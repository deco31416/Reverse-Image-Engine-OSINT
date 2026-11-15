import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AssetsModule } from './assets/assets.module';
import { CacheModule } from './cache/cache.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { SocialModule } from './social/social.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }),
    CacheModule,
    DatabaseModule,
    StorageModule,
    AssetsModule,
    HealthModule,
    SocialModule,
  ],
})
export class AppModule {}
