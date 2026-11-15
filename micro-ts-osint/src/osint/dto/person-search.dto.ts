import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ImageSource {
  CAMERA = 'camera',
  DATASEC = 'datasec',
  OSINT = 'osint',
  UPLOAD = 'upload',
}

export enum SearchEngine {
  GOOGLE = 'google',
  YANDEX = 'yandex',
  TINEYE = 'tineye',
}

export enum IdentificationMethod {
  GROQ = 'groq',
  MANUAL = 'manual',
  HYBRID = 'hybrid',
}

export class PersonSearchDto {
  @ApiProperty({
    description: 'Source of the image',
    enum: ImageSource,
    example: ImageSource.CAMERA,
  })
  @IsEnum(ImageSource)
  imageSource: ImageSource;

  @ApiPropertyOptional({
    description: 'Direct image URL',
    example: 'https://example.com/person.jpg',
  })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({
    description: 'Base64 encoded image',
  })
  @IsOptional()
  @IsString()
  imageBase64?: string;

  @ApiPropertyOptional({
    description: 'Camera ID (when source is camera)',
    example: 'cam-001',
  })
  @IsOptional()
  @IsString()
  cameraId?: string;

  @ApiPropertyOptional({
    description: 'Datasec image ID (when source is datasec)',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsString()
  datasecImageId?: string;

  @ApiPropertyOptional({
    description: 'OSINT search ID (when source is osint)',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsString()
  osintSearchId?: string;

  @ApiProperty({
    description: 'Generate enhanced image with Gemini',
    example: true,
    default: true,
  })
  @IsBoolean()
  generateEnhanced: boolean = true;

  @ApiProperty({
    description: 'Search engines to use',
    enum: SearchEngine,
    isArray: true,
    example: [SearchEngine.GOOGLE, SearchEngine.YANDEX, SearchEngine.TINEYE],
    default: [SearchEngine.GOOGLE, SearchEngine.YANDEX, SearchEngine.TINEYE],
  })
  @IsArray()
  @IsEnum(SearchEngine, { each: true })
  searchEngines: SearchEngine[] = [
    SearchEngine.GOOGLE,
    SearchEngine.YANDEX,
    SearchEngine.TINEYE,
  ];

  @ApiProperty({
    description: 'Enable web crawler for found URLs',
    example: true,
    default: true,
  })
  @IsBoolean()
  enableCrawler: boolean = true;

  @ApiProperty({
    description: 'Identification method',
    enum: IdentificationMethod,
    example: IdentificationMethod.HYBRID,
    default: IdentificationMethod.HYBRID,
  })
  @IsEnum(IdentificationMethod)
  identificationMethod: IdentificationMethod = IdentificationMethod.HYBRID;

  @ApiPropertyOptional({
    description: 'Additional context for identification',
    example: 'Person seen at company entrance',
  })
  @IsOptional()
  @IsString()
  context?: string;
}

export class EnhanceImageDto {
  @ApiProperty({
    description: 'Front-facing image (URL or base64)',
    example: 'https://example.com/front.jpg',
  })
  @IsString()
  frontImage: string;

  @ApiPropertyOptional({
    description: 'Left profile image (URL or base64)',
    example: 'https://example.com/left.jpg',
  })
  @IsOptional()
  @IsString()
  leftProfileImage?: string;

  @ApiPropertyOptional({
    description: 'Right profile image (URL or base64)',
    example: 'https://example.com/right.jpg',
  })
  @IsOptional()
  @IsString()
  rightProfileImage?: string;

  @ApiPropertyOptional({
    description: 'Additional description for enhancement',
    example: 'Male, approximately 35 years old, wearing glasses',
  })
  @IsOptional()
  @IsString()
  description?: string;
}

export class PersonIdentificationDto {
  @ApiPropertyOptional({
    description: 'Person first name',
    example: 'John',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: 'Person last name',
    example: 'Doe',
  })
  @IsOptional()
  @IsString()
  surname?: string;

  @ApiPropertyOptional({
    description: 'Full name',
    example: 'John Doe',
  })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional({
    description: 'Username or handle',
    example: '@johndoe',
  })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional({
    description: 'Job position or title',
    example: 'Software Engineer',
  })
  @IsOptional()
  @IsString()
  position?: string;

  @ApiPropertyOptional({
    description: 'Organization or company',
    example: 'Tech Corp',
  })
  @IsOptional()
  @IsString()
  organization?: string;

  @ApiPropertyOptional({
    description: 'Location',
    example: 'San Francisco, CA',
  })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty({
    description: 'Confidence score (0-100)',
    example: 85,
  })
  @IsOptional()
  confidence: number;

  @ApiProperty({
    description: 'Identification method used',
    enum: IdentificationMethod,
    example: IdentificationMethod.GROQ,
  })
  @IsEnum(IdentificationMethod)
  method: IdentificationMethod;

  @ApiPropertyOptional({
    description: 'Whether identification was manually verified',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  manuallyVerified?: boolean;

  @ApiPropertyOptional({
    description: 'Additional notes from manual verification',
  })
  @IsOptional()
  @IsString()
  verificationNotes?: string;
}

export class CrawlResultsDto {
  @ApiProperty({
    description: 'URLs to crawl',
    type: [String],
    example: ['https://example.com/profile', 'https://linkedin.com/in/johndoe'],
  })
  @IsArray()
  @IsString({ each: true })
  urls: string[];

  @ApiPropertyOptional({
    description: 'Maximum number of pages to crawl',
    example: 10,
    default: 10,
  })
  @IsOptional()
  maxPages?: number = 10;

  @ApiPropertyOptional({
    description: 'Use headless browser (slower but handles JavaScript)',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  useHeadlessBrowser?: boolean = false;

  @ApiPropertyOptional({
    description: 'Extract email addresses',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  extractEmails?: boolean = true;

  @ApiPropertyOptional({
    description: 'Extract phone numbers',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  extractPhones?: boolean = true;
}

export class IdentifyPersonFromResultsDto {
  @ApiProperty({
    description: 'Search results from reverse image search',
    type: 'array',
  })
  searchResults: Array<{
    title: string;
    snippet: string;
    url: string;
  }>;

  @ApiProperty({
    description: 'Crawled content from web pages',
    type: 'array',
  })
  crawledContent: Array<{
    url: string;
    title: string;
    content: string;
    emails?: string[];
    phones?: string[];
  }>;

  @ApiPropertyOptional({
    description: 'Facial analysis from Gemini',
  })
  @IsOptional()
  facialAnalysis?: {
    age?: string;
    gender?: string;
    ethnicity?: string;
    distinctiveFeatures?: string[];
  };

  @ApiPropertyOptional({
    description: 'Social media profiles found',
  })
  @IsOptional()
  socialMediaProfiles?: {
    facebook?: string[];
    instagram?: string[];
    twitter?: string[];
    linkedin?: string[];
    tiktok?: string[];
  };
}
