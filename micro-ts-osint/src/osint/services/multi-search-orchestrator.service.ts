import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import { OsintSearch, OsintSearchDocument } from '../schemas/osint-search.schema';
import { BingSearchService } from './bing-search.service';
import { DuckDuckGoSearchService } from './duckduckgo-search.service';
import { YouTubeSearchService } from './youtube-search.service';
import { WebArchiveService } from './web-archive.service';
import { ReverseImageSearchService } from './reverse-image-search.service';
import { WebCrawlerService } from './web-crawler.service';
import { ScoringService } from './scoring.service';
import { EvidenceService } from './evidence.service';
import { AuditLogService } from './audit-log.service';
import { CacheService } from './cache.service';
import { ClusteringService } from './clustering.service';
import { ClusterEnrichmentService } from './cluster-enrichment.service';
import { SanctionsScreeningService } from './sanctions-screening.service';
import { SearxngSearchService } from './searxng-search.service';
import { TavilySearchService } from './tavily-search.service';
import { SerperSearchService } from './serper-search.service';
import { YandexImageSearchService } from './yandex-image-search.service';
import { NetworkSchedulerService, CaseProfile } from './network-scheduler.service';
import { MetaIntelligenceService } from './meta-intelligence.service';
import { InstagramIntelligenceService } from './instagram-intelligence.service';
import { BraveSearchService } from './brave-search.service';
import { SocialScraperClientService } from './social-scraper-client.service';

/** Query budget — limits total queries to prevent scraping storms */
interface QueryBudget {
  maxTotalQueries: number;
  maxMainQueries: number;
  maxSiteQueries: number;
  maxCrawlUrls: number;
  maxArchiveUrls: number;
}

export interface SearchOrchestrationResult {
  searchId: string;
  totalEvidence: number;
  sources: string[];
  scores: {
    identity: number;
    legal: number;
    financial: number;
    overall: number;
    confidence: string;
  };
  sanctions?: {
    riskLevel: string;
    riskScore: number;
    totalHits: number;
    summary: string;
  };
  summary: {
    bingResults: number;
    duckduckgoResults: number;
    searxngResults: number;
    tavilyResults: number;
    serperResults: number;
    braveResults: number;
    youtubeResults: number;
    webArchiveSnapshots: number;
    reverseImageResults: number;
    yandexImageResults: number;
    crawledPages: number;
    metaResults: number;
    instagramResults: number;
    socialScraperResults: number;
  };
  duration: number;
}

/**
 * Orquestador de búsqueda multi-motor
 * Ejecuta búsquedas en paralelo en múltiples servicios y agrega resultados
 * 
 * Responsabilidades:
 * - Ejecutar búsquedas en paralelo (Bing, DuckDuckGo, YouTube, WebArchive)
 * - Reverse image search si hay imagen
 * - Web crawling de URLs encontradas
 * - Calcular scoring multi-dimensional
 * - Actualizar estado de búsqueda en MongoDB
 * - Audit logging
 */
@Injectable()
export class MultiSearchOrchestratorService {
  private readonly logger = new Logger(MultiSearchOrchestratorService.name);

  // ─── QUERY BUDGETS PER PROFILE ────────────────────────────
  private static readonly QUERY_BUDGETS: Record<string, QueryBudget> = {
    silent:     { maxTotalQueries: 12, maxMainQueries: 4, maxSiteQueries: 5,  maxCrawlUrls: 3, maxArchiveUrls: 3 },
    stealth:    { maxTotalQueries: 15, maxMainQueries: 5, maxSiteQueries: 6,  maxCrawlUrls: 5, maxArchiveUrls: 4 },
    standard:   { maxTotalQueries: 20, maxMainQueries: 6, maxSiteQueries: 8,  maxCrawlUrls: 8, maxArchiveUrls: 5 },
    aggressive: { maxTotalQueries: 35, maxMainQueries: 8, maxSiteQueries: 15, maxCrawlUrls: 12, maxArchiveUrls: 8 },
  };

  /** OPSEC: hash query for safe logging (no PII in console) */
  private hashQ(q: string): string {
    return crypto.createHash('sha256').update(q).digest('hex').substring(0, 8);
  }

  /**
   * Reverse image engines are sensitive to exact pixels and public accessibility.
   * Prefer original image over AI-enhanced image, and force HTTPS when possible.
   */
  private normalizeReverseImageUrl(url?: string): string | undefined {
    if (!url) return undefined;
    const trimmed = url.trim();
    if (!trimmed) return undefined;
    return trimmed.startsWith('http://')
      ? `https://${trimmed.substring('http://'.length)}`
      : trimmed;
  }

  constructor(
    @InjectModel(OsintSearch.name)
    private osintSearchModel: Model<OsintSearchDocument>,
    private bingSearchService: BingSearchService,
    private duckduckgoSearchService: DuckDuckGoSearchService,
    private youtubeSearchService: YouTubeSearchService,
    private webArchiveService: WebArchiveService,
    private reverseImageSearchService: ReverseImageSearchService,
    private cacheService: CacheService,
    private webCrawlerService: WebCrawlerService,
    private scoringService: ScoringService,
    private evidenceService: EvidenceService,
    private auditLogService: AuditLogService,
    private clusteringService: ClusteringService,
    private clusterEnrichmentService: ClusterEnrichmentService,
    private sanctionsScreeningService: SanctionsScreeningService,
    private searxngSearchService: SearxngSearchService,
    private tavilySearchService: TavilySearchService,
    private serperSearchService: SerperSearchService,
    private yandexImageSearchService: YandexImageSearchService,
    private networkScheduler: NetworkSchedulerService,
    private metaIntelligenceService: MetaIntelligenceService,
    private instagramIntelligenceService: InstagramIntelligenceService,
    private braveSearchService: BraveSearchService,
    private socialScraperClient: SocialScraperClientService,
  ) {}

