import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash } from 'crypto';
import {
  Evidence,
  EvidenceDocument,
  EvidenceSignals,
} from '../schemas/evidence.schema';
import { SocialScraperClientService } from './social-scraper-client.service';
import { CloudinaryService } from './cloudinary.service';
import { OsintSearch, OsintSearchDocument } from '../schemas/osint-search.schema';

/**
 * Evidence Service - Manages OSINT evidence with deduplication
 *
 * Features:
 * - SHA256-based deduplication
 * - Signal extraction (identity, legal, financial)
 * - Reliability scoring
 * - Category-based grouping
 */
@Injectable()
export class EvidenceService {
  private readonly logger = new Logger(EvidenceService.name);

  constructor(
    @InjectModel(Evidence.name)
    private evidenceModel: Model<EvidenceDocument>,
    @InjectModel(OsintSearch.name)
    private osintSearchModel: Model<OsintSearchDocument>,
    private readonly socialScraperClient: SocialScraperClientService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  async enrichMissingImage(evidenceId: string): Promise<EvidenceDocument> {
    const evidence = await this.evidenceModel.findOne({ evidenceId }).exec();
    if (!evidence) throw new NotFoundException('Evidence not found');
    if (evidence.imageUrl || evidence.thumbnailUrl) return evidence;

    const profileUrl = String(evidence.url || '').trim();
    const search = await this.osintSearchModel.findById(evidence.searchId).select('query metadata').lean().exec().catch(() => null);
    const query = String((search as any)?.query || '').trim().toLowerCase();
    const title = String(evidence.title || '').toLowerCase();
    const source = String(evidence.source || '').toLowerCase();
    const likelyCaseNameLeak = Boolean(
      query
      && query !== 'unknown person search'
      && title.includes(query)
      && source.includes('social_scraper'),
    );
    if (likelyCaseNameLeak) {
      evidence.imageEnrichmentStatus = 'profile_unverified';
      evidence.imageEnrichment = { attemptedAt: new Date(), profileUrl, reason: 'Profile may originate from the case label rather than an explicit identity hint' };
      await evidence.save();
      throw new BadRequestException('Perfil no verificado: coincide con el nombre operativo del caso y no con una pista de identidad explícita');
    }
    if (!this.isVerifiedSocialProfileUrl(profileUrl)) {
      evidence.imageEnrichmentStatus = 'profile_unverified';
      evidence.imageEnrichment = { attemptedAt: new Date(), profileUrl, reason: 'No canonical supported social profile URL' };
      await evidence.save();
      throw new BadRequestException('La evidencia no contiene una URL canónica de perfil social verificable');
    }

    evidence.imageEnrichmentStatus = 'searching';
    evidence.imageEnrichment = { attemptedAt: new Date(), profileUrl, method: 'social_profile_resolver' };
    await evidence.save();

    const resolved = await this.socialScraperClient.resolveProfileUrl(profileUrl);
    if (!resolved) {
      evidence.imageEnrichmentStatus = 'profile_inaccessible';
      evidence.imageEnrichment = { ...evidence.imageEnrichment, reason: 'Profile resolver unavailable or source inaccessible' };
      return evidence.save();
    }

    const profiles = Array.isArray(resolved.profiles) ? resolved.profiles : [];
    const profile = profiles.find((item: any) => this.sameProfileUrl(item?.profileUrl, profileUrl)) || profiles[0];
    const avatarUrl = String(profile?.avatarUrl || '').trim();
    if (!/^https?:\/\//i.test(avatarUrl)) {
      evidence.imageEnrichmentStatus = 'no_public_image';
      evidence.imageEnrichment = { ...evidence.imageEnrichment, reason: 'Verified profile has no public avatar' };
      return evidence.save();
    }

    try {
      const uploaded = await this.cloudinaryService.uploadFromUrl(avatarUrl, `profile-${evidence.evidenceId}.jpg`, {
        folder: `osint/evidence-profiles/${evidence.searchId}`,
        tags: ['osint', 'profile-avatar', 'evidence-enrichment'],
        context: { evidenceId: evidence.evidenceId, profileUrl },
      });
      evidence.imageUrl = uploaded.secureUrl;
      evidence.thumbnailUrl = uploaded.secureUrl;
      evidence.imageEnrichmentStatus = 'recovered';
      evidence.imageEnrichment = {
        ...evidence.imageEnrichment,
        originalImageUrl: avatarUrl,
        storedImageUrl: uploaded.secureUrl,
      };
      return evidence.save();
    } catch (error: any) {
      evidence.imageEnrichmentStatus = 'profile_inaccessible';
      evidence.imageEnrichment = { ...evidence.imageEnrichment, originalImageUrl: avatarUrl, reason: error?.message || 'Image download failed' };
      return evidence.save();
    }
  }

  private isVerifiedSocialProfileUrl(value: string) {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      const supported = ['instagram.com', 'facebook.com', 'tiktok.com', 'x.com', 'twitter.com', 'github.com', 'reddit.com', 'youtube.com', 'threads.net', 'pinterest.com'];
      return url.protocol === 'https:' && supported.some((domain) => host === domain || host.endsWith(`.${domain}`)) && url.pathname.split('/').filter(Boolean).length > 0;
    } catch {
      return false;
    }
  }

