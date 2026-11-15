import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as cheerio from 'cheerio';
import { EvidenceService } from './evidence.service';
import { RegexExtractorService } from './regex-extractor.service';

export interface DuckDuckGoSearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
}

export interface DuckDuckGoSearchResponse {
  results: DuckDuckGoSearchResult[];
  totalResults: number;
}

/**
 * Servicio de búsqueda con DuckDuckGo (scraping)
 *
 * Características:
 * - Búsqueda privada sin tracking
 * - No requiere API key (scraping HTML)
 * - Auto-guardado de evidencia en MongoDB
 * - Extracción automática de datos estructurados
 *
 * NOTA: DuckDuckGo no tiene API oficial, usamos scraping del HTML público
 * Esto es legal pero puede ser bloqueado si se abusa (usar rate limiting)
 *
 * Variables de entorno opcionales:
 * - DUCKDUCKGO_ENABLED (default: true)
 */
@Injectable()
export class DuckDuckGoSearchService {
  private readonly logger = new Logger(DuckDuckGoSearchService.name);
  private readonly baseUrl = 'https://html.duckduckgo.com/html/';
  private readonly serviceName = 'duckduckgo';

  constructor(
    private httpService: HttpService,
    private evidenceService: EvidenceService,
    private regexExtractor: RegexExtractorService,
  ) {}

  /**
   * Busca en DuckDuckGo y guarda evidencia automáticamente
   *
   * @param searchId - ID de búsqueda OSINT en MongoDB
   * @param query - Query de búsqueda
   * @param options - Opciones adicionales
   * @returns Resultados de DuckDuckGo con metadatos
   */
  async search(
    searchId: string,
    query: string,
    options?: {
      maxResults?: number; // Máximo número de resultados (default: 10)
      region?: string; // Región (mx-es, us-en, etc.)
    },
  ): Promise<DuckDuckGoSearchResponse> {
    this.logger.log(`Searching DuckDuckGo for: "${query}"`);

    try {
      const response = await this.scrapeDuckDuckGo(query, options);

      // Procesar y guardar evidencia
      if (response.results.length > 0) {
        await this.processAndSaveEvidence(searchId, query, response.results);
      }

      return response;
    } catch (error) {
      this.logger.error(
        `DuckDuckGo search error: ${error.message}`,
        error.stack,
      );

      // No fallar, retornar respuesta vacía
      return {
        results: [],
        totalResults: 0,
      };
    }
  }

  /**
   * Scraping de DuckDuckGo HTML
   */
  /**
   * Scraping de una página de DuckDuckGo HTML
   * Retorna resultados y el form data para la siguiente página
   */
  private parseDuckDuckGoPage(html: string, maxResults: number): {
    results: DuckDuckGoSearchResult[];
    nextFormData: Record<string, string> | null;
  } {
    const $ = cheerio.load(html);
    const results: DuckDuckGoSearchResult[] = [];

    // Parsear resultados (clase `.result__body`)
    $('.result__body').each((index, element) => {
      if (results.length >= maxResults) return;

      const $element = $(element);
      const $title = $element.find('.result__a');
      const $snippet = $element.find('.result__snippet');

      const title = $title.text().trim();
      const url = $title.attr('href') || '';
      const snippet = $snippet.text().trim();

      if (title && url) {
        results.push({
          title,
          url: this.cleanUrl(url),
          snippet,
          source: 'duckduckgo',
        });
      }
    });

    // Buscar botón "Next" para paginación
    let nextFormData: Record<string, string> | null = null;
    const $nextForm = $('form.nav-link');
    if ($nextForm.length > 0) {
      const lastForm = $nextForm.last();
      const formFields: Record<string, string> = {};
      lastForm.find('input[type="hidden"]').each((_, el) => {
        const name = $(el).attr('name');
        const value = $(el).attr('value');
        if (name && value) {
          formFields[name] = value;
        }
      });
      if (Object.keys(formFields).length > 0) {
        nextFormData = formFields;
      }
    }

    return { results, nextFormData };
  }

