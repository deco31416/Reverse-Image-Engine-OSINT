import { IsIn, IsOptional, IsString } from 'class-validator';

export class MarkAssetDto {
  @IsIn(['candidate', 'positive', 'false_positive', 'archived'])
  status: 'candidate' | 'positive' | 'false_positive' | 'archived';

  @IsOptional()
  @IsString()
  note?: string;
}
