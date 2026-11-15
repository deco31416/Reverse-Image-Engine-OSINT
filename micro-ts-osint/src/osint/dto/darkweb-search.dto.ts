import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsNumber,
  Min,
  Max,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DarkWebAnalysisPreset } from '../constants/darkweb-prompts';

/**
 * Preset de análisis Dark Web
 */
export enum DarkWebPreset {
  THREAT_INTEL = 'threat_intel',
  RANSOMWARE_MALWARE = 'ransomware_malware',
  PERSONAL_IDENTITY = 'personal_identity',
  CORPORATE_ESPIONAGE = 'corporate_espionage',
}

/**
 * DTO de entrada para búsqueda Dark Web
 */
export class DarkWebSearchDto {
  @ApiProperty({
    description: 'Query de búsqueda (será refinada por IA si refineQuery=true)',
    example: 'ransomware group lockbit credentials leak',
    minLength: 2,
    maxLength: 500,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  query: string;

  @ApiPropertyOptional({
    description: 'Preset de análisis de inteligencia',
    enum: DarkWebPreset,
    default: DarkWebPreset.THREAT_INTEL,
  })
  @IsOptional()
  @IsEnum(DarkWebPreset)
  preset?: DarkWebPreset = DarkWebPreset.THREAT_INTEL;

  @ApiPropertyOptional({
    description: 'Instrucciones adicionales para el análisis (se concatenan al preset)',
    example: 'Focus on cryptocurrency wallet addresses and ransomware payment portals',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  customInstructions?: string;

  @ApiPropertyOptional({
    description: '¿Refinar la query con IA antes de buscar? (≤5 palabras optimizadas)',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  refineQuery?: boolean = true;

  @ApiPropertyOptional({
    description: '¿Filtrar resultados con IA? (selecciona top 20 más relevantes)',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  aiFilter?: boolean = true;

  @ApiPropertyOptional({
    description: '¿Hacer scraping del contenido de las URLs encontradas?',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  scrapeContent?: boolean = true;

  @ApiPropertyOptional({
    description: '¿Generar reporte de inteligencia con IA?',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  generateReport?: boolean = true;

  @ApiPropertyOptional({
    description: 'Workers concurrentes para búsqueda en motores',
    default: 5,
    minimum: 1,
    maximum: 16,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(16)
  searchWorkers?: number = 5;

  @ApiPropertyOptional({
    description: 'Workers concurrentes para scraping',
    default: 5,
    minimum: 1,
    maximum: 10,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  scrapeWorkers?: number = 5;

  @ApiPropertyOptional({
    description: 'Máximo de caracteres por página scrapeada',
    default: 2000,
    minimum: 500,
    maximum: 10000,
  })
  @IsOptional()
  @IsNumber()
  @Min(500)
  @Max(10000)
  maxCharsPerPage?: number = 2000;
}

// ─── Response Types ───────────────────────────────────────

export interface DarkWebSearchResult {
  title: string;
  link: string;
  engine: string;
}

export interface DarkWebScrapedPage {
  url: string;
  content: string;
  title: string;
  truncated: boolean;
  error?: string;
}

export interface DarkWebEngineStatus {
  name: string;
  status: 'up' | 'down' | 'timeout';
  latencyMs: number;
  resultsFound: number;
  error?: string;
}

// ─── Evidence Gate v2 Response Types ──────────────────────

/** Resumen del Evidence Gate en la respuesta */
export interface EvidenceGateResponseSummary {
  /** Total de páginas scrapeadas procesadas */
  totalProcessed: number;
  /** Páginas que PASARON el gate (alias encontrado literal) */
  totalPassed: number;
  /** Páginas descartadas */
  totalDiscarded: number;
  /** Razones de descarte agrupadas */
  discardReasons: Record<string, number>;
  /** Top 5 scores */
  topScores: { url: string; score: number }[];
}

/** Entidad encontrada por regex (no LLM) */
export interface DetectedEntity {
  type: 'email' | 'btc_wallet' | 'xmr_wallet' | 'eth_wallet' | 'pgp' | 'telegram' | 'session_id' | 'onion' | 'ip' | 'phone';
  value: string;
  /** URL fuente donde se encontró */
  sourceUrl: string;
}

/** Evidencia literal encontrada */
export interface LiteralEvidence {
  /** URL fuente */
  url: string;
  /** Título de la página */
  title: string;
  /** Score de relevancia (0-200+) */
  score: number;
  /** Snippets con el alias (±500 chars, max 3 por página) */
  snippets: {
    text: string;
    matchedVariant: string;
    location: 'title' | 'h1' | 'body' | 'url';
  }[];
  /** Entidades extraídas de esta página */
  entities: DetectedEntity[];
}

// ─── Coverage & Confidence v2.1 ───────────────────────────

/** Métricas de cobertura del pipeline */
export interface CoverageStats {
  /** Total de motores configurados */
  totalEngines: number;
  /** Motores activos (respondieron) */
  enginesUp: number;
  /** Motores caídos */
  enginesDown: number;
  /** Motores con timeout */
  enginesTimeout: number;
  /** % cobertura de motores */
  engineCoveragePct: number;
  /** Páginas scrapeadas exitosamente vs intentadas */
  scrapeSuccessRate: number;
  /** Páginas descartadas por pre-gate (alias no en título/snippet) */
  preGateDiscarded: number;
  /** Páginas que pasaron pre-gate (fueron scrapeadas) */
  preGatePassed: number;
}

// ─── Pipeline Response v2 ─────────────────────────────────

export interface DarkWebPipelineResponse {
  /** Query original */
  originalQuery: string;
  /** Query refinada por IA (si se habilitó) */
  refinedQuery?: string;
  /** Preset de análisis usado */
  preset: string;
  /** Resultados crudos encontrados */
  totalRawResults: number;
  /** Resultados tras deduplicación */
  totalUniqueResults: number;
  /** Resultados seleccionados por IA */
  totalFilteredResults: number;
  /** Páginas scrapeadas exitosamente */
  totalScrapedPages: number;
  /** Motores consultados y su estado */
  engineStatuses: DarkWebEngineStatus[];
  /** Resultados seleccionados (top 20) */
  selectedResults: DarkWebSearchResult[];
  /** Contenido scrapeado de cada URL */
  scrapedPages: DarkWebScrapedPage[];

  // ─── v2: Evidence Gate fields ───
  /** ¿Se encontró evidencia literal del alias? */
  aliasFound: boolean;
  /** Resumen del Evidence Gate */
  evidenceGate: EvidenceGateResponseSummary;
  /** Evidencia literal ordenada por score (solo las que pasaron el gate) */
  literalEvidence: LiteralEvidence[];
  /** Todas las entidades detectadas por regex (deduplicadas, sin LLM) */
  detectedEntities: DetectedEntity[];

  /** Reporte de inteligencia generado por IA (o "NO ENCONTRADO" si alias no hallado) */
  intelligenceReport?: string;
  /** ¿El reporte fue generado por LLM o es determinístico (no-match)? */
  reportSource: 'llm' | 'evidence_gate_no_match';
  /** Groq keys usadas (índices) */
  groqKeysUsed: number[];
  /** Tiempo total del pipeline en ms */
  totalTimeMs: number;
  /** Confidence Score matemático (0-100) */
  confidenceScore: number;
  /** Label de confianza legible */
  confidenceLabel: 'Muy bajo' | 'Bajo' | 'Medio' | 'Alto' | 'Muy alto';
  /** Métricas de cobertura */
  coverageStats: CoverageStats;
  /** Desglose de tiempos */
  timing: {
    refineMs?: number;
    searchMs: number;
    filterMs?: number;
    preGateMs?: number;
    scrapeMs?: number;
    /** Tiempo del Evidence Gate en ms */
    evidenceGateMs?: number;
    reportMs?: number;
  };
}
