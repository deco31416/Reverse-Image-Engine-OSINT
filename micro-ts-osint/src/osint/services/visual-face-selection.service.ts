import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { CloudinaryService } from './cloudinary.service';
import { DatasecCurationService } from './datasec-curation.service';
import { GoogleVisionService, VisionFaceBox } from './google-vision.service';
import { SecurityValidationService } from './security-validation.service';
import { StoragePathService } from './storage-path.service';
import { FaceBiometricClientService } from './face-biometric-client.service';

type DetectFacesInput = {
  imageUrl?: string;
  imageBase64?: string;
  datasecImageId?: string;
  userId?: string;
  label?: string;
};

type StoredImage = {
  buffer: Buffer;
  imageUrl: string;
  publicId: string;
  width: number;
  height: number;
  source: 'upload' | 'url' | 'datasec';
};

@Injectable()
export class VisualFaceSelectionService {
  private readonly logger = new Logger(VisualFaceSelectionService.name);

  constructor(
    private readonly cloudinaryService: CloudinaryService,
    private readonly datasecCuration: DatasecCurationService,
    private readonly googleVisionService: GoogleVisionService,
    private readonly securityValidation: SecurityValidationService,
    private readonly storagePath: StoragePathService,
    private readonly biometricClient: FaceBiometricClientService,
    private readonly configService: ConfigService,
  ) {}