  private async scrapeDuckDuckGo(
    query: string,
    options?: {
      maxResults?: number;
      region?: string;
    },
  ): Promise<DuckDuckGoSearchResponse> {
    const maxResults = options?.maxResults || 10;
    const region = options?.region || 'wt-wt'; // Global (sin restricción regional)
    const maxPages = Math.min(Math.ceil(maxResults / 25), 5); // Máximo 5 páginas (125 resultados)

    const allResults: DuckDuckGoSearchResult[] = [];
    const seenUrls = new Set<string>();

    try {
      // Primera página
      const formData = new URLSearchParams();
      formData.append('q', query);
      formData.append('kl', region);

      let currentFormBody = formData.toString();

      for (let page = 0; page < maxPages && allResults.length < maxResults; page++) {
        this.logger.debug(`DuckDuckGo page ${page + 1}/${maxPages} for "${query}"`);

        const response = await firstValueFrom(
          this.httpService.post(this.baseUrl, currentFormBody, {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
            timeout: 30_000,
          }),
        );

        const { results: pageResults, nextFormData } = this.parseDuckDuckGoPage(
          response.data,
          maxResults - allResults.length,
        );

        // Deduplicar por URL
        for (const result of pageResults) {
          if (!seenUrls.has(result.url)) {
            seenUrls.add(result.url);
            allResults.push(result);
          }
        }

        // Si no hay más páginas o no hubo resultados nuevos, parar
        if (!nextFormData || pageResults.length === 0) {
          break;
        }

        // Preparar siguiente página
        const nextParams = new URLSearchParams();
        nextParams.append('q', query);
        nextParams.append('kl', region);
        for (const [key, value] of Object.entries(nextFormData)) {
          nextParams.append(key, value);
        }
        currentFormBody = nextParams.toString();

        // Rate limit entre páginas (evitar bloqueo)
        await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 500));
      }

      this.logger.log(`Found ${allResults.length} DuckDuckGo results for "${query}" (${Math.min(maxPages, Math.ceil(allResults.length / 25))} pages)`);

      return {
        results: allResults.slice(0, maxResults),
        totalResults: allResults.length,
      };
    } catch (error) {
      this.logger.error(`DuckDuckGo scraping failed for "${query}": ${error.message}`);

      // Si ya tenemos algunos resultados, retornarlos aunque la paginación falle
      if (allResults.length > 0) {
        this.logger.warn(`Returning ${allResults.length} partial results`);
        return { results: allResults, totalResults: allResults.length };
      }

      if (error.code === 'ECONNREFUSED') {
        throw new Error('DuckDuckGo is unreachable');
      }

      throw error;
    }
  }

  /**
   * Limpia URL (DuckDuckGo usa redirects)
   */
  private cleanUrl(url: string): string {
    try {
      // DuckDuckGo usa URLs como: //duckduckgo.com/l/?uddg=...&rut=...
      if (url.startsWith('//duckduckgo.com/l/')) {
        const params = new URLSearchParams(url.split('?')[1]);
        const realUrl = params.get('uddg');
        if (realUrl) {
          return decodeURIComponent(realUrl);
        }
      }

      // Si empieza con //, agregar https:
      if (url.startsWith('//')) {
        return `https:${url}`;
      }

      return url;
    } catch {
      return url;
    }
  }

  /**
   * Procesa resultados y guarda como evidencia en MongoDB
   */
  private async processAndSaveEvidence(
    searchId: string,
    query: string,
    results: DuckDuckGoSearchResult[],
  ): Promise<void> {
    this.logger.log(
      `Processing ${results.length} DuckDuckGo results as evidence...`,
    );

    for (const result of results) {
      try {
        // Extraer datos estructurados del snippet
        const extractedData = this.regexExtractor.extractAll(
          `${result.title} ${result.snippet}`,
        );

        // Crear evidencia
        const evidence = {
          source: 'duckduckgo',
          url: result.url,
          title: result.title || 'DuckDuckGo Result',
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

    this.logger.log(`Saved ${results.length} DuckDuckGo results as evidence`);
  }

  /**
   * Verifica si DuckDuckGo está disponible
   */
  isAvailable(): boolean {
    return true; // Siempre disponible (no requiere API key)
  }
}
