import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { SecurityValidationService } from './security-validation.service';

export interface DatasecImage {
  id: string;
  url: string;
  secureUrl?: string;
  metadata: {
    cameraId: string;
    timestamp: Date;
    width?: number;
    height?: number;
    format?: string;
    size?: number;
  };
  detections?: Array<{
    class: string;
    confidence: number;
    bbox: number[];
  }>;
  faces?: Array<{
    faceId: string;
    bbox: number[];
    landmarks?: any;
  }>;
}

export interface DatasecSearchParams {
  cameraId?: string;
  startDate?: Date;
  endDate?: Date;
  hasDetections?: boolean;
  hasFaces?: boolean;
  personId?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class DatasecProxyService {
  private readonly logger = new Logger(DatasecProxyService.name);
  private readonly datasecUrl: string;
  private readonly apiKey: string | undefined;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly securityValidation: SecurityValidationService,
  ) {
    this.datasecUrl =
      this.configService.get<string>('DATASEC_SERVICE_URL') ||
      'http://localhost:7040';
    this.apiKey = this.configService.get<string>('DATASEC_API_KEY');

    if (!this.apiKey) {
      this.logger.log(
        'ℹ️  DATASEC_API_KEY not configured - Datasec proxy service disabled (feature not implemented yet)',
      );
    } else {
      this.logger.log(`✅ Datasec proxy configured: ${this.datasecUrl}`);
    }
  }

