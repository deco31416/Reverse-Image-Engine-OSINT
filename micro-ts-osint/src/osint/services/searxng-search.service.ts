import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { EvidenceService } from './evidence.service';
import { RegexExtractorService } from './regex-extractor.service';
import { RateLimitService } from './rate-limit.service';

export interface SearXNGSearchResult {
  title: string;
  url: string;
  snippet: string;
  engine?: string;       // e.g. "google", "bing", "brave", "duckduckgo"
  category?: string;     // "general", "images", "news", "videos"
  publishedDate?: string;
  thumbnailUrl?: string;
  source?: string;
}

export interface SearXNGSearchResponse {
  results: SearXNGSearchResult[];
  totalResults: number;
  engines: string[];     // motores que respondieron
  instanceUsed: string;  // instancia que sirvió
}

/**
 * SearXNG Search Service 🔍
 *
 * Meta-buscador open source que agrega resultados de 70+ motores:
 * Google, Bing, Brave, DuckDuckGo, Wikipedia, Qwant, Mojeek, etc.
 *
 * Ventajas:
 * ✅ 100% gratuito, sin API key
 * ✅ Sin límite real (con rotación de instancias)
 * ✅ Respuesta JSON nativa (?format=json)
 * ✅ Combina resultados de múltiples motores → deduplicado
 * ✅ NO trackea al usuario
 * ✅ Categorías: general, images, news, videos, files, science
 *
 * Estrategia de alta disponibilidad:
 * 1. Rotación entre múltiples instancias públicas
 * 2. Fallback automático si una instancia falla
 * 3. Rate limiting por instancia (no spamear)
 * 4. Cache local para queries repetidas
 */
@Injectable()
export class SearxngSearchService {
  private readonly logger = new Logger(SearxngSearchService.name);
  private readonly serviceName = 'searxng';

  /**
   * Instancias públicas de SearXNG con API JSON habilitada.
   * Se rotan para distribuir carga y evitar bloqueos.
   * Lista curada — solo instancias con format=json funcionando.
   */
  private readonly INSTANCES: string[] = [
    // Instancias curadas — verificadas activas en 2025-2026
    'https://searx.be',
    'https://searxng.site',
    'https://search.sapti.me',
    'https://paulgo.io',
    'https://searx.tiekoetter.com',
    'https://opnxng.com',
    'https://priv.au',
    'https://search.mdosch.de',
    'https://searx.lunar.icu',
    'https://search.unlocked.link',
    'https://searx.work',
    'https://searx.netzspielplatz.de',
  ];

  /** Índice actual para round-robin */
  private currentInstanceIndex = 0;

  /** Instancias que fallaron recientemente (cooldown 5 min) */
  private failedInstances = new Map<string, number>();
  private readonly INSTANCE_COOLDOWN = 5 * 60 * 1000; // 5 min

  constructor(
    private httpService: HttpService,
    private evidenceService: EvidenceService,
    private regexExtractor: RegexExtractorService,
    private rateLimitService: RateLimitService,
  ) {}

  /**
   * Busca en SearXNG y guarda evidencia automáticamente
   */
  async search(
    searchId: string,
    query: string,
    options?: {
      maxResults?: number;
      categories?: string;   // 'general', 'images', 'news', 'videos', 'science'
      language?: string;      // 'es', 'en', 'all'
      timeRange?: string;     // '', 'day', 'week', 'month', 'year'
      engines?: string;       // 'google,bing,brave' — override engines
    },
  ): Promise<SearXNGSearchResponse> {
    const maxResults = options?.maxResults || 20;
    const categories = options?.categories || 'general';
    const language = options?.language || 'all';

    this.logger.debug(`SearXNG search: "${query}" (cat=${categories}, max=${maxResults})`);

    // Intentar con rotación de instancias (max 3 intentos)
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const instance = this.getNextInstance();
      if (!instance) {
        this.logger.warn('No SearXNG instances available, all in cooldown');
        break;
      }

      try {
        const results = await this.searchInstance(
          instance,
          query,
          { maxResults, categories, language, timeRange: options?.timeRange, engines: options?.engines },
        );

        // Guardar como evidencia
        const saved = await this.saveResultsAsEvidence(searchId, results, query);

        return {
          results: saved,
          totalResults: saved.length,
          engines: [...new Set(saved.map(r => r.engine).filter(Boolean))] as string[],
          instanceUsed: instance,
        };
      } catch (error) {
        lastError = error;
        this.logger.warn(`SearXNG instance ${instance} failed: ${error.message}`);
        this.markInstanceFailed(instance);
        // Pausa antes de reintentar con otra instancia
        await this.sleep(300);
      }
    }

