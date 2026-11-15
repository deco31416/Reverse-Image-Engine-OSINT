import { SocialNormalizerService } from '../normalizer/social-normalizer.service';
import type { SocialAdapter } from './social-adapter.interface';
import type { SocialPlatform } from '../types/social-platform.type';
import type { SocialProfile } from '../types/social-profile.type';

export abstract class StaticPublicProfileAdapter implements SocialAdapter {
  abstract platform: SocialPlatform;
  protected abstract baseUrl: string;

  constructor(protected readonly normalizer: SocialNormalizerService) {}

  enabled() {
    return true;
  }

  async searchByUsername(username: string): Promise<SocialProfile[]> {
    const clean = this.cleanUsername(username);
    if (!clean) return [];

    return [
      this.normalizer.profile({
        platform: this.platform,
        username: clean,
        profileUrl: this.buildProfileUrl(clean),
        confidence: 0.45,
        source: 'public-web',
        metadata: {
          mode: 'candidate-url',
          note: 'Candidate profile URL generated. Add platform-specific scraper/provider to enrich.',
        },
      }),
    ];
  }

  async searchByName(_query?: string, _limit?: number): Promise<SocialProfile[]> {
    return [];
  }

  protected cleanUsername(username: string) {
    const raw = String(username || '').trim().replace(/^@/, '');

    try {
      if (/^https?:\/\//i.test(raw)) {
        const parsed = new URL(raw);
        const parts = parsed.pathname.split('/').filter(Boolean);
        return (parts.at(-1) || '').replace(/^@/, '');
      }
    } catch {
      return '';
    }

    return raw.split(/[/?#]/)[0].replace(/^@/, '');
  }

  protected buildProfileUrl(username: string) {
    return `${this.baseUrl}/${encodeURIComponent(username)}`;
  }
}
