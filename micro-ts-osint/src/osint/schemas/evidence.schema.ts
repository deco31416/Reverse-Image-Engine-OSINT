import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EvidenceDocument = Evidence & Document;

/**
 * Evidence signals breakdown
 */
export interface EvidenceSignals {
  identity: number; // Identity-related signals (names, photos, aliases)
  legal: number; // Legal signals (lawsuits, fines, records)
  financial: number; // Financial signals (companies, properties)
  social: number; // Social media signals
}

/**
 * Evidence Schema - Stores deduplicated evidence items from OSINT searches
 * Uses SHA256 hash for deduplication
 */
@Schema({ timestamps: true })
export class Evidence {
  /**
   * Unique evidence ID (SHA256 hash of source + title + url)
   * Used for deduplication
   */
  @Prop({ required: true })
  evidenceId: string;

  /**
   * Reference to the OSINT search that found this evidence
   */
  @Prop({ required: true, index: true })
  searchId: string;

  /**
   * Source of the evidence (e.g., "Google CSE", "LinkedIn", "Twitter")
   */
  @Prop({ required: true })
  source: string;

  /**
   * Category of evidence
   */
  @Prop({
    required: true,
    enum: [
      'identity',
      'legal',
      'financial',
      'social',
      'other',
      'search_result',
      'video',
      'crawled_page',
      'archived_page',
      'google_vision',
      'visual_context',
    ],
    index: true,
  })
  category:
    | 'identity'
    | 'legal'
    | 'financial'
    | 'social'
    | 'other'
    | 'search_result'
    | 'video'
    | 'crawled_page'
    | 'archived_page'
    | 'google_vision'
    | 'visual_context';

  /**
   * Title or heading of the evidence
   */
  @Prop({ required: true })
  title: string;

  /**
   * Summary or excerpt of the evidence content
   */
  @Prop({ required: true, type: String })
  summary: string;

  /**
   * URL where the evidence was found (optional)
   */
  @Prop()
  url?: string;

  /**
   * Timestamp when this evidence was fetched
   */
  @Prop({ required: true, type: Date })
  fetchedAt: Date;

  /**
   * Reliability score (0.0 to 1.0)
   * Based on source credibility and content verification
   */
  @Prop({ required: true, min: 0, max: 1, default: 0.5 })
  reliability: number;

  /**
   * Signal breakdown (identity, legal, financial, social counts)
   */
  @Prop({
    type: Object,
    default: { identity: 0, legal: 0, financial: 0, social: 0 },
  })
  signals: EvidenceSignals;

  /**
   * Tags for categorization and filtering
   */
  @Prop({ type: [String], default: [] })
  tags: string[];

  /**
   * Extracted data from this evidence
   */
  @Prop({ type: Object })
  extractedData?: {
    emails?: string[];
    phones?: string[];
    rfcs?: string[];
    curps?: string[];
    urls?: string[];
    ips?: string[];
  };

  /**
   * Validation status
   * - pending: Not yet validated
   * - valid: Confirmed as correct match
   * - false_positive: Discarded as incorrect match
   */
  @Prop({
    required: false,
    enum: ['pending', 'valid', 'false_positive'],
    default: 'pending',
    index: true,
  })
  validationStatus: 'pending' | 'valid' | 'false_positive';

  /**
   * User ID who validated this evidence
   */
  @Prop({ required: false })
  validatedBy?: string;

  /**
   * Timestamp when validated
   */
  @Prop({ required: false, type: Date })
  validatedAt?: Date;

  @Prop({ default: false, index: true })
  isArchived: boolean;

  @Prop({ required: false, type: Date })
  archivedAt?: Date;

  @Prop({ required: false })
  archivedBy?: string;

  @Prop({ required: false })
  archiveReason?: string;

  @Prop({ required: false, type: Date })
  restoredAt?: Date;

  @Prop({ required: false })
  restoredBy?: string;

  /**
   * Image URL if this evidence contains a photo
   */
  @Prop({ required: false })
  imageUrl?: string;

  /**
   * Thumbnail URL for gallery display
   */
  @Prop({ required: false })
  thumbnailUrl?: string;

  /**
   * Match confidence score (0.0-1.0) for image searches
   */
  @Prop({ required: false, min: 0, max: 1 })
  matchConfidence?: number;

  @Prop({ required: false, enum: ['not_requested', 'searching', 'recovered', 'no_public_image', 'profile_inaccessible', 'profile_unverified'], default: 'not_requested' })
  imageEnrichmentStatus?: 'not_requested' | 'searching' | 'recovered' | 'no_public_image' | 'profile_inaccessible' | 'profile_unverified';

  @Prop({ required: false, type: Object })
  imageEnrichment?: {
    attemptedAt?: Date;
    method?: string;
    profileUrl?: string;
    originalImageUrl?: string;
    storedImageUrl?: string;
    reason?: string;
  };
}

export const EvidenceSchema = SchemaFactory.createForClass(Evidence);

// Indexes for performance
EvidenceSchema.index({ evidenceId: 1 }, { unique: true });
EvidenceSchema.index({ searchId: 1, category: 1 });
EvidenceSchema.index({ searchId: 1, reliability: -1 });
EvidenceSchema.index({ searchId: 1, validationStatus: 1 });
EvidenceSchema.index({ validatedBy: 1, validatedAt: -1 });
EvidenceSchema.index({ searchId: 1, isArchived: 1, archivedAt: -1 });