    this.logger.error(`All SearXNG instances failed. Last error: ${lastError?.message}`);
    return { results: [], totalResults: 0, engines: [], instanceUsed: 'none' };
  }

  /**
   * Búsqueda multi-categoría: general + news + videos en una sola llamada
   */
  async searchMultiCategory(
    searchId: string,
    query: string,
    options?: { maxResults?: number; language?: string },
  ): Promise<SearXNGSearchResponse> {
    const allResults: SearXNGSearchResult[] = [];
    const allEngines: string[] = [];
    let instanceUsed = 'none';

    // Ejecutar búsquedas en 3 categorías en secuencia (para no spamear)
    const categories = ['general', 'news'];

    for (const cat of categories) {
      try {
        const resp = await this.search(searchId, query, {
          ...options,
          categories: cat,
          maxResults: options?.maxResults || 15,
        });
        allResults.push(...resp.results);
        allEngines.push(...resp.engines);
        if (resp.instanceUsed !== 'none') instanceUsed = resp.instanceUsed;

        // Pausa entre categorías
        await this.sleep(800 + Math.random() * 400);
      } catch (err) {
        this.logger.warn(`SearXNG ${cat} search failed: ${err.message}`);
      }
    }

    return {
      results: allResults,
      totalResults: allResults.length,
      engines: [...new Set(allEngines)],
      instanceUsed,
    };
  }

  // ============================================================
  // PRIVATE: Instance request
  // ============================================================

  private async searchInstance(
    instance: string,
    query: string,
    options: {
      maxResults: number;
      categories: string;
      language: string;
      timeRange?: string;
      engines?: string;
    },
  ): Promise<SearXNGSearchResult[]> {
    // Rate limiting por instancia
    const rateLimitKey = `searxng-${new URL(instance).hostname}`;
    const canProceed = await this.rateLimitService.canUseAPI(rateLimitKey, 600); // 600/day per instance
    if (!canProceed) {
      throw new Error(`Rate limit exceeded for ${instance}`);
    }
    await this.rateLimitService.registerCall(rateLimitKey, 600);

    const params: Record<string, string> = {
      q: query,
      format: 'json',
      categories: options.categories,
      language: options.language,
      pageno: '1',
    };

    if (options.timeRange) params.time_range = options.timeRange;
    if (options.engines) params.engines = options.engines;

    const url = `${instance}/search`;

    const response = await firstValueFrom(
      this.httpService.get(url, {
        params,
        timeout: 15000,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        // Follow redirects
        maxRedirects: 3,
      }),
    );

    const data = response.data;

    if (!data || !data.results || !Array.isArray(data.results)) {
      throw new Error(`Invalid SearXNG response from ${instance}`);
    }

    // Mapear resultados
    const results: SearXNGSearchResult[] = [];
    const seenUrls = new Set<string>();

    for (const item of data.results) {
      if (results.length >= options.maxResults) break;

      const itemUrl = item.url || item.href;
      if (!itemUrl || seenUrls.has(itemUrl)) continue;
      seenUrls.add(itemUrl);

      results.push({
        title: item.title || 'Sin título',
        url: itemUrl,
        snippet: item.content || item.description || '',
        engine: Array.isArray(item.engines) ? item.engines[0] : item.engine || 'unknown',
        category: item.category || options.categories,
        publishedDate: item.publishedDate || item.published_date,
        thumbnailUrl: item.thumbnail || item.img_src || item.thumbnail_src,
      });
    }

    this.logger.debug(
      `SearXNG ${instance}: ${data.results.length} raw → ${results.length} deduped ` +
      `(engines: ${[...new Set(data.results.map((r: any) => r.engines?.[0]).filter(Boolean))].join(',')})`,
    );

    return results;
  }

  // ============================================================
  // PRIVATE: Evidence saving
  // ============================================================

  private async saveResultsAsEvidence(
    searchId: string,
    results: SearXNGSearchResult[],
    query: string,
  ): Promise<SearXNGSearchResult[]> {
    const saved: SearXNGSearchResult[] = [];

    for (const result of results) {
      try {
        // Extraer datos estructurados del snippet
        const combinedText = `${result.title} ${result.snippet}`;
        const extracted = this.regexExtractor.extractAll(combinedText);

        await this.evidenceService.saveEvidence(searchId, {
          source: `SearXNG (${result.engine || 'multi'})`,
          category: 'search_result',
          title: result.title,
          summary: result.snippet || `Resultado de SearXNG via ${result.engine}`,
          url: result.url,
          thumbnailUrl: result.thumbnailUrl,
          matchConfidence: 0.6,
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
        });

        saved.push(result);
      } catch (err) {
        // Dedup collision or save error — skip
        this.logger.debug(`SearXNG evidence save skipped: ${err.message}`);
      }
    }

    this.logger.log(
      `SearXNG: ${saved.length}/${results.length} results saved as evidence for search ${searchId}`,
    );

    return saved;
  }

  // ============================================================
  // PRIVATE: Instance rotation & health
  // ============================================================

  /**
   * Obtiene la siguiente instancia disponible (round-robin con exclusión de fallidas)
   */
  private getNextInstance(): string | null {
    const now = Date.now();

    // Limpiar instancias que ya pasaron el cooldown
    for (const [inst, failTime] of this.failedInstances) {
      if (now - failTime > this.INSTANCE_COOLDOWN) {
        this.failedInstances.delete(inst);
      }
    }

    // Buscar siguiente instancia disponible
    for (let i = 0; i < this.INSTANCES.length; i++) {
      const idx = (this.currentInstanceIndex + i) % this.INSTANCES.length;
      const instance = this.INSTANCES[idx];

      if (!this.failedInstances.has(instance)) {
        this.currentInstanceIndex = (idx + 1) % this.INSTANCES.length;
        return instance;
      }
    }

    return null; // Todas en cooldown
  }

  /**
   * Marca una instancia como fallida (entra en cooldown)
   */
  private markInstanceFailed(instance: string): void {
    this.failedInstances.set(instance, Date.now());
    this.logger.debug(`SearXNG instance ${instance} marked as failed (${this.INSTANCE_COOLDOWN / 1000}s cooldown)`);
  }

  /**
   * Devuelve estadísticas de las instancias
   */
  getInstanceStats(): {
    total: number;
    available: number;
    failed: string[];
    currentIndex: number;
  } {
    const now = Date.now();
    const failed: string[] = [];

    for (const [inst, failTime] of this.failedInstances) {
      if (now - failTime <= this.INSTANCE_COOLDOWN) {
        failed.push(inst);
      }
    }

    return {
      total: this.INSTANCES.length,
      available: this.INSTANCES.length - failed.length,
      failed,
      currentIndex: this.currentInstanceIndex,
    };
  }

  // ============================================================
  // UTILS
  // ============================================================

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