  /**
   * Ejecuta búsqueda orquestada en todos los motores habilitados
   * 
   * @param searchId - ID de búsqueda creada en MongoDB
   * @returns Resultado agregado con scores y estadísticas
   */
  async executeSearch(searchId: string): Promise<SearchOrchestrationResult> {
    const startTime = Date.now();
    this.logger.log(`Starting orchestrated search for ${searchId}...`);

    try {
      // 1. Obtener búsqueda de MongoDB
      const search = await this.osintSearchModel.findById(searchId).exec();
      if (!search) {
        throw new Error(`Search not found: ${searchId}`);
      }

      // Actualizar estado a processing
      search.status = 'processing';
      search.updatedAt = new Date();
      await search.save();

      try {
        // Ejecutar búsqueda dentro de try/catch para capturar errores
        return await this.performSearch(search);
      } catch (searchError) {
        // Actualizar estado a failed si hay error
        search.status = 'failed';
        search.error = searchError.message;
        search.updatedAt = new Date();
        await search.save();
        
        this.logger.error(`Search ${searchId} failed: ${searchError.message}`);
        throw searchError;
      }
    } catch (error) {
      this.logger.error(`Execute search error: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Genera múltiples variaciones de query para maximizar resultados
   * A partir del input del usuario, crea queries específicos para cada aspecto
   */
  /**
   * 100+ sitios organizados por categoría
   * REGLA DE ORO: sin ciudad, sin organización — solo nombre + username + email + teléfono
   */
  private static readonly SITES = {
    // === REDES SOCIALES PRINCIPALES (11) ===
    social: [
      'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'linkedin.com',
      'tiktok.com', 'snapchat.com', 'pinterest.com', 'reddit.com', 'tumblr.com',
      't.me',
    ],
    // === TRADING & FINANZAS (10) ===
    trading: [
      'binance.com', 'etoro.com', 'mql5.com', 'tradingview.com', 'myfxbook.com',
      'forexfactory.com', 'investing.com', 'stocktwits.com', 'coinbase.com',
      'coinmarketcap.com',
    ],
    // === PROFESIONALES / DEV (9) ===
    professional: [
      'github.com', 'gitlab.com', 'bitbucket.org', 'stackoverflow.com',
      'codepen.io', 'hackerrank.com', 'kaggle.com', 'researchgate.net',
      'academia.edu',
    ],
    // === CONTENIDO / VIDEO (8) ===
    content: [
      'youtube.com', 'vimeo.com', 'twitch.tv', 'flickr.com', '500px.com',
      'deviantart.com', 'behance.net', 'dribbble.com',
    ],
    // === MÚSICA (6) ===
    music: [
      'soundcloud.com', 'open.spotify.com', 'bandcamp.com', 'last.fm',
      'mixcloud.com', 'discogs.com',
    ],
    // === BLOGS / ESCRITURA (5) ===
    blogs: [
      'medium.com', 'wordpress.com', 'blogger.com', 'quora.com', 'goodreads.com',
    ],
    // === E-COMMERCE (3) ===
    ecommerce: [
      'amazon.com.mx', 'ebay.com', 'mercadolibre.com.mx',
    ],
    // === GUBERNAMENTALES MÉXICO (8) ===
    gobierno: [
      'gob.mx', 'dof.gob.mx', 'sat.gob.mx', 'imss.gob.mx',
      'ine.mx', 'sep.gob.mx', 'salud.gob.mx', 'infonavit.org.mx',
    ],
    // === INTERNACIONALES / OSINT (5) ===
    international: [
      'interpol.int', 'web.archive.org', 'webmii.com',
      'social-searcher.com', 'pastebin.com',
    ],
    // === ACADÉMICAS (3) ===
    academic: [
      'scholar.google.com', 'researchgate.net', 'academia.edu',
    ],
    // === DIRECTORIOS MÉXICO (2) ===
    directorios: [
      'seccionamarilla.com.mx', 'paginasamarillas.com.mx',
    ],
    // === OTROS (6) ===
    otros: [
      'taringa.net', 'about.me', 'linktree.com', 'gravatar.com',
      'vk.com', 'wa.me',
    ],
  };

  /**
   * Generate query variations with TIERED site prioritization.
   * Priority 1 (always): social + professional
   * Priority 2 (standard+): gobierno + trading + content
   * Priority 3 (aggressive only): blogs, music, others
   */
  private generateQueryVariations(search: OsintSearchDocument, caseProfileName: string): string[] {
    const queries: string[] = [];
    const personalInfo = search.inputData?.personalInfo;

    if (!personalInfo) {
      if (search.query) queries.push(search.query);
      return queries;
    }

    const { nombre, apellido, username, email, telefono, rfc, curp, alias } = personalInfo as any;
    const fullName = [nombre, apellido].filter(Boolean).join(' ');

    // =====================================================
    // QUERIES PRINCIPALES (alta señal)
    // =====================================================
    if (fullName) {
      queries.push(`"${fullName}"`);
      queries.push(fullName);
    }
    if (username) {
      queries.push(username);
      queries.push(`"${username}"`);
      queries.push(`@${username}`);
    }
    if (email) {
      queries.push(`"${email}"`);
    }
    if (fullName && username) {
      queries.push(`"${fullName}" ${username}`);
    }
    if (telefono) {
      queries.push(`"${telefono}"`);
      // Cruce nombre + teléfono (alta señal)
      if (fullName) {
        queries.push(`"${fullName}" "${telefono}"`);
      }
    }
    // RFC — identificador único fiscal México
    if (rfc) {
      queries.push(`"${rfc}"`);
      queries.push(`${rfc} SAT`);
      queries.push(`${rfc} empresa OR accionista OR representante`);
      if (fullName) queries.push(`"${fullName}" ${rfc}`);
    }
    // CURP — identificador único de registro de población México
    if (curp) {
      queries.push(`"${curp}"`);
      if (fullName) queries.push(`"${fullName}" ${curp}`);
    }
    // Alias — búsqueda cruzada
    if (alias) {
      const aliasList = alias.split(',').map((a: string) => a.trim()).filter(Boolean);
      for (const al of aliasList) {
        queries.push(`"${al}"`);
        if (fullName) queries.push(`"${fullName}" "${al}"`);
      }
    }

    // =====================================================
    // TIERED SITE-SPECIFIC QUERIES
    // =====================================================
    // Priority 1: Always active — highest signal sites
    const prioritySites = [
      ...MultiSearchOrchestratorService.SITES.social,
      ...MultiSearchOrchestratorService.SITES.professional,
    ];

    // Priority 2: standard+ profiles
    const secondarySites = [
      ...MultiSearchOrchestratorService.SITES.gobierno,
      ...MultiSearchOrchestratorService.SITES.trading,
      ...MultiSearchOrchestratorService.SITES.content,
      ...MultiSearchOrchestratorService.SITES.international,
    ];

    // Priority 3: aggressive only
    const tertiarySites = [
      ...MultiSearchOrchestratorService.SITES.blogs,
      ...MultiSearchOrchestratorService.SITES.music,
      ...MultiSearchOrchestratorService.SITES.ecommerce,
      ...MultiSearchOrchestratorService.SITES.academic,
      ...MultiSearchOrchestratorService.SITES.directorios,
      ...MultiSearchOrchestratorService.SITES.otros,
    ];

    // Select sites based on case profile tier
    let activeSites = [...new Set(prioritySites)];
    if (['standard', 'aggressive'].includes(caseProfileName)) {
      activeSites = [...new Set([...prioritySites, ...secondarySites])];
    }
    if (caseProfileName === 'aggressive') {
      activeSites = [...new Set([...prioritySites, ...secondarySites, ...tertiarySites])];
    }

    if (username) {
      for (const site of activeSites) {
        queries.push(`site:${site} ${username}`);
      }
      if (fullName) {
        // Name search only on social (high signal)
        for (const site of MultiSearchOrchestratorService.SITES.social.slice(0, 6)) {
          queries.push(`site:${site} "${fullName}"`);
        }
      }
    } else if (fullName) {
      // Without username, only main social + professional
      const mainSites = [...new Set([
        ...MultiSearchOrchestratorService.SITES.social,
        ...MultiSearchOrchestratorService.SITES.professional,
      ])];
      for (const site of mainSites) {
        queries.push(`site:${site} "${fullName}"`);
      }
    }

    // =====================================================
    // SPECIAL QUERIES (intel-focused)
    // =====================================================
    if (username) {
      queries.push(`"${username}" perfil OR profile OR about`);
      queries.push(`"${username}" sentencia OR demanda OR antecedentes`);
    }
    if (fullName) {
      queries.push(`"${fullName}" perfil OR profile OR about`);
      queries.push(`"${fullName}" sentencia OR demanda OR antecedentes`);
    }
    // Directorios inversos telefónicos (para búsqueda por número)
    if (telefono && !fullName && !username) {
      queries.push(`site:truecaller.com ${telefono}`);
      queries.push(`site:numinfo.net ${telefono}`);
      queries.push(`site:whitepages.com ${telefono}`);
      queries.push(`site:spy-dialer.com ${telefono}`);
      queries.push(`"${telefono}" whatsapp OR telegram OR contacto`);
    }
    // SAT/DOF para RFC
    if (rfc) {
      queries.push(`site:sat.gob.mx ${rfc}`);
      queries.push(`site:dof.gob.mx "${rfc}"`);
      queries.push(`site:gob.mx "${rfc}"`);
    }

    // Deduplicar
    const uniqueQueries = [...new Set(queries.map(q => q.trim()))].filter(q => q.length > 0);
    this.logger.log(
      `🔍 Generated ${uniqueQueries.length} queries (profile=${caseProfileName}, ` +
      `sites=${activeSites.length}, tier=${caseProfileName === 'aggressive' ? '1+2+3' : caseProfileName === 'standard' ? '1+2' : '1'})`,
    );
    return uniqueQueries;
  }

  /**
   * Realiza la búsqueda real con case profile, query budget, hashed logging
   */
  private async performSearch(search: OsintSearchDocument): Promise<SearchOrchestrationResult> {
    const startTime = Date.now();
    const searchId = search._id.toString();

    const { query, inputData } = search;
    const rawOptions = (inputData?.options || {}) as any;
    const defaultSearchEngines = ['serper', 'tavily', 'searxng', 'duckduckgo'];
    const engineAliases: Record<string, string> = {
      google: 'serper',
    };
    const normalizedSearchEngines = Array.isArray(rawOptions.searchEngines)
      ? [...new Set(rawOptions.searchEngines
        .map((e: string) => engineAliases[(e || '').toLowerCase()] || (e || '').toLowerCase())
        .filter(Boolean))]
      : [];
    const options = {
      deepSearch: false,
      youtubeSearch: false,
      webArchiveSearch: false,
      ...rawOptions,
      searchEngines: normalizedSearchEngines.length > 0 ? normalizedSearchEngines : defaultSearchEngines,
    };
    const imageOnlyMode = Boolean((options as any).imageOnlyMode);

    // ── 1. APPLY CASE PROFILE ──────────────────────────────────
    const caseProfileName: string = (options as any).caseProfile || 'standard';
    this.networkScheduler.applyCaseProfile(caseProfileName);
    const caseProfile = this.networkScheduler.getCaseProfile();
    const budget = MultiSearchOrchestratorService.QUERY_BUDGETS[caseProfileName]
      || MultiSearchOrchestratorService.QUERY_BUDGETS['standard'];

    // Override deepSearch from case profile
    if (caseProfile.deepSearch) options.deepSearch = true;

    if (imageOnlyMode) {
      this.logger.log('🖼️ Image-only mode enabled: disabling text/news/crawler-oriented engines for visual-only gallery output');
    }

    // ── 2. GENERATE QUERIES (tiered by profile) ────────────────
    const queryVariations = this.generateQueryVariations(search, caseProfileName);
    this.logger.log(`Executing search q#${this.hashQ(query || '')} with ${queryVariations.length} variations (budget: ${budget.maxTotalQueries})`);

    try {
      const scheduledTasks: Array<{ domain: string; operation: () => Promise<any>; label?: string }> = [];

      // ── 3. APPLY QUERY BUDGET ────────────────────────────────
      let mainQueries = queryVariations.filter(q => !q.startsWith('site:'));
      let siteQueries = queryVariations.filter(q => q.startsWith('site:'));

      // Enforce budget limits
      mainQueries = mainQueries.slice(0, budget.maxMainQueries);
      siteQueries = siteQueries.slice(0, budget.maxSiteQueries);

      // Absolute cap
      const totalPlanned = mainQueries.length + siteQueries.length;
      if (totalPlanned > budget.maxTotalQueries) {
        siteQueries = siteQueries.slice(0, budget.maxTotalQueries - mainQueries.length);
      }

      this.logger.log(
        `📊 Budget applied: ${mainQueries.length} main + ${siteQueries.length} site = ` +
        `${mainQueries.length + siteQueries.length} total (max ${budget.maxTotalQueries})`,
      );

      const mainMaxResults = options.deepSearch ? 50 : 30;
      const siteMaxResults = options.deepSearch ? 25 : 15;

      // ── 4. TIER 1 ENGINES (always active): searxng, bing, serper, tavily ──

      // === SearXNG (Tier 1 — meta-search, highest value) ===
      if (!imageOnlyMode && options.searchEngines?.includes('searxng')) {
        const searxngQueries = mainQueries.slice(0, options.deepSearch ? 6 : 3);
        for (const q of searxngQueries) {
          const h = this.hashQ(q);
          scheduledTasks.push({
            domain: 'searxng',
            label: `SearXNG:q#${h}`,
            operation: () => this.searxngSearchService
              .search(searchId, q, { maxResults: options.deepSearch ? 25 : 15 })
              .then((r) => ({ ...r, _source: 'searxng' }))
              .catch((err) => {
                this.logger.error(`SearXNG failed [${h}]: ${err.message}`);
                return { results: [], totalResults: 0, engines: [], instanceUsed: 'none', _source: 'searxng' };
              }),
          });
        }
      }

      // === Bing (Tier 1 — API, reliable) ===
      if (!imageOnlyMode && options.searchEngines?.includes('bing') && this.bingSearchService.isAvailable()) {
        const bingQueries = mainQueries.slice(0, Math.min(4, budget.maxMainQueries));
        for (const q of bingQueries) {
          const h = this.hashQ(q);
          scheduledTasks.push({
            domain: 'bing',
            label: `Bing:q#${h}`,
            operation: () => this.bingSearchService
              .search(searchId, q, { count: options.deepSearch ? 30 : 15 })
              .then((r) => ({ ...r, _source: 'bing' }))
              .catch((err) => {
                this.logger.error(`Bing failed [${h}]: ${err.message}`);
                return { results: [], totalResults: 0, _source: 'bing' };
              }),
          });
        }
      }

      // === Serper (Tier 1 — Google real results) ===
      if (!imageOnlyMode && options.searchEngines?.includes('serper') && this.serperSearchService.isAvailable()) {
        const serperQueries = mainQueries.slice(0, options.deepSearch ? 4 : 2);
        for (const q of serperQueries) {
          const h = this.hashQ(q);
          scheduledTasks.push({
            domain: 'serper',
            label: `Serper:q#${h}`,
            operation: () => this.serperSearchService
              .search(searchId, q, { maxResults: options.deepSearch ? 15 : 10 })
              .then((r) => ({ ...r, _source: 'serper' }))
              .catch((err) => {
                this.logger.error(`Serper failed [${h}]: ${err.message}`);
                return { results: [], totalResults: 0, searchParameters: { query: q, type: 'search' }, responseTime: 0, _source: 'serper' };
              }),
          });
        }
        // Google Images
        const personalInfo = inputData?.personalInfo as any;
        const fullName = personalInfo ? [personalInfo.nombre, personalInfo.apellido].filter(Boolean).join(' ') : '';
        const visualQuery = fullName || personalInfo?.username || query || '';
        if (visualQuery) {
          scheduledTasks.push({
            domain: 'serper',
            label: `Serper-Img:q#${this.hashQ(visualQuery)}`,
            operation: () => this.serperSearchService
              .searchImages(searchId, visualQuery, { maxResults: 15 })
              .then((r) => ({ results: Array.isArray(r) ? r : [], _source: 'serper' as const }))
              .catch((err) => {
                this.logger.error(`Serper Images failed: ${err.message}`);
                return { results: [], _source: 'serper' };
              }),
          });
        }
        // Google News
        if (visualQuery) {
          const newsQuery = visualQuery;
          scheduledTasks.push({
            domain: 'serper',
            label: `Serper-News:q#${this.hashQ(newsQuery)}`,
            operation: () => this.serperSearchService
              .searchNews(searchId, newsQuery, { maxResults: 10 })
              .then((r) => ({ results: Array.isArray(r) ? r : [], _source: 'serper' as const }))
              .catch((err) => {
                this.logger.error(`Serper News failed: ${err.message}`);
                return { results: [], _source: 'serper' };
              }),
          });
        }
      }

      // === Brave Search (Tier 1 — independent index, free 2000/month) ===
      if (!imageOnlyMode && options.searchEngines?.includes('brave') && this.braveSearchService.isAvailable()) {
        const braveQueries = mainQueries.slice(0, options.deepSearch ? 4 : 2);
        for (const q of braveQueries) {
          const h = this.hashQ(q);
          scheduledTasks.push({
            domain: 'brave',
            label: `Brave:q#${h}`,
            operation: () => this.braveSearchService
              .search(searchId, q, { maxResults: options.deepSearch ? 15 : 10 })
              .then((r) => ({ ...r, _source: 'brave' }))
              .catch((err) => {
                this.logger.error(`Brave failed [${h}]: ${err.message}`);
                return { results: [], totalResults: 0, responseTime: 0, _source: 'brave' };
              }),
          });
        }
        // Brave News
        const personalInfo = inputData?.personalInfo as any;
        const fullNameBrave = personalInfo ? [personalInfo.nombre, personalInfo.apellido].filter(Boolean).join(' ') : '';
        if (fullNameBrave || personalInfo?.username) {
          const newsQ = fullNameBrave || personalInfo.username;
          scheduledTasks.push({
            domain: 'brave',
            label: `Brave-News:q#${this.hashQ(newsQ)}`,
            operation: () => this.braveSearchService
              .searchNews(searchId, newsQ, { maxResults: 10 })
              .then((r) => ({ ...r, _source: 'brave' }))
              .catch((err) => {
                this.logger.error(`Brave News failed: ${err.message}`);
                return { results: [], totalResults: 0, responseTime: 0, _source: 'brave' };
              }),
          });
        }
      }

      // === Tavily AI (Tier 1 — extracted content) ===
      if (!imageOnlyMode && options.searchEngines?.includes('tavily') && this.tavilySearchService.isAvailable()) {
        const tavilyQueries = mainQueries.slice(0, options.deepSearch ? 3 : 2);
        for (const q of tavilyQueries) {
          const h = this.hashQ(q);
          scheduledTasks.push({
            domain: 'tavily',
            label: `Tavily:q#${h}`,
            operation: () => this.tavilySearchService
              .search(searchId, q, {
                maxResults: options.deepSearch ? 10 : 5,
                searchDepth: options.deepSearch ? 'advanced' : 'basic',
                includeAnswer: true,
              })
              .then((r) => ({ ...r, _source: 'tavily' }))
              .catch((err) => {
                this.logger.error(`Tavily failed [${h}]: ${err.message}`);
                return { results: [], totalResults: 0, responseTime: 0, _source: 'tavily' };
              }),
          });
        }
      }

      // === YouTube (Tier 1 — video intel) ===
      if (!imageOnlyMode && options.searchEngines?.includes('youtube') && this.youtubeSearchService.isAvailable() && options.youtubeSearch !== false) {
        const ytQueries = mainQueries.slice(0, 3);
        for (const q of ytQueries) {
          const h = this.hashQ(q);
          scheduledTasks.push({
            domain: 'youtube',
            label: `YT:q#${h}`,
            operation: () => this.youtubeSearchService
              .search(searchId, q, { maxResults: options.deepSearch ? 25 : 10 })
              .then((r) => ({ ...r, _source: 'youtube' }))
              .catch((err) => {
                this.logger.error(`YouTube failed [${h}]: ${err.message}`);
                return { results: [], totalResults: 0, _source: 'youtube' };
              }),
          });
        }
      }

      // ── 5. TIER 2 ENGINES (only if profile allows) ──────────

      // === DuckDuckGo (Tier 2 — scraping, highest block risk) ===
      if (!imageOnlyMode && caseProfile.allowTier2 && options.searchEngines?.includes('duckduckgo')) {
        const ddgMainQueries = mainQueries.slice(0, options.deepSearch ? 4 : 3);
        const ddgSiteQueries = siteQueries.slice(0, options.deepSearch ? 6 : 4);

        for (const q of ddgMainQueries) {
          const h = this.hashQ(q);
          scheduledTasks.push({
            domain: 'duckduckgo',
            label: `DDG:q#${h}`,
            operation: () => this.duckduckgoSearchService
              .search(searchId, q, { maxResults: mainMaxResults })
              .then((r) => ({ ...r, _source: 'duckduckgo' }))
              .catch((err) => {
                this.logger.error(`DDG failed [${h}]: ${err.message}`);
                return { results: [], totalResults: 0, _source: 'duckduckgo' };
              }),
          });
        }
        for (const q of ddgSiteQueries) {
          const h = this.hashQ(q);
          scheduledTasks.push({
            domain: 'duckduckgo',
            label: `DDG-site:q#${h}`,
            operation: () => this.duckduckgoSearchService
              .search(searchId, q, { maxResults: siteMaxResults })
              .then((r) => ({ ...r, _source: 'duckduckgo' }))
              .catch((err) => {
                this.logger.error(`DDG-site failed [${h}]: ${err.message}`);
                return { results: [], totalResults: 0, _source: 'duckduckgo' };
              }),
          });
        }
      }

      // === Reverse image search (Tier 2 — per-domain queues) ===
      const originalImageUrl = this.normalizeReverseImageUrl(search.imageUrl);
      const enhancedImageUrl = this.normalizeReverseImageUrl(search.enhancedImageUrl);
      const resolvedImageUrl = originalImageUrl || enhancedImageUrl;
      const selectedImageSource = originalImageUrl ? 'original' : enhancedImageUrl ? 'enhanced' : 'none';
      this.logger.log(`🖼️ Reverse image check — original: ${originalImageUrl || 'N/A'}, enhanced: ${enhancedImageUrl || 'N/A'}, selected: ${selectedImageSource}, resolved: ${resolvedImageUrl || 'N/A'}`);
      if (inputData?.image && resolvedImageUrl && (options as any).reverseImageSearch !== false) {
        const imageUrl = resolvedImageUrl;
        const imageBase64 = (inputData as any)?.image?.base64;
        this.logger.log(`🔍 RUNNING REVERSE IMAGE SEARCH with URL: ${imageUrl}`);
        if (imageOnlyMode || caseProfile.allowTier2) {
          scheduledTasks.push({
            domain: 'reverse-image',
            label: 'ReverseImg:multi',
            operation: () => this.reverseImageSearchService
              .searchAllEngines(searchId, imageUrl, imageBase64)
              .then((r) => ({ ...r, _source: 'reverse-image' }))
              .catch((err) => {
                this.logger.error(`Reverse image failed: ${err.message}`);
                return { results: [], totalResults: 0, _source: 'reverse-image' };
              }),
          });
          if (!imageOnlyMode) {
            scheduledTasks.push({
              domain: 'yandex',
              label: 'Yandex:revimg',
              operation: () => this.yandexImageSearchService
                .reverseImageSearch(searchId, imageUrl)
                .then((r) => ({ ...r, _source: 'yandex' }))
                .catch((err) => {
                  this.logger.error(`Yandex reverse image failed: ${err.message}`);
                  return { results: [], totalResults: 0, facesDetected: false, relatedSearches: [], similarImages: [], duration: 0, _source: 'yandex' };
                }),
            });
          }
        }
      }

      // Log task distribution per domain
      const domainCounts: Record<string, number> = {};
      scheduledTasks.forEach(t => { domainCounts[t.domain] = (domainCounts[t.domain] || 0) + 1; });
      const domainSummary = Object.entries(domainCounts).map(([d, c]) => `${d}:${c}`).join(', ');
      this.logger.log(
        `🚀 Scheduling ${scheduledTasks.length} tasks across ${Object.keys(domainCounts).length} domain queues [${domainSummary}]`,
      );

      // Execute through NetworkScheduler — each domain runs independently
      // with its own concurrency limit, delays, circuit breaker, and retries
      const results = await this.networkScheduler.scheduleMultiDomain(scheduledTasks);

      this.logger.log(`✅ Completed ${results.length} scheduled searches`);

      // 3. Procesar resultados - contar por tipo
      let bingResults = 0;
      let duckduckgoResults = 0;
      let searxngResults = 0;
      let tavilyResults = 0;
      let serperResults = 0;
      let braveResults = 0;
      let youtubeResults = 0;
      let reverseImageResults = 0;
      let yandexImageResults = 0;

      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          const data = result.value;
          // Use _source tag if available (set by tagged promises), otherwise fallback to duck-typing
          const source = (data as any)?._source as string | undefined;
          const resultCount = Array.isArray(data?.results) ? data.results.length : 0;

          if (source) {
            // Clean source-tagged counting (no duck-typing needed)
            switch (source) {
              case 'bing': bingResults += resultCount; break;
              case 'duckduckgo': duckduckgoResults += resultCount; break;
              case 'searxng': searxngResults += resultCount; break;
              case 'tavily': tavilyResults += resultCount; break;
              case 'serper': serperResults += resultCount; break;
              case 'brave': braveResults += resultCount; break;
              case 'youtube': youtubeResults += resultCount; break;
              case 'yandex': yandexImageResults += resultCount; break;
              case 'reverse-image': reverseImageResults += data?.summary?.totalResults || 0; break;
            }
          } else if (data?.results && Array.isArray(data.results)) {
            // Fallback: duck-typing for backwards compatibility
            if (data.results[0]?.videoId) {
              youtubeResults += resultCount;
            } else if (data.results[0]?.snippet !== undefined) {
              duckduckgoResults += resultCount;
            } else {
              bingResults += resultCount;
            }
          } else if (data?.summary?.totalResults) {
            reverseImageResults += data.summary.totalResults;
          } else if (Array.isArray(data)) {
            serperResults += data.length;
          }
        }
      });

      // 4. Web crawling (si está habilitado)
      let crawledPages = 0;
      if ((options as any).enableCrawler) {
        crawledPages = await this.executeCrawling(searchId, (options as any).maxPagesPerUrl || 10);
      }

      // 5. Web Archive search (si está habilitado y hay URLs de evidencia)
      let webArchiveSnapshots = 0;
      if (options.webArchiveSearch) {
        webArchiveSnapshots = await this.executeWebArchiveSearch(searchId);
      }

      // ── 6. SOCIAL MEDIA — Meta (Facebook) + Instagram ─────────────────────
      // Se ejecutan DESPUÉS del crawling para tener usernames ya extraídos
      let metaResults = 0;
      let instagramResults = 0;
      let socialScraperResults = 0;

      const personalInfoData = inputData?.personalInfo as any;
      const fullNameForSocial = personalInfoData
        ? [personalInfoData.nombre, personalInfoData.apellido].filter(Boolean).join(' ')
        : query || '';
      const usernameCandidate = personalInfoData?.username || '';

      if (imageOnlyMode) {
        this.logger.log('🖼️ Image-only mode: skipping Meta/Instagram social pipelines');
      }

      // 6a. Facebook / Meta — si hay RapidAPI key disponible
      if (!imageOnlyMode && this.metaIntelligenceService.isAvailable() && fullNameForSocial) {
        try {
          this.logger.log(`📘 Running Meta search for "${fullNameForSocial}"...`);
          const metaResult = await this.networkScheduler.schedule('meta', () =>
            this.metaIntelligenceService.executeSearch({
              query: fullNameForSocial,
              searchType: 'people' as any,
            } as any),
          );

          if (metaResult?.found) {
            // Guardar evidencia de perfil principal
            if (metaResult.profile) {
              const mp = metaResult.profile as any;
              await this.evidenceService.saveEvidence(searchId, {
                source: 'facebook',
                url: mp.url || `https://www.facebook.com/search/people/?q=${encodeURIComponent(fullNameForSocial)}`,
                title: mp.name || fullNameForSocial,
                summary: `Facebook: ${mp.name} — ${mp.intro || mp.bio || ''}`,
                category: 'social_profile',
                reliability: 0.85,
                rawData: mp,
                extractedData: {
                  emails: mp.email ? [mp.email] : [],
                  phones: mp.phone ? [mp.phone] : [],
                  socialProfiles: [{ platform: 'facebook', url: mp.url || '' }],
                },
              } as any);
              metaResults++;
            }
            // Guardar posts como evidencias individuales
            if (Array.isArray(metaResult.posts)) {
              for (const post of metaResult.posts.slice(0, 10)) {
                if (!post.url) continue;
                await this.evidenceService.saveEvidence(searchId, {
                  source: 'facebook',
                  url: post.url,
                  title: `Facebook post — ${fullNameForSocial}`,
                  summary: post.text?.substring(0, 400) || '',
                  category: 'social_post',
                  reliability: 0.75,
                  rawData: post,
                } as any).catch(() => {});
                metaResults++;
              }
            }
          }

          // Buscar también por username si disponible
          if (usernameCandidate && usernameCandidate !== fullNameForSocial) {
            const metaByUsername = await this.networkScheduler.schedule('meta', () =>
              this.metaIntelligenceService.executePipeline({
                username: usernameCandidate,
                fetchProfile: true,
                fetchPosts: true,
                fetchPhotos: false,
              }),
            );
            if (metaByUsername?.found && metaByUsername.profile) {
              const mbup = metaByUsername.profile as any;
              await this.evidenceService.saveEvidence(searchId, {
                source: 'facebook',
                url: mbup.url || '',
                title: `Facebook (${usernameCandidate}): ${mbup.name || ''}`,
                summary: mbup.intro || mbup.bio || '',
                category: 'social_profile',
                reliability: 0.9,
                rawData: mbup,
              } as any).catch(() => {});
              metaResults++;
            }
          }
          this.logger.log(`📘 Meta: ${metaResults} evidencias guardadas`);
        } catch (metaErr) {
          this.logger.error(`Meta search error: ${metaErr.message}`);
        }
      } else if (!this.metaIntelligenceService.isAvailable()) {
        this.logger.warn('📘 Meta search: RAPIDAPI_KEY no configurada — omitiendo Facebook');
      }

      // 6b. Instagram — siempre disponible (usa Direct API sin key)
      if (!imageOnlyMode && this.instagramIntelligenceService.isAvailable()) {
        const igTargets: string[] = [];
        if (usernameCandidate) igTargets.push(usernameCandidate);
        // Derivar posibles usernames del nombre (heurística simple)
        if (fullNameForSocial && !usernameCandidate) {
          const derived = fullNameForSocial.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9._]/g, '');
          if (derived.length >= 3) igTargets.push(derived);
          const derived2 = fullNameForSocial.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
          if (derived2.length >= 3 && derived2 !== derived) igTargets.push(derived2);
        }

