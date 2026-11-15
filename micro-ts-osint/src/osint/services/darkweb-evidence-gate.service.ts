import { Injectable, Logger } from '@nestjs/common';
import {
  DarkWebSearchResult,
  DarkWebScrapedPage,
} from '../dto/darkweb-search.dto';

// ══════════════════════════════════════════════════
//  TYPES
// ══════════════════════════════════════════════════

/** Entidades extraídas por regex (determinístico, NO LLM) */
export interface ExtractedEntities {
  emails: string[];
  btcWallets: string[];
  xmrWallets: string[];
  ethWallets: string[];
  pgpFingerprints: string[];
  telegramHandles: string[];
  sessionIds: string[];
  onionDomains: string[];
  ipAddresses: string[];
  phoneNumbers: string[];
}

/** Snippet con contexto alrededor del match */
export interface EvidenceSnippet {
  /** Texto del snippet (±500 chars alrededor del match) */
  text: string;
  /** Offset en el texto limpio */
  offset: number;
  /** Variante que hizo match */
  matchedVariant: string;
  /** Ubicación del match */
  location: 'title' | 'h1' | 'body' | 'url';
}

/** Resultado del Evidence Gate por página */
export interface EvidenceGateResult {
  url: string;
  title: string;
  /** ¿Pasó el gate? (alias encontrado literal) */
  passed: boolean;
  /** Score de relevancia (0-200+) */
  score: number;
  /** Razón de descarte si no pasó */
  discardReason?: string;
  /** Snippets con evidencia */
  snippets: EvidenceSnippet[];
  /** Entidades extraídas (regex, determinístico) */
  entities: ExtractedEntities;
  /** Categoría de la URL */
  urlCategory: 'noise' | 'directory' | 'search_engine' | 'marketplace' | 'content';
}

/** Resumen del gate para logging */
export interface EvidenceGateSummary {
  totalPages: number;
  passed: number;
  discarded: number;
  discardReasons: Record<string, number>;
  topScores: { url: string; score: number }[];
}

// ══════════════════════════════════════════════════
//  NOISE URL PATTERNS
// ══════════════════════════════════════════════════

