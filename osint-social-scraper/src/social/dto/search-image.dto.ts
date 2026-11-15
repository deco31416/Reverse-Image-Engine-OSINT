import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { SOCIAL_PLATFORMS, SocialPlatform } from '../types/social-platform.type';

export class SearchImageDto {
  @IsString()
  base64: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(14)
  @IsIn(SOCIAL_PLATFORMS, { each: true })
  platforms?: SocialPlatform[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsBoolean()
  enrichProfiles?: boolean;

  @IsOptional()
  @IsString()
  ownerHint?: string;
}
