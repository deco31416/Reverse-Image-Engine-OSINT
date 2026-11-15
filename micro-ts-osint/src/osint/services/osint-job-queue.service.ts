import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import RedisClient, { Redis } from 'ioredis';
import { MultiSearchOrchestratorService } from './multi-search-orchestrator.service';
import { LocalJobQueue } from '../../common/local-job-queue';

type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

@Injectable()
export class OsintJobQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OsintJobQueueService.name);
  private readonly prefix: string;
  private readonly concurrency: number;
  private readonly pollMs: number;
  private readonly maxAttempts: number;
  private readonly retryBackoffMs: number;
  private readonly processingTimeoutMs: number;
  private readonly ownsRedis: boolean;
  private readonly active = new Set<string>();
  private stopped = false;
  private timer?: NodeJS.Timeout;
  private readonly localQueue: LocalJobQueue;

  constructor(
    @Inject('REDIS_CLIENT') private redis: Redis | null,
    private readonly configService: ConfigService,
    private readonly multiSearchOrchestrator: MultiSearchOrchestratorService,
  ) {
    this.prefix = this.configService.get<string>('OSINT_JOB_QUEUE_PREFIX') || 'osint:jobs';
    this.concurrency = Math.max(Number(this.configService.get<string>('OSINT_JOB_CONCURRENCY') || 1), 1);
    this.localQueue = new LocalJobQueue(this.concurrency);
    this.pollMs = Math.max(Number(this.configService.get<string>('OSINT_JOB_POLL_MS') || 1000), 250);
    this.maxAttempts = Math.max(Number(this.configService.get<string>('OSINT_JOB_MAX_ATTEMPTS') || 3), 1);
    this.retryBackoffMs = Math.max(Number(this.configService.get<string>('OSINT_JOB_RETRY_BACKOFF_MS') || 30000), 1000);
    this.processingTimeoutMs = Math.max(Number(this.configService.get<string>('OSINT_JOB_PROCESSING_TIMEOUT_MS') || 900000), 60000);
    const queueUrl = this.configService.get<string>('REDIS_QUEUE_URL');
    const redisUrl = this.configService.get<string>('REDIS_URL');
    this.ownsRedis = Boolean(queueUrl && queueUrl !== redisUrl);

    if (this.ownsRedis && queueUrl) {
      this.redis = new RedisClient(queueUrl, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      });
      this.redis
        .connect()
        .then(() => this.logger.log('OSINT job queue connected to REDIS_QUEUE_URL'))
        .catch((error) => this.logger.warn(`OSINT job queue Redis connection failed: ${error.message}`));
    }
  }

  onModuleInit() {
    this.stopped = false;
    this.schedule();
  }

  onModuleDestroy() {
    this.stopped = true;
    this.localQueue.close();
    if (this.timer) clearTimeout(this.timer);
    if (this.ownsRedis) {
      this.redis?.disconnect();
    }
  }

  async enqueueSearch(searchId: string, reason = 'search') {
    const now = new Date().toISOString();

    if (!this.redis) {
      const job = this.localQueue.enqueue(searchId, () => this.multiSearchOrchestrator.executeSearch(searchId));
      return {
        searchId,
        ...job,
        reason,
        queuedAt: now,
        mode: 'direct-fallback',
      };
    }

    await this.redis
      .multi()
      .lrem(this.queueKey(), 0, searchId)
      .hset(this.statusKey(searchId), {
        searchId,
        status: 'queued',
        reason,
        attempts: 0,
        queuedAt: now,
        updatedAt: now,
      })
      .rpush(this.queueKey(), searchId)
      .exec();

    this.schedule(0);

    return {
      searchId,
      status: 'queued' as JobStatus,
      reason,
      queuedAt: now,
      mode: 'redis',
    };
  }

  async getJob(searchId: string) {
    if (!this.redis) {
      return {
        searchId,
        ...(this.localQueue.get(searchId) || { status: 'unknown' }),
        mode: 'direct-fallback',
      };
    }

    const job = await this.redis.hgetall(this.statusKey(searchId));
    return Object.keys(job).length ? job : { searchId, status: 'unknown', mode: 'redis' };
  }

  async getStats() {
    if (!this.redis) {
      return {
        mode: 'direct-fallback',
        ...this.localQueue.stats(),
        maxAttempts: this.maxAttempts,
      };
    }

    const [queued, processing, delayed] = await Promise.all([
      this.redis.llen(this.queueKey()),
      this.redis.scard(this.processingKey()),
      this.redis.zcard(this.delayedKey()),
    ]);
    return {
      mode: 'redis',
      queued,
      delayed,
      processing,
      active: this.active.size,
      concurrency: this.concurrency,
      maxAttempts: this.maxAttempts,
      processingTimeoutMs: this.processingTimeoutMs,
      prefix: this.prefix,
    };
  }

  private schedule(delay = this.pollMs) {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.processQueue().catch((error) => this.logger.error(`Queue processing error: ${error.message}`));
    }, delay);
  }

  private async processQueue() {
    if (this.stopped || !this.redis) return;

    await this.recoverStaleProcessing();
    await this.releaseDelayedJobs();

    while (this.active.size < this.concurrency) {
      const searchId = await this.redis.rpoplpush(this.queueKey(), this.processingListKey());
      if (!searchId) break;
      if (this.active.has(searchId)) continue;
      this.runRedisJob(searchId);
    }

    this.schedule();
  }

  private runRedisJob(searchId: string) {
    this.active.add(searchId);
    const startedAt = new Date().toISOString();

    void (async () => {
      try {
        const attempts = await this.incrementAttempts(searchId);
        await this.redis?.hset(this.statusKey(searchId), {
          searchId,
          status: 'processing',
          attempts,
          startedAt,
          updatedAt: startedAt,
        });
        await this.redis?.sadd(this.processingKey(), searchId);

        await this.multiSearchOrchestrator.executeSearch(searchId);

        const completedAt = new Date().toISOString();
        await this.redis
          ?.multi()
          .hset(this.statusKey(searchId), {
            status: 'completed',
            completedAt,
            updatedAt: completedAt,
            error: '',
          })
          .lrem(this.processingListKey(), 0, searchId)
          .srem(this.processingKey(), searchId)
          .exec();
      } catch (error: any) {
        await this.handleJobFailure(searchId, error);
      } finally {
        this.active.delete(searchId);
        this.schedule(0);
      }
    })();
  }

  private runDirect(searchId: string, reason: string) {
    this.active.add(searchId);
    void this.multiSearchOrchestrator
      .executeSearch(searchId)
      .catch((error) => this.logger.error(`Direct ${reason} job failed (${searchId}): ${error.message}`))
      .finally(() => this.active.delete(searchId));
  }

  private queueKey() {
    return `${this.prefix}:search:queue`;
  }

  private processingListKey() {
    return `${this.prefix}:search:processing`;
  }

  private processingKey() {
    return `${this.prefix}:search:processing:set`;
  }

  private delayedKey() {
    return `${this.prefix}:search:delayed`;
  }

  private statusKey(searchId: string) {
    return `${this.prefix}:search:${searchId}`;
  }

  private async incrementAttempts(searchId: string) {
    const current = Number((await this.redis?.hget(this.statusKey(searchId), 'attempts')) || 0);
    return current + 1;
  }

  private async handleJobFailure(searchId: string, error: any) {
    if (!this.redis) return;

    const attempts = Number((await this.redis.hget(this.statusKey(searchId), 'attempts')) || 1);
    const message = error?.message || 'unknown error';
    const now = new Date().toISOString();

    if (attempts < this.maxAttempts) {
      const retryAt = Date.now() + this.retryBackoffMs * attempts;
      await this.redis
        .multi()
        .hset(this.statusKey(searchId), {
          status: 'queued',
          retryAt: new Date(retryAt).toISOString(),
          updatedAt: now,
          error: message,
        })
        .zadd(this.delayedKey(), retryAt, searchId)
        .lrem(this.processingListKey(), 0, searchId)
        .srem(this.processingKey(), searchId)
        .exec();
      this.logger.warn(`Search job retry scheduled (${searchId}) attempt ${attempts}/${this.maxAttempts}: ${message}`);
      return;
    }

    await this.redis
      .multi()
      .hset(this.statusKey(searchId), {
        status: 'failed',
        failedAt: now,
        updatedAt: now,
        error: message,
      })
      .lrem(this.processingListKey(), 0, searchId)
      .srem(this.processingKey(), searchId)
      .exec();
    this.logger.error(`Search job failed permanently (${searchId}) after ${attempts} attempts: ${message}`);
  }

  private async releaseDelayedJobs() {
    if (!this.redis) return;
    const now = Date.now();
    const due = await this.redis.zrangebyscore(this.delayedKey(), 0, now, 'LIMIT', 0, 20);
    if (!due.length) return;

    const pipeline = this.redis.multi();
    due.forEach((searchId) => {
      pipeline.zrem(this.delayedKey(), searchId);
      pipeline.rpush(this.queueKey(), searchId);
      pipeline.hset(this.statusKey(searchId), { status: 'queued', updatedAt: new Date().toISOString() });
    });
    await pipeline.exec();
  }

  private async recoverStaleProcessing() {
    if (!this.redis) return;
    const processing = await this.redis.smembers(this.processingKey());
    if (!processing.length) return;

    const now = Date.now();
    for (const searchId of processing) {
      if (this.active.has(searchId)) continue;
      const job = await this.redis.hgetall(this.statusKey(searchId));
      const started = Date.parse(job.startedAt || job.updatedAt || '');
      if (!started || now - started < this.processingTimeoutMs) continue;

      await this.redis
        .multi()
        .hset(this.statusKey(searchId), {
          status: 'queued',
          recoveredAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          error: 'Recovered stale processing job',
        })
        .lrem(this.processingListKey(), 0, searchId)
        .srem(this.processingKey(), searchId)
        .rpush(this.queueKey(), searchId)
        .exec();
      this.logger.warn(`Recovered stale OSINT job: ${searchId}`);
    }
  }
}
