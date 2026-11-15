import { IsNotEmpty, IsString, IsUrl, MaxLength } from 'class-validator';

export class ResolveProfileUrlDto {
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  url: string;
}
