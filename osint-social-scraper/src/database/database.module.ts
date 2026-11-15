import { Module } from '@nestjs/common';
import { SocialAssetRepository } from './social-asset.repository';
import { SocialSearchRepository } from './social-search.repository';

@Module({
  providers: [SocialSearchRepository, SocialAssetRepository],
  exports: [SocialSearchRepository, SocialAssetRepository],
})
export class DatabaseModule {}
