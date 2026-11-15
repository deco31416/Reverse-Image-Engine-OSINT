import axios from 'axios';
import * as cheerio from 'cheerio';
import { ConfigService } from '@nestjs/config';
import { SocialNormalizerService } from '../normalizer/social-normalizer.service';
import { StaticPublicProfileAdapter } from './static-public-profile.adapter';
import type { SocialPlatform } from '../types/social-platform.type';
import type { SocialProfile } from '../types/social-profile.type';

export abstract class RapidApiProfileAdapter extends StaticPublicProfileAdapter {
  protected abstract rapidApiKeyNames: string[];
  protected abstract hostEnvName: string;
  protected abstract usernamePathEnvName: string;
  protected abstract nameSearchPathEnvName: string;

  constructor(
    normalizer: SocialNormalizerService,
    protected readonly configService: ConfigService,
  ) {
    super(normalizer);
  }

  enabled() {
    return true;
  }

  async searchByUsername(username: string, limit = 10): Promise<SocialProfile[]> {
    const clean = this.cleanUsername(username);
    if (!clean) return [];

    const publicProfile = await this.fetchPublicProfile(clean).catch(() => null);
    if (publicProfile && this.hasUsefulPublicProfileData(publicProfile)) return [publicProfile];

    const enriched = await this.fetchRapidApiProfiles('username', clean, limit).catch(() => []);
    if (enriched.length) return this.mergePublicFallback(publicProfile, enriched);

    return super.searchByUsername(clean);
  }

  async searchByName(query: string, limit = 10): Promise<SocialProfile[]> {
    const clean = String(query || '').trim();
    if (!clean) return [];
    // No hay URL pública confiable para un nombre libre; aquí RapidAPI sí actúa como capa secundaria de descubrimiento.
    return this.fetchRapidApiProfiles('name', clean, limit).catch(() => []);
  }

  protected async fetchPublicProfile(username: string): Promise<SocialProfile | null> {
    if (this.configService.get<string>('PUBLIC_PROFILE_CRAWLER_ENABLED')?.trim().toLowerCase() === 'false') {
      return null;
    }

    const profileUrl = this.buildProfileUrl(username);
    const { data, request } = await axios.get<string>(profileUrl, {
      timeout: Number(this.configService.get<string>('PUBLIC_PROFILE_CRAWLER_TIMEOUT_MS') || 12000),
      maxRedirects: 3,
      responseType: 'text',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-419,es;q=0.9,en;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      },
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const $ = cheerio.load(data || '');
    const canonicalUrl = this.firstString(
      $('link[rel="canonical"]').attr('href'),
      $('meta[property="og:url"]').attr('content'),
      request?.res?.responseUrl,
      profileUrl,
    );
    const title = this.cleanTitle(
      this.firstString(
        $('meta[property="og:title"]').attr('content'),
        $('meta[name="twitter:title"]').attr('content'),
        $('title').first().text(),
      ),
    );
    const bio = this.firstString(
      $('meta[property="og:description"]').attr('content'),
      $('meta[name="twitter:description"]').attr('content'),
      $('meta[name="description"]').attr('content'),
    );
    const avatarUrl = this.firstString(
      $('meta[property="og:image"]').attr('content'),
      $('meta[name="twitter:image"]').attr('content'),
      $('link[rel="image_src"]').attr('href'),
      this.extractJsonLdImage($),
    );

    if (!title && !bio && !avatarUrl) return null;

    return this.normalizer.profile({
      platform: this.platform as SocialPlatform,
      name: title || undefined,
      username,
      profileUrl: canonicalUrl || profileUrl,
      avatarUrl: avatarUrl || undefined,
      bio: bio || undefined,
      images: avatarUrl ? [avatarUrl] : [],
      links: [],
      confidence: avatarUrl ? 0.62 : 0.52,
      source: 'scraper',
      metadata: {
        provider: 'public-profile-crawler',
        mode: 'own-first',
        title,
        canonicalUrl,
        rapidApiFallback: false,
      },
    });
  }

  private hasUsefulPublicProfileData(profile: SocialProfile) {
    return Boolean(profile.avatarUrl || profile.images.length || profile.bio || this.isSpecificProfileName(profile.name));
  }

  private mergePublicFallback(publicProfile: SocialProfile | null, enriched: SocialProfile[]) {
    if (!publicProfile) return enriched;
    return enriched.map((profile) => ({
      ...profile,
      metadata: {
        ...profile.metadata,
        publicCrawlerCandidate: {
          profileUrl: publicProfile.profileUrl,
          avatarUrl: publicProfile.avatarUrl,
          name: publicProfile.name,
          bio: publicProfile.bio,
        },
        rapidApiFallback: true,
      },
    }));
  }

  protected async fetchRapidApiProfiles(kind: 'username' | 'name', query: string, limit: number): Promise<SocialProfile[]> {
    const host = this.configService.get<string>(this.hostEnvName)?.trim();
    const pathTemplate = this.configService.get<string>(
      kind === 'username' ? this.usernamePathEnvName : this.nameSearchPathEnvName,
    )?.trim();
    const apiKey = this.resolveRapidApiKey();

    if (!host || !pathTemplate || !apiKey) return [];

    const url = `https://${host.replace(/^https?:\/\//, '').replace(/\/+$/, '')}${this.renderPath(pathTemplate, query, limit)}`;
    const { data } = await axios.get(url, {
      timeout: Number(this.configService.get<string>('RAPIDAPI_TIMEOUT_MS') || 15000),
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': host.replace(/^https?:\/\//, '').replace(/\/+$/, ''),
      },
    });

    return this.normalizeRapidApiResponse(data, query, kind, limit);
  }

