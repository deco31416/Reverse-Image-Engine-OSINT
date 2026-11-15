import { Injectable } from '@nestjs/common';
import { SocialNormalizerService } from '../../normalizer/social-normalizer.service';
import { StaticPublicProfileAdapter } from '../static-public-profile.adapter';

@Injectable()
export class RedditAdapter extends StaticPublicProfileAdapter {
  platform = 'reddit' as const;
  protected baseUrl = 'https://www.reddit.com/user';

  constructor(normalizer: SocialNormalizerService) {
    super(normalizer);
  }
}
