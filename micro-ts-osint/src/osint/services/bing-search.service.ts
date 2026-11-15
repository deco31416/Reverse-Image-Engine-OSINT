import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { RateLimitService } from './rate-limit.service';
import { EvidenceService } from './evidence.service';
import { RegexExtractorService } from './regex-extractor.service';

export interface BingSearchResult {
  title: string;
  url: string;
  snippet: string;
  datePublished?: string;
  source?: string;
}

export interface BingSearchResponse {
  results: BingSearchResult[];
  totalResults: number;
  queryExpansions: string[];
  relatedSearches: string[];
}

/**
 * Servicio de búsqueda con Bing Search API
 *
 * Características:
 * - Búsqueda web con Bing Custom Search API o Web Search API
 * - Rate limiting automático (protege costos)
 * - Auto-guardado de evidencia en MongoDB
 * - Extracción automática de datos estructurados
 *
 * API Docs: https://learn.microsoft.com/en-us/bing/search-apis/
 *
 * Variables de entorno requeridas:
 * - BING_SEARCH_API_KEY
 * - BING_SEARCH_ENDPOINT (opcional, default: https://api.bing.microsoft.com/v7.0/search)
 */
@Injectable()
export class BingSearchService {
  private readonly logger = new Logger(BingSearchService.name);
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly serviceName = 'bing';

  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
    private rateLimitService: RateLimitService,
    private evidenceService: EvidenceService,
    private regexExtractor: RegexExtractorService,
  ) {
    this.apiKey = this.configService.get<string>('BING_SEARCH_API_KEY') || '';
    this.endpoint =
      this.configService.get<string>('BING_SEARCH_ENDPOINT') ||
      'https://api.bing.microsoft.com/v7.0/search';

    if (!this.apiKey) {
      this.logger.warn(
        'BING_SEARCH_API_KEY not configured - Bing search will be disabled',
      );
    }
  }

  /**
   * Busca en Bing y guarda evidencia automáticamente
   *
   * @param searchId - ID de búsqueda OSINT en MongoDB
   * @param query - Query de búsqueda
   * @param options - Opciones adicionales
   * @returns Resultados de Bing con metadatos
   */
  async search(
    searchId: string,
    query: string,
    options?: {
      count?: number; // Número de resultados (default: 10)
      offset?: number; // Offset para paginación
      market?: string; // Mercado/idioma (es-MX, en-US, etc.)
      safeSearch?: 'Off' | 'Moderate' | 'Strict';
      freshness?: 'Day' | 'Week' | 'Month';
    },
  ): Promise<BingSearchResponse> {
    if (!this.apiKey) {
      this.logger.warn('Bing search skipped - API key not configured');
      return {
        results: [],
        totalResults: 0,
        queryExpansions: [],
        relatedSearches: [],
      };
    }

    this.logger.log(`Searching Bing for: "${query}"`);

    try {
      // Rate limiting + single API call (fixed: was calling API twice)
      const response = await this.rateLimitService.executeWithRateLimit(
        this.serviceName,
        async () => {
          const apiResponse = await this.callBingApi(query, options);

          // Procesar y guardar evidencia
          if (apiResponse.results.length > 0) {
            await this.processAndSaveEvidence(
              searchId,
              query,
              apiResponse.results,
            );
          }

          return apiResponse;
        },
      );

      return response;
    } catch (error) {
      this.logger.error(`Bing search error: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Llama a Bing Search API
   */
  private async callBingApi(
    query: string,
    options?: {
      count?: number;
      offset?: number;
      market?: string;
      safeSearch?: 'Off' | 'Moderate' | 'Strict';
      freshness?: 'Day' | 'Week' | 'Month';
    },
  ): Promise<BingSearchResponse> {
    const params: any = {
      q: query,
      count: options?.count || 10,
      offset: options?.offset || 0,
      mkt: options?.market || 'es-MX',
      safeSearch: options?.safeSearch || 'Moderate',
    };

    if (options?.freshness) {
      params.freshness = options.freshness;
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get(this.endpoint, {
          params,
          headers: {
            'Ocp-Apim-Subscription-Key': this.apiKey,
          },
          timeout: 30_000,
        }),
      );

      const data = response.data;

      // Parsear respuesta de Bing
      const webPages = data.webPages?.value || [];
      const results: BingSearchResult[] = webPages.map((item: any) => ({
        title: item.name || '',
        url: item.url || '',
        snippet: item.snippet || '',
        datePublished: item.datePublished,
        source: 'bing',
      }));

      return {
        results,
        totalResults: data.webPages?.totalEstimatedMatches || 0,
        queryExpansions: data.queryContext?.alterationOverrideQuery
          ? [data.queryContext.alterationOverrideQuery]
          : [],
        relatedSearches: (data.relatedSearches?.value || []).map(
          (r: any) => r.text,
        ),
      };
    } catch (error) {
      this.logger.error(`Bing API call failed: ${error.message}`);

      if (error.response?.status === 401) {
        throw new Error('Bing API key invalid or expired');
      }

      if (error.response?.status === 429) {
        throw new Error('Bing API rate limit exceeded');
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
    results: BingSearchResult[],
  ): Promise<void> {
    this.logger.log(`Processing ${results.length} Bing results as evidence...`);

    for (const result of results) {
      try {
        // Extraer datos estructurados del snippet
        const extractedData = this.regexExtractor.extractAll(
          `${result.title} ${result.snippet}`,
        );

        // Crear evidencia
        const evidence = {
          source: 'bing',
          url: result.url,
          title: result.title || 'Bing Result',
          summary: result.snippet || result.title || 'No description available',
          category: 'search_result' as const,
          extractedData,
          fetchedAt: new Date(),
        };

        // Guardar evidencia (con deduplicación automática)
        await this.evidenceService.saveEvidence(searchId, evidence as any);
      } catch (error) {
        this.logger.error(
          `Error saving evidence for URL ${result.url}: ${error.message}`,
        );
        // No fallar, continuar con otros resultados
      }
    }

    this.logger.log(`Saved ${results.length} Bing results as evidence`);
  }

  /**
   * Verifica si Bing está disponible (API key configurada)
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
