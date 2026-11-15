import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import axios from 'axios';
import {
  GroqKeyRotationService,
  GroqModelType,
} from './groq-key-rotation.service';
import { DarkWebSearchService } from './darkweb-search.service';
import { DarkWebScraperService } from './darkweb-scraper.service';
import {
  DarkWebEvidenceGateService,
  EvidenceGateResult,
  EvidenceGateSummary,
} from './darkweb-evidence-gate.service';
import {
  DarkWebSearchDto,
  DarkWebSearchResult,
  DarkWebScrapedPage,
  DarkWebPipelineResponse,
  EvidenceGateResponseSummary,
  LiteralEvidence,
  DetectedEntity,
  CoverageStats,
} from '../dto/darkweb-search.dto';
import {
  DARKWEB_REFINE_QUERY_PROMPT,
  DARKWEB_FILTER_RESULTS_PROMPT,
  DARKWEB_ANALYSIS_PRESETS,
  DarkWebAnalysisPreset,
} from '../constants/darkweb-prompts';

/** Modelo para las 3 llamadas de IA (texto, razonamiento rápido) */
const DARKWEB_GROQ_MODEL = 'llama-3.3-70b-versatile';

/** Máximo de caracteres de contenido a enviar a Groq para el reporte */
const MAX_REPORT_CONTENT_CHARS = 12_000;

/** Timeout para cada llamada individual a Groq API (ms) */
const GROQ_CALL_TIMEOUT_MS = 45_000;

/**
 * DarkWebIntelligenceService — Coplito v2 🔥
 *
 * Pipeline de Dark Web Intelligence basado en EVIDENCIA:
 *
 *  [1] refine_query   →  Groq optimiza la query a ≤5 palabras
 *  [2] search         →  16 motores .onion via Tor (concurrente)
 *  [3] filter_results →  Groq selecciona top 20 más relevantes
 *  [4] scrape         →  Scraping .onion de los top 20 (concurrente)
 *  [5] evidence_gate  →  Match literal + scoring + snippets + entities (DETERMINÍSTICO)
 *  [6] report         →  Groq genera reporte SOLO si hay evidencia literal
 *
 * PRINCIPIO: El LLM es REDACTOR, no investigador.
 * El cerebro es lógica determinística (Evidence Gate).
 * Si no hay match literal del alias → NO se llama al LLM → "NO ENCONTRADO".
 *
 * Usa GroqKeyRotationService para las llamadas de IA (pool de keys).
 */
@Injectable()
export class DarkWebIntelligenceService {
  private readonly logger = new Logger(DarkWebIntelligenceService.name);
  private readonly GROQ_API_URL =
    'https://api.groq.com/openai/v1/chat/completions';

  constructor(
    private readonly httpService: HttpService,
    private readonly groqKeyRotation: GroqKeyRotationService,
    private readonly darkWebSearch: DarkWebSearchService,
    private readonly darkWebScraper: DarkWebScraperService,
    private readonly evidenceGate: DarkWebEvidenceGateService,
  ) {
    this.logger.log('🔥 DarkWebIntelligenceService v2 (Evidence-Based) initialized');
  }

