import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import sharp from 'sharp';
import { StorageService } from '../../storage/storage.service';
import type { SocialPlatform } from '../types/social-platform.type';

type CandidateImage = {
  absolutePath: string;
  relativePath: string;
  publicUrl: string;
  platform: string;
  owner: string;
  filename: string;
};

@Injectable()
export class ImageFingerprintService {
  constructor(private readonly storageService: StorageService) {}

  async searchSimilar(input: {
    base64: string;
    platforms?: SocialPlatform[];
    limit?: number;
  }) {
    const queryBuffer = this.parseBase64Image(input.base64);
    const queryHash = await this.averageHash(queryBuffer);
    const candidates = await this.listCandidateImages(input.platforms);
    const matches = [];

    for (const candidate of candidates) {
      try {
        const candidateBuffer = await fs.readFile(candidate.absolutePath);
        const candidateHash = await this.averageHash(candidateBuffer);
        const distance = this.hammingDistance(queryHash, candidateHash);
        const similarity = Math.max(0, 1 - distance / queryHash.length);
        matches.push({
          ...candidate,
          distance,
          similarity: Number(similarity.toFixed(4)),
          score: Math.round(similarity * 100),
        });
      } catch {
        // Ignore corrupt or unsupported images and keep the visual search moving.
      }
    }

    return matches
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, Math.min(Math.max(input.limit || 10, 1), 50));
  }

  private async averageHash(buffer: Buffer) {
    const pixels = await sharp(buffer)
      .rotate()
      .resize(16, 16, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();

    const average = pixels.reduce((sum, value) => sum + value, 0) / pixels.length;
    return Array.from(pixels, (value) => (value >= average ? '1' : '0')).join('');
  }

  private hammingDistance(left: string, right: string) {
    const length = Math.min(left.length, right.length);
    let distance = Math.abs(left.length - right.length);

    for (let index = 0; index < length; index += 1) {
      if (left[index] !== right[index]) distance += 1;
    }

    return distance;
  }

  private async listCandidateImages(platforms?: SocialPlatform[]) {
    const candidates: CandidateImage[] = [];
    const root = path.join(this.storageService.uploadDir, 'social');
    const allowedPlatforms = new Set(platforms || []);

    await this.walk(root, async (absolutePath) => {
      const extension = path.extname(absolutePath).toLowerCase();
      if (!['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) return;

      const relativeFromUploads = path.relative(this.storageService.uploadDir, absolutePath).replace(/\\/g, '/');
      const parts = relativeFromUploads.split('/');
      const platform = parts[1] || 'general';
      const owner = parts[3] || 'unknown';

      if (allowedPlatforms.size && !allowedPlatforms.has(platform as SocialPlatform)) return;

      candidates.push({
        absolutePath,
        relativePath: `/uploads/${relativeFromUploads}`,
        publicUrl: this.storageService.publicUrl(relativeFromUploads),
        platform,
        owner,
        filename: path.basename(absolutePath),
      });
    });

    return candidates;
  }

  private async walk(directory: string, onFile: (absolutePath: string) => Promise<void>) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await this.walk(absolutePath, onFile);
      } else if (entry.isFile()) {
        await onFile(absolutePath);
      }
    }
  }

  private parseBase64Image(value: string) {
    const input = String(value || '').trim();
    const match = input.match(/^data:image\/(?:png|jpe?g|webp);base64,(.+)$/i);
    const raw = match?.[1] || input;
    const buffer = Buffer.from(raw, 'base64');

    if (!buffer.length) {
      throw new Error('Invalid image payload');
    }

    return buffer;
  }
}
