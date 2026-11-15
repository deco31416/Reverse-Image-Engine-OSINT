import { PartialType } from '@nestjs/mapped-types';
import { CreateSearchDto } from './create-search.dto';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateSearchDto extends PartialType(CreateSearchDto) {
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
