import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { SecurityValidationService } from './security-validation.service';
import { signUploadUrl } from '../../common/upload-access';

export interface CloudinaryUploadResult {
  url: string;
  secureUrl: string;
  publicId: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
  createdAt: Date;
}

export interface ImageMetadata {
  width: number;
  height: number;
  format: string;
  size: number;
  hasAlpha: boolean;
}

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  private readonly folder: string;
  private readonly cloudinaryEnabled: boolean;
  private readonly uploadDir: string;
  private readonly publicBaseUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly securityValidation: SecurityValidationService,
  ) {
    this.cloudinaryEnabled =
      this.configService.get<string>('CLOUDINARY_ENABLED') !== 'false' &&
      Boolean(this.configService.get<string>('CLOUDINARY_CLOUD_NAME')) &&
      Boolean(this.configService.get<string>('CLOUDINARY_API_KEY')) &&
      Boolean(this.configService.get<string>('CLOUDINARY_API_SECRET'));

    // Configure Cloudinary
    if (this.cloudinaryEnabled) {
      cloudinary.config({
        cloud_name: this.configService.get<string>('CLOUDINARY_CLOUD_NAME'),
        api_key: this.configService.get<string>('CLOUDINARY_API_KEY'),
        api_secret: this.configService.get<string>('CLOUDINARY_API_SECRET'),
      });
    }

    this.folder = this.configService.get<string>('CLOUDINARY_FOLDER') || 'ia-cam/osint-searches';
    this.uploadDir = this.configService.get<string>('UPLOAD_DIR') || path.join(process.cwd(), 'uploads');
    this.publicBaseUrl =
      this.configService.get<string>('UPLOAD_PUBLIC_BASE_URL') ||
      `http://localhost:${this.configService.get<string>('PORT') || process.env.PORT || 7105}`;

    fs.mkdirSync(this.uploadDir, { recursive: true });

    if (!this.cloudinaryEnabled) {
      this.logger.warn(`Cloudinary disabled. Local uploads enabled at ${this.uploadDir}`);
    }
  }

  /**
   * Upload image to Cloudinary
   */
  async uploadImage(
    imageBuffer: Buffer,
    filename: string,
    options?: {
      folder?: string;
      tags?: string[];
      context?: Record<string, string>;
    },
  ): Promise<CloudinaryUploadResult> {
    try {
      this.logger.log(`📤 Uploading image: ${filename}`);

      if (!this.cloudinaryEnabled) {
        return await this.saveLocalImage(imageBuffer, filename, options?.folder);
      }

      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: options?.folder || this.folder,
            public_id: filename,
            tags: options?.tags || [],
            context: options?.context || {},
            resource_type: 'image',
          },
          (error, result) => {
            if (error) {
              this.logger.error(`❌ Upload failed: ${error.message}`);
              reject(error);
            } else if (!result) {
              this.logger.error('❌ Upload failed: no result returned');
              reject(new Error('Upload failed: no result returned'));
            } else {
              this.logger.log(`✅ Image uploaded: ${result.secure_url}`);
              resolve({
                url: result.url,
                secureUrl: result.secure_url,
                publicId: result.public_id,
                format: result.format,
                width: result.width,
                height: result.height,
                bytes: result.bytes,
                createdAt: new Date(result.created_at),
              });
            }
          },
        );

        uploadStream.end(imageBuffer);
      });
    } catch (error) {
      this.logger.error(`❌ Upload error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Upload image from URL
   */
  async uploadFromUrl(
    imageUrl: string,
    filename: string,
    options?: {
      folder?: string;
      tags?: string[];
      context?: Record<string, string>;
    },
  ): Promise<CloudinaryUploadResult> {
    try {
      this.logger.log(`📤 Uploading from URL: ${imageUrl}`);
      const safeImageUrl = await this.securityValidation.validatePublicUrl(imageUrl, {
        field: 'imageUrl',
        allowLocalUploads: true,
      });
      if (!safeImageUrl) throw new Error('imageUrl is required');

      if (!this.cloudinaryEnabled) {
        const buffer = await this.securityValidation.fetchPublicUrl(safeImageUrl, {
          field: 'imageUrl',
          allowLocalUploads: true,
        });
        return await this.saveLocalImage(buffer, filename, options?.folder);
      }

      const result = await cloudinary.uploader.upload(safeImageUrl, {
        folder: options?.folder || this.folder,
        public_id: filename,
        tags: options?.tags || [],
        context: options?.context || {},
        resource_type: 'image',
      });

      this.logger.log(`✅ Image uploaded: ${result.secure_url}`);

      return {
        url: result.url,
        secureUrl: result.secure_url,
        publicId: result.public_id,
        format: result.format,
        width: result.width,
        height: result.height,
        bytes: result.bytes,
        createdAt: new Date(result.created_at),
      };
    } catch (error) {
      this.logger.error(`❌ Upload from URL failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Upload base64 image
   */
  async uploadBase64(
    base64Data: string,
    filename: string,
    options?: {
      folder?: string;
      tags?: string[];
      context?: Record<string, string>;
      generateThumbnails?: boolean;
    },
  ): Promise<CloudinaryUploadResult> {
    try {
      this.logger.log(`📤 Uploading base64 image: ${filename}`);

      if (!this.cloudinaryEnabled) {
        const { buffer } = this.decodeBase64Image(base64Data);
        return await this.saveLocalImage(buffer, filename, options?.folder);
      }

      // Configuración de upload con transformaciones automáticas
      const uploadOptions: any = {
        folder: options?.folder || this.folder,
        public_id: filename,
        tags: options?.tags || [],
        context: options?.context || {},
        resource_type: 'image',
      };

      // Generar thumbnails automáticamente si se solicita
      if (options?.generateThumbnails !== false) {
        uploadOptions.eager = [
          { width: 150, height: 150, crop: 'thumb', gravity: 'face' }, // Thumbnail pequeño
          { width: 300, height: 300, crop: 'thumb', gravity: 'face' }, // Thumbnail mediano
          { width: 600, height: 600, crop: 'limit', quality: 'auto' }, // Preview
        ];
        uploadOptions.eager_async = false; // Generar inmediatamente
      }

      const result = await cloudinary.uploader.upload(base64Data, uploadOptions);

      this.logger.log(`✅ Base64 image uploaded: ${result.secure_url}`);

      return {
        url: result.url,
        secureUrl: result.secure_url,
        publicId: result.public_id,
        format: result.format,
        width: result.width,
        height: result.height,
        bytes: result.bytes,
        createdAt: new Date(result.created_at),
      };
    } catch (error) {
      this.logger.error(`❌ Base64 upload failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get image by public ID
   */
  async getImage(publicId: string): Promise<string> {
    try {
      if (!this.cloudinaryEnabled) {
        return this.toPublicUrl(publicId);
      }

      return cloudinary.url(publicId, {
        secure: true,
        sign_url: true,
      });
    } catch (error) {
      this.logger.error(`❌ Get image failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get thumbnail URL for an image
   */
  getThumbnail(
    publicIdOrUrl: string,
    size: 'small' | 'medium' | 'large' = 'small',
  ): string {
    if (!this.cloudinaryEnabled) return this.toPublicUrl(publicIdOrUrl);

    const sizeMap = {
      small: { width: 150, height: 150 },
      medium: { width: 300, height: 300 },
      large: { width: 800, height: 600 },
    };

    const { width, height } = sizeMap[size];

    return cloudinary.url(publicIdOrUrl, {
      transformation: [
        { width, height, crop: 'thumb', gravity: 'face' },
        { quality: 'auto', fetch_format: 'auto' },
      ],
      secure: true,
    });
  }

  /**
   * Get optimized image URL
   */
  getOptimizedUrl(publicIdOrUrl: string, options?: {
    width?: number;
    height?: number;
    quality?: 'auto' | number;
  }): string {
    if (!this.cloudinaryEnabled) return this.toPublicUrl(publicIdOrUrl);

    return cloudinary.url(publicIdOrUrl, {
      transformation: [
        {
          width: options?.width,
          height: options?.height,
          crop: 'limit',
          quality: options?.quality || 'auto',
          fetch_format: 'auto',
        },
      ],
      secure: true,
    });
  }

  /**
   * Delete image from Cloudinary
   */
  async deleteImage(publicId: string): Promise<void> {
    try {
      this.logger.log(`🗑️  Deleting image: ${publicId}`);
      if (!this.cloudinaryEnabled) {
        const localPath = path.resolve(this.uploadDir, publicId.replace(/^\/?uploads[\\/]/, ''));
        if (localPath.startsWith(path.resolve(this.uploadDir)) && fs.existsSync(localPath)) {
          fs.unlinkSync(localPath);
        }
        this.logger.log(`✅ Local image deleted: ${publicId}`);
        return;
      }
      await cloudinary.uploader.destroy(publicId);
      this.logger.log(`✅ Image deleted: ${publicId}`);
    } catch (error) {
      this.logger.error(`❌ Delete failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate thumbnail URL from public ID
   */
  getThumbnailUrl(
    publicId: string,
    size: 'small' | 'medium' | 'large' = 'medium',
  ): string {
    if (!this.cloudinaryEnabled) return this.toPublicUrl(publicId);

    const dimensions = {
      small: { width: 150, height: 150 },
      medium: { width: 300, height: 300 },
      large: { width: 600, height: 600 },
    };

    return cloudinary.url(publicId, {
      secure: true,
      transformation: [
        {
          width: dimensions[size].width,
          height: dimensions[size].height,
          crop: 'thumb',
          gravity: 'face',
          quality: 'auto',
          fetch_format: 'auto',
        },
      ],
    });
  }

  /**
   * Optimize image before upload (compress, resize, convert to WebP)
   */
  async optimizeImage(
    imageBuffer: Buffer,
    options?: {
      maxWidth?: number;
      maxHeight?: number;
      quality?: number;
      format?: 'webp' | 'jpeg' | 'png';
    },
  ): Promise<Buffer> {
    try {
      this.logger.log('🔧 Optimizing image...');

      let pipeline = sharp(imageBuffer);

      // Resize if needed
      if (options?.maxWidth || options?.maxHeight) {
        pipeline = pipeline.resize(options.maxWidth, options.maxHeight, {
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

      // Convert format
      const format = options?.format || 'webp';
      const quality = options?.quality || 80;

      if (format === 'webp') {
        pipeline = pipeline.webp({ quality });
      } else if (format === 'jpeg') {
        pipeline = pipeline.jpeg({ quality });
      } else if (format === 'png') {
        pipeline = pipeline.png({ quality });
      }

      const optimizedBuffer = await pipeline.toBuffer();
      this.logger.log(`✅ Image optimized (${imageBuffer.length} → ${optimizedBuffer.length} bytes)`);

      return optimizedBuffer;
    } catch (error) {
      this.logger.error(`❌ Optimization failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get image metadata
   */
  async getImageMetadata(imageBuffer: Buffer): Promise<ImageMetadata> {
    try {
      const metadata = await sharp(imageBuffer).metadata();

      return {
        width: metadata.width || 0,
        height: metadata.height || 0,
        format: metadata.format || 'unknown',
        size: metadata.size || 0,
        hasAlpha: metadata.hasAlpha || false,
      };
    } catch (error) {
      this.logger.error(`❌ Get metadata failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * List images in folder
   */
  async listImages(folder?: string, maxResults: number = 100): Promise<string[]> {
    try {
      const targetFolder = folder || this.folder;
      this.logger.log(`📂 Listing images in: ${targetFolder}`);

      if (!this.cloudinaryEnabled) {
        const files = fs
          .readdirSync(this.uploadDir)
          .filter((file) => /\.(jpe?g|png|webp|gif)$/i.test(file))
          .slice(0, maxResults);
        return files.map((file) => this.toPublicUrl(file));
      }

      const result = await cloudinary.api.resources({
        type: 'upload',
        prefix: targetFolder,
        max_results: maxResults,
      });

      const urls = result.resources.map((resource: any) => resource.secure_url);
      this.logger.log(`✅ Found ${urls.length} images`);

      return urls;
    } catch (error) {
      this.logger.error(`❌ List images failed: ${error.message}`);
      throw error;
    }
  }

  async deleteFolder(folder: string): Promise<void> {
    const clean = String(folder || '').replace(/^[/\\]+/, '').replace(/\\/g, '/');
    if (!clean || clean.includes('..')) throw new Error('Invalid storage folder');
    if (!this.cloudinaryEnabled) {
      const root = path.resolve(this.uploadDir);
      const target = path.resolve(root, clean);
      if (target !== root && target.startsWith(`${root}${path.sep}`) && fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
      }
      return;
    }
    await cloudinary.api.delete_resources_by_prefix(clean, { resource_type: 'image' });
    await cloudinary.api.delete_folder(clean).catch((error: any) => {
      if (!String(error?.message || '').toLowerCase().includes('not found')) throw error;
    });
  }

  getLocalPath(publicIdOrUrl: string): string | null {
    if (this.cloudinaryEnabled) return null;
    let value = publicIdOrUrl;
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value);
      if (url.origin !== new URL(this.publicBaseUrl).origin || !url.pathname.startsWith('/uploads/')) return null;
      value = decodeURIComponent(url.pathname);
    } else value = value.split('?')[0];
    const clean = value
      .replace(/^\/?uploads[\\/]/, '')
      .replace(/\\/g, '/');
    const localPath = path.resolve(this.uploadDir, clean);
    const root = path.resolve(this.uploadDir);
    return localPath.startsWith(`${root}${path.sep}`) ? localPath : null;
  }

  private async saveLocalImage(imageBuffer: Buffer, filename: string, folder?: string): Promise<CloudinaryUploadResult> {
    const metadata = await sharp(imageBuffer).metadata();
    const format = metadata.format || this.extensionFromFilename(filename) || 'jpg';
    const safeName = this.safeFilename(filename, format);
    const relativeFolder = this.safeFolder(folder);
    const targetDir = path.join(this.uploadDir, relativeFolder);
    fs.mkdirSync(targetDir, { recursive: true });

    const relativePath = path.posix.join(relativeFolder.replace(/\\/g, '/'), safeName);
    const absolutePath = path.join(this.uploadDir, relativePath);

    fs.writeFileSync(absolutePath, imageBuffer);

    const publicUrl = this.toPublicUrl(relativePath);
    this.logger.log(`✅ Local image saved: ${absolutePath}`);

    return {
      url: publicUrl,
      secureUrl: publicUrl,
      publicId: relativePath,
      format,
      width: metadata.width || 0,
      height: metadata.height || 0,
      bytes: imageBuffer.length,
      createdAt: new Date(),
    };
  }

  private decodeBase64Image(input: string): { buffer: Buffer; mimeType: string } {
    const match = input.match(/^data:([^;]+);base64,(.+)$/s);
    const mimeType = match?.[1] || 'image/jpeg';
    const payload = match?.[2] || input;
    return {
      buffer: Buffer.from(payload, 'base64'),
      mimeType,
    };
  }

  private safeFilename(filename: string, format?: string): string {
    const extension = (format || this.extensionFromFilename(filename) || 'jpg').replace('jpeg', 'jpg');
    const base = filename
      .replace(/\.[a-z0-9]+$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'image';

    return `${Date.now()}-${base}.${extension}`;
  }

  private safeFolder(folder?: string): string {
    const clean = String(folder || 'general')
      .replace(/\\/g, '/')
      .split('/')
      .map((part) =>
        part
          .toLowerCase()
          .replace(/[^a-z0-9-_]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 80),
      )
      .filter(Boolean)
      .join('/');

    return clean || 'general';
  }

  private extensionFromFilename(filename: string): string | undefined {
    const ext = filename.split('.').pop()?.toLowerCase();
    return ext && ext !== filename ? ext : undefined;
  }

  private toPublicUrl(publicIdOrUrl: string): string {
    if (/^https?:\/\//i.test(publicIdOrUrl)) return signUploadUrl(publicIdOrUrl, this.publicBaseUrl);
    const clean = publicIdOrUrl.replace(/^\/?uploads[\\/]/, '').replace(/\\/g, '/');
    return signUploadUrl(`${this.publicBaseUrl.replace(/\/$/, '')}/uploads/${clean}`, this.publicBaseUrl);
  }
}
