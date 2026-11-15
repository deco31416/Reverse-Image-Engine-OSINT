import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { EvidenceService } from './evidence.service';
import { RegexExtractorService } from './regex-extractor.service';
import { RateLimitService } from './rate-limit.service';

export interface SerperSearchResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
  date?: string;
  imageUrl?: string;
  sitelinks?: Array<{ title: string; link: string }>;
}

export interface SerperImageResult {
  title: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  thumbnailUrl: string;
  link: string;        // Page URL
  source: string;      // Domain
  position: number;
}

export interface SerperSearchResponse {
  results: SerperSearchResult[];
  images?: SerperImageResult[];
  totalResults: number;
  searchParameters: {
    query: string;
    type: string;
  };
  knowledgeGraph?: {
    title?: string;
    type?: string;
    description?: string;
    website?: string;
    imageUrl?: string;
    attributes?: Record<string, string>;
  };
  answerBox?: {
    title?: string;
    answer?: string;
    snippet?: string;
    link?: string;
  };
  responseTime: number;
}

/**
 * Serper.dev Search Service 🔍
 *
 * API que devuelve resultados REALES de Google.
 * Es la misma data que ves en google.com, en JSON.
 *
 * Ventajas:
 * ✅ 2,500 búsquedas/mes gratis (sin tarjeta)
 * ✅ Resultados Google reales (no proxied)
 * ✅ Images API incluida
 * ✅ Knowledge Graph, Answer Box, People Also Ask
 * ✅ Locations, News, Scholar, Patents
 * ✅ Extremadamente rápido (~200ms)
 *
 * Tipos de búsqueda:
 * - search     → resultados web
 * - images     → búsqueda por imagen
 * - news       → noticias
 * - scholar    → académico
 * - places     → negocios/maps
 *
 * API Docs: https://serper.dev/docs
 * Free tier: 2,500 credits/month
 */
