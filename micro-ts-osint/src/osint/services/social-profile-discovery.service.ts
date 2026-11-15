import { Injectable, Logger } from '@nestjs/common';
import { SecurityValidationService } from './security-validation.service';

export type DiscoveredSocialProfile = {
  url: string;
  platform: string;
  sourcePageUrl: string;
  sourceTitle?: string;
};

type VisualCandidate = {
  url?: string;
  title?: string;
  snippet?: string;
  domain?: string;
  source?: string;
  isSocialMedia?: boolean;
  socialPlatform?: string;
};

@Injectable()
export class SocialProfileDiscoveryService {
  private readonly logger = new Logger(SocialProfileDiscoveryService.name);
  private readonly maxPageBytes = 1;

  private readonly blockedDomains = [
    'adobe.com',
    'stock.adobe.com',
    'shutterstock.com',
    'unsplash.com',
    'pixabay.com',
    'vecteezy.com',
    'freepik.com',
    'magnific.com',
    'wikipedia.org',
    'wikimedia.org',
    'stockcake.com',
    'istockphoto.com',
    'gettyimages.com',
    'dreamstime.com',
    'alamy.com',
    'depositphotos.com',
    'fstoppers.com',
  ];

  private readonly socialDomains: Record<string, string> = {
    'instagram.com': 'instagram',
    'facebook.com': 'facebook',
    'fb.com': 'facebook',
    'tiktok.com': 'tiktok',
    'x.com': 'x',
    'twitter.com': 'x',
    'youtube.com': 'youtube',
    'youtu.be': 'youtube',
    'telegram.me': 'telegram',
    't.me': 'telegram',
    'threads.net': 'threads',
    'bsky.app': 'bluesky',
    'linkedin.com': 'linkedin',
    'pinterest.com': 'pinterest',
  };

  private readonly blockedCorporateHandles = new Set([
    'soundcloud',
    'shazam',
    'spotify',
    'youtube',
    'youtubecreators',
    'google',
    'facebook',
    'instagram',
    'x',
    'twitter',
    'pinterest',
    'tiktok',
    'linkedin',
    'grmdaily',
    'bbcleicester',
    'leicesterbbc',
    'bbc',
    'bbcnews',
  ]);

  constructor(private readonly securityValidation: SecurityValidationService) {}

  async discoverFromVisualCandidates(
    candidates: VisualCandidate[],
    options: { maxPages?: number; maxProfiles?: number; platforms?: string[] } = {},
  ) {
    const maxPages = Math.max(Math.min(options.maxPages || 8, 20), 1);
    const maxProfiles = Math.max(Math.min(options.maxProfiles || 20, 60), 1);
    const allowedPlatforms = new Set((options.platforms || []).map((item) => this.normalizePlatform(item)).filter(Boolean));
    const selectedPages = this.selectPages(candidates, maxPages);
    const byUrl = new Map<string, DiscoveredSocialProfile>();

    for (const candidate of selectedPages) {
      if (byUrl.size >= maxProfiles) break;
      const direct = this.asSocialProfile(candidate.url || '', candidate.url || '', candidate.title, allowedPlatforms);
      if (direct) {
        byUrl.set(direct.url, direct);
        continue;
      }

      const pageUrl = String(candidate.url || '').trim();
      try {
        const html = await this.fetchHtml(pageUrl);
        for (const profile of this.extractSocialProfiles(html, pageUrl, candidate.title, allowedPlatforms)) {
          if (byUrl.size >= maxProfiles) break;
          byUrl.set(profile.url, profile);
        }
      } catch (error: any) {
        this.logger.debug(`Social profile extraction skipped ${pageUrl}: ${error.message}`);
      }
    }

    return {
      pagesVisited: selectedPages.length,
      profilesFound: byUrl.size,
      profiles: Array.from(byUrl.values()),
    };
  }

