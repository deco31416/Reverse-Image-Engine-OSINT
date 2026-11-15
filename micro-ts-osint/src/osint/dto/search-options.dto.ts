import {
  IsBoolean,
  IsArray,
  IsEnum,
  IsOptional,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum SearchEngine {
  // Tier 1 — siempre activos si disponibles (no requieren estar en searchEngines)
  SEARXNG = 'searxng',
  SERPER = 'serper',
  TAVILY = 'tavily',
  YOUTUBE = 'youtube',
  GOOGLE_VIA_BING = 'google_via_bing',
  // Tier 2 — controlados por searchEngines[] + caseProfile.allowTier2
  BING = 'bing',
  DUCKDUCKGO = 'duckduckgo',
  // Tier 3 — crawling y archivo
  CRAWL4AI = 'crawl4ai',
  WEBARCHIVE = 'webarchive',
  GOOGLEVISION = 'googlevision',
  // Legacy (aceptados para compatibilidad con clientes existentes)
  GOOGLE = 'google',
  YANDEX = 'yandex',
  TINEYE = 'tineye',
}

export enum CaseProfileEnum {
  SILENT = 'silent',
  STEALTH = 'stealth',
  STANDARD = 'standard',
  AGGRESSIVE = 'aggressive',
}

export enum CrawlStrategy {
  FAST = 'fast', // Solo títulos y snippets
  STANDARD = 'standard', // Crawl completo
  DEEP = 'deep', // Crawl recursivo con análisis profundo
}

/**
 * DTO para opciones de búsqueda OSINT
 * Controla qué motores usar y qué tan profunda es la búsqueda
 */
export class SearchOptionsDto {
  @ApiProperty({
    description: 'Generar imagen mejorada con Gemini antes de buscar',
    example: true,
    default: true,
  })
  @IsBoolean()
  generateEnhanced: boolean = true;

  @ApiProperty({
    description: 'Motores de búsqueda Tier 2 a habilitar (bing, duckduckgo). Los Tier 1 (serper, tavily, searxng, youtube) se activan automáticamente si están disponibles.',
    enum: SearchEngine,
    isArray: true,
    example: [SearchEngine.BING, SearchEngine.DUCKDUCKGO],
    default: [SearchEngine.BING, SearchEngine.DUCKDUCKGO],
  })
  @IsArray()
  @IsEnum(SearchEngine, { each: true })
  searchEngines: SearchEngine[] = [SearchEngine.BING, SearchEngine.DUCKDUCKGO];

  @ApiProperty({
    description: 'Habilitar web crawler para URLs encontradas',
    example: true,
    default: true,
  })
  @IsBoolean()
  enableCrawler: boolean = true;

  @ApiProperty({
    description: 'Estrategia de crawling',
    enum: CrawlStrategy,
    example: CrawlStrategy.STANDARD,
    default: CrawlStrategy.STANDARD,
  })
  @IsEnum(CrawlStrategy)
  crawlStrategy: CrawlStrategy = CrawlStrategy.STANDARD;

  @ApiProperty({
    description: 'Búsqueda profunda (más motores, más páginas, más tiempo)',
    example: false,
    default: false,
  })
  @IsBoolean()
  deepSearch: boolean = false;

  @ApiProperty({
    description: 'Buscar videos en YouTube',
    example: true,
    default: true,
  })
  @IsBoolean()
  youtubeSearch: boolean = true;

  @ApiProperty({
    description: 'Buscar en Web Archive (Wayback Machine)',
    example: false,
    default: false,
  })
  @IsBoolean()
  webArchiveSearch: boolean = false;

  @ApiProperty({
    description:
      'Habilitar búsqueda inversa de imágenes (Google, Yandex, TinEye)',
    example: true,
    default: true,
  })
  @IsBoolean()
  reverseImageSearch: boolean = true;

  @ApiProperty({
    description: 'Usar Google Vision API para análisis de imagen',
    example: true,
    default: true,
  })
  @IsBoolean()
  useGoogleVision: boolean = true;

  @ApiPropertyOptional({
    description: 'Máximo número de páginas a crawlear por URL',
    example: 10,
    default: 10,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  maxPagesPerUrl?: number = 10;

  @ApiPropertyOptional({
    description: 'Timeout en segundos para cada búsqueda',
    example: 30,
    default: 30,
    minimum: 5,
    maximum: 300,
  })
  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(300)
  searchTimeout?: number = 30;

  @ApiPropertyOptional({
    description: 'Guardar caché de resultados (evita re-buscar)',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  cacheResults?: boolean = true;

  @ApiPropertyOptional({
    description: 'Verificar dedplicación con SHA256 (previene duplicados)',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  enableDeduplication?: boolean = true;

  @ApiPropertyOptional({
    description: 'Perfil de caso OPSEC: controla concurrencia, velocidad y motores Tier 2',
    enum: CaseProfileEnum,
    example: CaseProfileEnum.STANDARD,
    default: CaseProfileEnum.STANDARD,
  })
  @IsOptional()
  @IsEnum(CaseProfileEnum)
  caseProfile?: CaseProfileEnum = CaseProfileEnum.STANDARD;

  @ApiPropertyOptional({
    description: 'Modo solo imagen: evita motores de texto y prioriza reverse image pipeline',
    example: true,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  imageOnlyMode?: boolean = false;

  @ApiPropertyOptional({
    description: 'Búsqueda en dark web (requiere Tor)',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  darkWebSearch?: boolean = false;
}