        for (const igUser of igTargets.slice(0, 3)) {
          try {
            this.logger.log(`📸 Running Instagram search for "@${igUser}"...`);
            const igResult = await this.networkScheduler.schedule('instagram', () =>
              this.instagramIntelligenceService.executePipeline({ username: igUser }),
            );

            if (igResult?.found && igResult.profile) {
              const igp = igResult.profile as any;
              await this.evidenceService.saveEvidence(searchId, {
                source: 'instagram',
                url: `https://www.instagram.com/${igUser}/`,
                title: `Instagram @${igUser}: ${igp.fullName || igp.full_name || igUser}`,
                summary: igp.biography || igp.bio || '',
                category: 'social_profile',
                reliability: 0.85,
                rawData: igp,
                extractedData: {
                  emails: igp.email ? [igp.email] : [],
                  phones: [],
                  socialProfiles: [{ platform: 'instagram', url: `https://www.instagram.com/${igUser}/`, username: igUser }],
                },
              } as any);
              instagramResults++;

              // Posts de Instagram
              if (Array.isArray((igResult as any).posts)) {
                for (const post of (igResult as any).posts.slice(0, 8)) {
                  await this.evidenceService.saveEvidence(searchId, {
                    source: 'instagram',
                    url: post.url || post.shortcodeUrl || `https://www.instagram.com/${igUser}/`,
                    title: `Instagram post — @${igUser}`,
                    summary: post.caption?.substring(0, 300) || '',
                    category: 'social_post',
                    reliability: 0.75,
                    rawData: post,
                  } as any).catch(() => {});
                  instagramResults++;
                }
              }
            } else {
              this.logger.log(`📸 Instagram @${igUser}: no encontrado`);
            }
          } catch (igErr) {
            this.logger.error(`Instagram search error (@${igUser}): ${igErr.message}`);
          }
        }
        this.logger.log(`📸 Instagram: ${instagramResults} evidencias guardadas`);
      }

      // 6c. Servicio agregado: osint-social-scraper
      // Complementa redes por nombre, username y foto sin bloquear el pipeline principal.
      if (this.socialScraperClient.isAvailable()) {
        try {
          const scraperResponses: any[] = [];

          if (!imageOnlyMode && usernameCandidate) {
            const byUsername = await this.networkScheduler.schedule('social-scraper', () =>
              this.socialScraperClient.searchByUsername(
                usernameCandidate,
                ['instagram', 'facebook', 'tiktok', 'x', 'youtube', 'telegram', 'threads', 'bluesky', 'github', 'reddit'],
                20,
              ),
            );
            if (byUsername) scraperResponses.push(byUsername);
          }

          if (!imageOnlyMode && fullNameForSocial) {
            const byName = await this.networkScheduler.schedule('social-scraper', () =>
              this.socialScraperClient.searchByName(
                fullNameForSocial,
                ['instagram', 'facebook', 'tiktok', 'x', 'youtube', 'telegram', 'threads', 'bluesky', 'github', 'reddit'],
                20,
              ),
            );
            if (byName) scraperResponses.push(byName);
          }

          const rawInputData = (inputData || {}) as any;
          const rawImageData = rawInputData.imageData || rawInputData.imageBase64 || rawInputData.image?.base64 || rawInputData.personalInfo?.imageData;
          if (rawImageData) {
            const byImage = await this.networkScheduler.schedule('social-scraper-image', () =>
              this.socialScraperClient.searchByImage(
                String(rawImageData),
                ['instagram', 'facebook', 'tiktok', 'x', 'youtube', 'telegram', 'threads', 'bluesky'],
                20,
              ),
            );
            if (byImage) scraperResponses.push(byImage);
          }

          socialScraperResults = await this.saveSocialScraperEvidence(searchId, scraperResponses);
          this.logger.log(`🧩 Social scraper: ${socialScraperResults} evidencias guardadas`);
        } catch (scraperErr) {
          this.logger.error(`Social scraper integration error: ${scraperErr.message}`);
        }
      } else {
        this.logger.log('🧩 Social scraper no configurado — omitiendo servicio agregado');
      }

      // 7. Calcular scores
      const evidences = await this.evidenceService.getEvidenceBySearch(searchId);
      const scores = this.scoringService.computeScores(evidences);

      // 7. Actualizar búsqueda en MongoDB (status: completed)
      search.scores = {
        identity: scores.identity,
        legal: scores.legal,
        financial: scores.financial,
        overall: scores.overall,
      };
      search.resultCount = evidences.length;
      search.lastSearched = new Date();
      search.status = 'completed';
      search.updatedAt = new Date();
      await search.save();

      // 8. Audit log
      const duration = Date.now() - startTime;
      await this.auditLogService.log(
        'search_completed',
        'osint_search',
        searchId,
        inputData?.options?.userId,
        {
          query,
          totalEvidence: evidences.length,
          scores,
          duration,
        },
      );

      const result: SearchOrchestrationResult = {
        searchId,
        totalEvidence: evidences.length,
        sources: [...new Set(evidences.map((e) => e.source as string))],
        scores,
        summary: {
          bingResults,
          duckduckgoResults,
          searxngResults,
          tavilyResults,
          serperResults,
          braveResults,
          youtubeResults,
          webArchiveSnapshots,
          reverseImageResults,
          yandexImageResults,
          crawledPages,
          metaResults,
          instagramResults,
          socialScraperResults,
        },
        duration,
      };

      this.logger.log(
        `Search completed in ${duration}ms - Total evidence: ${evidences.length}`,
      );

      // 9. Sanctions Screening 🚨 (Interpol, OFAC, ONU, Europol, FBI, PEPs)
      try {
        const personalInfo = inputData?.personalInfo as any;
        if (personalInfo) {
          const fullName = [personalInfo.nombre, personalInfo.apellido].filter(Boolean).join(' ');
          const sanctions = await this.networkScheduler.schedule('sanctions', () =>
            this.sanctionsScreeningService.screenPerson(
              searchId,
              {
                fullName: fullName || undefined,
                firstName: personalInfo.nombre,
                lastName: personalInfo.apellido,
                email: personalInfo.email,
                phone: personalInfo.telefono,
              },
            ),
          );

          result.sanctions = {
            riskLevel: sanctions.riskLevel,
            riskScore: sanctions.riskScore,
            totalHits: sanctions.totalHits,
            summary: sanctions.summary,
          };

          this.logger.log(
            `🚨 Sanctions screening: ${sanctions.riskLevel} (${sanctions.riskScore}/100) - ${sanctions.totalHits} hits`,
          );

          // Guardar resultado en el cluster
          const clusterId = search.metadata?.clusterId;
          if (clusterId) {
            const cluster = await this.clusteringService.getClusterById(clusterId);
            if (cluster) {
              (cluster as any).sanctionsScreening = {
                riskLevel: sanctions.riskLevel,
                riskScore: sanctions.riskScore,
                totalHits: sanctions.totalHits,
                lastScreened: new Date(),
                sourcesChecked: sanctions.sourcesChecked,
                summary: sanctions.summary,
              };
              await cluster.save();
            }
          }
        }
      } catch (sanctionsErr) {
        this.logger.error(`Sanctions screening error: ${sanctionsErr.message}`);
      }

      // 10. Actualizar Identity Cluster stats + enriquecimiento
      try {
        const clusterId = search.metadata?.clusterId;
        if (clusterId) {
          const platforms = [...new Set(evidences.map(e => e.source as string))];
          await this.clusteringService.updateClusterStats(clusterId, {
            totalEvidence: evidences.length,
            platforms,
            scores,
          });
          this.logger.log(`📊 Cluster stats updated: ${evidences.length} evidences, ${platforms.length} platforms`);

          // 11. Enriquecer cluster desde evidencias (nuevos aliases, emails, perfiles)
          const cluster = await this.clusteringService.getClusterById(clusterId);
          if (cluster) {
            const enrichment = await this.clusterEnrichmentService.enrichClusterFromEvidence(
              cluster,
              evidences as any,
            );
            this.logger.log(
              `🧬 Cluster enrichment: +${enrichment.newAliases.length} aliases, ` +
              `+${enrichment.newEmails.length} emails, ${enrichment.confirmedProfiles.length} profiles`,
            );
          }
        }
      } catch (clusterErr) {
        this.logger.error(`Error updating cluster stats: ${clusterErr.message}`);
      }

      return result;
    } catch (error) {
      this.logger.error(`Search orchestration error: ${error.message}`, error.stack);

      // Actualizar estado a failed (no 'error')
      await this.osintSearchModel
        .findByIdAndUpdate(searchId, {
          status: 'failed',
          error: error.message,
          updatedAt: new Date(),
        })
        .exec();

      throw error;
    }
  }

  /**
   * Ejecuta crawling de URLs encontradas en evidencias
   */
  private async executeCrawling(searchId: string, maxPages: number): Promise<number> {
    this.logger.log(`Starting web crawling for search ${searchId}...`);

    try {
      // Obtener URLs de evidencias
      const evidences = await this.evidenceService.getEvidenceBySearch(searchId);
      const urls = evidences
        .map((e) => e.url)
        .filter((url): url is string => !!url && url.startsWith('http'))
        .slice(0, maxPages);

      if (urls.length === 0) {
        this.logger.log('No URLs to crawl');
        return 0;
      }

      this.logger.log(`Crawling ${urls.length} URLs...`);

      // Crawl en paralelo usando crawlMultipleUrls (máximo 5 simultáneos internamente)
      const crawlResults = await this.webCrawlerService
        .crawlMultipleUrls(urls, { maxPages: 1, extractEmails: true, extractPhones: true })
        .catch((err: any) => {
          this.logger.error(`Crawl batch failed: ${err.message}`);
          return [];
        });

      // Guardar cada CrawlResult como evidencia
      let savedCount = 0;
      for (const page of crawlResults) {
        try {
          await this.evidenceService.saveEvidence(searchId, {
            source: 'web_crawler',
            url: page.url,
            title: page.title || 'Crawled page',
            summary: page.description?.substring(0, 500) || '',
            category: 'crawled_page',
            rawData: {
              title: page.title,
              description: page.description,
              emails: page.emails,
              phones: page.phones,
              links: page.links?.slice(0, 50),
              socialMediaProfiles: page.socialMediaProfiles,
            },
            extractedData: {
              emails: page.emails || [],
              phones: page.phones || [],
            },
          } as any);
          savedCount++;
        } catch (error: any) {
          this.logger.error(`Error saving crawled page: ${error.message}`);
        }
      }

      this.logger.log(`Crawled and saved ${savedCount}/${crawlResults.length} pages`);
      return savedCount;
    } catch (error) {
      this.logger.error(`Crawling error: ${error.message}`);
      return 0;
    }
  }

  /**
   * Ejecuta búsqueda en Web Archive para URLs encontradas
   */
  private async executeWebArchiveSearch(searchId: string): Promise<number> {
    this.logger.log(`Starting Web Archive search for ${searchId}...`);

    try {
      // Obtener URLs únicas de evidencias
      const evidences = await this.evidenceService.getEvidenceBySearch(searchId);
      const urls = [
        ...new Set(
          evidences
            .map((e) => e.url)
            .filter((url): url is string => !!url && url.startsWith('http')),
        ),
      ].slice(0, 10); // Máximo 10 URLs

      if (urls.length === 0) {
        this.logger.log('No URLs for Web Archive search');
        return 0;
      }

      this.logger.log(`Searching Web Archive for ${urls.length} URLs...`);

      // Buscar a través del scheduler (dominio 'webarchive': concurrency 2, delay 500-2000ms)
      const archiveTasks = urls.map((url: string) => ({
        domain: 'webarchive',
        label: `Archive: ${url.substring(0, 50)}`,
        operation: () => this.webArchiveService.search(searchId, url, { limit: 50 }).catch((err) => {
          this.logger.error(`Web Archive search failed for ${url}: ${err.message}`);
          return { snapshots: [], totalSnapshots: 0 };
        }),
      }));

      const settledResults = await this.networkScheduler.scheduleMultiDomain(archiveTasks);
      const results = settledResults
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
        .map(r => r.value);
      const totalSnapshots = results.reduce((sum, r) => sum + r.totalSnapshots, 0);

      this.logger.log(`Found ${totalSnapshots} Web Archive snapshots`);
      return totalSnapshots;
    } catch (error) {
      this.logger.error(`Web Archive search error: ${error.message}`);
      return 0;
    }
  }

  /**
   * Diagnóstico completo de todos los motores de búsqueda.
   * Ejecuta una query de prueba real en cada motor y reporta status.
   */
  private async saveSocialScraperEvidence(searchId: string, responses: any[]): Promise<number> {
    let saved = 0;

    for (const response of responses.filter(Boolean)) {
      for (const profile of response.profiles || []) {
        const platform = profile.platform || 'social';
        const url = profile.profileUrl || profile.url;
        if (!url) continue;

        await this.evidenceService.saveEvidence(searchId, {
          source: `social_scraper_${platform}`,
          url,
          title: `${platform} profile ${profile.username ? `@${profile.username}` : profile.name || ''}`.trim(),
          summary: profile.bio || profile.name || `Perfil social candidato encontrado por osint-social-scraper`,
          category: 'social',
          reliability: profile.source === 'api' ? 0.85 : 0.65,
          imageUrl: profile.avatarUrl,
          thumbnailUrl: profile.avatarUrl,
          matchConfidence: profile.confidence || 0.5,
          rawData: profile,
          extractedData: {
            urls: [url],
            socialProfiles: [{ platform, url, username: profile.username }],
            source: profile.source,
          },
        } as any).catch(() => null);
        saved++;
      }

      for (const match of response.matches || []) {
        const url = match.publicUrl || match.relativePath;
        if (!url) continue;

        await this.evidenceService.saveEvidence(searchId, {
          source: `social_scraper_image_${match.platform || 'social'}`,
          url,
          title: `Imagen social similar — ${match.platform || 'social'} / ${match.owner || 'unknown'}`,
          summary: `Coincidencia visual local con score ${match.score ?? 0}`,
          category: 'identity',
          reliability: 0.7,
          imageUrl: match.publicUrl,
          thumbnailUrl: match.publicUrl,
          matchConfidence: match.similarity || (match.score || 0) / 100,
          rawData: match,
          extractedData: {
            urls: [url],
            socialPlatform: match.platform,
            owner: match.owner,
            source: 'osint-social-scraper',
          },
        } as any).catch(() => null);
        saved++;
      }
    }

    return saved;
  }

  async runDiagnostics(testQuery = 'test'): Promise<Record<string, any>> {
    this.logger.log(`🩺 Running search engine diagnostics with query: "${testQuery}"...`);
    const results: Record<string, any> = {};

    // 1. Serper
    results.serper = { available: this.serperSearchService.isAvailable() };
    if (results.serper.available) {
      try {
        const r = await this.serperSearchService.search('__diag__', testQuery, { maxResults: 2 });
        // Serper service returns empty response on auth/rate failures (does not throw).
        // Use responseTime as success signal: >0 means the HTTP call completed.
        results.serper.status = r.responseTime > 0 ? 'ok' : 'request_failed';
        results.serper.resultCount = r.results?.length ?? 0;
        results.serper.responseTime = r.responseTime;
        if (r.responseTime === 0) {
          results.serper.error = 'No successful response from Serper (invalid key, rate limit, or network error).';
        }
      } catch (e) {
        results.serper.status = 'error';
        results.serper.error = e.message;
      }
    } else {
      results.serper.status = 'no_api_key';
    }

    // 2. SearXNG
    try {
      const stats = this.searxngSearchService.getInstanceStats();
      results.searxng = { instancesTotal: stats.total, instancesAvailable: stats.available, failedInstances: stats.failed };
      const r = await this.searxngSearchService.search('__diag__', testQuery, { maxResults: 3 });
      results.searxng.status = r.instanceUsed !== 'none' ? 'ok' : 'all_instances_failed';
      results.searxng.resultCount = r.totalResults;
      results.searxng.instanceUsed = r.instanceUsed;
      results.searxng.engines = r.engines;
    } catch (e) {
      results.searxng = { ...results.searxng, status: 'error', error: e.message };
    }

    // 3. DuckDuckGo
    try {
      const r = await this.duckduckgoSearchService.search('__diag__', testQuery, { maxResults: 3 });
      results.duckduckgo = { status: r.results.length > 0 ? 'ok' : 'no_results', resultCount: r.totalResults };
    } catch (e) {
      results.duckduckgo = { status: 'error', error: e.message };
    }

    // 4. Bing
    results.bing = { available: this.bingSearchService.isAvailable() };
    if (results.bing.available) {
      try {
        const r = await this.bingSearchService.search('__diag__', testQuery, { count: 2 });
        results.bing.status = 'ok';
        results.bing.resultCount = r.results?.length ?? 0;
      } catch (e) {
        results.bing.status = 'error';
        results.bing.error = e.message;
      }
    } else {
      results.bing.status = 'no_api_key';
    }

    // 5. Tavily
    results.tavily = { available: this.tavilySearchService.isAvailable() };
    if (results.tavily.available) {
      try {
        const r = await this.tavilySearchService.search('__diag__', testQuery, { maxResults: 2 });
        results.tavily.status = 'ok';
        results.tavily.resultCount = r.results?.length ?? 0;
      } catch (e) {
        results.tavily.status = 'error';
        results.tavily.error = e.message;
      }
    } else {
      results.tavily.status = 'no_api_key';
    }

    // 5b. Brave Search
    results.brave = { available: this.braveSearchService.isAvailable() };
    if (results.brave.available) {
      try {
        const r = await this.braveSearchService.search('__diag__', testQuery, { maxResults: 2 });
        results.brave.status = 'ok';
        results.brave.resultCount = r.results?.length ?? 0;
        results.brave.responseTime = r.responseTime;
      } catch (e) {
        results.brave.status = 'error';
        results.brave.error = e.message;
      }
    } else {
      results.brave.status = 'no_api_key';
    }

    // 6. YouTube
    results.youtube = { available: this.youtubeSearchService.isAvailable() };
    results.youtube.status = results.youtube.available ? 'configured' : 'no_api_key';

    // 7. Meta (Facebook)
    results.meta = { available: this.metaIntelligenceService.isAvailable() };
    results.meta.status = results.meta.available ? 'configured' : 'no_api_key';

    // 8. Instagram
    results.instagram = { available: this.instagramIntelligenceService.isAvailable() };
    results.instagram.status = results.instagram.available ? 'configured' : 'no_api_key';

    // 8b. Social Scraper agregado
    results.socialScraper = await this.socialScraperClient.healthCheck();
    results.socialScraper.status = results.socialScraper.available ? 'configured' : 'not_configured';

    // 9. Network scheduler stats
    results.networkScheduler = this.networkScheduler.getStats();

    // Summary
    const working = Object.entries(results)
      .filter(([k, v]) => k !== 'networkScheduler' && v.status === 'ok')
      .map(([k]) => k);
    const configured = Object.entries(results)
      .filter(([k, v]) => k !== 'networkScheduler' && v.status === 'configured')
      .map(([k]) => k);
    const failed = Object.entries(results)
      .filter(([k, v]) => k !== 'networkScheduler' && !['ok', 'configured'].includes(v.status))
      .map(([k, v]) => `${k}: ${v.status || 'unknown'}`);

    results._summary = {
      workingEngines: working,
      configuredEngines: configured,
      failedEngines: failed,
      totalWorking: working.length,
      totalConfigured: configured.length,
      totalFailed: failed.length,
      recommendation: working.length === 0
        ? 'CRITICAL: No search engines working. Get a valid API key from https://serper.dev (free 2500/month) or https://brave.com/search/api/ (free 2000/month)'
        : working.length < 3
          ? 'WARNING: Few engines working. Consider adding more API keys for better coverage.'
          : 'OK: Multiple engines online.',
    };

    this.logger.log(`🩺 Diagnostics complete: ${working.length} working, ${failed.length} failed`);
    return results;
  }
}