  private selectPages(candidates: VisualCandidate[], limit: number) {
    const seen = new Set<string>();
    const pages: VisualCandidate[] = [];

    for (const candidate of candidates || []) {
      const url = String(candidate.url || '').trim();
      if (!/^https?:\/\//i.test(url)) continue;
      if (this.isBlockedCandidate(candidate)) continue;
      const normalized = this.normalizeUrl(url);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      pages.push(candidate);
      if (pages.length >= limit) break;
    }

    return pages;
  }

  private isBlockedCandidate(candidate: VisualCandidate) {
    const url = String(candidate.url || '').toLowerCase();
    const text = [candidate.title, candidate.snippet, candidate.domain].map((item) => String(item || '').toLowerCase()).join(' ');
    if (this.blockedDomains.some((domain) => url.includes(domain) || text.includes(domain))) return true;
    return /\b(stock|royalty-free|free photo|free image|vectors?|wallpaper|human face|person face|man face front|african men faces?|average faces?|faces around the world|image result for .*faces?)\b/i.test(text);
  }

  private async fetchHtml(url: string) {
    const bytes = await this.securityValidation.fetchPublicUrl(url, {
      field: 'socialDiscovery.pageUrl',
      accept: 'text/html,application/xhtml+xml,*/*;q=0.6',
      maxMb: this.maxPageBytes,
    });
    const html = bytes.toString('utf8');
    if (!/<html|<a\s|href=/i.test(html)) return '';
    return html;
  }

  private extractSocialProfiles(html: string, sourcePageUrl: string, sourceTitle: string | undefined, allowedPlatforms: Set<string>) {
    const found: DiscoveredSocialProfile[] = [];
    const hrefRegex = /\bhref\s*=\s*["']([^"']+)["']/gi;
    let match: RegExpExecArray | null;

    while ((match = hrefRegex.exec(html))) {
      const resolved = this.resolveUrl(match[1], sourcePageUrl);
      const profile = this.asSocialProfile(resolved, sourcePageUrl, sourceTitle, allowedPlatforms);
      if (profile) found.push(profile);
    }

    return found;
  }

  private asSocialProfile(url: string, sourcePageUrl: string, sourceTitle: string | undefined, allowedPlatforms: Set<string>): DiscoveredSocialProfile | null {
    const normalized = this.normalizeUrl(url);
    if (!normalized) return null;

    const platform = this.platformFromUrl(normalized);
    if (!platform) return null;
    if (allowedPlatforms.size && !allowedPlatforms.has(platform)) return null;
    if (!this.looksLikeProfileUrl(normalized, platform)) return null;

    return {
      url: normalized,
      platform,
      sourcePageUrl,
      sourceTitle,
    };
  }

  private platformFromUrl(url: string) {
    let host = '';
    try {
      host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return '';
    }

    for (const [domain, platform] of Object.entries(this.socialDomains)) {
      const normalizedDomain = domain.toLowerCase().replace(/^www\./, '');
      if (host === normalizedDomain || host.endsWith(`.${normalizedDomain}`)) {
        return this.normalizePlatform(platform);
      }
    }
    return '';
  }

  private looksLikeProfileUrl(url: string, platform: string) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }

    const parts = parsed.pathname.split('/').map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return false;
    const first = parts[0].toLowerCase();
    if (['share', 'intent', 'search', 'explore', 'hashtag', 'p', 'reel', 'watch', 'embed', 'login', 'signup', 'privacy', 'help', 'about'].includes(first)) return false;
    if (platform === 'pinterest') return false;
    if (platform === 'facebook' && ['sharer', 'sharer.php', 'plugins', 'events', 'marketplace', 'groups'].includes(first)) return false;
    if (platform === 'youtube') return first === 'channel' || first === 'c' || first === 'user' || first.startsWith('@');
    if (platform === 'telegram') return parts.length === 1;
    if (this.blockedCorporateHandles.has(first.replace(/^@/, '').toLowerCase())) return false;
    return true;
  }

  private resolveUrl(value: string, base: string) {
    try {
      return new URL(value, base).toString();
    } catch {
      return '';
    }
  }

  private normalizeUrl(value: string) {
    try {
      const parsed = new URL(value);
      parsed.hash = '';
      return parsed.toString().replace(/\/+$/, '');
    } catch {
      return '';
    }
  }

  private normalizePlatform(value: string) {
    const platform = String(value || '').toLowerCase().trim();
    if (platform === 'twitter') return 'x';
    return platform;
  }
}
