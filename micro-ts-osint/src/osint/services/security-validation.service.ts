import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lookup } from 'dns/promises';
import * as net from 'net';
import * as https from 'https';
import * as http from 'http';
import { verifyUploadUrl } from '../../common/upload-access';

type UrlValidationOptions = {
  field?: string;
  allowLocalUploads?: boolean;
};

type ImageValidationOptions = {
  field?: string;
  maxMb?: number;
};

type FetchPublicUrlOptions = UrlValidationOptions & {
  maxMb?: number;
  accept?: string;
};

@Injectable()
export class SecurityValidationService {
  private readonly maxImageMb: number;
  private readonly uploadPublicBaseUrl: string;
  private readonly isProduction: boolean;

  constructor(private readonly configService: ConfigService) {
    this.maxImageMb = Number(this.configService.get<string>('OSINT_MAX_IMAGE_UPLOAD_MB') || 10);
    this.uploadPublicBaseUrl = String(this.configService.get<string>('UPLOAD_PUBLIC_BASE_URL') || '').replace(/\/$/, '');
    this.isProduction = (this.configService.get<string>('NODE_ENV') || process.env.NODE_ENV) === 'production';
  }

  async validatePublicUrl(value?: string, options: UrlValidationOptions = {}) {
    const field = options.field || 'url';
    const raw = String(value || '').trim();
    if (!raw) return undefined;

    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new BadRequestException(`${field} must be a valid URL`);
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new BadRequestException(`${field} must use http or https`);
    }

    if (parsed.username || parsed.password) {
      throw new BadRequestException(`${field} must not contain credentials`);
    }

    if (options.allowLocalUploads && this.isConfiguredUploadUrl(parsed)) {
      if (!verifyUploadUrl(parsed.toString())) throw new BadRequestException(`${field} requires a valid temporary image URL`);
      if (!this.isProduction) return parsed.toString();
    }

    if (this.isBlockedHostname(parsed.hostname)) {
      throw new BadRequestException(`${field} points to a private or local host`);
    }