  /**
   * Ejecuta el pipeline completo de Dark Web Intelligence.
   *
   * @param dto - Parámetros de búsqueda
   * @returns Resultado completo con reporte de inteligencia
   */
  async executePipeline(
    dto: DarkWebSearchDto,
  ): Promise<DarkWebPipelineResponse> {
    const pipelineStart = Date.now();
    const groqKeysUsed: number[] = [];
    const timing: DarkWebPipelineResponse['timing'] = { searchMs: 0 };

    this.logger.log('');
    this.logger.log('🔥 ═══════════════════════════════════════════════');
    this.logger.log('🔥  DARK WEB INTELLIGENCE PIPELINE v2 — COPLITO');
    this.logger.log(`🔥  Query: "${dto.query}"`);
    this.logger.log(`🔥  Preset: ${dto.preset || 'threat_intel'}`);
    this.logger.log('🔥  Mode: Evidence-Based (alias literal match required)');
    this.logger.log('🔥 ═══════════════════════════════════════════════');
    this.logger.log('');

    // ══════════════════════════════════════════════════
    // PASO 1: REFINAR QUERY (DETERMINÍSTICO o IA)
    // ══════════════════════════════════════════════════
    let refinedQuery = dto.query;

    if (dto.refineQuery !== false) {
      this.logger.log('🧠 [1/6] Refinando query...');
      const refineStart = Date.now();

      // v2.1: Refine DETERMINÍSTICO — no gastar Groq call
      // El alias se mantiene intacto + se agregan palabras clave genéricas
      const aliasParts = dto.query.trim().split(/\s+/);
      if (aliasParts.length <= 2) {
        // Alias corto (un handle/username) → agregar contexto
        refinedQuery = `${dto.query} site profile`;
      } else {
        // Ya tiene contexto, usar tal cual
        refinedQuery = dto.query;
      }

      timing.refineMs = Date.now() - refineStart;
      this.logger.log(
        `   ✅ Query refinada (determinístico): "${dto.query}" → "${refinedQuery}" (${timing.refineMs}ms, 0 tokens)`,
      );
    }

    // ══════════════════════════════════════════════════
    // PASO 2: BUSCAR EN 16 MOTORES DARK WEB VIA TOR
    // ══════════════════════════════════════════════════
    this.logger.log('🧅 [2/6] Buscando en 16 motores dark web via Tor...');
    const searchStart = Date.now();

    const searchResult = await this.darkWebSearch.searchAll(
      refinedQuery,
      dto.searchWorkers || 5,
    );

    timing.searchMs = Date.now() - searchStart;
    this.logger.log(
      `   ✅ ${searchResult.totalRaw} raw → ${searchResult.results.length} unique results (${timing.searchMs}ms)`,
    );

    // Early exit si no hay resultados
    if (searchResult.results.length === 0) {
      this.logger.warn('   ⚠️  No se encontraron resultados. Pipeline terminado.');
      return this.buildEmptyResponse(dto, refinedQuery, searchResult, groqKeysUsed, timing, pipelineStart);
    }

    // ══════════════════════════════════════════════════
    // PASO 3: PRE-GATE FILTER (DETERMINÍSTICO) 🔐
    // ══════════════════════════════════════════════════
    // v2.1: Filtrado por alias en título/URL/snippet ANTES de scrapear.
    // Elimina Groq call del filtrado. Solo scrapeamos lo relevante.
    let selectedResults = searchResult.results;
    let preGateDiscarded = 0;
    let preGatePassed = 0;

    {
      this.logger.log('🔐 [3/6] Pre-gate: filtrando por alias literal en título/URL/snippet...');
      const filterStart = Date.now();

      const variants = this.evidenceGate.generateAliasVariants(dto.query);
      const aliasRegex = new RegExp(
        variants.map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
        'i',
      );

      // Clasificar: con alias match vs sin match
      const withAlias: DarkWebSearchResult[] = [];
      const withoutAlias: DarkWebSearchResult[] = [];

      for (const r of searchResult.results) {
        const titleMatch = aliasRegex.test(r.title || '');
        const urlMatch = aliasRegex.test(r.link || '');
        const engineMatch = aliasRegex.test(r.engine || '');
        if (titleMatch || urlMatch || engineMatch) {
          withAlias.push(r);
        } else {
          withoutAlias.push(r);
        }
      }

      // Priorizar: primero los que tienen alias, luego rellenar hasta 20
      if (withAlias.length >= 20) {
        selectedResults = withAlias.slice(0, 20);
      } else {
        // Si hay pocos con alias, completar con otros (diversidad)
        selectedResults = [
          ...withAlias,
          ...withoutAlias.slice(0, 20 - withAlias.length),
        ];
      }

      preGatePassed = withAlias.length;
      preGateDiscarded = searchResult.results.length - withAlias.length;

      timing.preGateMs = Date.now() - filterStart;
      this.logger.log(
        `   ✅ Pre-gate: ${withAlias.length} con alias, ${withoutAlias.length} sin alias → ${selectedResults.length} seleccionadas (${timing.preGateMs}ms, 0 tokens)`,
      );
    }

    // ══════════════════════════════════════════════════
    // PASO 4: SCRAPING DE URLs .ONION
    // ══════════════════════════════════════════════════
    let scrapedPages: DarkWebScrapedPage[] = [];

    if (dto.scrapeContent !== false) {
      this.logger.log(
        `🕷️  [4/6] Scraping ${selectedResults.length} dark web pages...`,
      );
      const scrapeStart = Date.now();

      scrapedPages = await this.darkWebScraper.scrapeMultiple(
        selectedResults,
        dto.scrapeWorkers || 5,
        dto.maxCharsPerPage || 2000,
      );

      timing.scrapeMs = Date.now() - scrapeStart;
      const scraped = scrapedPages.filter((p) => !p.error).length;
      this.logger.log(
        `   ✅ ${scraped}/${selectedResults.length} páginas scrapeadas (${timing.scrapeMs}ms)`,
      );
    }

    // ══════════════════════════════════════════════════
    // PASO 5: EVIDENCE GATE (DETERMINÍSTICO, NO LLM) 🔐
    // ══════════════════════════════════════════════════
    this.logger.log('🔐 [5/6] Evidence Gate — verificando coincidencias literales del alias...');
    const gateStart = Date.now();

    const { passed: passedResults, summary: gateSummary } = this.evidenceGate.processAll(
      dto.query, // Usar query original (alias del usuario), NO la refinada
      scrapedPages,
      selectedResults,
    );

    timing.evidenceGateMs = Date.now() - gateStart;
    this.logger.log(
      `   🔐 Evidence Gate: ${passedResults.length}/${scrapedPages.length} pasaron (threshold ≥50) (${timing.evidenceGateMs}ms)`,
    );

    const aliasFound = passedResults.length > 0;

    // Convertir resultados del gate a formato de respuesta
    const literalEvidence = this.mapToLiteralEvidence(passedResults);
    const detectedEntities = this.collectAllEntities(passedResults);
    const evidenceGateResponse: EvidenceGateResponseSummary = {
      totalProcessed: gateSummary.totalPages,
      totalPassed: gateSummary.passed,
      totalDiscarded: gateSummary.discarded,
      discardReasons: gateSummary.discardReasons,
      topScores: gateSummary.topScores,
    };

    // ══════════════════════════════════════════════════
    // PASO 6: REPORTE DE INTELIGENCIA
    // ══════════════════════════════════════════════════
    let intelligenceReport: string | undefined;
    let reportSource: 'llm' | 'evidence_gate_no_match' = 'evidence_gate_no_match';

    if (aliasFound && dto.generateReport !== false) {
      // ─── HAY EVIDENCIA LITERAL → LLM como REDACTOR (no investigador) ───
      this.logger.log(`🧠 [6/6] ${passedResults.length} evidencias → Groq IA genera reporte basado en evidencia...`);
      const reportStart = Date.now();

      try {
        // Enviar SOLO snippets+entidades (no HTML completo)
        const evidenceForLLM = this.evidenceGate.formatForLLM(dto.query, passedResults);

        intelligenceReport = await this.generateReport(
          dto.query, // Usar query original (alias del usuario)
          evidenceForLLM,
          (dto.preset as DarkWebAnalysisPreset) || 'threat_intel',
          dto.customInstructions,
          groqKeysUsed,
        );
        reportSource = 'llm';
        timing.reportMs = Date.now() - reportStart;
        this.logger.log(
          `   ✅ Reporte LLM generado: ${intelligenceReport.length} chars (${timing.reportMs}ms)`,
        );
      } catch (error: any) {
        timing.reportMs = Date.now() - reportStart;
        this.logger.error(
          `   ❌ Generación de reporte LLM falló: ${error.message}. Generando reporte determinístico.`,
        );
        // Fallback: generar reporte básico con evidencia pero sin LLM
        intelligenceReport = this.buildFallbackReport(dto.query, passedResults, gateSummary);
        reportSource = 'evidence_gate_no_match';
      }
    }
    // Nota: si !aliasFound, el reporte NO ENCONTRADO se genera DESPUÉS del cálculo de confidence (ver abajo)

    const totalTimeMs = Date.now() - pipelineStart;

    // ══════════════════════════════════════════════════
    // COVERAGE STATS v2.1
    // ══════════════════════════════════════════════════
    const enginesUp = searchResult.engineStatuses.filter(e => e.status === 'up').length;
    const enginesDown = searchResult.engineStatuses.filter(e => e.status === 'down').length;
    const enginesTimeout = searchResult.engineStatuses.filter(e => e.status === 'timeout').length;
    const totalEngines = searchResult.engineStatuses.length;
    const scrapeAttempted = scrapedPages.length;
    const scrapeOk = scrapedPages.filter(p => !p.error).length;

    const coverageStats: CoverageStats = {
      totalEngines,
      enginesUp,
      enginesDown,
      enginesTimeout,
      engineCoveragePct: totalEngines > 0 ? Math.round((enginesUp / totalEngines) * 100) : 0,
      scrapeSuccessRate: scrapeAttempted > 0 ? Math.round((scrapeOk / scrapeAttempted) * 100) : 0,
      preGateDiscarded,
      preGatePassed,
    };

    // ══════════════════════════════════════════════════
    // CONFIDENCE SCORE v2.1 (matemático)
    // ══════════════════════════════════════════════════
    // Fórmula: coverage × depth × health × evidence_factor
    //
    // coverage (0-1): % motores que respondieron
    // depth (0-1): % páginas scrapeadas con éxito vs intentadas
    // health (0-1): penaliza timeouts y errores proxy
    // evidence_factor: bonus si se encontró evidencia literal
    //
    const coverageFactor = totalEngines > 0 ? enginesUp / totalEngines : 0;
    const depthFactor = scrapeAttempted > 0 ? scrapeOk / scrapeAttempted : 0;
    const healthFactor = totalEngines > 0
      ? Math.max(0, 1 - (enginesTimeout * 0.1 + enginesDown * 0.05))
      : 0;
    const resultDiversity = Math.min(1, searchResult.results.length / 50); // Diversidad de resultados (cap a 50)

    // ── Base score (cobertura técnica) ──
    const baseScore = (
      coverageFactor * 0.30 +  // 30% peso cobertura de motores
      depthFactor * 0.25 +     // 25% peso profundidad de scraping
      healthFactor * 0.20 +    // 20% peso salud de la red
      resultDiversity * 0.25   // 25% peso diversidad de resultados
    ) * 100;

    // ── Evidence quality factor ──
    // Detectar SERP circulares entre las evidencias
    const serpCount = passedResults.filter(r => r.urlCategory === 'search_engine').length;
    const realEvidence = passedResults.length - serpCount;

    let evidenceFactor: number;
    if (!aliasFound || passedResults.length === 0) {
      // Sin evidencia → score refleja solo calidad de cobertura (cap 40%)
      evidenceFactor = 0.4;
    } else if (realEvidence === 0 && serpCount > 0) {
      // SOLO SERPs circulares → casi nulo (cap 15%)
      evidenceFactor = 0.15;
    } else if (realEvidence === 1) {
      // 1 fuente real → cap 55%
      evidenceFactor = 0.55;
    } else if (realEvidence === 2) {
      // 2 fuentes reales → cap 75%
      evidenceFactor = 0.75;
    } else {
      // 3+ fuentes reales → full score con bonus
      evidenceFactor = 1.0 + (realEvidence - 3) * 0.05; // +5% por fuente extra
      evidenceFactor = Math.min(evidenceFactor, 1.3); // Cap 130%
    }

    const rawScore = baseScore * evidenceFactor;
    const confidenceScore = Math.min(100, Math.round(rawScore));
    const confidenceLabel = confidenceScore >= 80 ? 'Muy alto'
      : confidenceScore >= 60 ? 'Alto'
      : confidenceScore >= 40 ? 'Medio'
      : confidenceScore >= 20 ? 'Bajo'
      : 'Muy bajo' as const;

    // ─── Generar reporte NO ENCONTRADO (ahora con confidence real) ───
    if (!aliasFound && !intelligenceReport) {
      this.logger.log('📝 [6/6] Sin evidencia literal → generando reporte "NO ENCONTRADO" (sin LLM)');
      intelligenceReport = this.evidenceGate.formatNoMatchReport(
        dto.query,
        gateSummary,
        { searchMs: timing.searchMs, scrapeMs: timing.scrapeMs || 0 },
        { score: confidenceScore, label: confidenceLabel },
      );
      reportSource = 'evidence_gate_no_match';
      this.logger.log(`   ✅ Reporte "NO ENCONTRADO" generado: ${intelligenceReport.length} chars (0 tokens LLM)`);
    }

    this.logger.log('');
    this.logger.log('🔥 ═══════════════════════════════════════════════');
    this.logger.log('🔥  PIPELINE v2.1 COMPLETO');
    this.logger.log(`🔥  Alias: "${dto.query}"`);
    this.logger.log(`🔥  Alias encontrado: ${aliasFound ? '✅ SÍ' : '❌ NO'}`);
    this.logger.log(`🔥  Evidencias literales: ${passedResults.length}`);
    this.logger.log(`🔥  Entidades detectadas: ${detectedEntities.length}`);
    this.logger.log(`🔥  Reporte: ${reportSource} (${intelligenceReport?.length || 0} chars)`);
    this.logger.log(`🔥  Groq keys used: [${groqKeysUsed.join(', ')}] (${groqKeysUsed.length} calls)`);
    this.logger.log(`🔥  Confidence: ${confidenceScore}% (${confidenceLabel}) [real_evidence=${realEvidence}, serp=${serpCount}, factor=${evidenceFactor.toFixed(2)}]`);
    this.logger.log(`🔥  Coverage: ${coverageStats.engineCoveragePct}% engines, ${coverageStats.scrapeSuccessRate}% scrape`);
    this.logger.log(`🔥  Pre-gate: ${preGatePassed} con alias / ${preGateDiscarded} sin alias`);
    this.logger.log(`🔥  Tiempo total: ${totalTimeMs}ms`);
    this.logger.log('🔥 ═══════════════════════════════════════════════');
    this.logger.log('');

    return {
      originalQuery: dto.query,
      refinedQuery: dto.refineQuery !== false ? refinedQuery : undefined,
      preset: dto.preset || 'threat_intel',
      totalRawResults: searchResult.totalRaw,
      totalUniqueResults: searchResult.results.length,
      totalFilteredResults: selectedResults.length,
      totalScrapedPages: scrapedPages.filter((p) => !p.error).length,
      engineStatuses: searchResult.engineStatuses,
      selectedResults,
      scrapedPages,
      // ─── v2 Evidence Gate fields ───
      aliasFound,
      evidenceGate: evidenceGateResponse,
      literalEvidence,
      detectedEntities,
      intelligenceReport,
      reportSource,
      groqKeysUsed,
      confidenceScore,
      confidenceLabel,
      coverageStats,
      totalTimeMs,
      timing,
    };
  }

