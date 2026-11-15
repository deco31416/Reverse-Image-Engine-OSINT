import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { SocialSearchRepository } from './social-search.repository';
import { signUploadUrl } from '../common/upload-access';

export type SocialAssetStatus = 'candidate' | 'positive' | 'false_positive' | 'archived';

export type SaveSocialAssetPayload = {
  platform: string;
  owner: string;
  type: 'image' | 'profile' | 'post' | 'link' | 'other';
  sourceUrl?: string;
  publicUrl?: string;
  relativePath?: string;
  absolutePath?: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  searchId?: string;
  osintSearchId?: string;
  status?: SocialAssetStatus;
  metadata?: Record<string, any>;
};

@Injectable()
export class SocialAssetRepository {
  constructor(private readonly socialSearchRepository: SocialSearchRepository) {}

  status() {
    return {
      configured: this.socialSearchRepository.configured(),
      collection: 'social_assets',
    };
  }

  async saveAsset(payload: SaveSocialAssetPayload) {
    const model = await this.socialSearchRepository.assetModel();
    if (!model) return { saved: false, reason: 'mongo_not_configured' };

    const document = await model.create({
      ...payload,
      platform: payload.platform || 'general',
      owner: payload.owner || 'unknown',
      type: payload.type || 'other',
      status: payload.status || 'candidate',
      metadata: payload.metadata || {},
    });

    return { saved: true, id: String(document._id) };
  }

  async listAssets(options: {
    platform?: string;
    owner?: string;
    status?: SocialAssetStatus;
    osintSearchId?: string;
    osintSearchIds?: string;
    limit?: number;
  } = {}) {
    const model = await this.socialSearchRepository.assetModel();
    if (!model) return [];

    const filter: Record<string, any> = {};
    if (options.platform) filter.platform = options.platform;
    if (options.owner) filter.owner = options.owner;
    if (options.status) filter.status = options.status;
    if (options.osintSearchId) filter.osintSearchId = options.osintSearchId;
    else if (options.osintSearchIds !== undefined) {
      const ids = options.osintSearchIds.split(',').filter((id) => /^[a-f\d]{24}$/i.test(id)).slice(0, 500);
      if (!ids.length) return [];
      filter.osintSearchId = { $in: ids };
    }

    const assets = await model
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(options.limit || 50, 1), 200))
      .lean();
    return assets.map((asset: any) => this.refreshImageLink(asset));
  }

  async findAsset(id: string) {
    const model = await this.socialSearchRepository.assetModel();
    if (!model) return null;
    if (!Types.ObjectId.isValid(id)) return null;
    return this.refreshImageLink(await model.findById(id).lean());
  }

  private refreshImageLink(asset: any) {
    if (!asset || typeof asset.publicUrl !== 'string') return asset;
    // Only internal, API-key protected asset reads renew the stored image grant.
    return { ...asset, publicUrl: signUploadUrl(asset.publicUrl) };
  }

  async markStatus(id: string, status: SocialAssetStatus, metadata?: Record<string, any>) {
    const model = await this.socialSearchRepository.assetModel();
    if (!model) return { updated: false, reason: 'mongo_not_configured' };

    const document = await model.findByIdAndUpdate(
      id,
      {
        $set: {
          status,
          ...(metadata?.note ? { 'metadata.lastStatusNote': metadata.note } : {}),
          'metadata.statusUpdatedAt': new Date(),
        },
      },
      { new: true },
    );

    return document ? { updated: true, id: String(document._id), status: document.status } : { updated: false, reason: 'not_found' };
  }

  async deleteByOsintSearchId(osintSearchId: string) {
    const model = await this.socialSearchRepository.assetModel();
    if (!model) return { configured: false, assets: [] as any[] };
    const assets = await model.find({ osintSearchId }).select('_id absolutePath').lean();
    return { configured: true, assets, model };
  }
}
