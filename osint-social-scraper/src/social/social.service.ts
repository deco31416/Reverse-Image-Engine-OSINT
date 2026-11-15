import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { RedisCacheService } from '../cache/redis-cache.service';
import { SocialAssetRepository } from '../database/social-asset.repository';
import { SocialSearchRepository } from '../database/social-search.repository';
import { SearchNameDto } from './dto/search-name.dto';
import { SearchImageDto } from './dto/search-image.dto';
import { ResolveProfileUrlDto } from './dto/resolve-profile-url.dto';
import { SearchUsernameDto } from './dto/search-username.dto';
import { SOCIAL_PLATFORMS, SocialPlatform } from './types/social-platform.type';
import type { SocialAdapter } from './adapters/social-adapter.interface';
import { GithubAdapter } from './adapters/github/github.adapter';
import { InstagramAdapter } from './adapters/instagram/instagram.adapter';
import { FacebookAdapter } from './adapters/facebook/facebook.adapter';
import { TiktokAdapter } from './adapters/tiktok/tiktok.adapter';
import { XAdapter } from './adapters/x/x.adapter';
import { RedditAdapter } from './adapters/reddit/reddit.adapter';
import { PinterestAdapter } from './adapters/pinterest/pinterest.adapter';
import { MediumAdapter } from './adapters/medium/medium.adapter';
import { YoutubeAdapter } from './adapters/youtube/youtube.adapter';
import { TelegramAdapter } from './adapters/telegram/telegram.adapter';
import { DiscordAdapter } from './adapters/discord/discord.adapter';
import { ThreadsAdapter } from './adapters/threads/threads.adapter';
import { MastodonAdapter } from './adapters/mastodon/mastodon.adapter';
import { BlueskyAdapter } from './adapters/bluesky/bluesky.adapter';
import { ImageFingerprintService } from './visual/image-fingerprint.service';

@Injectable()
export class SocialService {
  private readonly adapters: SocialAdapter[];

  constructor(
    github: GithubAdapter,
    instagram: InstagramAdapter,
    facebook: FacebookAdapter,
    tiktok: TiktokAdapter,
    x: XAdapter,
    reddit: RedditAdapter,
    pinterest: PinterestAdapter,
    medium: MediumAdapter,
    youtube: YoutubeAdapter,
    telegram: TelegramAdapter,
    discord: DiscordAdapter,
    threads: ThreadsAdapter,
    mastodon: MastodonAdapter,
    bluesky: BlueskyAdapter,
    private readonly cacheService: RedisCacheService,
    private readonly searchRepository: SocialSearchRepository,
    private readonly assetRepository: SocialAssetRepository,
    private readonly imageFingerprintService: ImageFingerprintService,
  ) {
    this.adapters = [
      github,
      instagram,
      facebook,
      tiktok,
      x,
      reddit,
      pinterest,
      medium,
      youtube,
      telegram,
      discord,
      threads,
      mastodon,
      bluesky,
    ];
  }

  platforms() {
    return SOCIAL_PLATFORMS.map((platform) => ({
      platform,
      implemented: this.adapters.some((adapter) => adapter.platform === platform),
      enabled: this.adapters.find((adapter) => adapter.platform === platform)?.enabled() || false,
    }));
  }

  async searchByUsername(dto: SearchUsernameDto) {
    const adapters = this.selectAdapters(dto.platforms);
    const cacheKey = this.cacheKey('username', dto.username, adapters.map((adapter) => adapter.platform), dto.limit || 10);
    const cached = await this.cacheService.getJson(cacheKey);
    if (cached) return { ...(cached as Record<string, unknown>), cache: { hit: true, key: cacheKey } };

    const results = await Promise.allSettled(
      adapters.map((adapter) => adapter.searchByUsername(dto.username, dto.limit || 10)),
    );

    return this.response('username', dto.username, adapters, results, cacheKey);
  }

  async searchByName(dto: SearchNameDto) {
    const adapters = this.selectAdapters(dto.platforms);
    const cacheKey = this.cacheKey('name', dto.query, adapters.map((adapter) => adapter.platform), dto.limit || 10);
    const cached = await this.cacheService.getJson(cacheKey);
    if (cached) return { ...(cached as Record<string, unknown>), cache: { hit: true, key: cacheKey } };

    const results = await Promise.allSettled(
      adapters.map((adapter) => adapter.searchByName(dto.query, dto.limit || 10)),
    );

    return this.response('name', dto.query, adapters, results, cacheKey);
  }