  // ══════════════════════════════════════════════════
  //  V2 HELPERS (Evidence Gate response mapping)
  // ══════════════════════════════════════════════════

  /**
   * Respuesta vacía para early exit (0 resultados de búsqueda)
   */
  private buildEmptyResponse(
    dto: DarkWebSearchDto,
    refinedQuery: string,
    searchResult: { totalRaw: number; results: DarkWebSearchResult[]; engineStatuses: any[] },
    groqKeysUsed: number[],
    timing: DarkWebPipelineResponse['timing'],
    pipelineStart: number,
  ): DarkWebPipelineResponse {
    return {
      originalQuery: dto.query,
      refinedQuery: dto.refineQuery !== false ? refinedQuery : undefined,
      preset: dto.preset || 'threat_intel',
      totalRawResults: searchResult.totalRaw,
      totalUniqueResults: 0,
      totalFilteredResults: 0,
      totalScrapedPages: 0,
      engineStatuses: searchResult.engineStatuses,
      selectedResults: [],
      scrapedPages: [],
      aliasFound: false,
      evidenceGate: { totalProcessed: 0, totalPassed: 0, totalDiscarded: 0, discardReasons: {}, topScores: [] },
      literalEvidence: [],
      detectedEntities: [],
      intelligenceReport: `## Dark Web Intelligence Report\n### Alias: \`${dto.query}\`\n### Resultado: NO ENCONTRADO\n\nNo se encontraron resultados en ningún motor de búsqueda dark web.`,
      reportSource: 'evidence_gate_no_match',
      groqKeysUsed,
      confidenceScore: 0,
      confidenceLabel: 'Muy bajo',
      coverageStats: {
        totalEngines: searchResult.engineStatuses.length,
        enginesUp: searchResult.engineStatuses.filter(e => e.status === 'up').length,
        enginesDown: searchResult.engineStatuses.filter(e => e.status === 'down').length,
        enginesTimeout: searchResult.engineStatuses.filter(e => e.status === 'timeout').length,
        engineCoveragePct: searchResult.engineStatuses.length > 0
          ? Math.round((searchResult.engineStatuses.filter(e => e.status === 'up').length / searchResult.engineStatuses.length) * 100) : 0,
        scrapeSuccessRate: 0,
        preGateDiscarded: 0,
        preGatePassed: 0,
      },
      totalTimeMs: Date.now() - pipelineStart,
      timing,
    };
  }

