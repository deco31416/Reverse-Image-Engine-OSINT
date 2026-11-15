import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EvidenceService } from './evidence.service';
import { RegexExtractorService } from './regex-extractor.service';

// Google Vision AI se usará via REST API para compatibilidad Railway
// No requiere credentials file, solo API key

export interface VisionAnalysisResult {
  // Detección de rostros
  faceDetection?: {
    emotions: string[];
    age?: { min: number; max: number };
    gender?: 'male' | 'female' | 'unknown';
    facialHair?: boolean;
    glasses?: boolean;
    headwear?: boolean;
    confidence: number;
  };

  // Detección de texto (OCR)
  textDetection?: {
    fullText: string;
    words: string[];
    language: string;
    confidence: number;
  };

  // Detección de etiquetas/objetos
  labelDetection?: {
    labels: Array<{ description: string; score: number }>;
  };

  // Detección de objetos
  objectDetection?: {
    objects: Array<{ name: string; confidence: number }>;
  };

  // Detección de logos/marcas
  logoDetection?: {
    logos: Array<{ description: string; score: number }>;
  };

  // Detección de puntos de referencia (landmarks)
  landmarkDetection?: {
    landmarks: Array<{ name: string; location: string; score: number }>;
  };

  // SafeSearch (contenido sensible)
  safeSearch?: {
    adult: string; // 'VERY_UNLIKELY' | 'UNLIKELY' | 'POSSIBLE' | 'LIKELY' | 'VERY_LIKELY'
    violence: string;
    racy: string;
    medical: string;
    spoof: string;
  };

  // Propiedades de imagen
  imageProperties?: {
    dominantColors: Array<{
      color: { red: number; green: number; blue: number };
      score: number;
    }>;
  };
}

export interface VisionFaceBox {
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
  emotions: string[];
  landmarks: Array<{ type: string; x: number; y: number }>;
}

/**
 * Servicio de análisis de imagen con Google Vision AI
 *
 * Características:
 * - Detección de rostros con atributos (edad, género, emociones)
 * - OCR de texto en imágenes
 * - Detección de objetos, logos, landmarks
 * - SafeSearch (contenido sensible)
 * - Propiedades de imagen (colores dominantes)
 * - Auto-guardado de evidencia en MongoDB
 *
 * API Docs: https://cloud.google.com/vision/docs
 *
 * Setup:
 * 1. yarn add @google-cloud/vision
 * 2. Crear proyecto en Google Cloud Platform
 * 3. Habilitar Vision AI en el proyecto
 * 4. Crear Service Account y descargar JSON key
 * 5. Configurar GOOGLE_APPLICATION_CREDENTIALS (ruta al JSON key)
 *
 * Variables de entorno:
 * - GOOGLE_APPLICATION_CREDENTIALS (ruta a service-account.json)
 * - GOOGLE_CLOUD_PROJECT_ID (opcional)
 */
@Injectable()
export class GoogleVisionService {
  private readonly logger = new Logger(GoogleVisionService.name);
  private readonly apiKey: string;
  private readonly enabled: boolean;
  private readonly baseUrl = 'https://vision.googleapis.com/v1';

  constructor(
    private configService: ConfigService,
    private evidenceService: EvidenceService,
    private regexExtractor: RegexExtractorService,
  ) {
    this.apiKey = this.configService.get<string>('GOOGLE_API_KEY') || '';
    this.enabled = !!this.apiKey;

    if (!this.enabled) {
      this.logger.warn(
        'Google Vision AI disabled - GOOGLE_API_KEY not configured',
      );
    } else {
      this.logger.log('✅ Google Vision AI enabled (REST API)');
    }
  }

  /**
   * Check if service is available
   */
  isAvailable(): boolean {
    return this.enabled;
  }

