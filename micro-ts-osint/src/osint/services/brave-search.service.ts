import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { EvidenceService } from './evidence.service';
import { RegexExtractorService } from './regex-extractor.service';
import { RateLimitService } from './rate-limit.service';

export interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
  age?: string;
  language?: string;
  thumbnail?: { src: string };
}

export interface BraveSearchResponse {
  results: BraveSearchResult[];
  totalResults: number;
  responseTime: number;
}

/**
 * Brave Search API Service
 *
 * Free tier: 2,000 queries/month (no credit card required)
 * API Docs: https://brave.com/search/api/
 *
 * Advantages:
 * ✅ Independent index (not Google/Bing proxy)
 * ✅ Generous free tier
 * ✅ Fast and reliable API
 * ✅ Web, news, and image search
 */
@Injectable()
export class BraveSearchService {
  private readonly logger = new Logger(BraveSearchService.name);
  private readonly apiKey: string;
  private readonly BASE_URL = 'https://api.search.brave.com/res/v1';
  private readonly dailyLimit: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly evidenceService: EvidenceService,
    private readonly regexExtractor: RegexExtractorService,
    private readonly rateLimitService: RateLimitService,
  ) {
    this.apiKey = this.configService.get<string>('BRAVE_SEARCH_API_KEY') || '';
    this.dailyLimit = parseInt(
      this.configService.get<string>('BRAVE_DAILY_LIMIT') || '60',
      10,
    );

    if (this.apiKey) {
      this.logger.log(
        `✅ Brave Search initialized (daily limit: ${this.dailyLimit} calls)`,
      );
    } else {
      this.logger.warn(
        '⚠️ BRAVE_SEARCH_API_KEY not set — Brave search disabled',
      );
    }
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async search(
    searchId: string,
    query: string,
    options: { maxResults?: number; country?: string; language?: string } = {},
  ): Promise<BraveSearchResponse> {
    const maxResults = options.maxResults || 10;
    const startTime = Date.now();

    const canProceed = await this.rateLimitService.canUseAPI(
      'brave-search',
      this.dailyLimit,
    );
    if (!canProceed) {
      this.logger.warn('Brave Search daily limit reached');
      return { results: [], totalResults: 0, responseTime: 0 };
    }
    await this.rateLimitService.registerCall('brave-search', this.dailyLimit);

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.BASE_URL}/web/search`, {
          params: {
            q: query,
            count: Math.min(maxResults, 20),
            country: options.country || 'ALL',
            search_lang: options.language || 'en',
            text_decorations: false,
          },
          headers: {
            Accept: 'application/json',
            'Accept-Encoding': 'gzip',
            'X-Subscription-Token': this.apiKey,
          },
          timeout: 15000,
        }),
      );

      const data = response.data;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const webResults: BraveSearchResult[] = (data.web?.results || []).slice(
        0,
        maxResults,
      );
      const responseTime = Date.now() - startTime;

      // Save evidence
      for (const result of webResults) {
        try {
          const combinedText = `${result.title} ${result.description || ''}`;
          const extracted = this.regexExtractor.extractAll(combinedText);

          await this.evidenceService.saveEvidence(searchId, {
            source: 'Brave Search',
            category: 'search_result',
            title: result.title,
            summary: result.description || '',
            url: result.url,
            thumbnailUrl: result.thumbnail?.src,
            matchConfidence: 0.65,
            signals: {
              identity: 0.5,
              legal: 0.3,
              financial: 0.2,
              social: 0.4,
            },
            extractedData: {
              emails: extracted.emails,
              phones: extracted.phones,
              rfcs: extracted.rfcs,
              curps: extracted.curps,
              urls: extracted.urls,
              ips: extracted.ips,
            },
          } as any);
        } catch (err) {
          this.logger.debug(`Brave evidence save skipped: ${err.message}`);
        }
      }

      this.logger.log(
        `Brave Search: ${webResults.length} results for "${query}" (${responseTime}ms)`,
      );

      return {
        results: webResults,
        totalResults: data.web?.totalResults || webResults.length,
        responseTime,
      };
    } catch (error: any) {
      this.logger.error(`Brave Search error: ${error.message}`);
      throw error;
    }
  }

  async searchNews(
    searchId: string,
    query: string,
    options: { maxResults?: number } = {},
  ): Promise<BraveSearchResponse> {
    const maxResults = options.maxResults || 10;
    const startTime = Date.now();

    const canProceed = await this.rateLimitService.canUseAPI(
      'brave-search',
      this.dailyLimit,
    );
    if (!canProceed) {
      return { results: [], totalResults: 0, responseTime: 0 };
    }
    await this.rateLimitService.registerCall('brave-search', this.dailyLimit);

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.BASE_URL}/news/search`, {
          params: { q: query, count: Math.min(maxResults, 20) },
          headers: {
            Accept: 'application/json',
            'X-Subscription-Token': this.apiKey,
          },
          timeout: 15000,
        }),
      );

      const newsResults = (response.data.results || []).slice(0, maxResults);
      const responseTime = Date.now() - startTime;

      for (const result of newsResults) {
        try {
          await this.evidenceService.saveEvidence(searchId, {
            source: 'Brave News',
            category: 'news',
            title: result.title,
            summary: result.description || '',
            url: result.url,
            matchConfidence: 0.6,
          } as any);
        } catch {
          // dedup or save error
        }
      }

      return {
        results: newsResults,
        totalResults: newsResults.length,
        responseTime,
      };
    } catch (error: any) {
      this.logger.error(`Brave News error: ${error.message}`);
      throw error;
    }
  }
}
