import { Injectable } from '@nestjs/common';
import { SocialNormalizerService } from '../../normalizer/social-normalizer.service';
import { StaticPublicProfileAdapter } from '../static-public-profile.adapter';

@Injectable()
export class MastodonAdapter extends StaticPublicProfileAdapter {
  platform = 'mastodon' as const;
  protected baseUrl = 'https://mastodon.social/@';

  constructor(normalizer: SocialNormalizerService) {
    super(normalizer);
  }

  async searchByUsername(username: string) {
    const clean = this.cleanUsername(username);
    if (!clean) return [];
    return [
      this.normalizer.profile({
        platform: this.platform,
        username: clean,
        profileUrl: `${this.baseUrl}${encodeURIComponent(clean)}`,
        confidence: 0.38,
        source: 'public-web',
        metadata: { mode: 'candidate-url', note: 'Instance can vary; mastodon.social is only the default candidate.' },
      }),
    ];
  }
}