  /**
   * Convierte EvidenceGateResult[] a LiteralEvidence[] para la respuesta
   */
  private mapToLiteralEvidence(results: EvidenceGateResult[]): LiteralEvidence[] {
    return results.map((r) => ({
      url: r.url,
      title: r.title,
      score: r.score,
      snippets: r.snippets.map((s) => ({
        text: s.text,
        matchedVariant: s.matchedVariant,
        location: s.location,
      })),
      entities: this.flattenEntities(r.entities, r.url),
    }));
  }

  /**
   * Recopila todas las entidades de todos los resultados en una lista plana deduplicada
   */
  private collectAllEntities(results: EvidenceGateResult[]): DetectedEntity[] {
    const seen = new Set<string>();
    const all: DetectedEntity[] = [];

    for (const r of results) {
      const entities = this.flattenEntities(r.entities, r.url);
      for (const e of entities) {
        const key = `${e.type}:${e.value}`;
        if (!seen.has(key)) {
          seen.add(key);
          all.push(e);
        }
      }
    }

    return all;
  }

  /**
   * Convierte ExtractedEntities (by-type object) a DetectedEntity[] (flat array)
   */
  private flattenEntities(
    entities: import('./darkweb-evidence-gate.service').ExtractedEntities,
    sourceUrl: string,
  ): DetectedEntity[] {
    const result: DetectedEntity[] = [];

    for (const email of entities.emails) {
      result.push({ type: 'email', value: email, sourceUrl });
    }
    for (const w of entities.btcWallets) {
      result.push({ type: 'btc_wallet', value: w, sourceUrl });
    }
    for (const w of entities.xmrWallets) {
      result.push({ type: 'xmr_wallet', value: w, sourceUrl });
    }
    for (const w of entities.ethWallets) {
      result.push({ type: 'eth_wallet', value: w, sourceUrl });
    }
    for (const p of entities.pgpFingerprints) {
      result.push({ type: 'pgp', value: p, sourceUrl });
    }
    for (const t of entities.telegramHandles) {
      result.push({ type: 'telegram', value: t, sourceUrl });
    }
    for (const s of entities.sessionIds) {
      result.push({ type: 'session_id', value: s, sourceUrl });
    }
    for (const o of entities.onionDomains) {
      result.push({ type: 'onion', value: o, sourceUrl });
    }
    for (const ip of entities.ipAddresses) {
      result.push({ type: 'ip', value: ip, sourceUrl });
    }
    for (const ph of entities.phoneNumbers) {
      result.push({ type: 'phone', value: ph, sourceUrl });
    }

    return result;
  }

