import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocialNormalizerService } from '../../normalizer/social-normalizer.service';
import { RapidApiProfileAdapter } from '../rapidapi-profile.adapter';

@Injectable()
export class FacebookAdapter extends RapidApiProfileAdapter {
  platform = 'facebook' as const;
  protected baseUrl = 'https://www.facebook.com';
  protected rapidApiKeyNames = ['RAPIDAPI_KEY_FB_SCRAPER3', 'RAPIDAPI_KEY'];
  protected hostEnvName = 'FACEBOOK_RAPIDAPI_HOST';
  protected usernamePathEnvName = 'FACEBOOK_RAPIDAPI_USERNAME_PATH';
  protected nameSearchPathEnvName = 'FACEBOOK_RAPIDAPI_SEARCH_PATH';

  constructor(normalizer: SocialNormalizerService, configService: ConfigService) {
    super(normalizer, configService);
  }
}
