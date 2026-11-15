import { IsOptional, ValidateNested, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ImageInputDto } from './image-input.dto';
import { PersonalInfoDto } from './personal-info.dto';
import { ContextDto } from './context.dto';
import { SearchOptionsDto } from './search-options.dto';

/**
 * DTO principal para búsqueda OSINT multi-modal expandida
 * Combina imagen, datos personales, contexto y opciones de búsqueda
 *
 * @example
 * {
 *   "image": {
 *     "source": "upload",
 *     "url": "https://example.com/person.jpg"
 *   },
 *   "personalInfo": {
 *     "nombre": "Juan",
 *     "apellido": "Pérez",
 *     "email": "juan@example.com"
 *   },
 *   "context": {
 *     "organizacion": "UNAM",
 *     "cargo": "Profesor"
 *   },
 *   "options": {
 *     "deepSearch": true,
 *     "youtubeSearch": true,
 *     "searchEngines": ["google", "bing", "duckduckgo"]
 *   }
 * }
 */
export class ExpandedPersonSearchDto {
  @ApiPropertyOptional({
    description:
      'Imagen de la persona (opcional si se proporciona personalInfo)',
    type: () => ImageInputDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ImageInputDto)
  image?: ImageInputDto;

  @ApiPropertyOptional({
    description:
      'Información personal conocida (opcional si se proporciona image)',
    type: () => PersonalInfoDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PersonalInfoDto)
  personalInfo?: PersonalInfoDto;

  @ApiPropertyOptional({
    description: 'Contexto adicional de búsqueda (organización, cargo, etc.)',
    type: () => ContextDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContextDto)
  context?: ContextDto;

  @ApiProperty({
    description: 'Opciones de búsqueda y configuración',
    type: () => SearchOptionsDto,
  })
  @ValidateNested()
  @Type(() => SearchOptionsDto)
  options: SearchOptionsDto = new SearchOptionsDto();

  @ApiPropertyOptional({
    description: 'ID de usuario que realiza la búsqueda (para audit log)',
    example: 'user-123',
  })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({
    description: 'IP del solicitante (para audit log)',
    example: '192.168.1.100',
  })
  @IsOptional()
  @IsString()
  requestIp?: string;

  @ApiPropertyOptional({
    description: 'User-Agent del solicitante (para audit log)',
    example: 'Mozilla/5.0...',
  })
  @IsOptional()
  @IsString()
  userAgent?: string;
}

/**
 * DTO de respuesta para búsqueda OSINT
 */
export class OsintSearchResponseDto {
  @ApiProperty({
    description: 'ID de la búsqueda creada',
    example: '507f1f77bcf86cd799439011',
  })
  searchId: string;

  @ApiProperty({
    description: 'Query generada para la búsqueda',
    example: 'Juan Pérez UNAM profesor',
  })
  query: string;

  @ApiProperty({
    description: 'Letra de cluster asignada (A-Z o #)',
    example: 'P',
  })
  clusterLetter: string;

  @ApiPropertyOptional({
    description: 'URL de imagen enhanced (si se generó)',
    example: 'https://res.cloudinary.com/xyz/enhanced.jpg',
  })
  enhancedImageUrl?: string;

  @ApiProperty({
    description: 'Estado de la búsqueda',
    example: 'processing',
  })
  status: string;

  @ApiProperty({
    description: 'Fecha de creación',
    example: '2026-02-17T10:30:00Z',
  })
  createdAt: Date;

  @ApiPropertyOptional({
    description: 'Estado del job en cola Redis',
    example: { searchId: '507f1f77bcf86cd799439011', status: 'queued', mode: 'redis' },
  })
  job?: {
    searchId: string;
    status: string;
    reason?: string;
    queuedAt?: string;
    mode?: string;
  };

  @ApiPropertyOptional({
    description: 'Resultados preliminares (si ya hay)',
  })
  results?: {
    evidenceCount: number;
    sources: string[];
    reliability: number;
  };
}