@Injectable()
export class SerperSearchService {
  private readonly logger = new Logger(SerperSearchService.name);
  private readonly apiKey: string;
  private readonly serviceName = 'serper';
  private readonly BASE_URL = 'https://google.serper.dev';
  /** Límite diario configurable. Por defecto 400 (2500/mes ÷ 6 días activos).
   *  Ajusta con env var SERPER_DAILY_LIMIT si tienes un plan mayor. */
  private readonly dailyLimit: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly evidenceService: EvidenceService,
    private readonly regexExtractor: RegexExtractorService,
    private readonly rateLimitService: RateLimitService,
  ) {
    const rawApiKey = this.configService.get<string>('SERPER_API_KEY') || '';
    this.apiKey = rawApiKey.trim().replace(/^['\"]+|['\"]+$/g, '');
    this.dailyLimit = parseInt(this.configService.get<string>('SERPER_DAILY_LIMIT') || '400', 10);

    if (rawApiKey && rawApiKey !== this.apiKey) {
      this.logger.warn('⚠️ SERPER_API_KEY had wrapping quotes/whitespace; normalized at runtime');
    }

    if (this.apiKey) {
      this.logger.log(`✅ Serper.dev initialized (daily limit: ${this.dailyLimit} calls)`);
    } else {
      this.logger.warn('⚠️ SERPER_API_KEY not set — Serper search disabled');
    }
  }

  /**
   * Check if Serper API is available
   */
  isAvailable(): boolean {
    return !!this.apiKey;
  }

  /**
   * Google web search via Serper
   */
  async search(
    searchId: string,
    query: string,
    options: {
      maxResults?: number;
      country?: string;
      locale?: string;
      page?: number;
    } = {},
  ): Promise<SerperSearchResponse> {
    if (!this.apiKey) {
      return { results: [], totalResults: 0, searchParameters: { query, type: 'search' }, responseTime: 0 };
    }

    // Rate limit: 2500/month ≈ ~83/day
    const canUse = await this.rateLimitService.canUseAPI(this.serviceName, this.dailyLimit);
    if (!canUse) {
      this.logger.warn('⚠️ Serper daily rate limit reached (daily limit reached (SERPER_DAILY_LIMIT))');
      return { results: [], totalResults: 0, searchParameters: { query, type: 'search' }, responseTime: 0 };
    }

    try {
      const startTime = Date.now();

      const requestBody: any = {
        q: query,
        num: options.maxResults || 10,
      };

      if (options.country) requestBody.gl = options.country;
      if (options.locale) requestBody.hl = options.locale;
      if (options.page) requestBody.page = options.page;

      this.logger.log(`🔵 Serper (Google): "${query}"`);

      const response = await firstValueFrom(
        this.httpService.post(`${this.BASE_URL}/search`, requestBody, {
          headers: {
            'X-API-KEY': this.apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }),
      );

      await this.rateLimitService.registerCall(this.serviceName, this.dailyLimit);

      const data = response.data;
      const results: SerperSearchResult[] = (data.organic || []).map((r: any, i: number) => ({
        title: r.title || 'Sin título',
        link: r.link || '',
        snippet: r.snippet || '',
        position: r.position || i + 1,
        date: r.date,
        imageUrl: r.imageUrl,
        sitelinks: r.sitelinks,
      }));

      const responseTime = Date.now() - startTime;

      // Save as evidence
      await this.saveWebResults(searchId, query, results, data.knowledgeGraph, data.answerBox);

      this.logger.log(
        `✅ Serper: ${results.length} Google results in ${responseTime}ms` +
        (data.knowledgeGraph ? ' (+KG)' : '') +
        (data.answerBox ? ' (+Answer)' : ''),
      );

      return {
        results,
        totalResults: results.length,
        searchParameters: { query, type: 'search' },
        knowledgeGraph: data.knowledgeGraph,
        answerBox: data.answerBox,
        responseTime,
      };
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.logger.error('❌ Serper: Invalid API key');
      } else if (error.response?.status === 429) {
        this.logger.error('❌ Serper: Rate limit exceeded');
      } else {
        this.logger.error(`❌ Serper search failed: ${error.message}`);
      }
      return { results: [], totalResults: 0, searchParameters: { query, type: 'search' }, responseTime: 0 };
    }
  }

  /**
   * Google Lens reverse image search via Serper
   * Busca usando una imagen como query — resultados únicos por imagen
   * Endpoint: POST https://google.serper.dev/lens
   * Body: { url: "https://..." } or { imageBase64Content: "..." }
   */
  async searchByImageUrl(
    searchId: string,
    imageUrl?: string,
    imageBase64?: string,
  ): Promise<SerperImageResult[]> {
    if (!this.apiKey) return [];

    const canUse = await this.rateLimitService.canUseAPI(this.serviceName, this.dailyLimit);
    if (!canUse) {
      this.logger.warn('⚠️ Serper Lens: daily limit reached');
      return [];
    }

    try {
      const requestBody = this.buildLensRequestBody(imageUrl, imageBase64);
      if (!requestBody) {
        this.logger.warn('⚠️ Serper Lens: missing valid imageUrl/imageBase64 payload');
        return [];
      }

      if ('url' in requestBody) {
        this.logger.log(`🔍 Serper Lens (reverse image URL): ${requestBody.url.substring(0, 80)}...`);
      } else {
        this.logger.log(`🔍 Serper Lens (reverse image base64): payload ${requestBody.imageBase64Content.length} chars`);
      }

      const response = await firstValueFrom(
        this.httpService.post(`${this.BASE_URL}/lens`, requestBody, {
          headers: {
            'X-API-KEY': this.apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        }),
      );

      await this.rateLimitService.registerCall(this.serviceName, this.dailyLimit);

      const data = response.data;
      const results: SerperImageResult[] = [];

      // Google Lens returns: matches, pages, relatedSearches, knowledgeGraph
      // "matches" = visually similar images
      const matches: any[] = data.matches || data.visualMatches || data.images || [];
      for (const m of matches) {
        results.push({
          title: m.title || m.snippet || '',
          imageUrl: m.imageUrl || m.thumbnailUrl || '',
          imageWidth: m.imageWidth || 0,
          imageHeight: m.imageHeight || 0,
          thumbnailUrl: m.thumbnailUrl || m.imageUrl || '',
          link: m.link || m.url || '',
          source: m.source || (m.link ? new URL(m.link).hostname : ''),
          position: m.position || 0,
        });
      }

      // "pages" = web pages where the image appears
      const pages: any[] = data.pages || data.webPages || [];
      for (const p of pages) {
        results.push({
          title: p.title || '',
          imageUrl: p.imageUrl || '',
          imageWidth: 0,
          imageHeight: 0,
          thumbnailUrl: p.thumbnailUrl || '',
          link: p.link || p.url || '',
          source: p.source || (p.link ? new URL(p.link).hostname : ''),
          position: p.position || 0,
        });
      }

      // Save results as evidence
      if (results.length > 0 && searchId) {
        for (const r of results.slice(0, 20)) {
          try {
            await this.evidenceService.saveEvidence(searchId, {
              source: 'serper_lens',
              category: 'social',
              title: r.title,
              summary: `Google Lens: imagen encontrada en ${r.source}`,
              url: r.link,
              imageUrl: r.imageUrl || r.thumbnailUrl,
              matchConfidence: 0.85,
              extractedData: { urls: [r.link] },
            } as any);
          } catch (_) {}
        }
      }

      this.logger.log(`✅ Serper Lens: ${results.length} resultados (matches + pages)`);
      return results;
    } catch (error: any) {
      this.logger.error(`❌ Serper Lens failed: ${error.message}`);
      return [];
    }
  }

  private buildLensRequestBody(
    imageUrl?: string,
    imageBase64?: string,
  ): { url: string } | { imageBase64Content: string } | null {
    if (imageUrl && !imageUrl.startsWith('data:image/')) {
      return { url: imageUrl };
    }

    const base64Source = imageBase64 || imageUrl;
    if (!base64Source) return null;

    const normalizedBase64 = this.normalizeBase64ForSerper(base64Source);
    if (!normalizedBase64) return null;

    return { imageBase64Content: normalizedBase64 };
  }

  private normalizeBase64ForSerper(value: string): string {
    const trimmed = value.trim();
    const commaIndex = trimmed.indexOf(',');
    return (commaIndex >= 0 ? trimmed.substring(commaIndex + 1) : trimmed).trim();
  }

  /**
   * Google Images search via Serper
   * Busca imágenes por texto — útil para encontrar fotos de persona
   */
  async searchImages(
    searchId: string,
    query: string,
    options: { maxResults?: number } = {},
  ): Promise<SerperImageResult[]> {
    if (!this.apiKey) return [];

    const canUse = await this.rateLimitService.canUseAPI(this.serviceName, this.dailyLimit);
    if (!canUse) {
      this.logger.warn('⚠️ Serper daily limit reached');
      return [];
    }

    try {
      this.logger.log(`🖼️ Serper Images: "${query}"`);

      const response = await firstValueFrom(
        this.httpService.post(`${this.BASE_URL}/images`, {
          q: query,
          num: options.maxResults || 20,
        }, {
          headers: {
            'X-API-KEY': this.apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }),
      );

      await this.rateLimitService.registerCall(this.serviceName, this.dailyLimit);

      const images: SerperImageResult[] = (response.data.images || []).map((img: any, i: number) => ({
        title: img.title || '',
        imageUrl: img.imageUrl || '',
        imageWidth: img.imageWidth || 0,
        imageHeight: img.imageHeight || 0,
        thumbnailUrl: img.thumbnailUrl || '',
        link: img.link || '',
        source: img.source || '',
        position: img.position || i + 1,
      }));

      // Save image results as evidence
      await this.saveImageResults(searchId, query, images);

      this.logger.log(`✅ Serper Images: ${images.length} results`);
      return images;
    } catch (error: any) {
      this.logger.error(`❌ Serper Images failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Google News search via Serper
   * Noticias recientes sobre la persona
   */
  async searchNews(
    searchId: string,
    query: string,
    options: { maxResults?: number } = {},
  ): Promise<SerperSearchResult[]> {
    if (!this.apiKey) return [];

    const canUse = await this.rateLimitService.canUseAPI(this.serviceName, this.dailyLimit);
    if (!canUse) return [];

    try {
      this.logger.log(`📰 Serper News: "${query}"`);

      const response = await firstValueFrom(
        this.httpService.post(`${this.BASE_URL}/news`, {
          q: query,
          num: options.maxResults || 10,
        }, {
          headers: {
            'X-API-KEY': this.apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }),
      );

      await this.rateLimitService.registerCall(this.serviceName, this.dailyLimit);

      const results: SerperSearchResult[] = (response.data.news || []).map((r: any, i: number) => ({
        title: r.title || '',
        link: r.link || '',
        snippet: r.snippet || '',
        position: i + 1,
        date: r.date,
        imageUrl: r.imageUrl,
      }));

      // Save as evidence
      for (const result of results) {
        try {
          const extracted = this.regexExtractor.extractAll(`${result.title} ${result.snippet} ${result.link}`);
          await this.evidenceService.saveEvidence(searchId, {
            source: 'serper_news',
            category: 'legal' as const,  // News often relevant for legal/reputation
            title: result.title,
            summary: result.snippet,
            url: result.link,
            matchConfidence: 0.75,
            extractedData: {
              emails: extracted.emails,
              phones: extracted.phones,
              rfcs: extracted.rfcs,
              curps: extracted.curps,
              urls: [result.link],
            },
          } as any);
        } catch (err: any) {
          this.logger.error(`Error saving news evidence: ${err.message}`);
        }
      }

      this.logger.log(`✅ Serper News: ${results.length} articles`);
      return results;
    } catch (error: any) {
      this.logger.error(`❌ Serper News failed: ${error.message}`);
      return [];
    }
  }

  /**
   * OSINT person search — Combina web + images + news
   * 3 API calls = comprehensive Google results
   */
  async osintPersonSearch(
    searchId: string,
    fullName: string,
    options: { username?: string } = {},
  ): Promise<{
    webResults: SerperSearchResult[];
    images: SerperImageResult[];
    news: SerperSearchResult[];
    knowledgeGraph?: any;
  }> {
    const query = options.username
      ? `"${fullName}" OR "${options.username}"`
      : `"${fullName}"`;

    // Execute in parallel — 3 API calls
    const [web, images, news] = await Promise.allSettled([
      this.search(searchId, query, { maxResults: 10 }),
      this.searchImages(searchId, fullName, { maxResults: 15 }),
      this.searchNews(searchId, fullName, { maxResults: 10 }),
    ]);

    return {
      webResults: web.status === 'fulfilled' ? web.value.results : [],
      images: images.status === 'fulfilled' ? images.value : [],
      news: news.status === 'fulfilled' ? news.value : [],
      knowledgeGraph: web.status === 'fulfilled' ? web.value.knowledgeGraph : undefined,
    };
  }

  /**
   * Save web search results as evidence
   */
  private async saveWebResults(
    searchId: string,
    query: string,
    results: SerperSearchResult[],
    knowledgeGraph?: any,
    answerBox?: any,
  ): Promise<void> {
    for (const result of results) {
      try {
        const extracted = this.regexExtractor.extractAll(
          `${result.title} ${result.snippet} ${result.link}`,
        );

        await this.evidenceService.saveEvidence(searchId, {
          source: 'serper_google',
          category: this.categorize(result.snippet, result.link),
          title: result.title,
          summary: result.snippet,
          url: result.link,
          imageUrl: result.imageUrl,
          thumbnailUrl: result.imageUrl || `https://www.google.com/s2/favicons?sz=128&domain_url=${encodeURIComponent(result.link)}`,
          matchConfidence: Math.max(0.5, 1 - (result.position / 20)),
          extractedData: {
            emails: extracted.emails,
            phones: extracted.phones,
            rfcs: extracted.rfcs,
            curps: extracted.curps,
            urls: [result.link],
          },
        } as any);
      } catch (error: any) {
        this.logger.error(`Error saving Serper evidence: ${error.message}`);
      }
    }

    // Save Knowledge Graph as special evidence (very valuable for OSINT)
    if (knowledgeGraph?.title) {
      try {
        const kgDescription = [
          knowledgeGraph.description,
          knowledgeGraph.type,
          knowledgeGraph.website,
          ...Object.entries(knowledgeGraph.attributes || {}).map(([k, v]) => `${k}: ${v}`),
        ].filter(Boolean).join(' | ');

        await this.evidenceService.saveEvidence(searchId, {
          source: 'serper_knowledge_graph',
          category: 'identity' as const,
          title: `Google Knowledge Graph: ${knowledgeGraph.title}`,
          summary: kgDescription.substring(0, 500),
          url: knowledgeGraph.website || 'https://google.com',
          imageUrl: knowledgeGraph.imageUrl,
          matchConfidence: 0.95,
          extractedData: {
            emails: [],
            phones: [],
            rfcs: [],
            curps: [],
            urls: knowledgeGraph.website ? [knowledgeGraph.website] : [],
          },
        } as any);
      } catch (err: any) {
        this.logger.error(`Error saving KG evidence: ${err.message}`);
      }
    }

    // Save Answer Box
    if (answerBox?.answer || answerBox?.snippet) {
      try {
        await this.evidenceService.saveEvidence(searchId, {
          source: 'serper_answer_box',
          category: 'identity' as const,
          title: answerBox.title || `Google Answer: ${query}`,
          summary: (answerBox.answer || answerBox.snippet || '').substring(0, 500),
          url: answerBox.link || 'https://google.com',
          matchConfidence: 0.9,
          extractedData: {
            emails: [],
            phones: [],
            rfcs: [],
            curps: [],
            urls: answerBox.link ? [answerBox.link] : [],
          },
        } as any);
      } catch (err: any) {
        this.logger.error(`Error saving Answer Box: ${err.message}`);
      }
    }
  }

  /**
   * Save image results as evidence
   */
  private async saveImageResults(
    searchId: string,
    query: string,
    images: SerperImageResult[],
  ): Promise<void> {
    for (const img of images.slice(0, 10)) { // Max 10 images
      try {
        await this.evidenceService.saveEvidence(searchId, {
          source: 'serper_images',
          category: 'identity' as const,
          title: img.title || `Image from ${img.source}`,
          summary: `Image found on ${img.source}: ${img.title}`,
          url: img.link,
          imageUrl: img.imageUrl,
          thumbnailUrl: img.thumbnailUrl,
          matchConfidence: Math.max(0.4, 1 - (img.position / 30)),
          extractedData: {
            emails: [],
            phones: [],
            rfcs: [],
            curps: [],
            urls: [img.link, img.imageUrl].filter(Boolean),
          },
        } as any);
      } catch (err: any) {
        this.logger.error(`Error saving image evidence: ${err.message}`);
      }
    }
  }

  /**
   * Categorize by content
   */
  private categorize(text: string, url: string): 'identity' | 'legal' | 'financial' | 'social' | 'other' {
    const combined = `${text} ${url}`.toLowerCase();

    if (combined.match(/sentencia|demanda|juicio|tribunal|delito|penal|condena|arrest/)) return 'legal';
    if (combined.match(/sat\.gob|rfc|hacienda|fiscal|impuesto|factura|bank|financ/)) return 'financial';
    if (combined.match(/facebook|twitter|instagram|tiktok|snapchat|reddit|vk\.com/)) return 'social';
    if (combined.match(/linkedin|github|stackoverflow|portfolio|resume|cv|kaggle/)) return 'social';
    if (combined.match(/perfil|profile|nombre|name|foto|photo|imagen|image/)) return 'identity';

    return 'other';
  }

  /**
   * Get usage stats
   */
  async getUsageStats(): Promise<{
    available: boolean;
    dailyLimit: number;
    monthlyEstimate: number;
    features: string[];
  }> {
    return {
      available: this.isAvailable(),
      dailyLimit: 83,
      monthlyEstimate: 2500,
      features: ['web', 'images', 'news', 'scholar', 'places', 'knowledge_graph'],
    };
  }
}
