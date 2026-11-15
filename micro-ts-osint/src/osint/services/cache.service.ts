import { Injectable, Logger, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { createHash } from 'crypto';

/**
 * Cache Service - Redis-based caching for search results
 *
 * Features:
 * - Cache search results by query hash
 * - TTL-based expiration (default: 1 hour)
 * - Automatic cache invalidation
 * - Cache hit/miss metrics
 *
 * Usage:
 * ```typescript
 * const cached = await cacheService.get<SearchResult>('search', query);
 * if (!cached) {
 *   const result = await performSearch();
 *   await cacheService.set('search', query, result, 3600); // 1 hour TTL
 * }
 * ```
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private redis: Redis | null = null;
  private readonly enabled: boolean;
  private readonly defaultTTL = 3600; // 1 hour in seconds

  // Stats
  private hits = 0;
  private misses = 0;

  constructor(@Inject('REDIS_CLIENT') redis: Redis) {
    this.redis = redis;
    this.enabled = !!redis;

    if (!this.enabled) {
      this.logger.warn('⚠️  Redis not available - caching disabled');
    } else {
      this.logger.log('✅ Redis cache enabled');
    }
  }

  /**
   * Generate cache key from namespace and data
   */
  private generateKey(namespace: string, data: any): string {
    const hash = createHash('sha256');
    const content = typeof data === 'string' ? data : JSON.stringify(data);
    const dataHash = hash.update(content).digest('hex').substring(0, 16);
    return `cache:${namespace}:${dataHash}`;
  }

  /**
   * Get cached value
   */
  async get<T>(namespace: string, key: any): Promise<T | null> {
    if (!this.enabled || !this.redis) {
      return null;
    }

    try {
      const cacheKey = this.generateKey(namespace, key);
      const cached = await this.redis.get(cacheKey);

      if (cached) {
        this.hits++;
        this.logger.debug(
          `Cache HIT: ${namespace} (${this.hits}/${this.hits + this.misses})`,
        );
        return JSON.parse(cached) as T;
      }

      this.misses++;
      this.logger.debug(
        `Cache MISS: ${namespace} (${this.hits}/${this.hits + this.misses})`,
      );
      return null;
    } catch (error) {
      this.logger.error(`Cache get error: ${error.message}`);
      return null;
    }
  }

  /**
   * Set cached value with TTL
   */
  async set<T>(
    namespace: string,
    key: any,
    value: T,
    ttl: number = this.defaultTTL,
  ): Promise<void> {
    if (!this.enabled || !this.redis) {
      return;
    }

    try {
      const cacheKey = this.generateKey(namespace, key);
      await this.redis.set(cacheKey, JSON.stringify(value), 'EX', ttl);
      this.logger.debug(`Cache SET: ${namespace} (TTL: ${ttl}s)`);
    } catch (error) {
      this.logger.error(`Cache set error: ${error.message}`);
    }
  }

  /**
   * Delete cached value
   */
  async delete(namespace: string, key: any): Promise<void> {
    if (!this.enabled || !this.redis) {
      return;
    }

    try {
      const cacheKey = this.generateKey(namespace, key);
      await this.redis.del(cacheKey);
      this.logger.debug(`Cache DELETE: ${namespace}`);
    } catch (error) {
      this.logger.error(`Cache delete error: ${error.message}`);
    }
  }

  /**
   * Clear all cache for a namespace
   */
  async clearNamespace(namespace: string): Promise<void> {
    if (!this.enabled || !this.redis) {
      return;
    }

    try {
      const pattern = `cache:${namespace}:*`;
      const keys = await this.redis.keys(pattern);

      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.logger.log(`Cache cleared: ${namespace} (${keys.length} keys)`);
      }
    } catch (error) {
      this.logger.error(`Cache clear error: ${error.message}`);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    enabled: boolean;
    hits: number;
    misses: number;
    hitRate: number;
  } {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? (this.hits / total) * 100 : 0;

    return {
      enabled: this.enabled,
      hits: this.hits,
      misses: this.misses,
      hitRate: Math.round(hitRate * 100) / 100,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.logger.log('Cache stats reset');
  }

  /**
   * Execute function with caching
   */
  async withCache<T>(
    namespace: string,
    key: any,
    fn: () => Promise<T>,
    ttl: number = this.defaultTTL,
  ): Promise<T> {
    // Try to get from cache
    const cached = await this.get<T>(namespace, key);
    if (cached) {
      return cached;
    }

    // Execute function
    const result = await fn();

    // Cache result
    await this.set(namespace, key, result, ttl);

    return result;
  }
}
