import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type DatasecAssetDocument = DatasecAsset & Document;

@Schema({ timestamps: true })
export class DatasecAsset {
  @Prop({ type: Types.ObjectId, ref: 'DatasecPerson', index: true })
  personId?: Types.ObjectId;

  @Prop({ required: true, enum: ['image', 'face', 'profile', 'post', 'link', 'document'], index: true })
  type: 'image' | 'face' | 'profile' | 'post' | 'link' | 'document';

  @Prop({ required: true, enum: ['manual', 'osint', 'datasec_external'], index: true })
  origin: 'manual' | 'osint' | 'datasec_external';

  @Prop({ trim: true })
  title?: string;

  @Prop({ type: String })
  description?: string;

  @Prop()
  url?: string;

  @Prop()
  imageUrl?: string;

  @Prop()
  thumbnailUrl?: string;

  @Prop({ index: true })
  source?: string;

  @Prop({ index: true })
  searchId?: string;

  @Prop()
  evidenceId?: string;

  @Prop({ min: 0, max: 1 })
  confidence?: number;

  @Prop({ default: 'candidate', enum: ['candidate', 'validated', 'discarded'], index: true })
  curationStatus: 'candidate' | 'validated' | 'discarded';

  @Prop({ type: [String], default: [], index: true })
  tags: string[];

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export const DatasecAssetSchema = SchemaFactory.createForClass(DatasecAsset);

DatasecAssetSchema.index({ personId: 1, curationStatus: 1, createdAt: -1 });
DatasecAssetSchema.index({ evidenceId: 1 }, { sparse: true });
DatasecAssetSchema.index({ searchId: 1, origin: 1 });
DatasecAssetSchema.index({ title: 'text', description: 'text', source: 'text', tags: 'text' });
