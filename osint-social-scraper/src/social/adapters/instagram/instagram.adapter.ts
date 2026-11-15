import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocialNormalizerService } from '../../normalizer/social-normalizer.service';
import { RapidApiProfileAdapter } from '../rapidapi-profile.adapter';

@Injectable()
export class InstagramAdapter extends RapidApiProfileAdapter {
  platform = 'instagram' as const;
  protected baseUrl = 'https://www.instagram.com';
  protected rapidApiKeyNames = ['RAPIDAPI_KEY_INSTAGRAM', 'RAPIDAPI_KEY'];
  protected hostEnvName = 'INSTAGRAM_RAPIDAPI_HOST';
  protected usernamePathEnvName = 'INSTAGRAM_RAPIDAPI_USERNAME_PATH';
  protected nameSearchPathEnvName = 'INSTAGRAM_RAPIDAPI_SEARCH_PATH';

  constructor(normalizer: SocialNormalizerService, configService: ConfigService) {
    super(normalizer, configService);
  }
}
