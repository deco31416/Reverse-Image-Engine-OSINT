import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AuditLogDocument = AuditLog & Document;

/**
 * Audit Log Schema - Tracks all actions in the OSINT system
 * Used for compliance, debugging, and analytics
 */
@Schema({ timestamps: true })
export class AuditLog {
  /**
   * Action performed (e.g., "search_created", "evidence_added", "api_called")
   */
  @Prop({ required: true, index: true })
  action: string;

  /**
   * Type of entity affected (e.g., "search", "evidence", "api")
   */
  @Prop({ required: true, index: true })
  entityType: string;

  /**
   * ID of the affected entity
   */
  @Prop({ index: true })
  entityId?: string;

  /**
   * User who performed the action (optional)
   */
  @Prop({ index: true })
  userId?: string;

  /**
   * Additional metadata about the action
   */
  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;

  /**
   * IP address of the request (if applicable)
   */
  @Prop()
  ipAddress?: string;

  /**
   * User agent of the request (if applicable)
   */
  @Prop()
  userAgent?: string;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

// Indexes for performance
AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ entityType: 1, entityId: 1 });
AuditLogSchema.index({ userId: 1, createdAt: -1 });