    await this.assertDnsDoesNotResolvePrivate(parsed.hostname, field);
    return parsed.toString();
  }

  async fetchPublicUrl(value: string, options: FetchPublicUrlOptions = {}) {
    const field = options.field || 'url';
    const safeUrl = await this.validatePublicUrl(value, options);
    if (!safeUrl) throw new BadRequestException(`${field} is required`);

    const parsed = new URL(safeUrl);
    if (!this.isProduction && options.allowLocalUploads && this.isConfiguredUploadUrl(parsed)) {
      const response = await fetch(safeUrl, { redirect: 'error', signal: AbortSignal.timeout(15000) });
      return this.responseToBuffer(response, options, field);
    }

    const address = await this.resolvePublicAddress(parsed.hostname, field);
    const target = new URL(safeUrl);
    target.hostname = net.isIPv6(address) ? `[${address}]` : address;

    const buffer = await this.fetchResolvedUrl(target, parsed, options, field);
    return buffer;
  }

  validateImageBase64(value?: string, options: ImageValidationOptions = {}) {
    const field = options.field || 'imageBase64';
    const raw = String(value || '').trim();
    if (!raw) return undefined;

    const match = raw.match(/^data:([^;]+);base64,(.+)$/);
    const mimeType = match ? match[1].toLowerCase() : 'image/jpeg';
    const payload = match ? match[2] : raw;

    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'].includes(mimeType)) {
      throw new BadRequestException(`${field} must be jpeg, png, webp or gif`);
    }

    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(payload)) {
      throw new BadRequestException(`${field} is not valid base64`);
    }

    const bytes = Math.floor((payload.replace(/\s/g, '').length * 3) / 4);
    const maxBytes = (options.maxMb || this.maxImageMb) * 1024 * 1024;
    if (bytes > maxBytes) {
      throw new BadRequestException(`${field} exceeds ${(options.maxMb || this.maxImageMb)}MB`);
    }

    return { mimeType, payload, bytes };
  }

  private isConfiguredUploadUrl(parsed: URL) {
    if (!this.uploadPublicBaseUrl) return false;
    try {
      const base = new URL(this.uploadPublicBaseUrl);
      if (this.isProduction && this.isBlockedHostname(base.hostname)) return false;
      return parsed.origin === base.origin && parsed.pathname.startsWith('/uploads/');
    } catch {
      return false;
    }
  }

  private async resolvePublicAddress(hostname: string, field: string) {
    const ipHost = this.normalizeIpHostname(hostname);
    if (net.isIP(ipHost)) {
      if (this.isPrivateIp(ipHost)) throw new BadRequestException(`${field} resolves to a private IP`);
      return ipHost;
    }

    const addresses: Array<{ address: string; family: number }> = await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
    const publicAddress = addresses.find((entry) => !this.isPrivateIp(entry.address));
    if (!publicAddress) throw new BadRequestException(`${field} host could not be resolved to a public IP`);
    return publicAddress.address;
  }

  private fetchResolvedUrl(target: URL, original: URL, options: FetchPublicUrlOptions, field: string) {
    return new Promise<Buffer>((resolve, reject) => {
      const client = original.protocol === 'https:' ? https : http;
      const request = client.get(
        target,
        {
          timeout: 15000,
          headers: {
            Host: original.host,
            Accept: options.accept || 'image/*,*/*;q=0.8',
            'User-Agent': 'OSINT-Deco/1.0',
          },
          servername: original.hostname,
        } as any,
        (response) => {
          const status = response.statusCode || 0;
          if (status >= 300 && status < 400) {
            response.resume();
            reject(new BadRequestException(`${field} redirects are not allowed`));
            return;
          }
          if (status < 200 || status >= 300) {
            response.resume();
            reject(new BadRequestException(`${field} download failed with status ${status}`));
            return;
          }

          const chunks: Buffer[] = [];
          let total = 0;
          const maxBytes = (options.maxMb || this.maxImageMb) * 1024 * 1024;

          response.on('data', (chunk: Buffer) => {
            total += chunk.length;
            if (total > maxBytes) {
              request.destroy(new BadRequestException(`${field} exceeds ${(options.maxMb || this.maxImageMb)}MB`));
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => resolve(Buffer.concat(chunks)));
          response.on('error', reject);
          response.on('aborted', () => reject(new BadRequestException(`${field} download was interrupted`)));
        },
      );

      request.on('timeout', () => request.destroy(new BadRequestException(`${field} download timed out`)));
      request.on('error', (error) => reject(error));
    });
  }

  private async responseToBuffer(response: Response, options: FetchPublicUrlOptions, field: string) {
    if (!response.ok) throw new BadRequestException(`${field} download failed with status ${response.status}`);
    const maxBytes = (options.maxMb || this.maxImageMb) * 1024 * 1024;
    if (!response.body) throw new BadRequestException(`${field} download has no body`);
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new BadRequestException(`${field} exceeds ${(options.maxMb || this.maxImageMb)}MB`);
        }
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks);
    } finally {
      reader.releaseLock();
    }
  }

  private async assertDnsDoesNotResolvePrivate(hostname: string, field: string) {
    const ipHost = this.normalizeIpHostname(hostname);
    if (net.isIP(ipHost)) {
      if (this.isPrivateIp(ipHost)) throw new BadRequestException(`${field} resolves to a private IP`);
      return;
    }

    try {
      const addresses = await lookup(hostname, { all: true, verbatim: true });
      if (!addresses.length) throw new BadRequestException(`${field} host could not be resolved`);
      if (addresses.some((entry) => this.isPrivateIp(entry.address))) {
        throw new BadRequestException(`${field} resolves to a private IP`);
      }
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(`${field} host could not be validated`);
    }
  }

  private isBlockedHostname(hostname: string) {
    const normalized = hostname.toLowerCase();
    return (
      normalized === 'localhost' ||
      normalized === 'localhost.localdomain' ||
      normalized.endsWith('.localhost') ||
      normalized.endsWith('.local') ||
      normalized === 'metadata.google.internal'
    );
  }

  private normalizeIpHostname(hostname: string) {
    return String(hostname || '').replace(/^\[|\]$/g, '');
  }

  private isPrivateIp(value: string) {
    value = this.normalizeIpHostname(value);
    if (net.isIPv4(value)) {
      const parts = value.split('.').map((part) => Number(part));
      const [a, b] = parts;
      return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 192 && b === 0 && (parts[2] === 0 || parts[2] === 2)) ||
        (a === 198 && b === 51 && parts[2] === 100) ||
        (a === 203 && b === 0 && parts[2] === 113) ||
        (a === 198 && (b === 18 || b === 19)) ||
        a >= 224
      );
    }

    if (net.isIPv6(value)) {
      // Only global unicast is eligible. This also rejects every spelling of
      // IPv4-mapped IPv6, loopback, link-local, multicast and translation ranges.
      const global = new net.BlockList();
      global.addSubnet('2000::', 3, 'ipv6');
      if (!global.check(value, 'ipv6')) return true;
      const reserved = new net.BlockList();
      reserved.addSubnet('2001::', 23, 'ipv6');
      reserved.addSubnet('2001:db8::', 32, 'ipv6');
      reserved.addSubnet('2002::', 16, 'ipv6');
      reserved.addSubnet('3fff::', 20, 'ipv6');
      return reserved.check(value, 'ipv6');
    }

    return true;
  }
}
