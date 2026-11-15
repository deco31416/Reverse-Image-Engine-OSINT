import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { SOCIAL_PLATFORMS, SocialPlatform } from '../../social/types/social-platform.type';

export class SaveImageDto {
  @IsString()
  base64: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  scope?: string;

  @IsOptional()
  @IsIn(SOCIAL_PLATFORMS)
  platform?: SocialPlatform;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  owner?: string;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  filename?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  osintSearchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  sourceUrl?: string;
}
