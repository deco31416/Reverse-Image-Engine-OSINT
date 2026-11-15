import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { signUploadUrl } from '../common/upload-access';

type SaveImageInput = {
  base64: string;
  scope?: string;
  platform?: string;
  owner?: string;
  filename?: string;
};

@Injectable()
export class StorageService {
  constructor(private readonly configService: ConfigService) {}

  get uploadDir() {
    return this.configService.get<string>('UPLOAD_DIR') || path.join(process.cwd(), 'uploads');
  }

  get publicBaseUrl() {
    return (this.configService.get<string>('UPLOAD_PUBLIC_BASE_URL') || '').replace(/\/$/, '');
  }

  info() {
    return {
      provider: 'local-volume',
      uploadDir: this.uploadDir,
      publicBaseUrl: this.publicBaseUrl,
      staticPath: '/uploads',
      railwayVolumeReady: this.uploadDir === '/app/uploads' || this.uploadDir.startsWith('/app/uploads/'),
    };
  }

  publicUrl(relativePath: string) {
    const clean = String(relativePath || '').replace(/^\/+/, '');
    const uploadsPath = clean.startsWith('uploads/') ? clean : `uploads/${clean}`;
    return signUploadUrl(this.publicBaseUrl ? `${this.publicBaseUrl}/${uploadsPath}` : `/${uploadsPath}`, this.publicBaseUrl);
  }

  async saveBase64Image(input: SaveImageInput) {
    const parsed = await this.parseBase64Image(input.base64);
    const scope = this.safeSegment(input.scope || 'social');
    const platform = this.safeSegment(input.platform || 'general');
    const owner = this.safeSegment(input.owner || 'unknown');
    const date = new Date().toISOString().slice(0, 10);
    const name = this.safeFilename(input.filename || 'image').replace(/\.[^.]+$/, '');
    const filename = `${name}-${randomUUID()}.${parsed.extension}`;
    const relativePath = path.posix.join(scope, platform, date, owner, filename);
    const root = path.resolve(this.uploadDir);
    const absolutePath = path.resolve(root, relativePath);
    if (!absolutePath.startsWith(`${root}${path.sep}`)) throw new BadRequestException('Image path escapes upload directory');

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, parsed.buffer, { flag: 'wx' });

    return {
      provider: 'local-volume',
      filename,
      relativePath: `/uploads/${relativePath.replace(/\\/g, '/')}`,
      absolutePath,
      publicUrl: this.publicUrl(relativePath),
      mimeType: parsed.mimeType,
      size: parsed.buffer.length,
    };
  }

  async deleteAssetFile(absolutePath?: string) {
    if (!absolutePath) return false;
    const root = path.resolve(this.uploadDir);
    const target = path.resolve(absolutePath);
    if (target === root || !target.startsWith(`${root}${path.sep}`)) throw new Error('Asset path escapes upload directory');
    await fs.rm(target, { force: true });
    return true;
  }

  safeSegment(value: string) {
    const clean = String(value || 'unknown')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .toLowerCase();
    if (clean === '.' || clean === '..') throw new BadRequestException('Invalid image path segment');
    return clean || 'unknown';
  }

  private safeFilename(value: string) {
    const parsed = path.parse(value);
    const name = this.safeSegment(parsed.name || 'image');
    const extension = this.safeSegment((parsed.ext || '.jpg').replace(/^\./, '')) || 'jpg';
    return `${name}.${extension}`;
  }

  private async parseBase64Image(value: string) {
    const input = String(value || '').trim();
    const match = input.match(/^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i);
    const mimeType = match?.[1]?.toLowerCase() || 'image/jpeg';
    const raw = match?.[2] || input;
    const maxBytes = 10 * 1024 * 1024;
    if (raw.length > 4 * Math.ceil(maxBytes / 3)) throw new BadRequestException('Image exceeds 10MB');
    if (!/^(?:[a-zA-Z\d+/]{4})*(?:[a-zA-Z\d+/]{2}==|[a-zA-Z\d+/]{3}=)?$/.test(raw)) {
      throw new BadRequestException('Invalid image base64');
    }
    const buffer = Buffer.from(raw, 'base64');

    if (!buffer.length) {
      throw new BadRequestException('Invalid image payload');
    }

    if (buffer.length > maxBytes) throw new BadRequestException('Image exceeds 10MB');
    try {
      const image = sharp(buffer, { limitInputPixels: 25000000, failOn: 'warning' });
      const metadata = await image.metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format || '')) throw new Error('Unsupported format');
      // Re-encoding removes embedded active content and ignores client extensions.
      const encoded = await image.rotate().webp({ quality: 85 }).toBuffer();
      return { buffer: encoded, mimeType: 'image/webp', extension: 'webp' };
    } catch {
      throw new BadRequestException('Payload must be a valid JPEG, PNG or WEBP image');
    }
  }
}
