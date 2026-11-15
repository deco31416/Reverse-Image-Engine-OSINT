import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected =
      this.configService.get<string>('SOCIAL_SCRAPER_API_KEY') ||
      this.configService.get<string>('MICROSERVICES_API_KEY');
    if (!expected) return true;

    const request = context.switchToHttp().getRequest();
    const provided = request.headers['x-api-key'];
    if (typeof provided === 'string' && this.safeCompare(provided, expected)) return true;

    throw new UnauthorizedException('Invalid internal API key');
  }

  private safeCompare(provided: string, expected: string) {
    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);
    return providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
  }
}
