import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as FormData from 'form-data';
import * as cheerio from 'cheerio';
import { EvidenceService } from './evidence.service';
import { RegexExtractorService } from './regex-extractor.service';
import { SerperSearchService } from './serper-search.service';
import { YandexReverseImageNativeService } from './yandex-reverse-image-native.service';
import { SerpApiGoogleLensService } from './serpapi-google-lens.service';

export interface ReverseImageResult {
  source: 'google' | 'yandex' | 'tineye' | 'bing' | 'google_lens';
  url: string;
  title: string;
  snippet?: string;
  thumbnail?: string;
  domain: string;
  confidence?: number;
  imageUrl?: string;
}

export interface ReverseImageSearchResponse {
  query: {
    imageUrl?: string;
    imageBase64?: string;
  };
  totalResults: number;
  results: ReverseImageResult[];
  searchUrl?: string;
  relatedSearches?: string[];
  visuallySimilarImages?: string[];
  timestamp: Date;
}

@Injectable()
export class ReverseImageSearchService {
  private readonly logger = new Logger(ReverseImageSearchService.name);
  private readonly googleApiKey: string;
  private readonly googleCseId: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly evidenceService: EvidenceService,
    private readonly regexExtractor: RegexExtractorService,
    private readonly serperSearchService: SerperSearchService,
    private readonly yandexNative: YandexReverseImageNativeService,
    private readonly serpApiLens: SerpApiGoogleLensService,
  ) {
    this.googleApiKey = this.configService.get<string>('GOOGLE_API_KEY') || '';
    this.googleCseId = this.configService.get<string>('GOOGLE_CSE_ID') || '';
  }

  /**
   * Search all engines and save evidence automatically
   * Used by MultiSearchOrchestrator
   */
  async searchAllEngines(
    searchId: string,
    imageUrl?: string,
    imageBase64?: string,
  ): Promise<ReverseImageSearchResponse> {
    this.logger.log(`🔍 Reverse image search for ${searchId}...`);

    const response = await this.searchByImage(imageUrl, imageBase64);

    // Save evidences
    if (response.results.length > 0) {
      await this.saveEvidences(searchId, response.results);
    } else {
      await this.saveNoMatchEvidence(searchId, response);
    }

    return response;
  }

  /**
   * Perform reverse image search using Yandex only
   */
  async searchByImage(
    imageUrl?: string,
    imageBase64?: string,
  ): Promise<ReverseImageSearchResponse> {
    this.logger.log('🔍 Starting reverse image search...');

    const results: ReverseImageResult[] = [];
    const hasPublicUrl = Boolean(imageUrl && !imageUrl.startsWith('data:image/'));

    // Run SerpAPI Google Lens in parallel (non-blocking)
    let serpApiPromise: Promise<ReverseImageResult[]> | null = null;
    if (hasPublicUrl && this.serpApiLens.isAvailable()) {
      serpApiPromise = this.searchSerpApiGoogleLens(imageUrl!);
    }

    try {
      // Try native Yandex upload (base64 path)
      if (imageBase64) {
        const nativeResponse = await this.searchYandexNative(imageBase64, imageUrl);
        if (nativeResponse) {
          // Merge SerpAPI results if available
          if (serpApiPromise) {
            const lensResults = await serpApiPromise;
            nativeResponse.results.push(...lensResults);
            nativeResponse.totalResults = nativeResponse.results.length;
          }
          return nativeResponse;
        }
      }

      // Fallback: download image from public URL and try native upload
      if (hasPublicUrl) {
        this.logger.log('⬇️ Downloading image from URL for native Yandex upload...');
        const downloaded = await this.yandexNative.downloadImage(imageUrl!);
        if (downloaded) {
          const yandex = await this.yandexNative.reverseSearch(downloaded.bytes, downloaded.contentType, 50);
          if (yandex.ok) {
            const nativeResults = this.mapYandexMatches(yandex, imageUrl);
            this.logger.log(`✅ Native Yandex (from URL download): ${nativeResults.length} results`);
            // Merge SerpAPI results
            if (serpApiPromise) {
              const lensResults = await serpApiPromise;
              nativeResults.push(...lensResults);
            }
            return {
              query: { imageUrl, imageBase64 },
              totalResults: nativeResults.length,
              results: nativeResults,
              searchUrl: yandex.search_url || undefined,
              relatedSearches: [],
              visuallySimilarImages: [],
              timestamp: new Date(),
            };
          }
        }
      }

      // Last resort: URL-based Yandex search (often hits captcha from Docker)
      if (hasPublicUrl) {
        const yandexResults = await this.searchYandexImages(imageUrl);
        results.push(...yandexResults);
      } else {
        this.logger.warn('Yandex reverse search skipped: no public image URL available');
      }

      // Merge SerpAPI results
      if (serpApiPromise) {
        const lensResults = await serpApiPromise;
        results.push(...lensResults);
      }

      this.logger.log(`✅ Found ${results.length} total reverse image results`);

      return {
        query: { imageUrl, imageBase64 },
        totalResults: results.length,
        results,
        searchUrl: hasPublicUrl ? `https://yandex.com/images/search?url=${encodeURIComponent(imageUrl!)}&rpt=imageview&cbir_page=sites` : undefined,
        relatedSearches: [],
        visuallySimilarImages: [],
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error(`❌ Reverse image search failed: ${error.message}`);
      throw error;
    }
  }

  private async searchYandexNative(
    imageBase64: string,
    imageUrl?: string,
  ): Promise<ReverseImageSearchResponse | null> {
    try {
      // Decode base64 to Buffer
      let payload = imageBase64.trim();
      let contentType = 'image/png';
      if (payload.startsWith('data:')) {
        const match = payload.match(/^data:([^;]+);base64,(.+)$/s);
        if (match) {
          contentType = match[1];
          payload = match[2];
        }
      }
      payload = payload.replace(/[\n\r]/g, '');
      const imageBytes = Buffer.from(payload, 'base64');

      const yandex = await this.yandexNative.reverseSearch(imageBytes, contentType, 50);

      if (!yandex.ok) {
        this.logger.warn(`⚠️ Native Yandex search failed: ${yandex.error}`);
        return null;
      }

      const results = this.mapYandexMatches(yandex, imageUrl);

      this.logger.log(`✅ Native Yandex: ${results.length} results (cbir_id: ${yandex.cbir_id || 'N/A'})`);

      return {
        query: { imageUrl, imageBase64 },
        totalResults: results.length,
        results,
        searchUrl: yandex.search_url || undefined,
        relatedSearches: [],
        visuallySimilarImages: [],
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.warn(`⚠️ Native Yandex search failed: ${error.message}`);
      return null;
    }
  }

  private mapYandexMatches(yandex: import('./yandex-reverse-image-native.service').YandexNativeResult, imageUrl?: string): ReverseImageResult[] {
    return yandex.matches
      .map((match) => {
        const url = (match.source_url || '').trim();
        if (!url) return null;
        const isImgUrl = /\.(jpe?g|png|gif|webp|bmp|svg)([?#]|$)/i.test(url);
        const thumb = match.thumbnail_url || (isImgUrl ? url : undefined);
        return {
          source: 'yandex' as const,
          url,
          title: match.title?.trim() || url,
          snippet: match.snippet?.trim() || undefined,
          thumbnail: thumb,
          domain: this.safeDomain(url),
          confidence: match.type === 'face_match' ? 0.95 : 0.8,
          imageUrl: thumb || yandex.original_image_url || imageUrl,
        };
      })
      .filter(Boolean) as ReverseImageResult[];
  }

  /**
   * SerpAPI Google Lens — uses serpapi.com engine
   */
  private async searchSerpApiGoogleLens(imageUrl: string): Promise<ReverseImageResult[]> {
    try {
      const response = await this.serpApiLens.searchByImageUrl(imageUrl);
      if (!response.ok || response.visualMatches.length === 0) return [];

      return response.visualMatches.map((m) => ({
        source: 'google_lens' as const,
        url: m.link,
        title: m.title || m.source,
        snippet: m.source,
        thumbnail: m.thumbnail,
        domain: this.safeDomain(m.link),
        confidence: Math.max(0.5, 1 - (m.position * 0.02)),
        imageUrl: m.image || m.thumbnail,
      })).filter((r) => r.url);
    } catch (error) {
      this.logger.error(`❌ SerpAPI Google Lens failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Google Lens reverse image search via Serper API (real results, no scraping)
   */
  private async searchGoogleLens(imageUrl?: string, imageBase64?: string): Promise<ReverseImageResult[]> {
    try {
      if (!imageUrl && !imageBase64) return [];

      // Use the centralized SerperSearchService.searchByImageUrl()
      const lensResults = await this.serperSearchService.searchByImageUrl('', imageUrl, imageBase64);

      return lensResults.map((r) => ({
        source: 'google' as const,
        url: r.link,
        title: r.title,
        snippet: undefined,
        thumbnail: r.thumbnailUrl || r.imageUrl,
        domain: r.source,
        confidence: 0.9,
        imageUrl: r.imageUrl,
      })).filter((r) => r.url);
    } catch (error) {
      this.logger.error(`❌ Google Lens failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Search on Google Images using reverse image search (LEGACY — scraping, may fail)
   * Kept for reference. searchGoogleLens() is preferred.
   */
  private async searchGoogleImages(
    imageUrl?: string,
    imageBase64?: string,
  ): Promise<ReverseImageResult[]> {
    try {
      this.logger.log('🔎 Searching on Google Images (scraping)...');

      if (!imageUrl && !imageBase64) {
        return [];
      }

      const searchUrl = imageUrl
        ? `https://www.google.com/searchbyimage?image_url=${encodeURIComponent(imageUrl)}&hl=en`
        : null;

      if (!searchUrl) {
        this.logger.warn('No valid search URL for Google Images');
        return [];
      }

      const response = await firstValueFrom(
        this.httpService.get(searchUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          timeout: 15000,
          maxRedirects: 5,
        }),
      );

      this.logger.log(`Google response status: ${response.status}, body length: ${response.data?.length || 0}`);

      // Parse HTML with Cheerio
      const $ = cheerio.load(response.data);
      const results: ReverseImageResult[] = [];

      // Extract results from search page
      $('.g').each((_, element) => {
        const title = $(element).find('h3').text();
        const link = $(element).find('a').attr('href');
        const snippet = $(element).find('.VwiC3b').text();

        if (title && link) {
          results.push({
            source: 'google',
            url: link,
            title,
            snippet,
            domain: new URL(link).hostname,
          });
        }
      });

      this.logger.log(`✅ Google Images: ${results.length} results`);
      return results;
    } catch (error) {
      this.logger.error(`❌ Google Images search failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Search on Yandex Images (excellent for face recognition)
   */
  private async searchYandexImages(
    imageUrl?: string,
  ): Promise<ReverseImageResult[]> {
    try {
      if (!imageUrl) return [];

      this.logger.log('🔎 Searching on Yandex Images...');

      const searchUrl = `https://yandex.com/images/search?url=${encodeURIComponent(imageUrl)}&rpt=imageview`;

      const response = await firstValueFrom(
        this.httpService.get(searchUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          timeout: 15000,
          maxRedirects: 5,
        }),
      );

      this.logger.log(`Yandex response status: ${response.status}, body length: ${response.data?.length || 0}`);

      const $ = cheerio.load(response.data);
      const results: ReverseImageResult[] = [];

      // Parse Yandex results
      $('.serp-item').each((_, element) => {
        const title = $(element).find('.serp-item__title').text();
        const link = $(element).find('.serp-item__link').attr('href');
        const snippet = $(element).find('.serp-item__text').text();

        if (title && link) {
          results.push({
            source: 'yandex',
            url: link,
            title,
            snippet,
            domain: new URL(link).hostname,
          });
        }
      });

      this.logger.log(`✅ Yandex: ${results.length} results`);
      return results;
    } catch (error) {
      this.logger.error(`❌ Yandex search failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Search on TinEye (best for exact image matches)
   */
  private async searchTinEye(imageUrl?: string): Promise<ReverseImageResult[]> {
    try {
      if (!imageUrl) return [];

      this.logger.log('🔎 Searching on TinEye...');

      const searchUrl = `https://tineye.com/search?url=${encodeURIComponent(imageUrl)}`;

      const response = await firstValueFrom(
        this.httpService.get(searchUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          timeout: 15000,
          maxRedirects: 5,
        }),
      );

      this.logger.log(`TinEye response status: ${response.status}, body length: ${response.data?.length || 0}`);

      const $ = cheerio.load(response.data);
      const results: ReverseImageResult[] = [];

      // Parse TinEye results
      $('.match').each((_, element) => {
        const title = $(element).find('.match-title').text();
        const link = $(element).find('.match-link').attr('href');
        const domain = $(element).find('.match-domain').text();

        if (title && link) {
          results.push({
            source: 'tineye',
            url: link,
            title,
            domain: domain || new URL(link).hostname,
          });
        }
      });

      this.logger.log(`✅ TinEye: ${results.length} results`);
      return results;
    } catch (error) {
      this.logger.error(`❌ TinEye search failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Extract social media profiles from reverse image results
   */
  extractSocialMediaProfiles(results: ReverseImageResult[]): {
    facebook: string[];
    instagram: string[];
    twitter: string[];
    linkedin: string[];
    tiktok: string[];
  } {
    const profiles: {
      facebook: string[];
      instagram: string[];
      twitter: string[];
      linkedin: string[];
      tiktok: string[];
    } = {
      facebook: [],
      instagram: [],
      twitter: [],
      linkedin: [],
      tiktok: [],
    };

    results.forEach((result) => {
      const url = result.url.toLowerCase();

      if (url.includes('facebook.com')) {
        profiles.facebook.push(result.url);
      } else if (url.includes('instagram.com')) {
        profiles.instagram.push(result.url);
      } else if (url.includes('twitter.com') || url.includes('x.com')) {
        profiles.twitter.push(result.url);
      } else if (url.includes('linkedin.com')) {
        profiles.linkedin.push(result.url);
      } else if (url.includes('tiktok.com')) {
        profiles.tiktok.push(result.url);
      }
    });

    return profiles;
  }

  /**
   * Save reverse image search results as evidence
   */
  private async saveEvidences(
    searchId: string,
    results: ReverseImageResult[],
  ): Promise<void> {
    this.logger.log(
      `Saving ${results.length} reverse image results as evidence...`,
    );

    for (const result of results) {
      try {
        // Extract data from result
        const extracted = this.regexExtractor.extractAll(
          `${result.title} ${result.snippet || ''} ${result.url}`,
        );

        await this.evidenceService.saveEvidence(searchId, {
          source: `reverse_image_${result.source}`,
          category: 'identity', // Imágenes son principalmente para identificación
          title: result.title,
          summary: result.snippet || result.title,
          url: result.url,
          imageUrl: result.imageUrl || result.thumbnail,
          thumbnailUrl: result.thumbnail,
          matchConfidence: result.confidence || 0.6,
          extractedData: {
            emails: extracted.emails,
            phones: extracted.phones,
            rfcs: extracted.rfcs,
            curps: extracted.curps,
            urls: [result.url],
          },
        } as any);
      } catch (error) {
        this.logger.error(
          `Error saving evidence from ${result.source}: ${error.message}`,
        );
      }
    }

    this.logger.log(`✅ Saved ${results.length} reverse image evidences`);
  }

  private async saveNoMatchEvidence(
    searchId: string,
    response: ReverseImageSearchResponse,
  ): Promise<void> {
    const fallbackUrl = response.searchUrl || response.query.imageUrl;
    if (!fallbackUrl) {
      return;
    }

    await this.evidenceService.saveEvidence(searchId, {
      source: 'yandex_reverse_image_status',
      category: 'identity',
      title: 'Yandex reverse image ejecutado sin coincidencias visibles',
      summary: `Yandex procesó la imagen correctamente (0 resultados). URL de búsqueda: ${fallbackUrl}`,
      url: fallbackUrl,
      imageUrl: response.query.imageUrl,
      matchConfidence: 0.2,
      extractedData: {
        emails: [],
        phones: [],
        rfcs: [],
        curps: [],
        urls: [fallbackUrl],
      },
    } as any).catch(() => {});
  }

  private safeDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return 'unknown';
    }
  }
}
