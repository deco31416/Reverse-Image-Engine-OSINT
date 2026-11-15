import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { EvidenceService } from './evidence.service';
import { RegexExtractorService } from './regex-extractor.service';
import { RateLimitService } from './rate-limit.service';

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;     // Tavily devuelve contenido extraído completo
  score: number;       // Relevance score 0-1
  rawContent?: string; // Full page content (advanced mode)
  publishedDate?: string;
}

export interface TavilySearchResponse {
  results: TavilySearchResult[];
  totalResults: number;
  answer?: string;        // AI-generated answer (si se solicita)
  followUpQuestions?: string[];
  responseTime: number;   // ms
}

/**
 * Tavily AI Search Service 🧠
 *
 * API de búsqueda diseñada para agentes de IA.
 * Devuelve contenido limpio y relevante, no solo links.
 *
 * Ventajas:
 * ✅ 1,000 búsquedas/mes gratis
 * ✅ Devuelve contenido extraído (no solo URLs)
 * ✅ search_depth: "basic" o "advanced" (deep crawl)
 * ✅ include_answer: genera respuesta IA resumida
 * ✅ Filtro por dominio (include/exclude)
 * ✅ Ideal para OSINT: extrae datos del HTML real
 *
 * API Docs: https://docs.tavily.com/api-reference
 * Free tier: 1,000 requests/month
 */
