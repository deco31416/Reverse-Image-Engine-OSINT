import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { InternalApiKeyGuard } from '../common/guards/internal-api-key.guard';
import { SocialAssetRepository } from '../database/social-asset.repository';
import { StorageService } from '../storage/storage.service';
import { ListAssetsDto } from './dto/list-assets.dto';
import { MarkAssetDto } from './dto/mark-asset.dto';
import { SaveImageDto } from './dto/save-image.dto';

@UseGuards(InternalApiKeyGuard)
@Controller('assets')
export class AssetsController {
  constructor(
    private readonly storageService: StorageService,
    private readonly socialAssetRepository: SocialAssetRepository,
  ) {}

  @Post('images/base64')
  async saveBase64Image(@Body() dto: SaveImageDto) {
    const saved = await this.storageService.saveBase64Image(dto);
    const asset = await this.socialAssetRepository.saveAsset({
      platform: dto.platform || 'general',
      owner: dto.owner || 'unknown',
      type: 'image',
      sourceUrl: dto.sourceUrl,
      publicUrl: saved.publicUrl,
      relativePath: saved.relativePath,
      absolutePath: saved.absolutePath,
      filename: saved.filename,
      mimeType: saved.mimeType,
      size: saved.size,
      osintSearchId: dto.osintSearchId,
      status: 'candidate',
      metadata: { scope: dto.scope || 'social' },
    });

    return { ...saved, asset };
  }

  @Get()
  listAssets(@Query() query: ListAssetsDto) {
    return this.socialAssetRepository.listAssets(query);
  }

  @Get(':id')
  getAsset(@Param('id') id: string) {
    return this.socialAssetRepository.findAsset(id);
  }

  @Patch(':id/status')
  markAsset(@Param('id') id: string, @Body() dto: MarkAssetDto) {
    return this.socialAssetRepository.markStatus(id, dto.status, dto.note ? { note: dto.note } : undefined);
  }

  @Delete('by-search/:searchId')
  async deleteBySearch(@Param('searchId') searchId: string) {
    const result = await this.socialAssetRepository.deleteByOsintSearchId(searchId);
    if (!result.configured) return { success: true, skipped: true, reason: 'mongo_not_configured', assetsDeleted: 0, filesDeleted: 0 };
    let filesDeleted = 0;
    for (const asset of result.assets) {
      if (await this.storageService.deleteAssetFile(asset.absolutePath)) filesDeleted += 1;
    }
    const deleted = await result.model.deleteMany({ osintSearchId: searchId });
    return { success: true, skipped: false, assetsDeleted: deleted.deletedCount, filesDeleted };
  }
}