  private sameProfileUrl(left?: string, right?: string) {
    const normalize = (value?: string) => String(value || '').replace(/\/$/, '').toLowerCase();
    return Boolean(normalize(left) && normalize(left) === normalize(right));
  }

  /**
   * Generate unique evidence ID using SHA256 hash
   * Scoped per-search: same source + title + url in DIFFERENT searches = different evidenceId
   * Within the SAME search: deduplication still works
   */
  generateEvidenceId(evidence: Partial<Evidence>, searchId?: string): string {
    const hash = createHash('sha256');
    const prefix = searchId || (evidence as any).searchId || '';
    const content = `${prefix}|${evidence.source}|${evidence.title}|${evidence.url || 'no-url'}`;
    return hash.update(content).digest('hex').substring(0, 16);
  }

  /**
   * Extract identity signals from text
   * Counts occurrences of target name, aliases, and related keywords
   */
  extractIdentitySignals(
    text: string,
    targetName: string,
    aliases: string[] = [],
  ): EvidenceSignals {
    const signals: EvidenceSignals = {
      identity: 0,
      legal: 0,
      financial: 0,
      social: 0,
    };

    const lowerText = text.toLowerCase();

    // Identity signals - name matches
    if (lowerText.includes(targetName.toLowerCase())) {
      signals.identity += 5;
    }

    // Check aliases
    aliases.forEach((alias) => {
      if (lowerText.includes(alias.toLowerCase())) {
        signals.identity += 3;
      }
    });

    // Legal keywords (Mexican context)
    const legalKeywords = [
      'pleito',
      'demanda',
      'multa',
      'antecedentes',
      'juicio',
      'sentencia',
      'delito',
      'condena',
      'tribunal',
      'juzgado',
      'carpeta de investigación',
      'proceso penal',
      'amparo',
    ];
    legalKeywords.forEach((keyword) => {
      if (lowerText.includes(keyword)) {
        signals.legal += 2;
      }
    });

    // Financial keywords (Mexican context)
    const financialKeywords = [
      'empresa',
      'sociedad',
      'rfc',
      'propiedad',
      'inmueble',
      'accionista',
      'director',
      'representante legal',
      'sat',
      'facturación',
      'contribuyente',
      'registro público',
    ];
    financialKeywords.forEach((keyword) => {
      if (lowerText.includes(keyword)) {
        signals.financial += 2;
      }
    });

    // Social keywords
    const socialKeywords = [
      'facebook',
      'twitter',
      'instagram',
      'linkedin',
      'tiktok',
      'perfil',
      'red social',
      'publicación',
      'seguidor',
    ];
    socialKeywords.forEach((keyword) => {
      if (lowerText.includes(keyword)) {
        signals.social += 2;
      }
    });

    return signals;
  }

  /**
   * Calculate reliability score based on source
   * Higher scores for official/verified sources
   */
  calculateReliability(source: string, url?: string): number {
    // Official government sources
    if (
      url?.includes('.gob.mx') ||
      source.includes('DOF') ||
      source.includes('SAT')
    ) {
      return 0.95;
    }

    // Professional networks
    if (source === 'LinkedIn' || url?.includes('linkedin.com')) {
      return 0.85;
    }

    // Major search engines
    if (source === 'Google CSE' || source === 'Bing') {
      return 0.8;
    }

    // Social media
    if (
      source === 'Twitter' ||
      source === 'Facebook' ||
      source === 'Instagram'
    ) {
      return 0.6;
    }

    // Web crawler results
    if (source === 'WebCrawler') {
      return 0.5;
    }

    // Default
    return 0.5;
  }

