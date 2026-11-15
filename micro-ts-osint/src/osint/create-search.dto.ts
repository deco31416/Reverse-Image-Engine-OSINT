import {
  IsString,
  IsEnum,
  IsOptional,
  IsArray,
  IsBoolean,
  MinLength,
  MaxLength,
} from 'class-validator';

export enum SearchType {
  GOOGLE = 'google',
  TWITTER = 'twitter',
  FACEBOOK = 'facebook',
  INSTAGRAM = 'instagram',
  LINKEDIN = 'linkedin',
  YOUTUBE = 'youtube',
  FACE_IMAGE = 'face_image',
  ALL = 'all',
}

export enum SearchCategory {
  PERSON = 'person',
  ORGANIZATION = 'organization',
  LOCATION = 'location',
  EVENT = 'event',
  KEYWORD = 'keyword',
  OTHER = 'other',
}

export class CreateSearchDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  query: string;

  @IsEnum(SearchType)
  searchType: SearchType;

  @IsEnum(SearchCategory)
  @IsOptional()
  category?: SearchCategory;

  @IsArray()
  @IsOptional()
  tags?: string[];

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;

  @IsBoolean()
  @IsOptional()
  autoRefresh?: boolean;

  @IsString()
  @IsOptional()
  clusterLetter?: string; // A-Z for alphabetical clustering

  @IsString()
  @IsOptional()
  imageData?: string; // Base64 image data for face/image search

  @IsString()
  @IsOptional()
  imageUrl?: string; // URL of image for face/image search
}
