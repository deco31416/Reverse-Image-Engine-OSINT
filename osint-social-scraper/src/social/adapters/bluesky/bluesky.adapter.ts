import { Injectable } from '@nestjs/common';
import { SocialNormalizerService } from '../../normalizer/social-normalizer.service';
import { StaticPublicProfileAdapter } from '../static-public-profile.adapter';

@Injectable()
export class BlueskyAdapter extends StaticPublicProfileAdapter {
  platform = 'bluesky' as const;
  protected baseUrl = 'https://bsky.app/profile';

  constructor(normalizer: SocialNormalizerService) {
    super(normalizer);
  }
}
