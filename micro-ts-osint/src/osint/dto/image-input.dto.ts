import { IsString, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ImageSource {
  CAMERA = 'camera',
  DATASEC = 'datasec',
  OSINT = 'osint',
  UPLOAD = 'upload',
}

/**
 * DTO para entrada de imagen multi-fuente
 * Soporta URL, base64, cámara, datasec, osint
 */
export class ImageInputDto {
  @ApiProperty({
    description: 'Fuente de la imagen',
    enum: ImageSource,
    example: ImageSource.UPLOAD,
  })
  @IsEnum(ImageSource)
  source: ImageSource;

  @ApiPropertyOptional({
    description: 'URL directa de la imagen',
    example: 'https://example.com/person.jpg',
  })
  @IsOptional()
  @IsString()
  url?: string;

  @ApiPropertyOptional({
    description: 'Imagen codificada en base64',
    example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
  })
  @IsOptional()
  @IsString()
  base64?: string;

  @ApiPropertyOptional({
    description: 'ID de cámara (cuando source es camera)',
    example: 'cam-front-entrance',
  })
  @IsOptional()
  @IsString()
  cameraId?: string;

  @ApiPropertyOptional({
    description: 'ID de imagen en Datasec (cuando source es datasec)',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsString()
  datasecImageId?: string;

  @ApiPropertyOptional({
    description: 'ID de búsqueda OSINT previa (cuando source es osint)',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsString()
  osintSearchId?: string;
}
