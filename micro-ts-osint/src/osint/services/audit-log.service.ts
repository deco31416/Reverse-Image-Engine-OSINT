import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditLog, AuditLogDocument } from '../schemas/audit-log.schema';

/**
 * AuditLog Service - Tracks all actions in the OSINT system
 *
 * Features:
 * - Action tracking
 * - Entity history
 * - User activity monitoring
 * - Compliance and debugging
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectModel(AuditLog.name)
    private auditLogModel: Model<AuditLogDocument>,
  ) {}

  /**
   * Log an action
   */
  async log(
    action: string,
    entityType: string,
    entityId?: string,
    userId?: string,
    metadata: Record<string, any> = {},
    request?: { ip?: string; userAgent?: string },
  ): Promise<AuditLogDocument> {
    const log = new this.auditLogModel({
      action,
      entityType,
      entityId,
      userId,
      metadata,
      ipAddress: request?.ip,
      userAgent: request?.userAgent,
    });

    const saved = await log.save();
    this.logger.debug(
      `📝 Audit: ${action} on ${entityType}${entityId ? ` [${entityId}]` : ''}`,
    );

    return saved;
  }

  /**
   * Quick logging methods for common actions
   */

  async logSearchCreated(
    searchId: string,
    query: string,
    userId?: string,
    request?: any,
  ): Promise<void> {
    await this.log(
      'search_created',
      'search',
      searchId,
      userId,
      { query },
      request,
    );
  }

  async logEvidenceAdded(
    evidenceId: string,
    searchId: string,
    source: string,
    userId?: string,
  ): Promise<void> {
    await this.log('evidence_added', 'evidence', evidenceId, userId, {
      searchId,
      source,
    });
  }

  async logAPICall(
    service: string,
    endpoint: string,
    success: boolean,
    userId?: string,
    metadata?: any,
  ): Promise<void> {
    await this.log('api_called', 'api', undefined, userId, {
      service,
      endpoint,
      success,
      ...metadata,
    });
  }

  async logSearchDeleted(searchId: string, userId?: string): Promise<void> {
    await this.log('search_deleted', 'search', searchId, userId);
  }

  async logRateLimitExceeded(
    service: string,
    userId?: string,
    request?: any,
  ): Promise<void> {
    await this.log(
      'rate_limit_exceeded',
      'api',
      undefined,
      userId,
      { service },
      request,
    );
  }

  /**
   * Get logs for a specific entity
   */
  async getLogsForEntity(
    entityType: string,
    entityId: string,
    limit: number = 100,
  ): Promise<AuditLogDocument[]> {
    return await this.auditLogModel
      .find({ entityType, entityId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  /**
   * Get logs by action
   */
  async getLogsByAction(
    action: string,
    limit: number = 100,
  ): Promise<AuditLogDocument[]> {
    return await this.auditLogModel
      .find({ action })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  /**
   * Get logs for a user
   */
  async getLogsByUser(
    userId: string,
    limit: number = 100,
  ): Promise<AuditLogDocument[]> {
    return await this.auditLogModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  /**
   * Get all logs with filtering
   */
  async getAllLogs(filters: {
    action?: string;
    entityType?: string;
    userId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<AuditLogDocument[]> {
    const query: any = {};

    if (filters.action) query.action = filters.action;
    if (filters.entityType) query.entityType = filters.entityType;
    if (filters.userId) query.userId = filters.userId;

    if (filters.startDate || filters.endDate) {
      query.createdAt = {};
      if (filters.startDate) query.createdAt.$gte = filters.startDate;
      if (filters.endDate) query.createdAt.$lte = filters.endDate;
    }

    return await this.auditLogModel
      .find(query)
      .sort({ createdAt: -1 })
      .limit(filters.limit || 100)
      .exec();
  }

  /**
   * Get audit statistics
   */
  async getStats(
    startDate?: Date,
    endDate?: Date,
  ): Promise<{
    totalLogs: number;
    byAction: Record<string, number>;
    byEntityType: Record<string, number>;
    topUsers: Array<{ userId: string; count: number }>;
    recentActions: AuditLogDocument[];
  }> {
    const query: any = {};

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = startDate;
      if (endDate) query.createdAt.$lte = endDate;
    }

    // Total count
    const totalLogs = await this.auditLogModel.countDocuments(query).exec();

    // Group by action
    const byActionResult = await this.auditLogModel
      .aggregate([
        { $match: query },
        { $group: { _id: '$action', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ])
      .exec();

    const byAction = byActionResult.reduce(
      (acc, item) => {
        acc[item._id] = item.count;
        return acc;
      },
      {} as Record<string, number>,
    );

    // Group by entity type
    const byEntityTypeResult = await this.auditLogModel
      .aggregate([
        { $match: query },
        { $group: { _id: '$entityType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ])
      .exec();

    const byEntityType = byEntityTypeResult.reduce(
      (acc, item) => {
        acc[item._id] = item.count;
        return acc;
      },
      {} as Record<string, number>,
    );

    // Top users
    const topUsersResult = await this.auditLogModel
      .aggregate([
        { $match: { ...query, userId: { $exists: true } } },
        { $group: { _id: '$userId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ])
      .exec();

    const topUsers = topUsersResult.map((item) => ({
      userId: item._id,
      count: item.count,
    }));

    // Recent actions
    const recentActions = await this.auditLogModel
      .find(query)
      .sort({ createdAt: -1 })
      .limit(20)
      .exec();

    return {
      totalLogs,
      byAction,
      byEntityType,
      topUsers,
      recentActions,
    };
  }

  /**
   * Clean up old logs (data retention)
   */
  async cleanupOldLogs(daysToKeep: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await this.auditLogModel
      .deleteMany({ createdAt: { $lt: cutoffDate } })
      .exec();

    this.logger.log(
      `Cleaned up ${result.deletedCount} audit logs older than ${daysToKeep} days`,
    );

    return result.deletedCount;
  }
}