  /**
   * Save evidence with automatic deduplication
   * Returns existing evidence if duplicate detected
   */
  async saveEvidence(
    searchId: string,
    evidence: Partial<Evidence>,
  ): Promise<EvidenceDocument> {
    const evidenceId = this.generateEvidenceId(evidence, searchId);

    // Check if already exists (deduplication)
    const existing = await this.evidenceModel.findOne({ evidenceId }).exec();

    if (existing) {
      this.logger.debug(
        `Evidence ${evidenceId} already exists (deduplicated) for search ${searchId}`,
      );
      return existing;
    }

    // Auto-calculate reliability if not provided
    if (!evidence.reliability) {
      evidence.reliability = this.calculateReliability(
        evidence.source || 'unknown',
        evidence.url,
      );
    }

    // Create new evidence
    const newEvidence = new this.evidenceModel({
      ...evidence,
      evidenceId,
      searchId,
      fetchedAt: evidence.fetchedAt || new Date(),
    });

    const saved = await newEvidence.save();
    this.logger.log(
      `✅ Evidence saved: ${evidenceId} [${evidence.category}] from ${evidence.source}`,
    );

    return saved;
  }

  /**
   * Get all evidence for a search
   */
  async getEvidenceBySearch(searchId: string): Promise<EvidenceDocument[]> {
    return await this.evidenceModel
      .find({ searchId, isArchived: { $ne: true } })
      .sort({ reliability: -1, createdAt: -1 })
      .exec();
  }

