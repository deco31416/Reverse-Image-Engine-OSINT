import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type IdentityCandidateDocument = IdentityCandidate & Document;

@Schema({ timestamps: true })
export class IdentityCandidate {
  @Prop({ type: Types.ObjectId, ref: 'TargetSubject', required: true, index: true })
  subjectId: Types.ObjectId;

  @Prop({ required: true, index: true })
  searchId: string;

  @Prop({ index: true })
  displayName?: string;

  @Prop({ type: [String], default: [] })
  aliases: string[];

  @Prop({ type: [Object], default: [] })
  profiles: Array<{
    platform: string;
    url: string;
    username?: string;
    verificationStatus: 'candidate' | 'reachable' | 'verified' | 'rejected';
  }>;

  @Prop({ type: [String], default: [] })
  evidenceIds: string[];

  @Prop({ type: [String], default: [] })
  imageUrls: string[];

  @Prop({ type: Object, default: {} })
  scores: {
    discovery?: number;
    visual?: number;
    face?: number;
    social?: number;
    overall?: number;
  };

  @Prop({
    required: true,
    enum: ['not_evaluated', 'unavailable', 'no_face', 'unlikely', 'candidate', 'probable'],
    default: 'not_evaluated',
    index: true,
  })
  biometricStatus: 'not_evaluated' | 'unavailable' | 'no_face' | 'unlikely' | 'candidate' | 'probable';

  @Prop({ type: [Object], default: [] })
  signals: Array<{ type: string; value: string; score?: number; source?: string }>;

  @Prop({ required: true, enum: ['candidate', 'probable', 'confirmed', 'rejected'], default: 'candidate', index: true })
  status: 'candidate' | 'probable' | 'confirmed' | 'rejected';

  @Prop({ type: Types.ObjectId, ref: 'DatasecPerson', index: true })
  personId?: Types.ObjectId;

  @Prop({ type: [Object], default: [] })
  reviewHistory: Array<{
    previousStatus: 'candidate' | 'probable' | 'confirmed' | 'rejected';
    nextStatus: 'probable' | 'confirmed' | 'rejected';
    actorId: string;
    reason: string;
    reviewedAt: Date;
    personId?: string;
  }>;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export const IdentityCandidateSchema = SchemaFactory.createForClass(IdentityCandidate);
IdentityCandidateSchema.index({ subjectId: 1, status: 1, createdAt: -1 });
IdentityCandidateSchema.index({ searchId: 1, status: 1 });
IdentityCandidateSchema.index({ 'profiles.url': 1 });
IdentityCandidateSchema.index({ subjectId: 1, 'metadata.sha256': 1 });
