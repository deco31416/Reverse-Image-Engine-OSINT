import { Injectable } from '@nestjs/common';
import { SocialNormalizerService } from '../../normalizer/social-normalizer.service';
import { StaticPublicProfileAdapter } from '../static-public-profile.adapter';

@Injectable()
export class TelegramAdapter extends StaticPublicProfileAdapter {
  platform = 'telegram' as const;
  protected baseUrl = 'https://t.me';

  constructor(normalizer: SocialNormalizerService) {
    super(normalizer);
  }
}
