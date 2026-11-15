import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocialNormalizerService } from '../../normalizer/social-normalizer.service';
import { RapidApiProfileAdapter } from '../rapidapi-profile.adapter';

@Injectable()
export class TiktokAdapter extends RapidApiProfileAdapter {
  platform = 'tiktok' as const;
  protected baseUrl = 'https://www.tiktok.com/@';
  protected rapidApiKeyNames = ['TIKTOK_RAPIDAPI_KEY', 'RAPIDAPI_KEY'];
  protected hostEnvName = 'TIKTOK_RAPIDAPI_HOST';
  protected usernamePathEnvName = 'TIKTOK_RAPIDAPI_USERNAME_PATH';
  protected nameSearchPathEnvName = 'TIKTOK_RAPIDAPI_SEARCH_PATH';

  constructor(normalizer: SocialNormalizerService, configService: ConfigService) {
    super(normalizer, configService);
  }

  protected cleanUsername(username: string) {
    return super.cleanUsername(username).replace(/^@/, '');
  }

  protected buildProfileUrl(username: string) {
    return `${this.baseUrl}${encodeURIComponent(username)}`;
  }
}
