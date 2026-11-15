import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TargetSubjectDocument = TargetSubject & Document;

@Schema({ timestamps: true })
export class TargetSubject {
  @Prop({ required: true, unique: true, index: true })
  subjectKey: string;

  @Prop({ required: true, index: true })
  searchId: string;

  @Prop({ required: true, enum: ['unknown', 'identified'], default: 'unknown', index: true })
  identityStatus: 'unknown' | 'identified';

  @Prop({ type: [String], default: [] })
  sourceImageUrls: string[];

  @Prop({ type: [String], default: [] })
  faceCropUrls: string[];

  @Prop({ type: [Object], default: [], select: false })
  biometricTemplates: Array<{
    assetSha256: string;
    embedding: number[];
    dimensions: number;
    model: string;
    modelVersion: string;
    qualityScore: number;
    sourceImageUrl?: string;
    createdAt: Date;
  }>;

  @Prop({ type: Types.ObjectId, ref: 'DatasecPerson', index: true })
  confirmedPersonId?: Types.ObjectId;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export const TargetSubjectSchema = SchemaFactory.createForClass(TargetSubject);
TargetSubjectSchema.index({ searchId: 1, identityStatus: 1 });
