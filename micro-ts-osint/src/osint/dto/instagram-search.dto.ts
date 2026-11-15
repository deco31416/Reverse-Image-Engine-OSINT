import {
  IsString,
  IsOptional,
  IsBoolean,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ─── Input DTOs ──────────────────────────────────────────

/**
 * DTO de entrada para Instagram OSINT Pipeline
 */
export class InstagramSearchDto {
  @ApiProperty({
    description: 'Username de Instagram a investigar',
    example: 'therock',
    minLength: 1,
    maxLength: 200,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  username: string;

  @ApiPropertyOptional({
    description: '¿Obtener perfil via Instagram Direct API?',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  fetchProfile?: boolean = true;

  @ApiPropertyOptional({
    description: '¿Obtener estadísticas via RapidAPI?',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  fetchStats?: boolean = true;

  @ApiPropertyOptional({
    description: '¿Obtener posts recientes?',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  fetchPosts?: boolean = true;

  @ApiPropertyOptional({
    description: '¿Detectar colaboradores (tagged users) en posts?',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  detectCollaborators?: boolean = true;
}

/**
 * DTO para consultar un post individual de Instagram
 */
export class InstagramPostDto {
  @ApiProperty({
    description: 'URL del post de Instagram',
    example: 'https://www.instagram.com/p/C1hfPhUiwo3/',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  postUrl: string;
}

// ─── Response Types ──────────────────────────────────────

export interface InstagramProfileData {
  /** Instagram user ID */
  id: string;
  /** Username */
  username: string;
  /** Nombre completo */
  fullName: string;
  /** Biografía */
  biography?: string;
  /** ¿Es cuenta privada? */
  isPrivate: boolean;
  /** ¿Es verificado? */
  isVerified: boolean;
  /** URL avatar */
  profilePicUrl?: string;
  /** URL avatar HD */
  profilePicUrlHd?: string;
  /** Número de seguidores */
  followerCount: number;
  /** Número de seguidos */
  followingCount: number;
  /** Número de posts */
  postCount: number;
  /** URL externa (link en bio) */
  externalUrl?: string;
  /** Categoría de la cuenta */
  category?: string;
  /** JSON crudo */
  raw?: Record<string, any>;
}

export interface InstagramCollaborator {
  /** Username del colaborador */
  username: string;
  /** URL del perfil */
  profileUrl: string;
}

export interface InstagramPostData {
  /** Shortcode del post */
  shortcode: string;
  /** URL completa del post */
  postUrl: string;
  /** ¿Es video? */
  isVideo: boolean;
  /** URL de la imagen */
  displayUrl?: string;
  /** URL del video (si es video) */
  videoUrl?: string;
  /** Caption / texto del post */
  caption?: string;
  /** Número de likes */
  likeCount: number;
  /** Número de comentarios */
  commentCount: number;
  /** Timestamp UNIX */
  timestamp?: number;
  /** Username del propietario del post */
  ownerUsername: string;
  /** Usuarios colaboradores / tagged */
  collaborators: InstagramCollaborator[];
  /** Tipo de media */
  mediaType: 'image' | 'video' | 'carousel';
}

export interface InstagramCommunityStats {
  /** Community ID (para consultas de posts por CID) */
  cid?: string;
  /** Seguidores */
  followers?: number;
  /** Seguidos */
  following?: number;
  /** Número de posts */
  posts?: number;
  /** Engagement rate (%) */
  engagementRate?: number;
  /** Promedio de likes por post */
  avgLikes?: number;
  /** Promedio de comentarios por post */
  avgComments?: number;
  /** JSON crudo */
  raw?: Record<string, any>;
}

export interface InstagramPipelineResponse {
  /** Username buscado */
  username: string;
  /** URL de Instagram */
  instagramUrl: string;
  /** ¿Se encontraron datos? */
  found: boolean;
  /** ¿Es cuenta privada? */
  isPrivate?: boolean;
  /** Datos del perfil (Instagram Direct API) */
  profile?: InstagramProfileData | null;
  /** Estadísticas de comunidad (RapidAPI) */
  communityStats?: InstagramCommunityStats | null;
  /** Posts recientes */
  posts?: InstagramPostData[] | null;
  /** Todos los colaboradores encontrados */
  allCollaborators?: InstagramCollaborator[];
  /** Errores parciales por fuente */
  errors: Record<string, string>;
  /** Timing del pipeline */
  timing: {
    directApiMs?: number;
    rapidApiMs?: number;
    postsMs?: number;
    totalMs: number;
  };
  /** Estado de cada API */
  apiStatus: Record<string, 'ok' | 'error' | 'skipped'>;
}