const NOISE_URL_PATTERNS: { pattern: RegExp; category: string; penalty: number }[] = [
  { pattern: /\/tag\//i, category: 'tag_page', penalty: -60 },
  { pattern: /\/product-tag\//i, category: 'product_tag', penalty: -60 },
  { pattern: /\/category\//i, category: 'category_page', penalty: -50 },
  { pattern: /\/search\?/i, category: 'search_internal', penalty: -80 },
  { pattern: /[?&]ad=/i, category: 'ad_redirect', penalty: -80 },
  { pattern: /[?&]k=[a-f0-9]{5}/i, category: 'ad_tracking', penalty: -70 },
  { pattern: /\/webmaster/i, category: 'webmaster_page', penalty: -40 },
  { pattern: /\/sitemap/i, category: 'sitemap', penalty: -50 },
  { pattern: /\/robots\.txt/i, category: 'robots', penalty: -50 },
  { pattern: /\/favicon/i, category: 'asset', penalty: -50 },
];

const DIRECTORY_PATTERNS = [
  /\/directory/i,
  /\/listing/i,
  /\/index\.html?$/i,
  /\/$/, // Only root pages
];

const SEARCH_ENGINE_HOSTS = [
  'ahmia', 'torgle', 'tor66', 'amnesia', 'phobos',
  'excavator', 'onionland', 'grams', 'kilos',
  'torland', 'torch', 'haystak', 'recon', 'darknetlive',
  'deeplink', 'onionsearch', 'darksearch', 'tordex',
];

/**
 * Detecta si una URL es una SERP (Search Engine Results Page)
 * que contiene el alias como query parameter → evidencia CIRCULAR.
 * Ejemplo: torland.onion/index.php?a=search&q=operador-demo
 */
const SERP_QUERY_PARAMS = ['q', 'query', 'search', 'keyword', 's', 'k', 'term', 'find'];

// ══════════════════════════════════════════════════
//  ENTITY REGEX PATTERNS
// ══════════════════════════════════════════════════

const ENTITY_PATTERNS = {
  email: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
  btcWallet: /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/g,
  xmrWallet: /\b4[0-9AB][1-9A-HJ-NP-Za-km-z]{93,}\b/g,
  ethWallet: /\b0x[a-fA-F0-9]{40}\b/g,
  pgpFingerprint: /[A-F0-9]{4}\s?[A-F0-9]{4}\s?[A-F0-9]{4}\s?[A-F0-9]{4}\s?[A-F0-9]{4}\s?[A-F0-9]{4}\s?[A-F0-9]{4}\s?[A-F0-9]{4}\s?[A-F0-9]{4}\s?[A-F0-9]{4}/g,
  telegram: /@[a-zA-Z][a-zA-Z0-9_]{4,31}/g,
  sessionId: /\b05[a-f0-9]{64}\b/g,
  onionDomain: /[a-z2-7]{16,56}\.onion/gi,
  ipAddress: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  phone: /(?:\+?\d{1,3}[\s.-]?)?\(?\d{1,4}\)?[\s.-]?\d{1,4}[\s.-]?\d{1,9}/g,
};

// ══════════════════════════════════════════════════
//  SERVICE
// ══════════════════════════════════════════════════

/**
 * DarkWebEvidenceGateService — Filtrado determinístico ANTES del LLM 🔐
 *
 * Principio: El LLM NO es el investigador. Es el redactor.
 * El cerebro es lógica determinística.
 *
 * Pipeline:
 *  1. Generar variantes del alias (exact, separators, etc.)
 *  2. Clasificar URL (noise/directory/search/marketplace/content)
 *  3. Buscar match literal del alias en el contenido
 *  4. Calcular score de relevancia
 *  5. Extraer snippets ±500 chars alrededor del match
 *  6. Extraer entidades con regex (emails, wallets, PGP, etc.)
 *  7. Pasar/Descartar con razón
 *
 * Si score < threshold → NO se manda al LLM.
 * Si alias no aparece literal → NO se manda al LLM.
 */
@Injectable()
export class DarkWebEvidenceGateService {
  private readonly logger = new Logger(DarkWebEvidenceGateService.name);

  /** Threshold mínimo para pasar al LLM */
  private readonly PASS_THRESHOLD = 50;
  /** Chars de contexto a cada lado del match */
  private readonly SNIPPET_WINDOW = 500;
  /** Max snippets por página */
  private readonly MAX_SNIPPETS_PER_PAGE = 3;

  /**
   * Genera variantes controladas del alias para búsqueda literal.
   * No genera variaciones explosivas para evitar ruido.
   */
  generateAliasVariants(alias: string): string[] {
    const clean = alias.trim().toLowerCase();
    const variants = new Set<string>();

    // Exact
    variants.add(clean);

    // Con separadores comunes
    // Si tiene números pegados a letras, separar
    const letterNumberSplit = clean.replace(/([a-z])(\d)/g, '$1_$2')
      .replace(/(\d)([a-z])/g, '$1_$2');
    if (letterNumberSplit !== clean) {
      variants.add(letterNumberSplit); // deco_3416
      variants.add(letterNumberSplit.replace(/_/g, '-')); // deco-3416
      variants.add(letterNumberSplit.replace(/_/g, '.')); // deco.3416
    }

    // Variante con guión bajo directo
    if (!clean.includes('_') && !clean.includes('-')) {
      // Solo para aliases tipo "username123"
      variants.add(clean.replace(/(\D)(\d)/g, '$1_$2'));
      variants.add(clean.replace(/(\D)(\d)/g, '$1-$2'));
    }

    return Array.from(variants);
  }

  /**
   * Procesa todos los resultados scrapeados a través del Evidence Gate.
   * Retorna solo los que pasan + summary de todo lo descartado.
   */
  processAll(
    alias: string,
    pages: DarkWebScrapedPage[],
    searchResults: DarkWebSearchResult[],
  ): { passed: EvidenceGateResult[]; summary: EvidenceGateSummary } {
    const variants = this.generateAliasVariants(alias);
    const discardReasons: Record<string, number> = {};
    const allResults: EvidenceGateResult[] = [];

    this.logger.log(`🔐 Evidence Gate: processing ${pages.length} pages for alias "${alias}"`);
    this.logger.log(`   Variants: [${variants.join(', ')}]`);

    for (const page of pages) {
      const result = this.processPage(page, variants, searchResults);
      allResults.push(result);

      if (!result.passed && result.discardReason) {
        discardReasons[result.discardReason] = (discardReasons[result.discardReason] || 0) + 1;
      }
    }

    // Ordenar por score descendente
    allResults.sort((a, b) => b.score - a.score);

    const passed = allResults.filter((r) => r.passed);
    const topScores = allResults
      .slice(0, 5)
      .map((r) => ({ url: this.truncateUrl(r.url), score: r.score }));

    const summary: EvidenceGateSummary = {
      totalPages: pages.length,
      passed: passed.length,
      discarded: pages.length - passed.length,
      discardReasons,
      topScores,
    };

    this.logger.log(`🔐 Evidence Gate results:`);
    this.logger.log(`   Passed: ${passed.length}/${pages.length}`);
    this.logger.log(`   Discarded: ${summary.discarded} — reasons: ${JSON.stringify(discardReasons)}`);

    if (passed.length > 0) {
      this.logger.log(`   Top scores: ${topScores.map((s) => `${s.url}(${s.score})`).join(', ')}`);
    }

    return { passed, summary };
  }

  /**
   * Procesa una página individual.
   */
  private processPage(
    page: DarkWebScrapedPage,
    variants: string[],
    searchResults: DarkWebSearchResult[],
  ): EvidenceGateResult {
    const url = page.url;
    const title = page.title || '';
    const content = page.content || '';
    const fullText = `${title} ${content}`.toLowerCase();

    // 1. Clasificar URL
    const urlCategory = this.classifyUrl(url);

    // 2. Detectar SERP circular — alias aparece como query param en URL de buscador
    const isSerpCircular = this.isSerpCircular(url, variants);
    if (isSerpCircular) {
      return {
        url, title, passed: false, score: 0,
        discardReason: 'serp_circular: alias en query param de buscador (evidencia circular)',
        snippets: [], entities: this.emptyEntities(),
        urlCategory: 'search_engine',
      };
    }

    // 3. Si la página tuvo error de scraping, descartar
    if (page.error && !content) {
      return {
        url, title, passed: false, score: 0,
        discardReason: `scrape_error: ${page.error}`,
        snippets: [], entities: this.emptyEntities(),
        urlCategory,
      };
    }

    // 3. Calcular penalties por URL
    let urlPenalty = 0;
    for (const noise of NOISE_URL_PATTERNS) {
      if (noise.pattern.test(url)) {
        urlPenalty += noise.penalty;
      }
    }

    // 4. Buscar matches literales del alias
    let matchScore = 0;
    let bestLocation: 'title' | 'h1' | 'body' | 'url' = 'body';
    const snippets: EvidenceSnippet[] = [];

    for (const variant of variants) {
      const variantLower = variant.toLowerCase();

      // Match en URL
      if (url.toLowerCase().includes(variantLower)) {
        matchScore = Math.max(matchScore, 30);
        bestLocation = 'url';
      }

      // Match en título
      if (title.toLowerCase().includes(variantLower)) {
        matchScore = Math.max(matchScore, variant === variants[0] ? 120 : 90);
        bestLocation = 'title';
        snippets.push({
          text: title,
          offset: title.toLowerCase().indexOf(variantLower),
          matchedVariant: variant,
          location: 'title',
        });
      }

      // Match en contenido
      const contentLower = content.toLowerCase();
      let searchStart = 0;
      let matchCount = 0;

      while (
        searchStart < contentLower.length &&
        matchCount < this.MAX_SNIPPETS_PER_PAGE
      ) {
        const idx = contentLower.indexOf(variantLower, searchStart);
        if (idx === -1) break;

        // Score por match en body
        if (matchScore < 120) {
          matchScore = Math.max(matchScore, variant === variants[0] ? 70 : 50);
        }

        // Extraer snippet ±500 chars
        const snippetStart = Math.max(0, idx - this.SNIPPET_WINDOW);
        const snippetEnd = Math.min(contentLower.length, idx + variant.length + this.SNIPPET_WINDOW);
        const snippetText = content.substring(snippetStart, snippetEnd);

        // Evitar duplicados
        const isDuplicate = snippets.some(
          (s) => Math.abs(s.offset - idx) < 200,
        );

        if (!isDuplicate) {
          snippets.push({
            text: snippetText,
            offset: idx,
            matchedVariant: variant,
            location: 'body',
          });
          matchCount++;
        }

        searchStart = idx + variant.length;
      }
    }

    // 5. Context score — bonus si el match está cerca de entidades relevantes
    let contextScore = 0;
    const entities = this.extractEntities(fullText);

    // Si hay alias + entidad cerca, bonus
    if (matchScore > 0) {
      if (entities.emails.length > 0) contextScore += 30;
      if (entities.btcWallets.length > 0 || entities.xmrWallets.length > 0 || entities.ethWallets.length > 0) contextScore += 40;
      if (entities.pgpFingerprints.length > 0) contextScore += 40;
      if (entities.telegramHandles.length > 0) contextScore += 20;
    }

    // Bonus por keyword de contexto relevante
    const contextKeywords = ['profile', 'user', 'vendor', 'contact', 'pgp', 'wallet', 'member', 'registered', 'joined', 'feedback', 'reputation'];
    for (const kw of contextKeywords) {
      if (fullText.includes(kw)) {
        contextScore += 5;
      }
    }

    // 6. Score final
    const totalScore = matchScore + contextScore + urlPenalty;

    // 7. Decisión
    const passed = matchScore > 0 && totalScore >= this.PASS_THRESHOLD;
    let discardReason: string | undefined;

    if (matchScore === 0) {
      discardReason = 'no_literal_match';
    } else if (totalScore < this.PASS_THRESHOLD) {
      discardReason = `low_score_${totalScore}`;
    }

    return {
      url,
      title,
      passed,
      score: totalScore,
      discardReason,
      snippets: snippets.slice(0, this.MAX_SNIPPETS_PER_PAGE),
      entities,
      urlCategory,
    };
  }

  /**
   * Clasifica una URL por tipo.
   */
  private classifyUrl(url: string): EvidenceGateResult['urlCategory'] {
    const urlLower = url.toLowerCase();

    // Es motor de búsqueda .onion?
    for (const host of SEARCH_ENGINE_HOSTS) {
      if (urlLower.includes(host)) return 'search_engine';
    }

    // Es directorio?
    for (const pat of DIRECTORY_PATTERNS) {
      if (pat.test(urlLower)) return 'directory';
    }

    // Noise patterns
    for (const noise of NOISE_URL_PATTERNS) {
      if (noise.pattern.test(url)) return 'noise';
    }

    return 'content';
  }

  /**
   * Extrae entidades con regex (determinístico, NO LLM).
   */
  extractEntities(text: string): ExtractedEntities {
    const dedupe = (arr: string[]) => [...new Set(arr)];
    const match = (pattern: RegExp): string[] => text.match(pattern) || [];

    return {
      emails: dedupe(match(ENTITY_PATTERNS.email)
        .filter((e: string) => !e.endsWith('.onion') && !e.includes('example'))),
      btcWallets: dedupe(match(ENTITY_PATTERNS.btcWallet)),
      xmrWallets: dedupe(match(ENTITY_PATTERNS.xmrWallet)),
      ethWallets: dedupe(match(ENTITY_PATTERNS.ethWallet)),
      pgpFingerprints: dedupe(match(ENTITY_PATTERNS.pgpFingerprint)),
      telegramHandles: dedupe(match(ENTITY_PATTERNS.telegram)),
      sessionIds: dedupe(match(ENTITY_PATTERNS.sessionId)),
      onionDomains: dedupe(match(ENTITY_PATTERNS.onionDomain)),
      ipAddresses: dedupe(match(ENTITY_PATTERNS.ipAddress)
        .filter((ip: string) => !ip.startsWith('127.') && !ip.startsWith('0.'))),
      phoneNumbers: [], // Too noisy to auto-extract, leave for targeted extraction
    };
  }

  /**
   * Formatea los resultados que pasaron el gate para el LLM.
   * Solo envía: URL, título, score, snippets con match, entidades extraídas.
   * NUNCA envía HTML completo ni páginas sin match.
   */
  formatForLLM(
    alias: string,
    results: EvidenceGateResult[],
  ): string {
    if (results.length === 0) {
      return `No evidence found for alias "${alias}" in any of the analyzed dark web pages.`;
    }

    const lines: string[] = [];
    lines.push(`=== EVIDENCE FOR ALIAS: "${alias}" ===\n`);

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      lines.push(`--- Evidence ${i + 1} (Score: ${r.score}) ---`);
      lines.push(`URL: ${r.url}`);
      lines.push(`Title: ${r.title}`);
      lines.push(`URL Category: ${r.urlCategory}`);

      // Snippets (solo el texto alrededor del match)
      if (r.snippets.length > 0) {
        lines.push(`Literal matches found (${r.snippets.length}):`);
        for (const s of r.snippets) {
          lines.push(`  [${s.location}] Match "${s.matchedVariant}":`);
          lines.push(`  "${s.text}"`);
        }
      }

      // Entidades detectadas
      const entityLines: string[] = [];
      if (r.entities.emails.length) entityLines.push(`  Emails: ${r.entities.emails.join(', ')}`);
      if (r.entities.btcWallets.length) entityLines.push(`  BTC Wallets: ${r.entities.btcWallets.join(', ')}`);
      if (r.entities.xmrWallets.length) entityLines.push(`  XMR Wallets: ${r.entities.xmrWallets.join(', ')}`);
      if (r.entities.ethWallets.length) entityLines.push(`  ETH Wallets: ${r.entities.ethWallets.join(', ')}`);
      if (r.entities.pgpFingerprints.length) entityLines.push(`  PGP Fingerprints: ${r.entities.pgpFingerprints.join(', ')}`);
      if (r.entities.telegramHandles.length) entityLines.push(`  Telegram: ${r.entities.telegramHandles.join(', ')}`);
      if (r.entities.onionDomains.length) entityLines.push(`  Onion Domains: ${r.entities.onionDomains.slice(0, 5).join(', ')}`);

      if (entityLines.length > 0) {
        lines.push(`Entities detected (regex):`);
        lines.push(...entityLines);
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Formatea el reporte de "NO ENCONTRADO" con métricas.
   */
  formatNoMatchReport(
    alias: string,
    summary: EvidenceGateSummary,
    timing: { searchMs: number; scrapeMs: number },
    confidence?: { score: number; label: string },
  ): string {
    const confScore = confidence?.score ?? 0;
    const confLabel = confidence?.label ?? 'N/A';
    const lines: string[] = [];
    lines.push(`## Dark Web Intelligence Report\n`);
    lines.push(`### Alias Buscado: \`${alias}\`\n`);
    lines.push(`### Resultado: NO ENCONTRADO\n`);
    lines.push(`No se encontró evidencia literal del alias **"${alias}"** en ninguna de las ${summary.totalPages} páginas dark web analizadas.\n`);
    lines.push(`### Métricas de Búsqueda`);
    lines.push(`- Páginas analizadas: ${summary.totalPages}`);
    lines.push(`- Coincidencias literales: 0`);
    lines.push(`- Descartadas: ${summary.discarded}`);

    if (Object.keys(summary.discardReasons).length > 0) {
      lines.push(`\n### Razones de Descarte`);
      for (const [reason, count] of Object.entries(summary.discardReasons)) {
        lines.push(`- ${reason}: ${count}`);
      }
    }

    lines.push(`\n### Tiempos`);
    lines.push(`- Búsqueda: ${Math.round(timing.searchMs / 1000)}s`);
    lines.push(`- Scraping: ${Math.round(timing.scrapeMs / 1000)}s`);

    lines.push(`\n### Nivel de Confianza`);
    lines.push(`**${confLabel}** (${confScore}%) — Limitado por cobertura de motores .onion disponibles y latencia de la red Tor.`);
    lines.push(`\n> El alias no fue encontrado en la muestra analizada. Esto no garantiza ausencia total en la dark web.`);

    return lines.join('\n');
  }

  /**
   * Detecta si una URL es una SERP circular.
   * Una SERP circular es cuando un motor de búsqueda .onion muestra al alias
   * como resultado de búsqueda PORQUE el usuario lo buscó — no porque exista.
   * Ej: torland.onion/index.php?a=search&q=operador-demo
   */
  private isSerpCircular(url: string, variants: string[]): boolean {
    const urlLower = url.toLowerCase();

    // 1. Verificar si la URL tiene query params que contienen el alias
    try {
      const urlObj = new URL(url);
      for (const paramName of SERP_QUERY_PARAMS) {
        const paramValue = urlObj.searchParams.get(paramName);
        if (paramValue) {
          const paramLower = paramValue.toLowerCase();
          for (const variant of variants) {
            if (paramLower.includes(variant.toLowerCase())) {
              this.logger.debug(`🚫 SERP circular: "${variant}" en param ?${paramName}= de ${url.substring(0, 80)}`);
              return true;
            }
          }
        }
      }
      // Check para params no estándar (ej: ?a=search&q=alias)
      if (urlObj.searchParams.has('a') && 
          ['search', 'buscar', 'find', 'query'].includes(urlObj.searchParams.get('a')?.toLowerCase() || '')) {
        for (const [, value] of urlObj.searchParams) {
          for (const variant of variants) {
            if (value.toLowerCase().includes(variant.toLowerCase())) {
              this.logger.debug(`🚫 SERP circular (param custom): "${variant}" en ${url.substring(0, 80)}`);
              return true;
            }
          }
        }
      }
    } catch {
      // URL parsing failed, use regex fallback
    }

    // 2. Regex fallback: ?q=alias o &search=alias
    for (const variant of variants) {
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const serpRegex = new RegExp(`[?&](?:${SERP_QUERY_PARAMS.join('|')})=${escaped}`, 'i');
      if (serpRegex.test(urlLower)) {
        return true;
      }
    }

    // 3. Si es un search engine host conocido, verificar si el alias está en el path/query
    const isSearchEngine = SEARCH_ENGINE_HOSTS.some(h => urlLower.includes(h));
    if (isSearchEngine) {
      for (const variant of variants) {
        // Si el alias aparece después de ? o en un path /search/alias
        if (urlLower.includes(`/${variant.toLowerCase()}`) || 
            urlLower.includes(`=${variant.toLowerCase()}`)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Verifica si una URL es una SERP circular (público, para uso en pipeline).
   */
  isSerpUrl(url: string, alias: string): boolean {
    const variants = this.generateAliasVariants(alias);
    return this.isSerpCircular(url, variants);
  }

  private emptyEntities(): ExtractedEntities {
    return {
      emails: [], btcWallets: [], xmrWallets: [], ethWallets: [],
      pgpFingerprints: [], telegramHandles: [], sessionIds: [],
      onionDomains: [], ipAddresses: [], phoneNumbers: [],
    };
  }

  private truncateUrl(url: string): string {
    try {
      const u = new URL(url);
      const host = u.hostname.length > 20
        ? u.hostname.substring(0, 17) + '...'
        : u.hostname;
      return `${host}${u.pathname.substring(0, 20)}`;
    } catch {
      return url.substring(0, 40);
    }
  }
}