  async detectFaces(input: DetectFacesInput) {
    const requestId = randomUUID();
    const label = this.storagePath.safeSegment(input.userId || 'visual-face-selection');
    const folder = `face-selections/${label}/${requestId}`;
    const original = await this.resolveAndStoreOriginal(input, folder);
    const detectionSource = this.base64FromBuffer(original.buffer);

    let boxes: VisionFaceBox[] = [];
    try {
      boxes = await this.googleVisionService.detectFaceBoxes(detectionSource);
    } catch (error: any) {
      this.logger.warn(`Face box detection degraded: ${error?.message || error}`);
    }

    let detector = boxes.length ? 'google_vision' : 'opencv_yunet';
    if (!boxes.length) {
      try {
        const local = await this.biometricClient.extract(original.buffer, 12, false);
        boxes = (local.faces || []).map((face) => ({
          boundingBox: face.boundingBox,
          confidence: face.detectionScore,
          emotions: [],
          landmarks: [],
        }));
      } catch (error: any) {
        this.logger.warn(`Local face detection unavailable: ${error?.message || error}`);
      }
    }

    if (!boxes.length) {
      throw new BadRequestException('No se detectó un rostro utilizable. Usa otra fotografía más clara.');
    }

    const normalizedBoxes = boxes.map((box) => this.expandAndClampBox(box, original.width, original.height));

    const faces = await Promise.all(
      normalizedBoxes.slice(0, 12).map(async (box, index) => {
        const cropBuffer = await sharp(original.buffer)
          .rotate()
          .extract({
            left: box.boundingBox.x,
            top: box.boundingBox.y,
            width: box.boundingBox.width,
            height: box.boundingBox.height,
          })
          .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 88 })
          .toBuffer();

        const crop = await this.cloudinaryService.uploadImage(
          cropBuffer,
          `face-${index + 1}.jpg`,
          {
            folder: `${folder}/faces`,
            tags: ['face-selection', 'crop'],
            context: {
              originalPublicId: original.publicId,
              faceIndex: String(index),
            },
          },
        );

        return {
          faceId: `${requestId}-${index + 1}`,
          index,
          label: `Rostro ${index + 1}`,
          imageUrl: crop.secureUrl,
          thumbnailUrl: this.cloudinaryService.getThumbnailUrl(crop.publicId, 'medium'),
          publicId: crop.publicId,
          boundingBox: box.boundingBox,
          confidence: box.confidence,
          qualityScore: this.qualityScore(box, original.width, original.height),
          emotions: box.emotions,
          selected: index === 0,
          fallback: false,
          selectionToken: this.selectionToken(`${requestId}-${index + 1}`, crop.secureUrl),
          original: {
            imageUrl: original.imageUrl,
            publicId: original.publicId,
            width: original.width,
            height: original.height,
            source: original.source,
          },
        };
      }),
    );

    return {
      requestId,
      status: 'faces_detected',
      totalFaces: faces.length,
      detector,
      message: 'Rostros detectados. Selecciona cuál persona quieres buscar.',
      original: {
        imageUrl: original.imageUrl,
        publicId: original.publicId,
        width: original.width,
        height: original.height,
        source: original.source,
      },
      faces,
    };
  }

  verifySelection(faceId: string, imageUrl: string, token: string) {
    if (!faceId || !imageUrl || !token) return false;
    const expected = this.selectionToken(faceId, imageUrl);
    const left = Buffer.from(expected);
    const right = Buffer.from(token);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private selectionToken(faceId: string, imageUrl: string) {
    const secret = this.configService.get<string>('FACE_SELECTION_SECRET') || this.configService.get<string>('JWT_SECRET');
    if (!secret) throw new Error('FACE_SELECTION_SECRET or JWT_SECRET is required');
    return createHmac('sha256', secret).update(`${faceId}|${imageUrl}`).digest('base64url');
  }

  private async resolveAndStoreOriginal(input: DetectFacesInput, folder: string): Promise<StoredImage> {
    if (input.datasecImageId) {
      const asset = await this.datasecCuration.resolveAssetImageUrl(input.datasecImageId);
      const buffer = await this.securityValidation.fetchPublicUrl(asset.imageUrl, {
        field: 'datasecImageId',
        allowLocalUploads: true,
        maxMb: 15,
      });
      return this.storeBuffer(buffer, `datasec-${input.datasecImageId}.jpg`, folder, 'datasec');
    }

    if (input.imageBase64?.trim()) {
      const validated = this.securityValidation.validateImageBase64(input.imageBase64, {
        field: 'imageBase64',
        maxMb: 15,
      });
      if (!validated) throw new BadRequestException('imageBase64 is required');
      const buffer = Buffer.from(validated.payload.replace(/\s/g, ''), 'base64');
      return this.storeBuffer(buffer, 'uploaded-face-image.jpg', folder, 'upload');
    }

    if (input.imageUrl?.trim()) {
      const buffer = await this.securityValidation.fetchPublicUrl(input.imageUrl, {
        field: 'imageUrl',
        allowLocalUploads: true,
        maxMb: 15,
      });
      return this.storeBuffer(buffer, 'remote-face-image.jpg', folder, 'url');
    }

    throw new BadRequestException('Sube una imagen, pega una URL o selecciona una imagen Datasec.');
  }

  private async storeBuffer(
    buffer: Buffer,
    filename: string,
    folder: string,
    source: StoredImage['source'],
  ): Promise<StoredImage> {
    const metadata = await sharp(buffer).rotate().metadata();
    const upload = await this.cloudinaryService.uploadImage(buffer, filename, {
      folder: `${folder}/original`,
      tags: ['face-selection', 'original'],
      context: { source },
    });

    return {
      buffer,
      imageUrl: upload.secureUrl,
      publicId: upload.publicId,
      width: metadata.width || upload.width || 0,
      height: metadata.height || upload.height || 0,
      source,
    };
  }

  private expandAndClampBox(face: VisionFaceBox, imageWidth: number, imageHeight: number): VisionFaceBox {
    const marginX = Math.round(face.boundingBox.width * 0.35);
    const marginY = Math.round(face.boundingBox.height * 0.45);
    const x = Math.max(0, face.boundingBox.x - marginX);
    const y = Math.max(0, face.boundingBox.y - marginY);
    const right = Math.min(imageWidth, face.boundingBox.x + face.boundingBox.width + marginX);
    const bottom = Math.min(imageHeight, face.boundingBox.y + face.boundingBox.height + marginY);

    return {
      ...face,
      boundingBox: {
        x,
        y,
        width: Math.max(1, right - x),
        height: Math.max(1, bottom - y),
      },
    };
  }

  private qualityScore(face: VisionFaceBox, width: number, height: number) {
    const imageArea = Math.max(width * height, 1);
    const faceArea = face.boundingBox.width * face.boundingBox.height;
    const areaScore = Math.min(faceArea / imageArea / 0.18, 1);
    const confidenceScore = Math.max(Math.min(face.confidence || 0, 1), 0);
    return Number(((areaScore * 0.45 + confidenceScore * 0.55) * 100).toFixed(1));
  }

  private base64FromBuffer(buffer: Buffer) {
    return buffer.toString('base64');
  }
}
