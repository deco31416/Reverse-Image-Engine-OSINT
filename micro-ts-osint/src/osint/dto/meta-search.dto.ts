import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ─── Enums ────────────────────────────────────────────────

export enum MetaSearchType {
  PEOPLE = 'people',
  PAGES = 'pages',
  POSTS = 'posts',
  GLOBAL = 'global',
  LOCATIONS = 'locations',
}

// ─── Input DTOs ───────────────────────────────────────────

/**
 * DTO de entrada para profile pipeline Meta/Facebook OSINT
 */
export class MetaSearchDto {
  @ApiProperty({
    description: 'Username o nombre de página de Facebook a investigar',
    example: 'nasa',
    minLength: 1,
    maxLength: 200,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  username: string;

  @ApiPropertyOptional({
    description: '¿Obtener perfil?',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  fetchProfile?: boolean = true;

  @ApiPropertyOptional({
    description: '¿Obtener posts del perfil?',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  fetchPosts?: boolean = true;

  @ApiPropertyOptional({
    description: '¿Obtener fotos del perfil?',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  fetchPhotos?: boolean = true;

  /** Legacy: kept for backward compat — maps to fetchPosts */
  @ApiPropertyOptional({ description: '(Legacy) Alias for fetchPosts' })
  @IsOptional()
  @IsBoolean()
  fetchPageDetails?: boolean = true;
}

/**
 * DTO para búsqueda en Facebook (people, pages, posts, global, locations)
 */
export class MetaFbSearchDto {
  @ApiProperty({
    description: 'Texto de búsqueda',
    example: 'pizza',
    minLength: 1,
    maxLength: 500,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  query: string;

  @ApiPropertyOptional({
    enum: MetaSearchType,
    description: 'Tipo de búsqueda: people, pages, posts, global, locations',
    default: MetaSearchType.GLOBAL,
  })
  @IsOptional()
  @IsEnum(MetaSearchType)
  searchType?: MetaSearchType = MetaSearchType.GLOBAL;
}

// ─── Profile Types ────────────────────────────────────────

export interface MetaIntroCard {
  label: string;
  value: string;
  externalUrl?: string;
}

export interface MetaPhoto {
  id: string;
  uri: string;
  width?: number;
  height?: number;
}

export interface MetaProfileData {
  /** Facebook user ID */
  id: string;
  /** Tipo de perfil (User, Page, etc.) */
  typeName: string;
  /** Nombre completo */
  name: string;
  /** Género (si disponible) */
  gender?: string;
  /** Cuenta verificada */
  verified?: boolean;
  /** Bio / intro text */
  intro?: string;
  /** URL del perfil de Facebook */
  url?: string;
  /** URL del avatar */
  profilePicture?: string;
  /** URL de la portada */
  coverPhoto?: string;
  /** Tarjetas de info (trabajo, educación, ubicación) */
  introCards: MetaIntroCard[];
  /** Fotos públicas */
  photos: MetaPhoto[];
  /** JSON crudo de la API para referencia */
  raw?: Record<string, any>;
}

// ─── Page Details Types ───────────────────────────────────

export interface MetaPageData {
  /** Título de la página */
  title: string;
  /** Descripción */
  description?: string;
  /** URL de imagen de la página */
  image?: string;
  /** URL pública de Facebook */
  url?: string;
  /** ID del propietario */
  userId?: string;
  /** JSON crudo */
  raw?: Record<string, any>;
}

// ─── Posts Types ──────────────────────────────────────────

export interface MetaPostAttachment {
  type: string;
  uri?: string;
  width?: number;
  height?: number;
  thumbnail?: string;
}

export interface MetaPostData {
  /** ID del post */
  postId: string;
  /** Texto del post */
  text?: string;
  /** URL directa al post */
  url?: string;
  /** Fecha de creación ISO */
  createdAt?: string;
  /** Número de comentarios */
  commentsCount: number;
  /** Número de shares */
  shareCount: number;
  /** Total de reacciones */
  reactionCount: number;
  /** Desglose de reacciones (like, love, haha, etc.) */
  reactions?: Record<string, number>;
  /** Adjuntos (fotos, videos) */
  attachments: MetaPostAttachment[];
}

// ─── Search Result ────────────────────────────────────────

export interface MetaSearchResult {
  /** Tipo de búsqueda realizada */
  type: MetaSearchType;
  /** Query original */
  query: string;
  /** Resultados */
  results: any[];
  /** Total de resultados */
  count: number;
  /** JSON crudo */
  raw?: any;
}

// ─── Pipeline Response ────────────────────────────────────

export interface MetaPipelineResponse {
  /** Username buscado */
  username: string;
  /** URL construida */
  facebookUrl: string;
  /** ¿Se encontraron datos? */
  found: boolean;
  /** Datos del perfil */
  profile?: MetaProfileData | null;
  /** (Legacy) Alias — kept for backward compat */
  pageDetails?: MetaPageData | null;
  /** Posts recientes */
  posts?: MetaPostData[] | null;
  /** Fotos del perfil */
  photos?: MetaPhoto[] | null;
  /** Resultados de búsqueda (solo con MetaFbSearchDto) */
  search?: MetaSearchResult | null;
  /** Errores parciales por endpoint */
  errors: Record<string, string>;
  /** Timing del pipeline */
  timing: {
    profileMs?: number;
    postsMs?: number;
    photosMs?: number;
    pageDetailsMs?: number;
    searchMs?: number;
    totalMs: number;
  };
  /** API status por endpoint */
  apiStatus: Record<string, 'ok' | 'error' | 'skipped'>;
}