  private resolveRapidApiKey() {
    for (const keyName of this.rapidApiKeyNames) {
      const value = this.configService.get<string>(keyName)?.trim();
      if (value) return value;
    }
    return '';
  }

  private renderPath(template: string, query: string, limit: number) {
    const encoded = encodeURIComponent(query.replace(/^@/, ''));
    const normalized = template.startsWith('/') ? template : `/${template}`;
    return normalized
      .replace(/\{username\}/g, encoded)
      .replace(/\{query\}/g, encoded)
      .replace(/\{limit\}/g, String(Math.max(Math.min(limit || 10, 50), 1)));
  }

  private normalizeRapidApiResponse(data: any, originalQuery: string, kind: 'username' | 'name', limit: number): SocialProfile[] {
    const rawItems = this.extractItems(data).slice(0, Math.max(Math.min(limit || 10, 50), 1));
    return rawItems
      .map((item) => this.normalizeItem(item, originalQuery, kind))
      .filter((profile): profile is SocialProfile => Boolean(profile));
  }

  private extractItems(data: any): any[] {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    for (const key of ['users', 'profiles', 'items', 'data', 'results', 'response']) {
      const value = data?.[key];
      if (Array.isArray(value)) return value;
      if (value && typeof value === 'object') {
        const nested = this.extractItems(value);
        if (nested.length) return nested;
      }
    }
    return [data];
  }

  private normalizeItem(item: any, originalQuery: string, kind: 'username' | 'name'): SocialProfile | null {
    if (!item || typeof item !== 'object') return null;
    const user = item.user || item.profile || item.author || item.owner || item;
    const username = this.firstString(
      user.username,
      user.user_name,
      user.uniqueId,
      user.unique_id,
      user.handle,
      user.screen_name,
      user.id,
      kind === 'username' ? originalQuery : '',
    )?.replace(/^@/, '');
    if (!username) return null;

    const profileUrl = this.firstString(
      user.profileUrl,
      user.profile_url,
      user.url,
      user.link,
      item.profileUrl,
      item.url,
    ) || this.buildProfileUrl(username);

    const avatarUrl = this.firstString(
      user.avatarUrl,
      user.avatar_url,
      user.profile_pic_url,
      user.profilePicUrl,
      user.picture,
      user.image,
      user.thumbnail,
      user.hd_profile_pic_url_info?.url,
    );
    const images = [
      avatarUrl,
      ...this.arrayStrings(user.images),
      ...this.arrayStrings(user.photos),
      ...this.arrayStrings(item.images),
      ...this.arrayStrings(item.photos),
    ].filter(Boolean);

    return this.normalizer.profile({
      platform: this.platform as SocialPlatform,
      name: this.firstString(user.fullName, user.full_name, user.name, user.nickname, user.title),
      username,
      profileUrl,
      avatarUrl,
      bio: this.firstString(user.bio, user.biography, user.description, user.signature),
      images: Array.from(new Set(images)),
      followers: this.firstNumber(user.followers, user.follower_count, user.followers_count, user.edge_followed_by?.count),
      following: this.firstNumber(user.following, user.following_count, user.follows_count, user.edge_follow?.count),
      posts: this.firstNumber(user.posts, user.media_count, user.video_count, user.aweme_count),
      links: this.arrayStrings(user.links),
      confidence: kind === 'username' ? 0.82 : 0.68,
      source: 'provider',
      metadata: {
        provider: 'rapidapi',
        mode: kind,
        rawKeys: Object.keys(user).slice(0, 30),
      },
    });
  }

  protected buildProfileUrl(username: string) {
    return `${this.baseUrl}/${encodeURIComponent(username)}`;
  }

  private firstString(...values: any[]) {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number') return String(value);
    }
    return '';
  }

  private firstNumber(...values: any[]) {
    for (const value of values) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return numeric;
    }
    return undefined;
  }

  private arrayStrings(value: any): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item?.url) return String(item.url);
        if (item?.src) return String(item.src);
        return '';
      })
      .filter(Boolean);
  }

  private extractJsonLdImage($: cheerio.CheerioAPI) {
    const scripts = $('script[type="application/ld+json"]')
      .map((_, element) => $(element).text())
      .get();

    for (const script of scripts) {
      try {
        const parsed = JSON.parse(script);
        const image = this.findJsonLdString(parsed, ['image', 'thumbnailUrl', 'logo']);
        if (image) return image;
      } catch {
        continue;
      }
    }

    return '';
  }

  private findJsonLdString(value: any, keys: string[]): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = this.findJsonLdString(item, keys);
        if (found) return found;
      }
      return '';
    }
    if (typeof value !== 'object') return '';
    for (const key of keys) {
      const found = this.findJsonLdString(value[key], keys);
      if (found) return found;
    }
    return '';
  }

  private cleanTitle(value: string) {
    return String(value || '')
      .replace(/\s*[\|•-]\s*(Instagram|Facebook|TikTok|X|YouTube|Threads|Bluesky).*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isSpecificProfileName(value?: string) {
    const clean = String(value || '').trim().toLowerCase();
    if (!clean) return false;
    return ![
      'instagram',
      'facebook',
      'tiktok',
      'tiktok - make your day',
      'x',
      'youtube',
      'threads',
      'bluesky',
    ].includes(clean);
  }
}
