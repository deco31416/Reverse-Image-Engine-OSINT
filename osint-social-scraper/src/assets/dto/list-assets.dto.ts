import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListAssetsDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  platform?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  owner?: string;

  @IsOptional()
  @IsIn(['candidate', 'positive', 'false_positive', 'archived'])
  status?: 'candidate' | 'positive' | 'false_positive' | 'archived';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  osintSearchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24000)
  osintSearchIds?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
