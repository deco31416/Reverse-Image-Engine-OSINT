import { Injectable } from '@nestjs/common';
import { SocialNormalizerService } from '../../normalizer/social-normalizer.service';
import { StaticPublicProfileAdapter } from '../static-public-profile.adapter';

@Injectable()
export class XAdapter extends StaticPublicProfileAdapter {
  platform = 'x' as const;
  protected baseUrl = 'https://x.com';

  constructor(normalizer: SocialNormalizerService) {
    super(normalizer);
  }
}
