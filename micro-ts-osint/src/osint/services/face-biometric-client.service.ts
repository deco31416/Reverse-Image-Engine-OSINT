import { HttpService } from '@nestjs/axios';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface BiometricFace {
  index: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  detectionScore: number;
  qualityScore: number;
  embedding?: number[];
  embeddingDimensions?: number;
  model: string;
  modelVersion: string;
}

@Injectable()
export class FaceBiometricClientService {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(private readonly http: HttpService, config: ConfigService) {
    this.baseUrl = String(config.get('FACE_BIOMETRIC_BASE_URL') || 'http://localhost:7120').replace(/\/$/, '');
    this.apiKey = String(config.get('FACE_BIOMETRIC_API_KEY') || '');
  }

  async extract(image: Buffer, maxFaces = 1, includeEmbedding = true): Promise<{ facesDetected: number; faces: BiometricFace[] }> {
    this.assertConfigured();
    try {
      const response = await firstValueFrom(this.http.post(`${this.baseUrl}/v1/faces/extract`, {
        imageBase64: image.toString('base64'),
        includeEmbedding,
        maxFaces,
      }, { headers: { 'x-api-key': this.apiKey }, timeout: 30000 }));
      return response.data;
    } catch (error: any) {
      throw new ServiceUnavailableException(error?.response?.data?.detail || 'Biometric service unavailable');
    }
  }

  async compare(firstEmbedding: number[], secondEmbedding: number[]) {
    this.assertConfigured();
    try {
      const response = await firstValueFrom(this.http.post(`${this.baseUrl}/v1/faces/compare`, {
        firstEmbedding,
        secondEmbedding,
      }, { headers: { 'x-api-key': this.apiKey }, timeout: 10000 }));
      return response.data as {
        cosineSimilarity: number;
        classification: 'unlikely' | 'candidate' | 'probable';
        thresholdCandidate: number;
        thresholdProbable: number;
        model: string;
      };
    } catch (error: any) {
      throw new ServiceUnavailableException(error?.response?.data?.detail || 'Biometric service unavailable');
    }
  }

  private assertConfigured() {
    if (!this.apiKey) throw new ServiceUnavailableException('FACE_BIOMETRIC_API_KEY is not configured');
  }
}