  async resolveProfileUrl(dto: ResolveProfileUrlDto) {
    const resolved = this.resolvePlatformAndUsername(dto.url);
    if (!resolved) {
      return {
        kind: 'profile-url',
        query: dto.url,
        searchedPlatforms: [],
        total: 0,
        profiles: [],
        errors: [{ message: 'Unsupported or unrecognized social profile URL' }],
        capturedAt: new Date().toISOString(),
      };
    }

    const adapter = this.adapters.find((item) => item.platform === resolved.platform);
    if (!adapter || !adapter.enabled()) {
      return {
        kind: 'profile-url',
        query: dto.url,
        searchedPlatforms: [resolved.platform],
        total: 0,
        profiles: [],
        errors: [{ platform: resolved.platform, message: 'Platform adapter is not enabled' }],
        capturedAt: new Date().toISOString(),
      };
    }

    const cacheKey = this.cacheKey('profile-url', dto.url, [resolved.platform], 1);
    const cached = await this.cacheService.getJson(cacheKey);
    if (cached) return { ...(cached as Record<string, unknown>), cache: { hit: true, key: cacheKey } };

    const results = await Promise.allSettled([adapter.searchByUsername(resolved.username, 1)]);
    return this.response('profile-url', dto.url, [adapter], results, cacheKey);
  }

  async searchByImage(dto: SearchImageDto) {
    const matches = await this.imageFingerprintService.searchSimilar({
      base64: dto.base64,
      platforms: dto.platforms,
      limit: dto.limit || 10,
    });

    const profiles = dto.enrichProfiles
      ? await this.enrichMatchesFromOwners(matches, dto.platforms)
      : [];

    const capturedAt = new Date().toISOString();
    const response = {
      kind: 'image',
      query: dto.ownerHint || 'uploaded-image',
      searchedPlatforms: dto.platforms || this.adapters.map((adapter) => adapter.platform),
      total: matches.length,
      matches,
      profiles,
      capturedAt,
      note: 'Local perceptual image comparison against images stored in the upload volume.',
    };

    const cacheKey = this.cacheKey('image', `${dto.ownerHint || ''}:${matches.map((item) => item.relativePath).join('|')}`, response.searchedPlatforms, dto.limit || 10);
    const persistence = await this.searchRepository.saveSearch({
      kind: 'image',
      query: response.query,
      searchedPlatforms: response.searchedPlatforms,
      total: response.total,
      profiles: response.profiles,
      errors: [],
      cacheKey,
      capturedAt: new Date(capturedAt),
    });

    await this.saveImageMatchesAsAssets(response.matches, persistence?.id);
    await this.saveProfilesAsAssets(response.profiles, persistence?.id);

    return { ...response, persistence };
  }

  private async saveProfilesAsAssets(profiles: any[], searchId?: string) {
    for (const profile of profiles || []) {
      const quality = this.profileEvidenceQuality(profile);
      if (quality === 'candidate-url') continue;

      await this.assetRepository.saveAsset({
        platform: profile.platform || 'social',
        owner: profile.username || profile.name || 'unknown',
        type: 'profile',
        sourceUrl: profile.profileUrl,
        publicUrl: profile.avatarUrl,
        searchId,
        status: 'candidate',
        metadata: {
          ...profile,
          evidenceQuality: quality,
          preservationPriority: this.profilePreservationPriority(profile, quality),
        },
      });
    }
  }

  private profileEvidenceQuality(profile: any) {
    if (profile?.metadata?.provider === 'rapidapi' || profile?.source === 'provider') return 'provider-enriched';
    if (profile?.metadata?.provider === 'public-profile-crawler' || profile?.source === 'scraper') return 'scraped-profile';
    if (profile?.avatarUrl || profile?.images?.length || profile?.bio || profile?.followers || profile?.posts) return 'enriched-profile';
    return 'candidate-url';
  }

  private profilePreservationPriority(profile: any, quality: string) {
    if (profile?.avatarUrl || profile?.images?.length) return 'high';
    if (quality === 'provider-enriched' || quality === 'scraped-profile') return 'medium';
    return 'low';
  }

  private async saveImageMatchesAsAssets(matches: any[], searchId?: string) {
    for (const match of matches || []) {
      await this.assetRepository.saveAsset({
        platform: match.platform || 'social',
        owner: match.owner || 'unknown',
        type: 'image',
        publicUrl: match.publicUrl,
        relativePath: match.relativePath,
        absolutePath: match.absolutePath,
        filename: match.filename,
        searchId,
        status: 'candidate',
        metadata: {
          score: match.score,
          similarity: match.similarity,
          distance: match.distance,
        },
      });
    }
  }

  async recent(limit = 20) {
    return this.searchRepository.recent(limit);
  }

  async findSearch(id: string) {
    return this.searchRepository.findById(id);
  }

