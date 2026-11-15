import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;
export type UserRole = 'admin' | 'analyst' | 'viewer';
export type UserStatus = 'active' | 'invited' | 'disabled';

@Schema({ timestamps: true, collection: 'auth_users' })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true, index: true })
  email: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true, index: true })
  username: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ required: true, enum: ['admin', 'analyst', 'viewer'], default: 'analyst', index: true })
  role: UserRole;

  @Prop({ required: true, enum: ['active', 'invited', 'disabled'], default: 'active', index: true })
  status: UserStatus;

  @Prop({ trim: true })
  displayName?: string;

  @Prop({ type: Date })
  lastLoginAt?: Date;

  @Prop({ type: Date })
  passwordChangedAt?: Date;

  @Prop({ default: 0, min: 0 })
  sessionVersion: number;

  @Prop({ default: false })
  mustChangePassword?: boolean;

  @Prop({ type: Object, default: {} })
  metadata?: Record<string, unknown>;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ email: 1, username: 1 });