  /**
   * Get image by ID from datasec
   */
  async getImageById(imageId: string): Promise<DatasecImage | null> {
    if (!this.apiKey) {
      throw new Error('Datasec API key not configured');
    }

    try {
      this.logger.log(`📥 Fetching image ${imageId} from datasec...`);

      const response = await firstValueFrom(
        this.httpService.get(`${this.datasecUrl}/api/images/${imageId}`, {
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json',
          },
        }),
      );

      return this.transformDatasecImage(response.data);
    } catch (error) {
      if (error.response?.status === 404) {
        this.logger.warn(`Image ${imageId} not found in datasec`);
        return null;
      }
      this.logger.error(`Error fetching image from datasec: ${error.message}`);
      throw error;
    }
  }

  /**
   * Search images by camera ID
   */
  async getImagesByCamera(
    cameraId: string,
    dateRange?: { startDate: Date; endDate: Date },
  ): Promise<DatasecImage[]> {
    if (!this.apiKey) {
      throw new Error('Datasec API key not configured');
    }

    try {
      this.logger.log(`📸 Fetching images from camera ${cameraId}...`);

      const params: any = { cameraId };
      if (dateRange) {
        params.startDate = dateRange.startDate.toISOString();
        params.endDate = dateRange.endDate.toISOString();
      }

      const response = await firstValueFrom(
        this.httpService.get(`${this.datasecUrl}/api/images/search`, {
          params,
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json',
          },
        }),
      );

      return response.data.map((img: any) => this.transformDatasecImage(img));
    } catch (error) {
      this.logger.error(`Error searching images by camera: ${error.message}`);
      throw error;
    }
  }

  /**
   * Search images by person ID
   */
  async getImagesByPerson(personId: string): Promise<DatasecImage[]> {
    if (!this.apiKey) {
      throw new Error('Datasec API key not configured');
    }

    try {
      this.logger.log(`👤 Fetching images of person ${personId}...`);

      const response = await firstValueFrom(
        this.httpService.get(
          `${this.datasecUrl}/api/images/person/${personId}`,
          {
            headers: {
              'X-API-Key': this.apiKey,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      return response.data.map((img: any) => this.transformDatasecImage(img));
    } catch (error) {
      this.logger.error(`Error fetching images by person: ${error.message}`);
      throw error;
    }
  }

  /**
   * Search images with advanced filters
   */
  async searchImages(params: DatasecSearchParams): Promise<DatasecImage[]> {
    if (!this.apiKey) {
      throw new Error('Datasec API key not configured');
    }

    try {
      this.logger.log(`🔍 Searching images with filters...`);

      const queryParams: any = {};
      if (params.cameraId) queryParams.cameraId = params.cameraId;
      if (params.startDate)
        queryParams.startDate = params.startDate.toISOString();
      if (params.endDate) queryParams.endDate = params.endDate.toISOString();
      if (params.hasDetections !== undefined)
        queryParams.hasDetections = params.hasDetections;
      if (params.hasFaces !== undefined) queryParams.hasFaces = params.hasFaces;
      if (params.personId) queryParams.personId = params.personId;
      if (params.limit) queryParams.limit = params.limit;
      if (params.offset) queryParams.offset = params.offset;

      const response = await firstValueFrom(
        this.httpService.get(`${this.datasecUrl}/api/images/search`, {
          params: queryParams,
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json',
          },
        }),
      );

      return response.data.map((img: any) => this.transformDatasecImage(img));
    } catch (error) {
      this.logger.error(`Error searching images: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get images with face detections
   */
  async getImagesWithFaces(limit: number = 100): Promise<DatasecImage[]> {
    return this.searchImages({
      hasFaces: true,
      limit,
    });
  }

  /**
   * Get recent images from a specific camera
   */
  async getRecentImages(
    cameraId: string,
    hours: number = 24,
  ): Promise<DatasecImage[]> {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - hours * 60 * 60 * 1000);

    return this.getImagesByCamera(cameraId, { startDate, endDate });
  }

  /**
   * Download image as Buffer
   */
  async downloadImage(imageUrl: string): Promise<Buffer> {
    try {
      this.logger.log(`⬇️  Downloading image from ${imageUrl}...`);
      if (!this.isDatasecServiceUrl(imageUrl)) {
        return await this.securityValidation.fetchPublicUrl(imageUrl, {
          field: 'imageUrl',
          allowLocalUploads: true,
          accept: 'image/*,*/*;q=0.8',
        });
      }

      const response = await firstValueFrom(
        this.httpService.get(imageUrl, {
          responseType: 'arraybuffer',
          headers: this.apiKey ? { 'X-API-Key': this.apiKey } : {},
          timeout: 15000,
          maxRedirects: 0,
          validateStatus: (status) => status >= 200 && status < 300,
        }),
      );

      return Buffer.from(response.data);
    } catch (error) {
      this.logger.error(`Error downloading image: ${error.message}`);
      throw error;
    }
  }

  private isDatasecServiceUrl(value: string) {
    try {
      const parsed = new URL(value);
      const base = new URL(this.datasecUrl);
      return parsed.origin === base.origin;
    } catch {
      return false;
    }
  }

  /**
   * Get statistics from datasec
   */
  async getStatistics(cameraId?: string): Promise<{
    totalImages: number;
    totalDetections: number;
    totalFaces: number;
    cameras: string[];
  }> {
    if (!this.apiKey) {
      throw new Error('Datasec API key not configured');
    }

    try {
      const params = cameraId ? { cameraId } : {};

      const response = await firstValueFrom(
        this.httpService.get(`${this.datasecUrl}/api/statistics`, {
          params,
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json',
          },
        }),
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Error fetching statistics: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get available cameras from datasec
   */
  async getCameras(): Promise<
    Array<{ id: string; name: string; status: string }>
  > {
    if (!this.apiKey) {
      throw new Error('Datasec API key not configured');
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.datasecUrl}/api/cameras`, {
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json',
          },
        }),
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Error fetching cameras: ${error.message}`);
      throw error;
    }
  }

  /**
   * Transform datasec image format to standardized format
   */
  private transformDatasecImage(data: any): DatasecImage {
    return {
      id: data.id || data._id,
      url: data.url || data.imageUrl,
      secureUrl: data.secureUrl || data.secure_url,
      metadata: {
        cameraId: data.cameraId || data.camera_id,
        timestamp: new Date(data.timestamp || data.createdAt),
        width: data.width,
        height: data.height,
        format: data.format,
        size: data.size,
      },
      detections: data.detections || [],
      faces: data.faces || [],
    };
  }

  /**
   * Check if datasec service is available
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.datasecUrl}/health`, {
          timeout: 5000,
        }),
      );
      return response.status === 200;
    } catch (error) {
      this.logger.error(`Datasec health check failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Extract face crops from images
   */
  async getFaceCrops(
    imageId: string,
  ): Promise<Array<{ faceId: string; url: string }>> {
    if (!this.apiKey) {
      throw new Error('Datasec API key not configured');
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.datasecUrl}/api/images/${imageId}/faces`, {
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json',
          },
        }),
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Error fetching face crops: ${error.message}`);
      return [];
    }
  }
}
