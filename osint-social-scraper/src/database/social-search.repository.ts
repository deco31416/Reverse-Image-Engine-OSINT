import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import mongoose, { Connection, Model, Schema, Types } from 'mongoose';

type SocialSearchDocument = {
  kind: 'name' | 'username' | 'profile-url' | 'image';
  query: string;
  searchedPlatforms: string[];
  total: number;
  profiles: unknown[];
  providerErrors: unknown[];
  cacheKey: string;
  capturedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type SocialAssetDocument = {
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
  status: 'candidate' | 'positive' | 'false_positive' | 'archived';
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
};

type SaveSocialSearchPayload = Omit<SocialSearchDocument, 'createdAt' | 'updatedAt' | 'providerErrors'> & {
  errors: unknown[];
};

const SocialSearchSchema = new Schema<SocialSearchDocument>(
  {
    kind: { type: String, enum: ['name', 'username', 'profile-url', 'image'], required: true, index: true },
    query: { type: String, required: true, index: true },
    searchedPlatforms: [{ type: String, index: true }],
    total: { type: Number, default: 0 },
    profiles: { type: [Schema.Types.Mixed], default: [] },
    providerErrors: { type: [Schema.Types.Mixed], default: [] },
    cacheKey: { type: String, required: true, index: true },
    capturedAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'social_searches' },
);

SocialSearchSchema.index({ kind: 1, query: 1, capturedAt: -1 });

const SocialAssetSchema = new Schema<SocialAssetDocument>(
  {
    platform: { type: String, required: true, index: true },
    owner: { type: String, required: true, index: true },
    type: { type: String, enum: ['image', 'profile', 'post', 'link', 'other'], required: true, index: true },
    sourceUrl: { type: String },
    publicUrl: { type: String },
    relativePath: { type: String },
    absolutePath: { type: String },
    filename: { type: String },
    mimeType: { type: String },
    size: { type: Number },
    searchId: { type: String, index: true },
    osintSearchId: { type: String, index: true },
    status: { type: String, enum: ['candidate', 'positive', 'false_positive', 'archived'], default: 'candidate', index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: 'social_assets' },
);

SocialAssetSchema.index({ platform: 1, owner: 1, createdAt: -1 });
SocialAssetSchema.index({ osintSearchId: 1, status: 1 });

@Injectable()
export class SocialSearchRepository implements OnModuleDestroy {
  private readonly logger = new Logger(SocialSearchRepository.name);
  private connection?: Connection;
  private model?: Model<SocialSearchDocument>;
  private socialAssetModel?: Model<SocialAssetDocument>;
  private connecting?: Promise<void>;

  constructor(private readonly configService: ConfigService) {}

  configured() {
    return Boolean(this.configService.get<string>('MONGODB_URI'));
  }

  status() {
    return {
      configured: this.configured(),
      connected: this.connection?.readyState === 1,
      readyState: this.connection?.readyState ?? 0,
      collection: 'social_searches',
      assetCollection: 'social_assets',
    };
  }

  async healthCheck() {
    await this.ensureConnected();
    if (!this.configured()) {
      return { configured: false, connected: false, readyState: 0 };
    }

    const readyState = this.connection?.readyState ?? 0;
    if (readyState !== 1 || !this.connection?.db) {
      return { configured: true, connected: false, readyState };
    }

    await this.connection.db.admin().ping();
    return { configured: true, connected: true, readyState };
  }

  async saveSearch(payload: SaveSocialSearchPayload) {
    await this.ensureConnected();
    if (!this.model) return { saved: false, reason: 'mongo_not_configured' };

    const document = await this.model.create({
      ...payload,
      providerErrors: payload.errors,
    });
    return { saved: true, id: String(document._id) };
  }

  async recent(limit = 20) {
    await this.ensureConnected();
    if (!this.model) return [];

    return this.model
      .find()
      .sort({ capturedAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 100))
      .lean();
  }

  async findById(id: string) {
    await this.ensureConnected();
    if (!this.model || !Types.ObjectId.isValid(id)) return null;
    return this.model.findById(id).lean();
  }

  async assetModel() {
    await this.ensureConnected();
    return this.socialAssetModel;
  }

  private async ensureConnected() {
    if (!this.configured()) return;
    if (this.connection?.readyState === 1 && this.model) return;
    if (this.connecting) return this.connecting;

    this.connecting = this.connect();
    try {
      await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  private async connect() {
    const uri = this.configService.get<string>('MONGODB_URI');
    if (!uri) return;

    const connection = await mongoose.createConnection(uri, {
      serverSelectionTimeoutMS: Number(this.configService.get<string>('MONGO_SERVER_SELECTION_TIMEOUT_MS') || 5000),
    }).asPromise();

    this.connection = connection;
    this.model = connection.model<SocialSearchDocument>('SocialSearch', SocialSearchSchema);
    this.socialAssetModel = connection.model<SocialAssetDocument>('SocialAsset', SocialAssetSchema);
    this.logger.log('Mongo connected for social search persistence');
  }

  async onModuleDestroy() {
    if (this.connection) {
      await this.connection.close();
    }
  }
}
