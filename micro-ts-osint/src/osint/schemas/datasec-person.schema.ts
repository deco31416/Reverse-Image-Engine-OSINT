import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type DatasecPersonDocument = DatasecPerson & Document;

@Schema({ timestamps: true })
export class DatasecPerson {
  @Prop({ required: true, trim: true, index: true })
  firstName: string;

  @Prop({ trim: true, index: true })
  lastName?: string;

  @Prop({ type: [String], default: [], index: true })
  aliases: string[];

  @Prop({ trim: true, index: true })
  documentId?: string;

  @Prop({ trim: true })
  country?: string;

  @Prop({ trim: true, index: true })
  city?: string;

  @Prop({ trim: true })
  organization?: string;

  @Prop({ trim: true })
  role?: string;

  @Prop({ trim: true })
  phone?: string;

  @Prop({ trim: true, lowercase: true })
  email?: string;

  @Prop({ type: [String], default: [], index: true })
  tags: string[];

  @Prop({ type: String })
  notes?: string;

  @Prop({ default: 'active', enum: ['active', 'archived'], index: true })
  status: 'active' | 'archived';

  @Prop()
  primaryImageUrl?: string;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export const DatasecPersonSchema = SchemaFactory.createForClass(DatasecPerson);

DatasecPersonSchema.index({ firstName: 'text', lastName: 'text', aliases: 'text', documentId: 'text', city: 'text' });
DatasecPersonSchema.index({ createdAt: -1 });