  /**
   * Get evidence with pagination and filters
   */
  async getEvidenceBySearchPaginated(
    searchId: string,
    options: {
      page?: number;
      limit?: number;
      source?: string;
      category?: string;
      minReliability?: number;
      validationStatus?: 'pending' | 'valid' | 'false_positive';
      sortBy?: 'reliability' | 'createdAt' | 'matchConfidence';
      sortOrder?: 'asc' | 'desc';
    } = {},
  ): Promise<{
    evidences: EvidenceDocument[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
  }> {
    const page = options.page || 1;
    const limit = options.limit || 50;
    const skip = (page - 1) * limit;

    // Build filter query
    const filter: any = { searchId, isArchived: { $ne: true } };

    if (options.source) {
      filter.source = options.source;
    }

    if (options.category) {
      filter.category = options.category;
    }

    if (options.minReliability !== undefined) {
      filter.reliability = { $gte: options.minReliability };
    }

    if (options.validationStatus) {
      filter.validationStatus = options.validationStatus;
    }

    // Build sort
    const sortBy = options.sortBy || 'reliability';
    const sortOrder = options.sortOrder || 'desc';
    const sort: any = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Execute query with pagination
    const [evidences, total] = await Promise.all([
      this.evidenceModel.find(filter).sort(sort).skip(skip).limit(limit).exec(),
      this.evidenceModel.countDocuments(filter).exec(),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      evidences,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  /**
   * Get evidence grouped by category
   */
  async getEvidenceBySearchGrouped(
    searchId: string,
  ): Promise<Record<string, EvidenceDocument[]>> {
    const evidences = await this.getEvidenceBySearch(searchId);

    return evidences.reduce(
      (acc, evidence) => {
        const category = evidence.category;
        if (!acc[category]) {
          acc[category] = [];
        }
        acc[category].push(evidence);
        return acc;
      },
      {} as Record<string, EvidenceDocument[]>,
    );
  }

  /**
   * Get evidence statistics for a search
   */
  async getEvidenceStats(searchId: string) {
    const evidences = await this.getEvidenceBySearch(searchId);

    const stats = {
      total: evidences.length,
      byCategory: {} as Record<string, number>,
      bySource: {} as Record<string, number>,
      averageReliability: 0,
      highReliabilityCount: 0, // >= 0.8
      mediumReliabilityCount: 0, // 0.5 - 0.79
      lowReliabilityCount: 0, // < 0.5
      totalSignals: {
        identity: 0,
        legal: 0,
        financial: 0,
        social: 0,
      },
    };

    let reliabilitySum = 0;

    evidences.forEach((evidence) => {
      // Count by category
      stats.byCategory[evidence.category] =
        (stats.byCategory[evidence.category] || 0) + 1;

      // Count by source
      stats.bySource[evidence.source] =
        (stats.bySource[evidence.source] || 0) + 1;

      // Reliability distribution
      if (evidence.reliability >= 0.8) {
        stats.highReliabilityCount++;
      } else if (evidence.reliability >= 0.5) {
        stats.mediumReliabilityCount++;
      } else {
        stats.lowReliabilityCount++;
      }

      reliabilitySum += evidence.reliability;

      // Sum signals
      if (evidence.signals) {
        stats.totalSignals.identity += evidence.signals.identity || 0;
        stats.totalSignals.legal += evidence.signals.legal || 0;
        stats.totalSignals.financial += evidence.signals.financial || 0;
        stats.totalSignals.social += evidence.signals.social || 0;
      }
    });

    stats.averageReliability =
      evidences.length > 0 ? reliabilitySum / evidences.length : 0;

    return stats;
  }

  /**
   * Update evidence extracted data
   */
  async updateExtractedData(
    evidenceId: string,
    extractedData: Evidence['extractedData'],
  ): Promise<EvidenceDocument | null> {
    return await this.evidenceModel
      .findOneAndUpdate(
        { evidenceId },
        { $set: { extractedData } },
        { new: true },
      )
      .exec();
  }

  /**
   * Validate or mark evidence as false positive
   * @param evidenceId - Unique evidence ID (SHA256 hash)
   * @param status - Validation status: 'valid' | 'false_positive'
   * @param userId - User ID who is validating (optional)
   */
  async validateEvidence(
    evidenceId: string,
    status: 'valid' | 'false_positive',
    userId?: string,
  ): Promise<EvidenceDocument | null> {
    const updated = await this.evidenceModel
      .findOneAndUpdate(
        { evidenceId },
        {
          $set: {
            validationStatus: status,
            validatedBy: userId,
            validatedAt: new Date(),
          },
        },
        { new: true },
      )
      .exec();

    if (updated) {
      this.logger.log(
        `✅ Evidence ${evidenceId} marked as ${status}${userId ? ` by ${userId}` : ''}`,
      );
    }

    return updated;
  }

  /**
   * Get evidence statistics with validation breakdown
   */
  async getValidationStats(searchId: string): Promise<{
    total: number;
    pending: number;
    valid: number;
    falsePositive: number;
    validationRate: number;
  }> {
    const evidences = await this.evidenceModel.find({ searchId }).exec();
    const total = evidences.length;
    const pending = evidences.filter(
      (e) => e.validationStatus === 'pending',
    ).length;
    const valid = evidences.filter(
      (e) => e.validationStatus === 'valid',
    ).length;
    const falsePositive = evidences.filter(
      (e) => e.validationStatus === 'false_positive',
    ).length;
    const validationRate =
      total > 0 ? ((valid + falsePositive) / total) * 100 : 0;

    return {
      total,
      pending,
      valid,
      falsePositive,
      validationRate: Math.round(validationRate * 100) / 100,
    };
  }

  /**
   * Get evidence filtered by validation status
   */
  async getEvidenceByStatus(
    searchId: string,
    status: 'pending' | 'valid' | 'false_positive',
  ): Promise<EvidenceDocument[]> {
    return await this.evidenceModel
      .find({ searchId, validationStatus: status, isArchived: { $ne: true } })
      .sort({ reliability: -1, createdAt: -1 })
      .exec();
  }

  /**
   * Delete all evidence for a search
   */
  async deleteEvidenceBySearch(searchId: string): Promise<number> {
    const result = await this.evidenceModel.deleteMany({ searchId }).exec();
    this.logger.log(
      `Deleted ${result.deletedCount} evidence items for search ${searchId}`,
    );
    return result.deletedCount;
  }

  /**
   * Delete a single evidence item by its SHA256 evidenceId
   */
  async deleteEvidenceById(evidenceId: string): Promise<boolean> {
    const result = await this.evidenceModel.deleteOne({ evidenceId }).exec();
    this.logger.log(
      `Deleted evidence ${evidenceId}: ${result.deletedCount} removed`,
    );
    return result.deletedCount === 1;
  }

  async archiveEvidence(evidenceId: string, actorId: string, reason: string): Promise<EvidenceDocument> {
    const evidence = await this.evidenceModel.findOneAndUpdate(
      { evidenceId, isArchived: { $ne: true } },
      { $set: {
        isArchived: true,
        archivedAt: new Date(),
        archivedBy: actorId,
        archiveReason: reason.trim().slice(0, 500),
      } },
      { new: true },
    ).exec();
    if (!evidence) throw new NotFoundException('Evidence not found or already archived');
    return evidence;
  }

  async restoreEvidence(evidenceId: string, actorId: string): Promise<EvidenceDocument> {
    const evidence = await this.evidenceModel.findOneAndUpdate(
      { evidenceId, isArchived: true },
      { $set: { isArchived: false, restoredAt: new Date(), restoredBy: actorId }, $unset: { archivedAt: 1, archivedBy: 1, archiveReason: 1 } },
      { new: true },
    ).exec();
    if (!evidence) throw new NotFoundException('Archived evidence not found');
    return evidence;
  }

  async getArchivedEvidence(searchId: string): Promise<EvidenceDocument[]> {
    return this.evidenceModel.find({ searchId, isArchived: true }).sort({ archivedAt: -1 }).exec();
  }

  /**
   * Get unique sources across all evidence
   */
  async getUniqueSources(): Promise<string[]> {
    return await this.evidenceModel.distinct('source').exec();
  }
}
