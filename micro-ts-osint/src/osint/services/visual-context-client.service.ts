import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export type VisualContextDetection = {
  label: string;
  confidence: number;
  classId?: number;
  box: { x: number; y: number; width: number; height: number };
};

export type VisualContextResponse = {
  status: string;
  model: string;
  yoloAvailable: boolean;
  width: number;
  height: number;
  detections: VisualContextDetection[];
  summary: {
    total: number;
    labels: Record<string, number>;
    people: number;
    contextTags: string[];
  };
  warnings?: string[];
};

@Injectable()
export class VisualContextClientService {
  private readonly logger = new Logger(VisualContextClientService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  isAvailable() {
    return Boolean(this.baseUrl);
  }

  async healthCheck() {
    if (!this.isAvailable()) return { available: false, reason: 'VISUAL_CONTEXT_BASE_URL not configured' };
    try {
      const { data } = await firstValueFrom(this.httpService.get(`${this.baseUrl}/health`, { timeout: this.timeoutMs }));
      return { available: true, service: data };
    } catch (error) {
      return { available: false, error: this.errorMessage(error) };
    }
  }

  async analyzeImage(imageBase64?: string, options: { includeCrops?: boolean; confidence?: number; maxDetections?: number } = {}) {
    if (!this.isAvailable() || !imageBase64) return null;
    try {
      const { data } = await firstValueFrom(
        this.httpService.post<VisualContextResponse>(
          `${this.baseUrl}/v1/visual/analyze`,
          {
            imageBase64,
            includeCrops: Boolean(options.includeCrops),
            confidence: options.confidence,
            maxDetections: options.maxDetections,
          },
          {
            headers: this.headers(),
            timeout: this.timeoutMs,
          },
        ),
      );
      return data;
    } catch (error) {
      this.logger.warn(`Visual context analysis failed: ${this.errorMessage(error)}`);
      return null;
    }
  }

  private headers() {
    const apiKey =
      this.configService.get<string>('VISUAL_CONTEXT_API_KEY') ||
      this.configService.get<string>('MICROSERVICES_API_KEY');
    return {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    };
  }

  private get baseUrl() {
    const raw = this.configService.get<string>('VISUAL_CONTEXT_BASE_URL') || '';
    return raw.replace(/\/$/, '');
  }

  private get timeoutMs() {
    return Number(this.configService.get<string>('VISUAL_CONTEXT_TIMEOUT_MS') || 30000);
  }

  private errorMessage(error: any) {
    return error?.response?.data?.detail || error?.response?.data?.message || error?.message || String(error);
  }
}
