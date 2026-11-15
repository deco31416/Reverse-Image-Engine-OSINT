import { IsString, IsOptional, IsEmail } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO para información personal conocida
 * Todos los campos son opcionales - se usa lo que se tenga disponible
 */
export class PersonalInfoDto {
  @ApiPropertyOptional({
    description: 'Nombre de pila',
    example: 'Juan',
  })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional({
    description: 'Apellido',
    example: 'Pérez García',
  })
  @IsOptional()
  @IsString()
  apellido?: string;

  @ApiPropertyOptional({
    description: 'Nombre de usuario / handle en redes sociales',
    example: '@juanperez',
  })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional({
    description: 'Dirección de correo electrónico',
    example: 'juan.perez@example.com',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    description: 'Número de teléfono (formato internacional preferido)',
    example: '+525512345678',
  })
  @IsOptional()
  @IsString()
  telefono?: string;

  @ApiPropertyOptional({
    description: 'Ciudad de residencia o trabajo',
    example: 'Ciudad de México',
  })
  @IsOptional()
  @IsString()
  ciudad?: string;

  @ApiPropertyOptional({
    description: 'País de residencia',
    example: 'México',
  })
  @IsOptional()
  @IsString()
  pais?: string;

  @ApiPropertyOptional({
    description: 'Fecha de nacimiento (YYYY-MM-DD)',
    example: '1990-05-15',
  })
  @IsOptional()
  @IsString()
  fechaNacimiento?: string;

  @ApiPropertyOptional({
    description: 'Alias conocidos (separados por coma)',
    example: 'JP, Juanito, Perezoso',
  })
  @IsOptional()
  @IsString()
  alias?: string;

  @ApiPropertyOptional({
    description: 'RFC (México)',
    example: 'PEGJ900515HDF',
  })
  @IsOptional()
  @IsString()
  rfc?: string;

  @ApiPropertyOptional({
    description: 'CURP (México)',
    example: 'PEGJ900515HDFRRN01',
  })
  @IsOptional()
  @IsString()
  curp?: string;
}
