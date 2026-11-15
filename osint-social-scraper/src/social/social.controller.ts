import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { InternalApiKeyGuard } from '../common/guards/internal-api-key.guard';
import { ResolveProfileUrlDto } from './dto/resolve-profile-url.dto';
import { SearchImageDto } from './dto/search-image.dto';
import { SearchNameDto } from './dto/search-name.dto';
import { SearchUsernameDto } from './dto/search-username.dto';
import { SocialService } from './social.service';

@UseGuards(InternalApiKeyGuard)
@Controller('social')
export class SocialController {
  constructor(private readonly socialService: SocialService) {}

  @Get('platforms')
  platforms() {
    return this.socialService.platforms();
  }

  @Get('searches/recent')
  recent(@Query('limit') limit?: string) {
    return this.socialService.recent(Number(limit || 20));
  }

  @Get('searches/:id')
  findSearch(@Param('id') id: string) {
    return this.socialService.findSearch(id);
  }

  @Post('search/name')
  searchByName(@Body() dto: SearchNameDto) {
    return this.socialService.searchByName(dto);
  }

  @Post('search/username')
  searchByUsername(@Body() dto: SearchUsernameDto) {
    return this.socialService.searchByUsername(dto);
  }

  @Post('search/image')
  searchByImage(@Body() dto: SearchImageDto) {
    return this.socialService.searchByImage(dto);
  }

  @Post('profile/resolve')
  resolveProfileUrl(@Body() dto: ResolveProfileUrlDto) {
    return this.socialService.resolveProfileUrl(dto);
  }
}
