import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

type SocialPlatform =
  | 'github'
  | 'reddit'
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'x'
  | 'pinterest'
  | 'medium'
  | 'youtube'
  | 'telegram'
  | 'discord'
  | 'threads'
  | 'mastodon'
  | 'bluesky';

type SocialProfile = {
  platform: SocialPlatform;
  name?: string;
  username?: string;
  profileUrl: string;
  avatarUrl?: string;
  bio?: string;
  confidence?: number;
  source?: string;
  metadata?: Record<string, any>;
};

type SocialScraperResponse = {
  kind: string;
  query: string;
  searchedPlatforms: SocialPlatform[];
  total: number;
  profiles?: SocialProfile[];
  matches?: Array<Record<string, any>>;
  errors?: Array<Record<string, any>>;
  capturedAt: string;
  persistence?: Record<string, any>;
};

@Injectable()
export class SocialScraperClientService {
  private readonly logger = new Logger(SocialScraperClientService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  isAvailable() {
    return Boolean(this.baseUrl);
  }

  async healthCheck() {
    if (!this.isAvailable()) {
      return { available: false, reason: 'SOCIAL_SCRAPER_BASE_URL not configured' };
    }

    try {
      const { data } = await this.get('/health');
      return { available: true, service: data };
    } catch (error) {
      return { available: false, error: this.errorMessage(error) };
    }
  }

  async searchByUsername(username: string, platforms?: SocialPlatform[], limit = 10): Promise<SocialScraperResponse | null> {
    if (!this.isAvailable() || !username) return null;
    return this.post('/social/search/username', { username, platforms, limit });
  }

  async searchByName(query: string, platforms?: SocialPlatform[], limit = 10): Promise<SocialScraperResponse | null> {
    if (!this.isAvailable() || !query) return null;
    return this.post('/social/search/name', { query, platforms, limit });
  }

  async searchByImage(base64: string, platforms?: SocialPlatform[], limit = 10): Promise<SocialScraperResponse | null> {
    if (!this.isAvailable() || !base64) return null;
    return this.post('/social/search/image', {
      base64,
      platforms,
      limit,
      enrichProfiles: true,
      ownerHint: 'micro-ts-osint',
    });
  }

  async resolveProfileUrl(url: string): Promise<SocialScraperResponse | null> {
    if (!this.isAvailable() || !url) return null;
    return this.post('/social/profile/resolve', { url });
  }

  async listAssets(params: Record<string, string | number | undefined>) {
    if (!this.isAvailable()) return [];
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== '') query.set(key, String(value));
    });
    const suffix = query.toString() ? `?${query.toString()}` : '';
    try {
      const { data } = await this.get(`/assets${suffix}`);
      return data;
    } catch (error) {
      this.logger.warn(`Social scraper list assets failed: ${this.errorMessage(error)}`);
      return [];
    }
  }

  async getAsset(id: string) {
    if (!this.isAvailable() || !id) return null;
    try {
      const { data } = await this.get(`/assets/${encodeURIComponent(id)}`);
      return data;
    } catch (error) {
      this.logger.warn(`Social scraper get asset failed: ${this.errorMessage(error)}`);
      return null;
    }
  }

  async markAssetStatus(id: string, body: { status: string; note?: string }) {
    if (!this.isAvailable()) return { updated: false, reason: 'social_scraper_not_configured' };
    return this.patch(`/assets/${encodeURIComponent(id)}/status`, body);
  }

  async deleteAssetsBySearch(searchId: string) {
    if (!this.isAvailable()) return { success: true, skipped: true, reason: 'social_scraper_not_configured', assetsDeleted: 0, filesDeleted: 0 };
    try {
      const { data } = await firstValueFrom(this.httpService.delete(
        `${this.baseUrl}/assets/by-search/${encodeURIComponent(searchId)}`,
        { headers: this.headers(), timeout: this.timeoutMs },
      ));
      return data;
    } catch (error) {
      return { success: false, skipped: false, error: this.errorMessage(error), assetsDeleted: 0, filesDeleted: 0 };
    }
  }

  private async get(path: string) {
    return firstValueFrom(
      this.httpService.get(`${this.baseUrl}${path}`, {
        headers: this.headers(),
        timeout: this.timeoutMs,
      }),
    );
  }

  private async post(path: string, body: Record<string, any>): Promise<SocialScraperResponse | null> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}${path}`, body, {
          headers: this.headers(),
          timeout: this.timeoutMs,
        }),
      );
      return data;
    } catch (error) {
      this.logger.warn(`Social scraper request failed ${path}: ${this.errorMessage(error)}`);
      return null;
    }
  }

  private async patch(path: string, body: Record<string, any>) {
    try {
      const { data } = await firstValueFrom(
        this.httpService.patch(`${this.baseUrl}${path}`, body, {
          headers: this.headers(),
          timeout: this.timeoutMs,
        }),
      );
      return data;
    } catch (error) {
      this.logger.warn(`Social scraper request failed ${path}: ${this.errorMessage(error)}`);
      return { updated: false, error: this.errorMessage(error) };
    }
  }

  private headers() {
    const apiKey =
      this.configService.get<string>('SOCIAL_SCRAPER_API_KEY') ||
      this.configService.get<string>('MICROSERVICES_API_KEY');
    return {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    };
  }

  private get baseUrl() {
    const raw = this.configService.get<string>('SOCIAL_SCRAPER_BASE_URL') || '';
    return raw.replace(/\/$/, '');
  }

  private get timeoutMs() {
    return Number(this.configService.get<string>('SOCIAL_SCRAPER_TIMEOUT_MS') || 30000);
  }

  private errorMessage(error: any) {
    return error?.response?.data?.message || error?.message || String(error);
  }
}