@Injectable()
export class TavilySearchService {
  private readonly logger = new Logger(TavilySearchService.name);
  private readonly apiKey: string;
  private readonly serviceName = 'tavily';
  private readonly API_URL = 'https://api.tavily.com/search';

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly evidenceService: EvidenceService,
    private readonly regexExtractor: RegexExtractorService,
    private readonly rateLimitService: RateLimitService,
  ) {
    this.apiKey = this.configService.get<string>('TAVILY_API_KEY') || '';

    if (this.apiKey) {
      this.logger.log('✅ Tavily AI Search initialized (1,000 req/month free)');
    } else {
      this.logger.warn('⚠️ TAVILY_API_KEY not set — Tavily search disabled');
    }
  }

  /**
   * Check if Tavily API is available
   */
  isAvailable(): boolean {
    return !!this.apiKey;
  }

  /**
   * Search using Tavily AI and save evidence
   */
  async search(
    searchId: string,
    query: string,
    options: {
      maxResults?: number;
      searchDepth?: 'basic' | 'advanced';
      includeAnswer?: boolean;
      includeDomains?: string[];
      excludeDomains?: string[];
    } = {},
  ): Promise<TavilySearchResponse> {
    if (!this.apiKey) {
      this.logger.warn('Tavily API key not configured');
      return { results: [], totalResults: 0, responseTime: 0 };
    }

    // Rate limit: 1000/month ≈ ~33/day
    const canUse = await this.rateLimitService.canUseAPI(this.serviceName, 33);
    if (!canUse) {
      this.logger.warn('⚠️ Tavily daily rate limit reached (33/day → ~1000/month)');
      return { results: [], totalResults: 0, responseTime: 0 };
    }

    try {
      const startTime = Date.now();

      const requestBody: any = {
        api_key: this.apiKey,
        query,
        search_depth: options.searchDepth || 'basic',
        max_results: options.maxResults || 10,
        include_answer: options.includeAnswer ?? true,
        include_raw_content: false, // Save bandwidth
      };

      if (options.includeDomains?.length) {
        requestBody.include_domains = options.includeDomains;
      }
      if (options.excludeDomains?.length) {
        requestBody.exclude_domains = options.excludeDomains;
      }

      this.logger.log(`🧠 Tavily search: "${query}" (depth: ${requestBody.search_depth})`);

      const response = await firstValueFrom(
        this.httpService.post(this.API_URL, requestBody, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000,
        }),
      );

      await this.rateLimitService.registerCall(this.serviceName, 33);

      const data = response.data;
      const results: TavilySearchResult[] = (data.results || []).map((r: any) => ({
        title: r.title || 'Sin título',
        url: r.url || '',
        content: r.content || '',
        score: r.score || 0,
        rawContent: r.raw_content,
        publishedDate: r.published_date,
      }));

      const responseTime = Date.now() - startTime;

      // Save results as evidence
      await this.saveAsEvidence(searchId, query, results, data.answer);

      this.logger.log(
        `✅ Tavily: ${results.length} results in ${responseTime}ms` +
        (data.answer ? ' (with AI answer)' : ''),
      );

      return {
        results,
        totalResults: results.length,
        answer: data.answer,
        followUpQuestions: data.follow_up_questions,
        responseTime,
      };
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.logger.error('❌ Tavily: Invalid API key');
      } else if (error.response?.status === 429) {
        this.logger.error('❌ Tavily: Rate limit exceeded');
      } else {
        this.logger.error(`❌ Tavily search failed: ${error.message}`);
      }
      return { results: [], totalResults: 0, responseTime: 0 };
    }
  }

  /**
   * Advanced OSINT search: busca persona en categorías clave
   * Usa search_depth:"advanced" para extraer contenido real de las páginas
   */
  async deepPersonSearch(
    searchId: string,
    fullName: string,
    options: {
      username?: string;
      email?: string;
    } = {},
  ): Promise<TavilySearchResponse> {
    const queries: string[] = [];

    // Query principal
    queries.push(`"${fullName}" profile OR perfil`);
    if (options.username) {
      queries.push(`"${options.username}" profile OR social`);
    }
    if (options.email) {
      queries.push(`"${options.email}"`);
    }

    let allResults: TavilySearchResult[] = [];
    let answer: string | undefined;

    for (const q of queries) {
      const response = await this.search(searchId, q, {
        searchDepth: 'advanced',
        maxResults: 10,
        includeAnswer: true,
      });

      allResults.push(...response.results);
      if (response.answer && !answer) {
        answer = response.answer;
      }

      // Delay between requests
      await this.delay(500);
    }

    // Dedup by URL
    const seen = new Set<string>();
    allResults = allResults.filter(r => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });

    return {
      results: allResults,
      totalResults: allResults.length,
      answer,
      responseTime: 0,
    };
  }

  /**
   * Search within specific domains (OSINT focus)
   * Útil para buscar en redes sociales específicas
   */
  async searchInDomains(
    searchId: string,
    query: string,
    domains: string[],
  ): Promise<TavilySearchResponse> {
    return this.search(searchId, query, {
      includeDomains: domains,
      maxResults: 10,
      searchDepth: 'basic',
    });
  }

  /**
   * Save Tavily results as evidence
   * Tavily es especial porque devuelve contenido real extraído
   */
  private async saveAsEvidence(
    searchId: string,
    query: string,
    results: TavilySearchResult[],
    aiAnswer?: string,
  ): Promise<void> {
    // Save individual results
    for (const result of results) {
      try {
        // Tavily devuelve contenido real — extraer datos de ahí
        const textToAnalyze = `${result.title} ${result.content} ${result.url}`;
        const extracted = this.regexExtractor.extractAll(textToAnalyze);

        await this.evidenceService.saveEvidence(searchId, {
          source: 'tavily_ai',
          category: this.categorizeByContent(result.content, result.url),
          title: result.title,
          summary: result.content.substring(0, 500),
          url: result.url,
          matchConfidence: result.score,
          extractedData: {
            emails: extracted.emails,
            phones: extracted.phones,
            rfcs: extracted.rfcs,
            curps: extracted.curps,
            urls: [result.url],
          },
        } as any);
      } catch (error: any) {
        this.logger.error(`Error saving Tavily evidence: ${error.message}`);
      }
    }

    // Save AI answer as special evidence (si existe)
    if (aiAnswer) {
      try {
        const extracted = this.regexExtractor.extractAll(aiAnswer);
        await this.evidenceService.saveEvidence(searchId, {
          source: 'tavily_ai_answer',
          category: 'identity' as const,
          title: `AI Summary: ${query}`,
          summary: aiAnswer.substring(0, 1000),
          url: 'https://tavily.com',
          matchConfidence: 0.85,
          extractedData: {
            emails: extracted.emails,
            phones: extracted.phones,
            rfcs: extracted.rfcs,
            curps: extracted.curps,
            urls: [],
          },
        } as any);
      } catch (error: any) {
        this.logger.error(`Error saving Tavily AI answer: ${error.message}`);
      }
    }
  }

  /**
   * Categorize evidence based on content and URL
   */
  private categorizeByContent(content: string, url: string): 'identity' | 'legal' | 'financial' | 'social' | 'other' {
    const text = `${content} ${url}`.toLowerCase();

    if (text.match(/sentencia|demanda|juicio|tribunal|delito|penal|condena/)) return 'legal';
    if (text.match(/sat\.gob|rfc|hacienda|fiscal|impuesto|factura/)) return 'financial';
    if (text.match(/facebook|twitter|instagram|tiktok|snapchat|reddit/)) return 'social';
    if (text.match(/linkedin|github|stackoverflow|portfolio|resume|cv/)) return 'social';
    if (text.match(/perfil|profile|nombre|name|identidad|identity/)) return 'identity';

    return 'other';
  }

  /**
   * Get usage stats
   */
  async getUsageStats(): Promise<{
    available: boolean;
    dailyLimit: number;
    monthlyEstimate: number;
  }> {
    return {
      available: this.isAvailable(),
      dailyLimit: 33,
      monthlyEstimate: 1000,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