  /**
   * Reporte fallback (si LLM falla pero hay evidencia del gate)
   */
  private buildFallbackReport(
    alias: string,
    passedResults: EvidenceGateResult[],
    summary: EvidenceGateSummary,
  ): string {
    const lines: string[] = [];
    lines.push(`## Dark Web Intelligence Report (Fallback)\n`);
    lines.push(`### Alias: \`${alias}\`\n`);
    lines.push(`### Resultado: ENCONTRADO (${passedResults.length} fuentes)\n`);
    lines.push(`> Nota: El reporte LLM falló. Esta es una versión determinística basada en el Evidence Gate.\n`);

    for (let i = 0; i < passedResults.length; i++) {
      const r = passedResults[i];
      lines.push(`### Evidencia ${i + 1} (Score: ${r.score})`);
      lines.push(`- **URL**: ${r.url}`);
      lines.push(`- **Título**: ${r.title}`);
      for (const s of r.snippets) {
        lines.push(`- **Match** [${s.location}]: "...${s.text.substring(0, 200)}..."`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  // ══════════════════════════════════════════════════
  //  GROQ AI CALLS (usa key rotation)
  // ══════════════════════════════════════════════════

  /**
   * Filtrar resultados con Groq (replica filter_results de Python)
   */
  private async filterWithGroq(
    query: string,
    results: DarkWebSearchResult[],
    keysTracker: number[],
  ): Promise<DarkWebSearchResult[]> {
    // Formatear resultados para el LLM
    let formattedResults = this.darkWebScraper.formatResultsForLLM(results);

    const systemPrompt = DARKWEB_FILTER_RESULTS_PROMPT.replace(
      '{query}',
      query,
    );

    let result: { content: string; keyIndex: number };

    try {
      result = await this.callGroq(systemPrompt, formattedResults, {
        temperature: 0,
        max_tokens: 500,
      });
    } catch (error: any) {
      // Rate limit fallback: truncar títulos (como en Python)
      if (error.message?.includes('rate') || error.response?.status === 429) {
        this.logger.warn(
          '   ⚠️  Rate limit — truncando a títulos cortos y reintentando...',
        );
        formattedResults = this.darkWebScraper.formatResultsForLLM(
          results,
          true,
        );
        result = await this.callGroq(systemPrompt, formattedResults, {
          temperature: 0,
          max_tokens: 500,
        });
      } else {
        throw error;
      }
    }

    keysTracker.push(result.keyIndex);

    // Parsear índices del response
    const parsedIndices = this.parseIndices(result.content, results.length);

    if (parsedIndices.length === 0) {
      this.logger.warn(
        `   ⚠️  No se pudo parsear respuesta del LLM: "${result.content}". Usando top 20.`,
      );
      return results.slice(0, 20);
    }

    // Seleccionar resultados por índice (1-based)
    return parsedIndices
      .slice(0, 20)
      .map((i) => results[i - 1])
      .filter(Boolean);
  }

  /**
   * Generar reporte de inteligencia (replica generate_summary de Python)
   */
  private async generateReport(
    query: string,
    content: string,
    preset: DarkWebAnalysisPreset,
    customInstructions?: string,
    keysTracker?: number[],
  ): Promise<string> {
    let systemPrompt =
      DARKWEB_ANALYSIS_PRESETS[preset] ||
      DARKWEB_ANALYSIS_PRESETS.threat_intel;

    // Reemplazar {query} en el prompt
    systemPrompt = systemPrompt.replace(/\{query\}/g, query);

    // Agregar instrucciones custom
    if (customInstructions?.trim()) {
      systemPrompt += `\n\nAdditionally focus on: ${customInstructions.trim()}`;
    }

    // Truncar contenido para no exceder contexto de Groq
    let truncatedContent = content;
    if (content.length > MAX_REPORT_CONTENT_CHARS) {
      truncatedContent = content.substring(0, MAX_REPORT_CONTENT_CHARS) + '\n...(content truncated for LLM context limit)';
      this.logger.log(
        `   📝 Content truncated: ${content.length} → ${MAX_REPORT_CONTENT_CHARS} chars for report`,
      );
    }

    const result = await this.callGroq(systemPrompt, truncatedContent, {
      temperature: 0.3,
      max_tokens: 4000,
    });

    if (keysTracker) {
      keysTracker.push(result.keyIndex);
    }

    return result.content;
  }

  /**
   * Llamada a Groq API usando key rotation.
   * Usa axios directo (no HttpService/rxjs) para timeout más confiable.
   */
  private async callGroq(
    systemPrompt: string,
    userContent: string,
    options: { temperature?: number; max_tokens?: number } = {},
  ): Promise<{ content: string; keyIndex: number }> {
    // Obtener key disponible del pool
    const keyResult = await this.groqKeyRotation.getAvailableKey(
      DARKWEB_GROQ_MODEL,
    );

    this.logger.debug(
      `🔑 DarkWeb IA: key [${keyResult.keyIndex}] for ${DARKWEB_GROQ_MODEL} (${userContent.length} chars input)`,
    );

    const callStart = Date.now();

    // Timeout guard — si Groq no responde en GROQ_CALL_TIMEOUT_MS, abortar
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), GROQ_CALL_TIMEOUT_MS);

    try {
      const response = await axios.post(
        this.GROQ_API_URL,
        {
          model: DARKWEB_GROQ_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          temperature: options.temperature ?? 0,
          max_tokens: options.max_tokens ?? 2000,
        },
        {
          headers: {
            Authorization: `Bearer ${keyResult.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: GROQ_CALL_TIMEOUT_MS,
          signal: abortController.signal,
        },
      );

      clearTimeout(timeoutId);

      const elapsed = Date.now() - callStart;
      this.logger.debug(
        `✅ Groq response: key [${keyResult.keyIndex}], ${elapsed}ms, ${response.data?.usage?.total_tokens || '?'} tokens`,
      );

      // Registrar uso después de éxito
      await this.groqKeyRotation.registerUsage(
        keyResult.keyIndex,
        keyResult.modelType,
      );

      const content =
        response.data?.choices?.[0]?.message?.content || '';

      return { content, keyIndex: keyResult.keyIndex };
    } catch (error: any) {
      clearTimeout(timeoutId);
      const elapsed = Date.now() - callStart;

      if (error.name === 'AbortError' || error.code === 'ERR_CANCELED' || error.code === 'ECONNABORTED') {
        this.logger.error(
          `⏱️  Groq timeout after ${elapsed}ms (key [${keyResult.keyIndex}], limit: ${GROQ_CALL_TIMEOUT_MS}ms)`,
        );
        throw new Error(`Groq API timeout after ${Math.round(elapsed / 1000)}s`);
      }

      if (error.response?.data) {
        // Detectar 429 y notificar al pool de keys
        if (error.response?.status === 429) {
          const retryAfter = parseInt(error.response?.headers?.['retry-after'] ?? '5', 10);
          await this.groqKeyRotation.handle429(keyResult.keyIndex, retryAfter);
          this.logger.warn(`Groq 429 on key [${keyResult.keyIndex}] — cooldown ${retryAfter}s`);
        }
        this.logger.error(
          `Groq API error (key [${keyResult.keyIndex}], ${elapsed}ms): ${JSON.stringify(error.response.data)}`,
        );
      } else {
        this.logger.error(
          `Groq API error (key [${keyResult.keyIndex}], ${elapsed}ms): ${error.message}`,
        );
      }
      throw error;
    }
  }

  // ══════════════════════════════════════════════════
  //  HELPERS
  // ══════════════════════════════════════════════════

  /**
   * Parsea índices numéricos de la respuesta del LLM
   * "1, 3, 5, 7, 12" → [1, 3, 5, 7, 12]
   */
  private parseIndices(text: string, maxIndex: number): number[] {
    const matches = text.match(/\d+/g) || [];
    const seen = new Set<number>();
    const indices: number[] = [];

    for (const match of matches) {
      const idx = parseInt(match, 10);
      if (idx >= 1 && idx <= maxIndex && !seen.has(idx)) {
        seen.add(idx);
        indices.push(idx);
      }
    }

    return indices;
  }

  /**
   * ¿Está el servicio disponible?
   */
  isAvailable(): boolean {
    return (
      this.darkWebSearch.isAvailable() &&
      this.groqKeyRotation.isAvailable()
    );
  }
}
