import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * Rate limit configuration per service
 */
export interface RateLimitConfig {
  service: string;
  dailyLimit: number;
  burstLimit?: number; // Optional: requests per minute
}

/**
 * Predefined rate limits for common APIs
 */
export const API_RATE_LIMITS: Record<string, RateLimitConfig> = {
  groq: {
    service: 'groq',
    dailyLimit: 600, // 600 requests per day (free tier)
    burstLimit: 10, // 10 requests per minute
  },
  gemini: {
    service: 'gemini',
    dailyLimit: 1500, // 1500 requests per day
    burstLimit: 15,
  },
  google_cse: {
    service: 'google_cse',
    dailyLimit: 10000, // 10,000 requests per day
    burstLimit: 100,
  },
  youtube: {
    service: 'youtube',
    dailyLimit: 10000,
    burstLimit: 100,
  },
  cloudinary: {
    service: 'cloudinary',
    dailyLimit: 25000, // Free tier
    burstLimit: 500,
  },
};

/**
 * RateLimit Service - Redis-based API rate limiting
 *
 * Features:
 * - Daily limits with automatic reset at midnight
 * - Burst protection (requests per minute)
 * - Per-service tracking
 * - Usage statistics
 * - Automatic cleanup with TTL
 */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private redis: Redis | null = null;

  constructor(@Inject('REDIS_CLIENT') redis: Redis) {
    this.redis = redis;

    if (!this.redis) {
      this.logger.warn('⚠️  Redis not available - rate limiting disabled');
    } else {
      this.logger.log('✅ Redis connected - rate limiting enabled');
    }
  }

  /**
   * Check if API can be used (within daily limit)
   * FAIL-CLOSED: If Redis is down, deny requests to protect API quotas
   */
  async canUseAPI(service: string, dailyLimit?: number): Promise<boolean> {
    if (!this.redis) {
      this.logger.warn('⚠️ Redis not available — BLOCKING request to protect API quota (fail-closed)');
      return false;
    }

    const limit = dailyLimit || API_RATE_LIMITS[service]?.dailyLimit || 1000;
    const current = await this.getUsageToday(service);

    return current < limit;
  }

  /**
   * Register API call and enforce rate limit
   * Throws HttpException if limit exceeded
   */
  async registerCall(service: string, dailyLimit?: number): Promise<void> {
    if (!this.redis) {
      this.logger.warn('⚠️ Redis not available — BLOCKING API call to protect quota (fail-closed)');
      throw new HttpException(
        {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message: `Rate limiter unavailable (Redis down) — API call to ${service} blocked to protect quota`,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const limit = dailyLimit || API_RATE_LIMITS[service]?.dailyLimit || 1000;
    const today = this.getTodayKey();
    const key = `rate_limit:${service}:${today}`;

    const current = await this.redis.get(key);

    if (!current) {
      // First call of the day
      await this.redis.set(key, 1, 'EX', this.getSecondsUntilMidnight());
      this.logger.debug(`First ${service} call today (1/${limit})`);
    } else {
      const count = parseInt(current);

      if (count >= limit) {
        const remaining = this.getSecondsUntilMidnight();
        const hours = Math.floor(remaining / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);

        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `Rate limit exceeded for ${service}`,
            details: {
              limit,
              current: count,
              resetIn: `${hours}h ${minutes}m`,
            },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      await this.redis.incr(key);
      this.logger.debug(`${service} call registered (${count + 1}/${limit})`);
    }

    // Check burst limit (requests per minute)
    if (API_RATE_LIMITS[service]?.burstLimit) {
      await this.checkBurstLimit(service, API_RATE_LIMITS[service].burstLimit);
    }
  }

  /**
   * Check burst limit (requests per minute)
   */
  private async checkBurstLimit(
    service: string,
    burstLimit: number,
  ): Promise<void> {
    if (!this.redis) return;

    const minute = new Date().toISOString().substring(0, 16); // YYYY-MM-DDTHH:MM
    const key = `rate_limit:${service}:burst:${minute}`;

    const current = await this.redis.get(key);

    if (!current) {
      await this.redis.set(key, 1, 'EX', 60); // Expire in 60 seconds
    } else {
      const count = parseInt(current);

      if (count >= burstLimit) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `Burst limit exceeded for ${service}`,
            details: {
              burstLimit,
              current: count,
              resetIn: '60 seconds',
            },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      await this.redis.incr(key);
    }
  }

  /**
   * Get current usage for today
   */
  async getUsageToday(service: string): Promise<number> {
    if (!this.redis) return Infinity; // Fail-closed: report max usage if Redis unavailable

    const today = this.getTodayKey();
    const key = `rate_limit:${service}:${today}`;

    const current = await this.redis.get(key);
    return current ? parseInt(current) : 0;
  }

  /**
   * Get usage statistics for a service
   */
  async getUsageStats(service: string): Promise<{
    service: string;
    todayUsage: number;
    dailyLimit: number;
    remainingToday: number;
    percentageUsed: number;
    resetIn: string;
  }> {
    const dailyLimit = API_RATE_LIMITS[service]?.dailyLimit || 1000;
    const todayUsage = await this.getUsageToday(service);
    const remainingToday = Math.max(0, dailyLimit - todayUsage);
    const percentageUsed = (todayUsage / dailyLimit) * 100;

    const remaining = this.getSecondsUntilMidnight();
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);

    return {
      service,
      todayUsage,
      dailyLimit,
      remainingToday,
      percentageUsed: Math.round(percentageUsed * 100) / 100,
      resetIn: `${hours}h ${minutes}m`,
    };
  }

  /**
   * Get usage for all services
   */
  async getAllUsageStats(): Promise<Record<string, any>> {
    const services = Object.keys(API_RATE_LIMITS);
    const stats: Record<string, any> = {};

    for (const service of services) {
      stats[service] = await this.getUsageStats(service);
    }

    return stats;
  }

  /**
   * Execute operation with automatic rate limit check
   * Throws if rate limit exceeded
   */
  async executeWithRateLimit<T>(
    service: string,
    operation: () => Promise<T>,
    dailyLimit?: number,
  ): Promise<T> {
    // Register the call (will throw if limit exceeded)
    await this.registerCall(service, dailyLimit);

    try {
      const result = await operation();
      return result;
    } catch (error) {
      this.logger.error(`Error in ${service} operation: ${error.message}`);
      throw error;
    }
  }

  /**
   * Reset usage for a service (admin function)
   */
  async resetUsage(service: string): Promise<void> {
    if (!this.redis) return;

    const today = this.getTodayKey();
    const key = `rate_limit:${service}:${today}`;

    await this.redis.del(key);
    this.logger.log(`Reset usage for ${service}`);
  }

  /**
   * Get today's date key (YYYY-MM-DD)
   */
  private getTodayKey(): string {
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Get seconds until midnight (for TTL)
   */
  private getSecondsUntilMidnight(): number {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    return Math.floor((tomorrow.getTime() - now.getTime()) / 1000);
  }

  /**
   * Health check - verify Redis connection
   */
  async healthCheck(): Promise<boolean> {
    if (!this.redis) return false;

    try {
      await this.redis.ping();
      return true;
    } catch (error) {
      this.logger.error('Redis health check failed:', error);
      return false;
    }
  }
}