  /**
   * Analiza imagen con Google Vision AI (todas las características)
   *
   * @param searchId - ID de búsqueda OSINT en MongoDB
   * @param imageUrl - URL de imagen o base64
   * @param options - Características a detectar
   * @returns Análisis completo de la imagen
   */
  async analyzeImage(
    searchId: string,
    imageUrl: string,
    options?: {
      detectFaces?: boolean;
      detectText?: boolean;
      detectLabels?: boolean;
      detectObjects?: boolean;
      detectLogos?: boolean;
      detectLandmarks?: boolean;
      safeSearch?: boolean;
      imageProperties?: boolean;
    },
  ): Promise<VisionAnalysisResult> {
    if (!this.enabled) {
      this.logger.warn(
        'Google Vision AI analysis skipped - service not configured',
      );
      return {};
    }

    this.logger.log(`Analyzing image with Google Vision AI...`);

    try {
      // Llamar a Vision AI REST API
      const result = await this.callVisionApi(imageUrl, options);

      // Parsear respuesta
      const analysis = this.parseVisionResponse(result);

      // Guardar como evidencia
      if (searchId) {
        await this.saveAnalysisAsEvidence(searchId, imageUrl, analysis);
      }

      return analysis;
    } catch (error) {
      this.logger.error(
        `Google Vision AI analysis error: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Análisis rápido solo de rostros
   */
  async analyzeFaces(
    searchId: string,
    imageUrl: string,
  ): Promise<VisionAnalysisResult> {
    return this.analyzeImage(searchId, imageUrl, { detectFaces: true });
  }

  async detectFaceBoxes(imageUrlOrBase64: string): Promise<VisionFaceBox[]> {
    if (!this.enabled) return [];

    const result = await this.callVisionApi(imageUrlOrBase64, {
      detectFaces: true,
      detectText: false,
      detectLabels: false,
      safeSearch: false,
    });

    const annotations = Array.isArray(result.faceAnnotations)
      ? result.faceAnnotations
      : [];

    return annotations
      .map((face: any) => this.faceAnnotationToBox(face))
      .filter(Boolean) as VisionFaceBox[];
  }

  /**
   * OCR de texto en imagen
   */
  async extractText(
    searchId: string,
    imageUrl: string,
  ): Promise<VisionAnalysisResult> {
    return this.analyzeImage(searchId, imageUrl, { detectText: true });
  }

  /**
   * Detección de objetos y etiquetas
   */
  async detectObjects(
    searchId: string,
    imageUrl: string,
  ): Promise<VisionAnalysisResult> {
    return this.analyzeImage(searchId, imageUrl, {
      detectObjects: true,
      detectLabels: true,
    });
  }

  /**
   * Construye features para Vision AI API
   */
  private buildFeatures(options?: {
    detectFaces?: boolean;
    detectText?: boolean;
    detectLabels?: boolean;
    detectObjects?: boolean;
    detectLogos?: boolean;
    detectLandmarks?: boolean;
    safeSearch?: boolean;
    imageProperties?: boolean;
  }): Array<{ type: string; maxResults?: number }> {
    const features: Array<{ type: string; maxResults?: number }> = [];

    if (options?.detectFaces !== false) {
      features.push({ type: 'FACE_DETECTION', maxResults: 10 });
    }
    if (options?.detectText !== false) {
      features.push({ type: 'TEXT_DETECTION' });
    }
    if (options?.detectLabels !== false) {
      features.push({ type: 'LABEL_DETECTION', maxResults: 20 });
    }
    if (options?.detectObjects) {
      features.push({ type: 'OBJECT_LOCALIZATION', maxResults: 20 });
    }
    if (options?.detectLogos) {
      features.push({ type: 'LOGO_DETECTION', maxResults: 10 });
    }
    if (options?.detectLandmarks) {
      features.push({ type: 'LANDMARK_DETECTION', maxResults: 10 });
    }
    if (options?.safeSearch !== false) {
      features.push({ type: 'SAFE_SEARCH_DETECTION' });
    }
    if (options?.imageProperties) {
      features.push({ type: 'IMAGE_PROPERTIES' });
    }

    return features;
  }

  /**
   * Parsea respuesta de Vision AI a formato estructurado
   */
  private parseVisionResponse(result: any): VisionAnalysisResult {
    const analysis: VisionAnalysisResult = {};

    // Face detection
    if (result.faceAnnotations && result.faceAnnotations.length > 0) {
      const face = result.faceAnnotations[0]; // Primera cara detectada

      analysis.faceDetection = {
        emotions: this.extractEmotions(face),
        gender: face.gender?.toLowerCase(),
        facialHair: face.blurredLikelihood !== 'VERY_UNLIKELY',
        glasses: face.headwearLikelihood !== 'VERY_UNLIKELY',
        headwear: face.headwearLikelihood !== 'VERY_UNLIKELY',
        confidence: face.detectionConfidence || 0,
      };
    }

    // Text detection
    if (result.textAnnotations && result.textAnnotations.length > 0) {
      const fullText = result.textAnnotations[0]?.description || '';
      const words = fullText.split(/\s+/).filter((w: string) => w.length > 0);

      analysis.textDetection = {
        fullText,
        words,
        language: result.textAnnotations[0]?.locale || 'unknown',
        confidence: 0.9, // Vision AI no devuelve confidence para texto
      };
    }

    // Label detection
    if (result.labelAnnotations && result.labelAnnotations.length > 0) {
      analysis.labelDetection = {
        labels: result.labelAnnotations.map((label: any) => ({
          description: label.description,
          score: label.score,
        })),
      };
    }

    // Object detection
    if (
      result.localizedObjectAnnotations &&
      result.localizedObjectAnnotations.length > 0
    ) {
      analysis.objectDetection = {
        objects: result.localizedObjectAnnotations.map((obj: any) => ({
          name: obj.name,
          confidence: obj.score,
        })),
      };
    }

    // Logo detection
    if (result.logoAnnotations && result.logoAnnotations.length > 0) {
      analysis.logoDetection = {
        logos: result.logoAnnotations.map((logo: any) => ({
          description: logo.description,
          score: logo.score,
        })),
      };
    }

    // Landmark detection
    if (result.landmarkAnnotations && result.landmarkAnnotations.length > 0) {
      analysis.landmarkDetection = {
        landmarks: result.landmarkAnnotations.map((landmark: any) => ({
          name: landmark.description,
          location: landmark.locations?.[0]?.latLng
            ? `${landmark.locations[0].latLng.latitude},${landmark.locations[0].latLng.longitude}`
            : 'unknown',
          score: landmark.score,
        })),
      };
    }

    // SafeSearch
    if (result.safeSearchAnnotation) {
      analysis.safeSearch = {
        adult: result.safeSearchAnnotation.adult,
        violence: result.safeSearchAnnotation.violence,
        racy: result.safeSearchAnnotation.racy,
        medical: result.safeSearchAnnotation.medical,
        spoof: result.safeSearchAnnotation.spoof,
      };
    }

    // Image properties
    if (result.imagePropertiesAnnotation) {
      analysis.imageProperties = {
        dominantColors:
          result.imagePropertiesAnnotation.dominantColors?.colors?.map(
            (c: any) => ({
              color: c.color,
              score: c.score,
            }),
          ) || [],
      };
    }

    return analysis;
  }

  /**
   * Extrae emociones de face annotations
   */
  private extractEmotions(face: any): string[] {
    const emotions: string[] = [];

    if (
      face.joyLikelihood === 'LIKELY' ||
      face.joyLikelihood === 'VERY_LIKELY'
    ) {
      emotions.push('joy');
    }
    if (
      face.sorrowLikelihood === 'LIKELY' ||
      face.sorrowLikelihood === 'VERY_LIKELY'
    ) {
      emotions.push('sorrow');
    }
    if (
      face.angerLikelihood === 'LIKELY' ||
      face.angerLikelihood === 'VERY_LIKELY'
    ) {
      emotions.push('anger');
    }
    if (
      face.surpriseLikelihood === 'LIKELY' ||
      face.surpriseLikelihood === 'VERY_LIKELY'
    ) {
      emotions.push('surprise');
    }

    return emotions.length > 0 ? emotions : ['neutral'];
  }

  private faceAnnotationToBox(face: any): VisionFaceBox | null {
    const vertices = face.boundingPoly?.vertices || face.fdBoundingPoly?.vertices || [];
    const points = vertices
      .map((vertex: any) => ({
        x: Number(vertex.x || 0),
        y: Number(vertex.y || 0),
      }))
      .filter((point: { x: number; y: number }) => Number.isFinite(point.x) && Number.isFinite(point.y));

    if (!points.length) return null;

    const minX = Math.max(0, Math.min(...points.map((point: any) => point.x)));
    const minY = Math.max(0, Math.min(...points.map((point: any) => point.y)));
    const maxX = Math.max(...points.map((point: any) => point.x));
    const maxY = Math.max(...points.map((point: any) => point.y));
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);

    return {
      boundingBox: { x: minX, y: minY, width, height },
      confidence: Number(face.detectionConfidence || 0),
      emotions: this.extractEmotions(face),
      landmarks: Array.isArray(face.landmarks)
        ? face.landmarks.map((landmark: any) => ({
            type: String(landmark.type || 'unknown'),
            x: Number(landmark.position?.x || 0),
            y: Number(landmark.position?.y || 0),
          }))
        : [],
    };
  }

  /**
   * Guarda análisis como evidencia en MongoDB
   */
  private async saveAnalysisAsEvidence(
    searchId: string,
    imageUrl: string,
    analysis: VisionAnalysisResult,
  ): Promise<void> {
    try {
      const labels = analysis.labelDetection?.labels?.map((l) => l.description) || [];
      const hasFace = analysis.faceDetection ? 1 : 0;
      const textSnippet = analysis.textDetection?.fullText?.substring(0, 200) || '';

      const summaryParts: string[] = [];
      if (labels.length > 0) summaryParts.push(`Labels: ${labels.slice(0, 5).join(', ')}`);
      if (hasFace > 0) summaryParts.push(`Face detected`);
      if (textSnippet) summaryParts.push(`Text: ${textSnippet}`);

      const evidence = {
        source: 'google_vision',
        url: imageUrl,
        title: `Vision AI Analysis: ${labels.slice(0, 3).join(', ') || 'Image'}`,
        summary: summaryParts.join(' | ') || 'Vision analysis completed',
        category: 'google_vision' as const,
        imageUrl,
        extractedData: {
          ...(analysis.textDetection?.fullText && {
            text: analysis.textDetection.fullText,
          }),
          ...(analysis.labelDetection?.labels && {
            labels,
          }),
        },
        fetchedAt: new Date(),
      };

      await this.evidenceService.saveEvidence(searchId, evidence as any);
      this.logger.log('Google Vision analysis saved as evidence');
    } catch (error) {
      this.logger.error(`Error saving Vision AI evidence: ${error.message}`);
    }
  }

  /**
   * Call Google Vision API via REST
   */
  private async callVisionApi(
    imageUrl: string,
    options?: {
      detectFaces?: boolean;
      detectText?: boolean;
      detectLabels?: boolean;
      detectObjects?: boolean;
      detectLogos?: boolean;
      detectLandmarks?: boolean;
      safeSearch?: boolean;
      imageProperties?: boolean;
    },
  ): Promise<any> {
    const features = this.buildFeatures(options);

    const requestBody = {
      requests: [
        {
          image: imageUrl.startsWith('http')
            ? { source: { imageUri: imageUrl } }
            : { content: imageUrl }, // base64
          features,
        },
      ],
    };

    try {
      const response = await fetch(
        `${this.baseUrl}/images:annotate?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        },
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Vision API error: ${error}`);
      }

      const data = await response.json();

      if (data.responses?.[0]?.error) {
        throw new Error(`Vision API error: ${data.responses[0].error.message}`);
      }

      return data.responses[0];
    } catch (error) {
      this.logger.error(`Vision API call failed: ${error.message}`);
      throw error;
    }
  }
}
