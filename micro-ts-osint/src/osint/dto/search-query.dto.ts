import {
  IsOptional,
  IsEnum,
  IsString,
  IsBoolean,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SearchType, SearchCategory } from './create-search.dto';

export class SearchQueryDto {
  @IsOptional()
  @IsEnum(SearchType)
  searchType?: SearchType;

  @IsOptional()
  @IsEnum(SearchCategory)
  category?: SearchCategory;

  @IsOptional()
  @IsString()
  clusterLetter?: string;

  @IsOptional()
  @IsString()
  tag?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 50;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  offset?: number = 0;

  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
