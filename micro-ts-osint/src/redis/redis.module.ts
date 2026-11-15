import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Redis Module - Global Redis Client Provider
 *
 * Provides Redis client for:
 * - Rate limiting (RateLimitService)
 * - Caching (future)
 * - Session storage (future)
 *
 * Configuration via REDIS_URL environment variable
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: (configService: ConfigService) => {
        const logger = new Logger('RedisModule');
        const redisUrl =
          configService.get<string>('REDIS_URL') || 'redis://localhost:6379';

        try {
          const redis = new Redis(redisUrl, {
            maxRetriesPerRequest: 3,
            retryStrategy: (times) => {
              if (times > 3) {
                logger.warn(
                  '⚠️  Redis connection failed after 3 retries - rate limiting will be disabled',
                );
                return null;
              }
              return Math.min(times * 200, 2000);
            },
            lazyConnect: true, // Don't connect immediately, wait for first operation
          });

          // Connect immediately
          redis
            .connect()
            .then(() => {
              logger.log('🟢 [OSINT-DECO] Redis connected successfully');
            })
            .catch((err) => {
              logger.error(`🔴 [OSINT-DECO] Redis connection error: ${err.message}`);
              logger.warn('🟠 [OSINT-DECO] Redis unavailable; authentication uses local rate limits');
            });

          redis.on('error', (err) => {
            logger.error(`🔴 [OSINT-DECO] Redis error: ${err.message}`);
          });

          redis.on('reconnecting', () => {
            logger.warn('🟠 [OSINT-DECO] Redis reconnecting...');
          });

          return redis;
        } catch (error) {
          logger.error(`🔴 [OSINT-DECO] Redis initialization error: ${error.message}`);
          logger.warn('🟠 [OSINT-DECO] Redis unavailable; authentication uses local rate limits');
          return null;
        }
      },
      inject: [ConfigService],
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class RedisModule {}
