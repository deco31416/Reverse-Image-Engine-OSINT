import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { SocialNormalizerService } from '../../normalizer/social-normalizer.service';
import type { SocialAdapter } from '../social-adapter.interface';
import type { SocialProfile } from '../../types/social-profile.type';

@Injectable()
export class GithubAdapter implements SocialAdapter {
  platform = 'github' as const;

  constructor(private readonly normalizer: SocialNormalizerService) {}

  enabled() {
    return true;
  }

  async searchByUsername(username: string): Promise<SocialProfile[]> {
    try {
      const clean = this.cleanUsername(username);
      if (!clean) return [];

      const { data } = await axios.get(`https://api.github.com/users/${encodeURIComponent(clean)}`, {
        timeout: 10000,
        headers: { Accept: 'application/vnd.github+json' },
      });

      return [
        this.normalizer.profile({
          platform: this.platform,
          name: data.name,
          username: data.login,
          profileUrl: data.html_url,
          avatarUrl: data.avatar_url,
          bio: data.bio,
          followers: data.followers,
          following: data.following,
          links: [data.blog].filter(Boolean),
          confidence: 0.95,
          source: 'api',
          metadata: {
            company: data.company,
            location: data.location,
            publicRepos: data.public_repos,
          },
        }),
      ];
    } catch {
      return [];
    }
  }

  async searchByName(query: string, limit = 10): Promise<SocialProfile[]> {
    try {
      const { data } = await axios.get('https://api.github.com/search/users', {
        timeout: 10000,
        params: { q: query, per_page: Math.min(limit, 30) },
        headers: { Accept: 'application/vnd.github+json' },
      });

      return (data.items || []).map((item: any) =>
        this.normalizer.profile({
          platform: this.platform,
          username: item.login,
          profileUrl: item.html_url,
          avatarUrl: item.avatar_url,
          confidence: 0.72,
          source: 'api',
          metadata: { githubScore: item.score },
        }),
      );
    } catch {
      return [];
    }
  }

  private cleanUsername(username: string) {
    const raw = String(username || '').trim().replace(/^@/, '');

    try {
      if (/^https?:\/\//i.test(raw)) {
        const parsed = new URL(raw);
        if (!parsed.hostname.toLowerCase().includes('github.com')) return '';
        const parts = parsed.pathname.split('/').filter(Boolean);
        return parts[0] || '';
      }
    } catch {
      return '';
    }

    return raw.split(/[/?#]/)[0].replace(/^@/, '');
  }
}
