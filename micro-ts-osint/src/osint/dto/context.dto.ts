import { IsString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO para contexto adicional de búsqueda
 * Ayuda a IA a generar mejores queries y filtrar resultados
 */
export class ContextDto {
  @ApiPropertyOptional({
    description: 'Organización o empresa donde trabaja/estudia',
    example: 'Universidad Nacional Autónoma de México',
  })
  @IsOptional()
  @IsString()
  organizacion?: string;

  @ApiPropertyOptional({
    description: 'Cargo o puesto laboral',
    example: 'Ingeniero de Software Senior',
  })
  @IsOptional()
  @IsString()
  cargo?: string;

  @ApiPropertyOptional({
    description: 'Industria o sector profesional',
    example: 'Tecnología - Desarrollo Web',
  })
  @IsOptional()
  @IsString()
  industria?: string;

  @ApiPropertyOptional({
    description: 'Notas adicionales o contexto relevante',
    example:
      'Visto en conferencia de tecnología el 12/02/2026. Posible speaker.',
  })
  @IsOptional()
  @IsString()
  notas?: string;

  @ApiPropertyOptional({
    description: 'Nivel de educación conocido',
    example: 'Maestría en Ciencias de la Computación',
  })
  @IsOptional()
  @IsString()
  educacion?: string;

  @ApiPropertyOptional({
    description: 'Intereses o hobbies conocidos',
    example: 'Fotografía, hiking, tecnología blockchain',
  })
  @IsOptional()
  @IsString()
  intereses?: string;
}
