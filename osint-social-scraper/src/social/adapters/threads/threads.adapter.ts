import { Injectable } from '@nestjs/common';
import { SocialNormalizerService } from '../../normalizer/social-normalizer.service';
import { StaticPublicProfileAdapter } from '../static-public-profile.adapter';

@Injectable()
export class ThreadsAdapter extends StaticPublicProfileAdapter {
  platform = 'threads' as const;
  protected baseUrl = 'https://www.threads.net/@';

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
        confidence: 0.42,
        source: 'public-web',
        metadata: { mode: 'candidate-url' },
      }),
    ];
  }
}
