import { Injectable } from '@nestjs/common';
import { SocialNormalizerService } from '../../normalizer/social-normalizer.service';
import { StaticPublicProfileAdapter } from '../static-public-profile.adapter';

@Injectable()
export class YoutubeAdapter extends StaticPublicProfileAdapter {
  platform = 'youtube' as const;
  protected baseUrl = 'https://www.youtube.com/@';

  constructor(normalizer: SocialNormalizerService) {
    super(normalizer);
  }

  async searchByUsername(username: string) {
    const clean = this.cleanUsername(username);
    if (!clean) return [];
    const isChannelId = /^UC[a-zA-Z0-9_-]{20,}$/.test(clean);
    return [
      this.normalizer.profile({
        platform: this.platform,
        username: clean,
        profileUrl: isChannelId
          ? `https://www.youtube.com/channel/${encodeURIComponent(clean)}`
          : `${this.baseUrl}${encodeURIComponent(clean)}`,
        confidence: 0.42,
        source: 'public-web',
        metadata: { mode: 'candidate-url', youtubeIdType: isChannelId ? 'channel-id' : 'handle' },
      }),
    ];
  }
}
