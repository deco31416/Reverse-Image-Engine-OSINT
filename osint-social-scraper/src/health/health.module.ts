import { Module } from '@nestjs/common';
import { CacheModule } from '../cache/cache.module';
import { DatabaseModule } from '../database/database.module';
import { StorageModule } from '../storage/storage.module';
import { HealthController } from './health.controller';

@Module({
  imports: [CacheModule, DatabaseModule, StorageModule],
  controllers: [HealthController],
})
export class HealthModule {}
