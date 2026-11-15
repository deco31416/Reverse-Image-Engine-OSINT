import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { EvidenceService } from './evidence.service';
import { RateLimitService } from './rate-limit.service';

/**
 * A single visual match from SerpAPI Google Lens.
 */
export interface SerpApiVisualMatch {
  position: number;
  title: string;
  link: string;
  source: string;
  sourceIcon?: string;
  thumbnail: string;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
}

/**
 * Full response from a SerpAPI Google Lens search.
 */
export interface SerpApiGoogleLensResponse {
  ok: boolean;
  totalResults: number;
  visualMatches: SerpApiVisualMatch[];
  searchUrl?: string;
  error?: string;
}

/**
 * SerpAPI Google Lens Service 🔍🌐
 *
 * Uses serpapi.com Google Lens engine to find visual matches for an image.
 * Returns structured JSON with title, link, source, thumbnail, and full image URL.
 *
 * API: GET https://serpapi.com/search.json?engine=google_lens&url=IMAGE_URL
 * Docs: https://serpapi.com/google-lens-api
 *
 * This is a separate engine from Yandex — runs in parallel.
 */
@Injectable()
export class SerpApiGoogleLensService {
  private readonly logger = new Logger(SerpApiGoogleLensService.name);
  private readonly apiKey: string;
  private readonly serviceName = 'serpapi-lens';
  private readonly BASE_URL = 'https://serpapi.com/search.json';
  private readonly dailyLimit: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly evidenceService: EvidenceService,
    private readonly rateLimitService: RateLimitService,
  ) {
    const rawKey = this.configService.get<string>('SERPAPI_API_KEY') || '';
    this.apiKey = rawKey.trim().replace(/^['\"]+|['\"]+$/g, '');
    this.dailyLimit = parseInt(
      this.configService.get<string>('SERPAPI_DAILY_LIMIT') || '100',
      10,
    );

    if (this.apiKey) {
      this.logger.log(`✅ SerpAPI Google Lens initialized (daily limit: ${this.dailyLimit})`);
    } else {
      this.logger.warn('⚠️ SERPAPI_API_KEY not set — Google Lens (SerpAPI) disabled');
    }
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  /**
   * Search Google Lens for visual matches of a public image URL.
   */
  async searchByImageUrl(imageUrl: string): Promise<SerpApiGoogleLensResponse> {
    if (!this.apiKey) {
      return { ok: false, totalResults: 0, visualMatches: [], error: 'No SERPAPI_API_KEY' };
    }

    const canUse = await this.rateLimitService.canUseAPI(this.serviceName, this.dailyLimit);
    if (!canUse) {
      this.logger.warn('⚠️ SerpAPI daily limit reached');
      return { ok: false, totalResults: 0, visualMatches: [], error: 'Rate limit reached' };
    }

    try {
      this.logger.log(`🔍 SerpAPI Google Lens: ${imageUrl.substring(0, 80)}...`);

      const response = await firstValueFrom(
        this.httpService.get(this.BASE_URL, {
          params: {
            engine: 'google_lens',
            url: imageUrl,
            api_key: this.apiKey,
          },
          timeout: 30000,
        }),
      );

      await this.rateLimitService.registerCall(this.serviceName, this.dailyLimit);

      const data = response.data;
      const rawMatches: any[] = data.visual_matches || [];

      const visualMatches: SerpApiVisualMatch[] = rawMatches.map((m: any) => ({
        position: m.position || 0,
        title: m.title || '',
        link: m.link || '',
        source: m.source || '',
        sourceIcon: m.source_icon,
        thumbnail: m.thumbnail || '',
        thumbnailWidth: m.thumbnail_width,
        thumbnailHeight: m.thumbnail_height,
        image: m.image,
        imageWidth: m.image_width,
        imageHeight: m.image_height,
      }));

      this.logger.log(`✅ SerpAPI Google Lens: ${visualMatches.length} visual matches`);

      return {
        ok: true,
        totalResults: visualMatches.length,
        visualMatches,
        searchUrl: data.search_metadata?.google_lens_url,
      };
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.logger.error('❌ SerpAPI: Invalid API key');
      } else if (error.response?.status === 429) {
        this.logger.error('❌ SerpAPI: Rate limit exceeded');
      } else {
        this.logger.error(`❌ SerpAPI Google Lens failed: ${error.message}`);
      }
      return { ok: false, totalResults: 0, visualMatches: [], error: error.message };
    }
  }

  /**
   * Search and save results as evidence.
   */
  async searchAndSaveEvidence(
    searchId: string,
    imageUrl: string,
  ): Promise<SerpApiGoogleLensResponse> {
    const result = await this.searchByImageUrl(imageUrl);

    if (result.ok && result.visualMatches.length > 0) {
      await this.saveEvidences(searchId, result.visualMatches);
    }

    return result;
  }

  private async saveEvidences(
    searchId: string,
    matches: SerpApiVisualMatch[],
  ): Promise<void> {
    for (const match of matches) {
      try {
        await this.evidenceService.saveEvidence(searchId, {
          source: 'serpapi_google_lens',
          category: 'identity',
          title: match.title || `Google Lens: ${match.source}`,
          summary: `Visual match on ${match.source}: ${match.title}`,
          url: match.link,
          imageUrl: match.image || match.thumbnail,
          thumbnailUrl: match.thumbnail,
          matchConfidence: Math.max(0.5, 1 - (match.position * 0.02)),
          extractedData: {
            urls: [match.link],
          },
        } as any);
      } catch {
        // Dedup handles duplicates
      }
    }

    this.logger.log(`✅ Saved ${matches.length} Google Lens evidences`);
  }
}
