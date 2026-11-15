import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisCacheService } from '../cache/redis-cache.service';
import { SocialAssetRepository } from '../database/social-asset.repository';
import { SocialSearchRepository } from '../database/social-search.repository';
import { StorageService } from '../storage/storage.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
    private readonly redisCacheService: RedisCacheService,
    private readonly socialSearchRepository: SocialSearchRepository,
    private readonly socialAssetRepository: SocialAssetRepository,
  ) {}

  @Get()
  health() {
    return {
      status: 'UP',
      service: 'osint-social-scraper',
      timestamp: new Date().toISOString(),
      storage: this.storageService.info(),
      redis: this.redisCacheService.status(),
      mongo: this.socialSearchRepository.status(),
      assets: this.socialAssetRepository.status(),
      providers: {
        rapidApiConfigured: Boolean(this.configService.get<string>('RAPIDAPI_KEY')),
        rapidApiFacebookConfigured: Boolean(this.configService.get<string>('RAPIDAPI_KEY_FB_SCRAPER3')),
        rapidApiInstagramConfigured: Boolean(this.configService.get<string>('RAPIDAPI_KEY_INSTAGRAM')),
        rapidApiTikTokConfigured: Boolean(this.configService.get<string>('TIKTOK_RAPIDAPI_KEY')),
        rapidApiMode: 'secondary_fallback',
      },
      publicCrawler: {
        enabled: this.configService.get<string>('PUBLIC_PROFILE_CRAWLER_ENABLED')?.trim().toLowerCase() !== 'false',
        timeoutMs: Number(this.configService.get<string>('PUBLIC_PROFILE_CRAWLER_TIMEOUT_MS') || 12000),
        mode: 'own_first',
        promotesGenericPages: false,
      },
      protected: Boolean(
        this.configService.get<string>('SOCIAL_SCRAPER_API_KEY') ||
        this.configService.get<string>('MICROSERVICES_API_KEY'),
      ),
    };
  }
}
