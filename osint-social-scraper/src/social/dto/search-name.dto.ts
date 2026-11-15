import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { SOCIAL_PLATFORMS, SocialPlatform } from '../types/social-platform.type';

export class SearchNameDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  query: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsIn(SOCIAL_PLATFORMS, { each: true })
  platforms?: SocialPlatform[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
