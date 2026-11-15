import { Injectable } from '@nestjs/common';
import { SocialNormalizerService } from '../../normalizer/social-normalizer.service';
import { StaticPublicProfileAdapter } from '../static-public-profile.adapter';

@Injectable()
export class DiscordAdapter extends StaticPublicProfileAdapter {
  platform = 'discord' as const;
  protected baseUrl = 'https://discord.com/users';

  constructor(normalizer: SocialNormalizerService) {
    super(normalizer);
  }
}
