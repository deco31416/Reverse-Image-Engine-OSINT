import { Injectable } from '@nestjs/common';
import { SocialNormalizerService } from '../../normalizer/social-normalizer.service';
import { StaticPublicProfileAdapter } from '../static-public-profile.adapter';

@Injectable()
export class PinterestAdapter extends StaticPublicProfileAdapter {
  platform = 'pinterest' as const;
  protected baseUrl = 'https://www.pinterest.com';

  constructor(normalizer: SocialNormalizerService) {
    super(normalizer);
  }
}
