import { Module } from '@nestjs/common';
import { InternalApiKeyGuard } from '../common/guards/internal-api-key.guard';
import { DatabaseModule } from '../database/database.module';
import { StorageModule } from '../storage/storage.module';
import { AssetsController } from './assets.controller';

@Module({
  imports: [DatabaseModule, StorageModule],
  controllers: [AssetsController],
  providers: [InternalApiKeyGuard],
})
export class AssetsModule {}
