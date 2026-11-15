import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { RateLimitService } from './rate-limit.service';
import { EvidenceService } from './evidence.service';
import { RegexExtractorService } from './regex-extractor.service';

export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  description: string;
  channelTitle: string;
  channelId: string;
  publishedAt: string;
  thumbnailUrl: string;
  url: string;
}

export interface YouTubeSearchResponse {
  results: YouTubeSearchResult[];
  totalResults: number;
  nextPageToken?: string;
}

/**
 * Servicio de búsqueda de videos en YouTube Data API v3
 *
 * Características:
 * - Búsqueda de videos relacionados con persona
 * - Extracción de canales y descripciones
 * - Rate limiting automático (protege cuota)
 * - Auto-guardado de evidencia en MongoDB
 *
 * API Docs: https://developers.google.com/youtube/v3/docs/search/list
 *
 * Cuota: 10,000 unidades/día (1 búsqueda = 100 unidades)
 *
 * Variables de entorno requeridas:
 * - YOUTUBE_API_KEY
 */
@Injectable()
export class YouTubeSearchService {
  private readonly logger = new Logger(YouTubeSearchService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://www.googleapis.com/youtube/v3';
  private readonly serviceName = 'youtube';

  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
    private rateLimitService: RateLimitService,
    private evidenceService: EvidenceService,
    private regexExtractor: RegexExtractorService,
  ) {
    this.apiKey = this.configService.get<string>('YOUTUBE_API_KEY') || '';

    if (!this.apiKey) {
      this.logger.warn(
        'YOUTUBE_API_KEY not configured - YouTube search will be disabled',
      );
    }
  }

  /**
   * Busca videos en YouTube y guarda evidencia automáticamente
   *
   * @param searchId - ID de búsqueda OSINT en MongoDB
   * @param query - Query de búsqueda
   * @param options - Opciones adicionales
   * @returns Resultados de YouTube con metadatos
   */
  async search(
    searchId: string,
    query: string,
    options?: {
      maxResults?: number; // Máximo resultados (default: 10, max: 50)
      order?: 'relevance' | 'date' | 'rating' | 'viewCount';
      publishedAfter?: Date; // Filtrar videos después de esta fecha
      publishedBefore?: Date; // Filtrar videos antes de esta fecha
      regionCode?: string; // Código de región (MX, US, etc.)
      pageToken?: string; // Token para paginación
    },
  ): Promise<YouTubeSearchResponse> {
    if (!this.apiKey) {
      this.logger.warn('YouTube search skipped - API key not configured');
      return {
        results: [],
        totalResults: 0,
      };
    }

    this.logger.log(`Searching YouTube for: "${query}"`);

    try {
      // Rate limiting (10,000 unidades/día, 100/minuto)
      const response = await this.rateLimitService.executeWithRateLimit(
        this.serviceName,
        async () => {
          return await this.callYouTubeApi(query, options);
        },
      );

      // Procesar y guardar evidencia
      if (response.results.length > 0) {
        await this.processAndSaveEvidence(searchId, query, response.results);
      }

      return response;
    } catch (error) {
      this.logger.error(`YouTube search error: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Llama a YouTube Data API v3
   */
  private async callYouTubeApi(
    query: string,
    options?: {
      maxResults?: number;
      order?: 'relevance' | 'date' | 'rating' | 'viewCount';
      publishedAfter?: Date;
      publishedBefore?: Date;
      regionCode?: string;
      pageToken?: string;
    },
  ): Promise<YouTubeSearchResponse> {
    const params: any = {
      part: 'snippet',
      q: query,
      type: 'video',
      maxResults: Math.min(options?.maxResults || 10, 50),
      order: options?.order || 'relevance',
      key: this.apiKey,
    };

    if (options?.publishedAfter) {
      params.publishedAfter = options.publishedAfter.toISOString();
    }

    if (options?.publishedBefore) {
      params.publishedBefore = options.publishedBefore.toISOString();
    }

    if (options?.regionCode) {
      params.regionCode = options.regionCode;
    }

    if (options?.pageToken) {
      params.pageToken = options.pageToken;
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/search`, {
          params,
          timeout: 30_000,
        }),
      );

      const data = response.data;

      // Parsear respuesta de YouTube
      const results: YouTubeSearchResult[] = (data.items || []).map(
        (item: any) => {
          const videoId = item.id.videoId;
          const snippet = item.snippet;

          return {
            videoId,
            title: snippet.title,
            description: snippet.description,
            channelTitle: snippet.channelTitle,
            channelId: snippet.channelId,
            publishedAt: snippet.publishedAt,
            thumbnailUrl:
              snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url,
            url: `https://www.youtube.com/watch?v=${videoId}`,
          };
        },
      );

      return {
        results,
        totalResults: data.pageInfo?.totalResults || 0,
        nextPageToken: data.nextPageToken,
      };
    } catch (error) {
      this.logger.error(`YouTube API call failed: ${error.message}`);

      if (error.response?.status === 403) {
        const errorData = error.response.data;
        if (errorData.error?.errors?.[0]?.reason === 'quotaExceeded') {
          throw new Error('YouTube API quota exceeded (10,000 units/day)');
        }
        throw new Error('YouTube API key invalid or expired');
      }

      if (error.response?.status === 429) {
        throw new Error('YouTube API rate limit exceeded');
      }

      throw error;
    }
  }

  /**
   * Procesa resultados y guarda como evidencia en MongoDB
   */
  private async processAndSaveEvidence(
    searchId: string,
    query: string,
    results: YouTubeSearchResult[],
  ): Promise<void> {
    this.logger.log(
      `Processing ${results.length} YouTube results as evidence...`,
    );

    for (const result of results) {
      try {
        // Extraer datos estructurados del título y descripción
        const extractedData = this.regexExtractor.extractAll(
          `${result.title} ${result.description} ${result.channelTitle}`,
        );

        // Crear evidencia
        const evidence = {
          source: 'youtube',
          url: result.url,
          title: result.title || 'YouTube Video',
          summary: result.description || result.title || 'No description available',
          category: 'video' as const,
          thumbnailUrl: result.thumbnailUrl,
          extractedData,
          fetchedAt: new Date(),
        };

        // Guardar evidencia (con deduplicación automática)
        await this.evidenceService.saveEvidence(searchId, evidence as any);
      } catch (error) {
        this.logger.error(
          `Error saving evidence for video ${result.videoId}: ${error.message}`,
        );
        // No fallar, continuar con otros resultados
      }
    }

    this.logger.log(`Saved ${results.length} YouTube results as evidence`);
  }

  /**
   * Verifica si YouTube está disponible (API key configurada)
   */
  isAvailable(): boolean {
    return !!this.apiKey;
  }

  /**
   * Obtiene uso actual de API
   */
  async getUsageStats() {
    return this.rateLimitService.getUsageStats(this.serviceName);
  }
}
