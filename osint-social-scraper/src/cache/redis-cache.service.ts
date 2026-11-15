import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private client?: Redis;

  constructor(private readonly configService: ConfigService) {}

  configured() {
    return Boolean(this.configService.get<string>('REDIS_URL'));
  }

  status() {
    return {
      configured: this.configured(),
      connected: this.client?.status === 'ready',
      prefix: this.prefix,
    };
  }

  async healthCheck() {
    if (!this.configured()) {
      return { configured: false, connected: false, status: 'not_configured' };
    }

    const client = this.getClient();
    if (!client) {
      return { configured: true, connected: false, status: 'unavailable' };
    }

    await client.ping();
    return {
      configured: true,
      connected: client.status === 'ready',
      status: client.status,
    };
  }

  async getJson<T>(key: string): Promise<T | null> {
    const client = this.getClient();
    if (!client) return null;

    try {
      const value = await client.get(this.key(key));
      return value ? (JSON.parse(value) as T) : null;
    } catch (error) {
      this.logger.warn(`Redis get failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds?: number) {
    const client = this.getClient();
    if (!client) return false;

    try {
      const ttl = ttlSeconds || Number(this.configService.get<string>('SOCIAL_CACHE_TTL_SECONDS') || 600);
      await client.set(this.key(key), JSON.stringify(value), 'EX', ttl);
      return true;
    } catch (error) {
      this.logger.warn(`Redis set failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private get prefix() {
    return this.configService.get<string>('SOCIAL_CACHE_PREFIX') || 'osint:social';
  }

  private key(key: string) {
    return `${this.prefix}:${key}`;
  }

  private getClient() {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (!redisUrl) return null;
    if (this.client) return this.client;

    this.client = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
    });
    this.client.on('error', (error) => this.logger.warn(`Redis error: ${error.message}`));
    this.client.connect().catch((error) => this.logger.warn(`Redis connect failed: ${error.message}`));
    return this.client;
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
    }
  }
}