  private selectAdapters(platforms?: SocialPlatform[]) {
    const selected = platforms?.length ? platforms : this.adapters.map((adapter) => adapter.platform);
    return this.adapters.filter((adapter) => selected.includes(adapter.platform) && adapter.enabled());
  }

  private async response(
    kind: 'name' | 'username' | 'profile-url' | 'image',
    query: string,
    adapters: SocialAdapter[],
    results: PromiseSettledResult<any[]>[],
    cacheKey: string,
  ) {
    const profiles = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
    const capturedAt = new Date().toISOString();
    const response = {
      kind,
      query,
      searchedPlatforms: adapters.map((adapter) => adapter.platform),
      total: profiles.length,
      profiles,
      errors: results
        .map((result, index) =>
          result.status === 'rejected'
            ? { platform: adapters[index]?.platform, message: result.reason?.message || String(result.reason) }
            : null,
        )
        .filter(Boolean),
      capturedAt,
      cache: { hit: false, key: cacheKey },
    };

    await this.cacheService.setJson(cacheKey, response);
    const persistence = await this.searchRepository.saveSearch({
      kind,
      query,
      searchedPlatforms: response.searchedPlatforms,
      total: response.total,
      profiles: response.profiles,
      errors: response.errors,
      cacheKey,
      capturedAt: new Date(capturedAt),
    });

    await this.saveProfilesAsAssets(response.profiles, persistence?.id);

    return { ...response, persistence };
  }

  private cacheKey(kind: 'name' | 'username' | 'profile-url' | 'image', query: string, platforms: SocialPlatform[], limit: number) {
    return crypto
      .createHash('sha256')
      .update(JSON.stringify({ kind, query: query.trim().toLowerCase(), platforms: [...platforms].sort(), limit }))
      .digest('hex');
  }

  private async enrichMatchesFromOwners(matches: Array<{ owner: string; platform: string }>, platforms?: SocialPlatform[]) {
    const seen = new Set<string>();
    const enrichedProfiles = [];

    for (const match of matches) {
      const platform = match.platform as SocialPlatform;
      const owner = match.owner;
      const key = `${platform}:${owner}`;

      if (!owner || owner === 'unknown' || seen.has(key)) continue;
      if (platforms?.length && !platforms.includes(platform)) continue;

      const adapter = this.adapters.find((item) => item.platform === platform);
      if (!adapter?.enabled()) continue;

      seen.add(key);
      const profiles = await adapter.searchByUsername(owner, 1);
      enrichedProfiles.push(...profiles);
    }

    return enrichedProfiles;
  }

  private resolvePlatformAndUsername(url: string): { platform: SocialPlatform; username: string } | null {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      const parts = parsed.pathname.split('/').filter(Boolean);
      const last = (parts.at(-1) || '').replace(/^@/, '');
      const first = (parts[0] || '').replace(/^@/, '');

      if (host === 'github.com' && first) return { platform: 'github', username: first };
      if (host === 'instagram.com' && first) return { platform: 'instagram', username: first };
      if (host === 'facebook.com' && first) return { platform: 'facebook', username: first };
      if (host === 'x.com' && first) return { platform: 'x', username: first };
      if (host === 'twitter.com' && first) return { platform: 'x', username: first };
      if (host === 'tiktok.com' && first) return { platform: 'tiktok', username: first };
      if (host === 'reddit.com' && parts[0] === 'user' && parts[1]) return { platform: 'reddit', username: parts[1] };
      if (host === 'pinterest.com' && first) return { platform: 'pinterest', username: first };
      if (host === 'medium.com' && first) return { platform: 'medium', username: first };
      if (host === 'youtube.com' && parts[0] === 'channel' && parts[1]) return { platform: 'youtube', username: parts[1] };
      if (host === 'youtube.com' && parts[0]?.startsWith('@')) return { platform: 'youtube', username: parts[0] };
      if (host === 'youtube.com' && parts[0] === 'c' && parts[1]) return { platform: 'youtube', username: parts[1] };
      if (host === 'youtube.com' && parts[0] === 'user' && parts[1]) return { platform: 'youtube', username: parts[1] };
      if (host === 'youtube.com' && first) return { platform: 'youtube', username: first };
      if (host === 'youtu.be' && last) return { platform: 'youtube', username: last };
      if (host === 't.me' && first) return { platform: 'telegram', username: first };
      if (host === 'discord.com' && last) return { platform: 'discord', username: last };
      if (host === 'threads.net' && first) return { platform: 'threads', username: first };
      if (host === 'bsky.app' && parts[0] === 'profile' && parts[1]) return { platform: 'bluesky', username: parts[1] };
      if (host.includes('mastodon') && last) return { platform: 'mastodon', username: last };
      return null;
    } catch {
      return null;
    }
  }
}
