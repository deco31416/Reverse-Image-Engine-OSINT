import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  OsintSearch,
  OsintSearchDocument,
} from '../schemas/osint-search.schema';
import { Evidence, EvidenceDocument } from '../schemas/evidence.schema';
import { AuditLog, AuditLogDocument } from '../schemas/audit-log.schema';
import { Cron, CronExpression } from '@nestjs/schedule';

/**
 * Cleanup Service - Automatic cleanup of old data
 *
 * Features:
 * - Delete searches older than retention period (default: 30 days)
 * - Cascade delete associated evidences and audit logs
 * - Scheduled job runs daily at 3 AM
 * - Manual cleanup trigger via cleanupOldSearches()
 *
 * Usage:
 * - Automatic: Runs daily via @Cron decorator
 * - Manual: await cleanupService.cleanupOldSearches(30);
 */
@Injectable()
export class CleanupService implements OnModuleInit {
  private readonly logger = new Logger(CleanupService.name);
  private readonly DEFAULT_RETENTION_DAYS = 30;
  private enabled = true;

  constructor(
    @InjectModel(OsintSearch.name)
    private osintSearchModel: Model<OsintSearchDocument>,
    @InjectModel(Evidence.name)
    private evidenceModel: Model<EvidenceDocument>,
    @InjectModel(AuditLog.name)
    private auditLogModel: Model<AuditLogDocument>,
  ) {}

  onModuleInit() {
    const retentionDays = parseInt(process.env.RETENTION_DAYS || '30');
    this.logger.log(
      `🗑️  Cleanup service initialized (retention: ${retentionDays} days)`,
    );
  }

  /**
   * Scheduled cleanup job - runs daily at 3 AM
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async scheduledCleanup() {
    if (!this.enabled) {
      this.logger.debug('Scheduled cleanup skipped (disabled)');
      return;
    }

    this.logger.log('🕒 Starting scheduled cleanup...');

    try {
      const stats = await this.cleanupOldSearches();
      this.logger.log(
        `✅ Scheduled cleanup completed: ${stats.deletedSearches} searches, ` +
          `${stats.deletedEvidences} evidences, ${stats.deletedLogs} logs`,
      );
    } catch (error) {
      this.logger.error(`❌ Scheduled cleanup failed: ${error.message}`);
    }
  }

  /**
   * Delete old searches and associated data
   *
   * @param retentionDays - Delete searches older than this (default: 30)
   * @returns Statistics of deleted documents
   */
  async cleanupOldSearches(retentionDays?: number): Promise<{
    deletedSearches: number;
    deletedEvidences: number;
    deletedLogs: number;
  }> {
    const days = retentionDays || this.DEFAULT_RETENTION_DAYS;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    this.logger.log(
      `🗑️  Cleaning up searches older than ${days} days (before ${cutoffDate.toISOString()})`,
    );

    // Find old searches
    const oldSearches = await this.osintSearchModel
      .find({ createdAt: { $lt: cutoffDate } })
      .select('_id')
      .lean()
      .exec();

    if (oldSearches.length === 0) {
      this.logger.log('No old searches to clean up');
      return {
        deletedSearches: 0,
        deletedEvidences: 0,
        deletedLogs: 0,
      };
    }

    const searchIds = oldSearches.map((s) => s._id);
    this.logger.log(`Found ${searchIds.length} searches to delete`);

    // Delete in parallel: searches, evidences, audit logs
    const [deletedSearches, deletedEvidences, deletedLogs] = await Promise.all([
      this.osintSearchModel.deleteMany({ _id: { $in: searchIds } }).exec(),
      this.evidenceModel.deleteMany({ searchId: { $in: searchIds } }).exec(),
      this.auditLogModel
        .deleteMany({
          entityType: 'search',
          entityId: { $in: searchIds.map((id) => id.toString()) },
        })
        .exec(),
    ]);

    const stats = {
      deletedSearches: deletedSearches.deletedCount || 0,
      deletedEvidences: deletedEvidences.deletedCount || 0,
      deletedLogs: deletedLogs.deletedCount || 0,
    };

    this.logger.log(
      `✅ Cleanup completed: ${stats.deletedSearches} searches, ` +
        `${stats.deletedEvidences} evidences, ${stats.deletedLogs} logs`,
    );

    return stats;
  }

  /**
   * Delete single search and associated data
   */
  async deleteSearch(searchId: string): Promise<void> {
    this.logger.log(`Deleting search: ${searchId}`);

    await Promise.all([
      this.osintSearchModel.deleteOne({ _id: searchId }).exec(),
      this.evidenceModel.deleteMany({ searchId }).exec(),
      this.auditLogModel
        .deleteMany({ entityType: 'search', entityId: searchId })
        .exec(),
    ]);

    this.logger.log(`✅ Search ${searchId} deleted`);
  }

  /**
   * Enable/disable cleanup job
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.logger.log(`Cleanup service ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get cleanup statistics
   */
  async getStats(): Promise<{
    totalSearches: number;
    oldSearches: number;
    oldEvidences: number;
    oldLogs: number;
    cutoffDate: Date;
  }> {
    const retentionDays = parseInt(process.env.RETENTION_DAYS || '30');
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const [totalSearches, oldSearches] = await Promise.all([
      this.osintSearchModel.countDocuments().exec(),
      this.osintSearchModel
        .countDocuments({ createdAt: { $lt: cutoffDate } })
        .exec(),
    ]);

    // Get old search IDs
    const oldSearchIds = await this.osintSearchModel
      .find({ createdAt: { $lt: cutoffDate } })
      .select('_id')
      .lean()
      .exec();

    const searchIds = oldSearchIds.map((s) => s._id);

    const [oldEvidences, oldLogs] = await Promise.all([
      this.evidenceModel
        .countDocuments({ searchId: { $in: searchIds } })
        .exec(),
      this.auditLogModel
        .countDocuments({ searchId: { $in: searchIds } })
        .exec(),
    ]);

    return {
      totalSearches,
      oldSearches,
      oldEvidences,
      oldLogs,
      cutoffDate,
    };
  }
}
