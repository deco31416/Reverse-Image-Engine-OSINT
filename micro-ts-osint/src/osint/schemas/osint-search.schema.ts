import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { SearchType, SearchCategory } from '../dto';

export type OsintSearchDocument = OsintSearch & Document;

/**
 * Search result collection structure
 */
export interface SearchResultCollection {
  totalResults: number;
  results: any[];
  sources: string[];
}

/**
 * OSINT Search Schema - Stores search metadata and cached results
 */
@Schema({ timestamps: true })
export class OsintSearch {
  /**
   * Search query (name, email, username, etc.)
   */
  @Prop({ required: true, index: true })
  query: string;

  // Mongoose adds these automatically with timestamps: true
  createdAt?: Date;
  updatedAt?: Date;

  /**
   * Type of search performed
   */
  @Prop({ required: true, type: String, enum: Object.values(SearchType) })
  searchType: SearchType;

  /**
   * Category of search
   */
  @Prop({ required: true, type: String, enum: Object.values(SearchCategory) })
  category: SearchCategory;

  /**
   * Tags for organization
   */
  @Prop({ type: [String], default: [] })
  tags: string[];

  /**
   * Optional description
   */
  @Prop()
  description?: string;

  /**
   * Cluster letter (A-Z) for alphabetic organization
   */
  @Prop({ length: 1, uppercase: true, index: true })
  clusterLetter?: string;

  /**
   * Auto-refresh setting (for continuous monitoring)
   */
  @Prop({ default: false })
  autoRefresh: boolean;

  /**
   * Active status
   */
  @Prop({ default: true, index: true })
  isActive: boolean;

  /**
   * Last time this search was executed
   */
  @Prop({ type: Date })
  lastSearched?: Date;

  /**
   * Count of evidence items found
   */
  @Prop({ default: 0 })
  resultCount: number;

  /**
   * Cached search results (for quick retrieval)
   */
  @Prop({ type: Object })
  cachedResults?: SearchResultCollection;

  /**
   * User who created this search
   */
  @Prop()
  createdBy?: string;

  /**
   * Additional metadata
   */
  @Prop({ type: Object, default: {} })
  metadata?: Record<string, any>;

  /**
   * Search status
   */
  @Prop({
    default: 'pending',
    enum: ['pending', 'processing', 'completed', 'failed'],
    index: true,
  })
  status?: 'pending' | 'processing' | 'completed' | 'failed';

  /**
   * Error message if search failed
   */
  @Prop()
  error?: string;

  /**
   * Original image URL
   */
  @Prop()
  imageUrl?: string;

  /**
   * Enhanced image URL (after Gemini enhancement)
   */
  @Prop()
  enhancedImageUrl?: string;

  /**
   * User ID who created this search
   */
  @Prop({ index: true })
  userId?: string;

  /**
   * Request IP address
   */
  @Prop()
  requestIp?: string;

  /**
   * User agent from request
   */
  @Prop()
  userAgent?: string;

  /**
   * Statistics about evidences found
   */
  @Prop({ type: Object })
  stats?: {
    totalEvidences: number;
    sourceBreakdown: Record<string, number>;
    categoryBreakdown: Record<string, number>;
  };

  /**
   * Multi-dimensional scores
   */
  @Prop({ type: Object })
  scores?: {
    identity: number;
    legal: number;
    financial: number;
    overall: number;
  };

  /**
   * Input data used for this search
   */
  @Prop({ type: Object })
  inputData?: {
    image?: {
      source: string;
      url?: string;
      cloudinaryUrl?: string;
    };
    personalInfo?: {
      nombre?: string;
      apellido?: string;
      username?: string;
      email?: string;
      telefono?: string;
      ciudad?: string;
      pais?: string;
      alias?: string;
      rfc?: string;
      curp?: string;
      fechaNacimiento?: string;
    };
    context?: {
      organizacion?: string;
      cargo?: string;
      industria?: string;
      notas?: string;
      educacion?: string;
      intereses?: string;
    };
    options?: {
      searchEngines?: string[];
      deepSearch?: boolean;
      youtubeSearch?: boolean;
      webArchiveSearch?: boolean;
      userId?: string;
    };
  };
}

export const OsintSearchSchema = SchemaFactory.createForClass(OsintSearch);

// Indexes for performance
OsintSearchSchema.index({ query: 1, isActive: 1 });
OsintSearchSchema.index({ clusterLetter: 1, isActive: 1 });
OsintSearchSchema.index({ createdBy: 1, createdAt: -1 });
OsintSearchSchema.index({ lastSearched: -1 });
