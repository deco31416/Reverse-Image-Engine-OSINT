import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import { HuggingFaceImageService } from './huggingface-image.service';
import { SecurityValidationService } from './security-validation.service';

export interface BiometricImageRequest {
  frontImage?: string;
  leftProfileImage?: string;
  rightProfileImage?: string;
  description?: string;
}

export interface EnhancedImageResult {
  enhancedImageUrl: string;
  enhancedImageBase64: string;
  leftProfileImageUrl?: string;
  leftProfileImageBase64?: string;
  rightProfileImageUrl?: string;
  rightProfileImageBase64?: string;
  profileGenerationMode?: 'ai' | 'fallback' | 'error';
  profileGenerationError?: string;
  biometricPoints?: {
    faceOval: number[][];
    leftEyebrow: number[][];
    rightEyebrow: number[][];
    leftEye: number[][];
    rightEye: number[][];
    noseBridge: number[][];
    noseBottom: number[][];
    lipUpper: number[][];
    lipLower: number[][];
    jawLine: number[][];
  };
  confidence: number;
  processingTime: number;
}

@Injectable()
export class GeminiImageEnhancementService {
  private readonly logger = new Logger(GeminiImageEnhancementService.name);
  private readonly genAI: GoogleGenerativeAI;
  private readonly model: any;
  private readonly apiKey: string;
  private readonly imageTimeoutMs: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly huggingFaceImageService: HuggingFaceImageService,
    private readonly securityValidation: SecurityValidationService,
  ) {
    this.apiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
    this.imageTimeoutMs = Number(
      this.configService.get<string>('GEMINI_IMAGE_TIMEOUT_MS') || '180000',
    );

    if (!this.apiKey) {
      this.logger.warn('GEMINI_API_KEY not configured. Gemini image generation disabled.');
    } else {
      this.genAI = new GoogleGenerativeAI(this.apiKey);
      this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    }
  }

  async generateEnhancedImage(
    request: BiometricImageRequest,
  ): Promise<EnhancedImageResult> {
    const startTime = Date.now();

    if (!request.frontImage) {
      throw new Error('frontImage is required');
    }

    this.logger.log('Starting image generation pipeline (Gemini with Hugging Face fallback)...');

    let biometricPoints: any = null;
    let analysisError: string | undefined;

    if (this.model) {
      try {
        const prompt = this.buildEnhancementPrompt(request);
        const result = await this.model.generateContent(prompt);
        const response = await result.response;
        biometricPoints = this.parseBiometricPoints(response.text());
      } catch (error: any) {
        analysisError = `No se pudieron extraer puntos biometricos: ${error?.message || 'error desconocido'}`;
      }
    }

    const source = await this.imageToBase64(request.frontImage);
    const promptFrontEnhanced =
      'Using this reference image, generate an ENHANCED, HYPERREALISTIC frontal portrait of the EXACT SAME PERSON. Improve the lighting to studio quality and keep identity unchanged. Output ONLY the image.';
    const promptLeft =
      'Generate a photorealistic 90-degree left profile view of the person in the reference photo. Maintain the exact facial features, skin tone, and hairstyle. The person should be looking directly to the left. High-end photography style, plain white background, sharp focus.';
    const promptRight =
      'Generate a photorealistic 90-degree right profile view of the person in the reference photo. Maintain the exact facial features, skin tone, and hairstyle. The person should be looking directly to the right. High-end photography style, plain white background, sharp focus.';

    let enhancedImageBase64 = request.frontImage;
    let leftProfileBase64: string | undefined;
    let rightProfileBase64: string | undefined;
    const generationErrors: string[] = [];

    try {
      const enhanced = await this.callGeminiImageAPI(
        source.mimeType,
        source.base64Data,
        promptFrontEnhanced,
      );
      if (enhanced) enhancedImageBase64 = enhanced;
    } catch (error: any) {
      generationErrors.push(`Error Frontal Gemini: ${this.summarizeProviderError(error)}`);
    }

    const profileSource = await this.imageToBase64(enhancedImageBase64);

    try {
      leftProfileBase64 = await this.callGeminiImageAPI(
        profileSource.mimeType,
        profileSource.base64Data,
        promptLeft,
      );
    } catch (error: any) {
      generationErrors.push(`Error Izquierdo Gemini: ${this.summarizeProviderError(error)}`);
    }

    try {
      rightProfileBase64 = await this.callGeminiImageAPI(
        profileSource.mimeType,
        profileSource.base64Data,
        promptRight,
      );
    } catch (error: any) {
      generationErrors.push(`Error Derecho Gemini: ${this.summarizeProviderError(error)}`);
    }

    let mode: 'ai' | 'fallback' | 'error' = 'error';

    if (!leftProfileBase64 || !rightProfileBase64) {
      const hfLeftPrompt =
        'Photorealistic LEFT side profile (exact 90-degree yaw) of the EXACT SAME person from the input image. Single person only, head-and-shoulders close-up, one subject, one head, one face. Keep identical identity: facial proportions, jawline, nose shape, eye shape, eyebrow shape, lips, skin tone, hairstyle, hairline, age. White seamless background (#FFFFFF), clean studio lighting. No artistic style, no extra people, no duplicate faces, no collage, no split image.';
      const hfRightPrompt =
        'Photorealistic RIGHT side profile (exact 90-degree yaw) of the EXACT SAME person from the input image. Single person only, head-and-shoulders close-up, one subject, one head, one face. Keep identical identity: facial proportions, jawline, nose shape, eye shape, eyebrow shape, lips, skin tone, hairstyle, hairline, age. White seamless background (#FFFFFF), clean studio lighting. No artistic style, no extra people, no duplicate faces, no collage, no split image.';

      if (!leftProfileBase64) {
        try {
          leftProfileBase64 = await this.huggingFaceImageService.generateProfile(
            enhancedImageBase64,
            hfLeftPrompt,
            0.18,
          );
        } catch (error: any) {
          generationErrors.push(`Error Izquierdo HF: ${error?.message || 'fallo de proveedor'}`);
        }
      }

      if (!rightProfileBase64) {
        try {
          rightProfileBase64 = await this.huggingFaceImageService.generateProfile(
            enhancedImageBase64,
            hfRightPrompt,
            0.18,
          );
        } catch (error: any) {
          generationErrors.push(`Error Derecho HF: ${error?.message || 'fallo de proveedor'}`);
        }
      }
    }

    if (leftProfileBase64 && rightProfileBase64) {
      mode = generationErrors.length === 0 ? 'ai' : 'fallback';
    }

    const processingTime = Date.now() - startTime;
    const allErrors = [analysisError, ...generationErrors].filter(Boolean).join(' | ');

    return {
      enhancedImageUrl: enhancedImageBase64,
      enhancedImageBase64,
      leftProfileImageUrl: leftProfileBase64,
      leftProfileImageBase64: leftProfileBase64,
      rightProfileImageUrl: rightProfileBase64,
      rightProfileImageBase64: rightProfileBase64,
      profileGenerationMode: mode,
      profileGenerationError: allErrors || undefined,
      biometricPoints,
      confidence: mode === 'ai' ? 0.95 : mode === 'fallback' ? 0.82 : 0.5,
      processingTime,
    };
  }

  async analyzeFacialFeatures(imageUrl: string): Promise<{
    ageRange: string;
    gender: string;
    ethnicity: string;
    facialHair: string;
    glasses: boolean;
    emotions: string[];
    distinctiveFeatures: string[];
    facialGeometry?: {
      faceShape: string;
      jawDefinition: string;
      symmetryEstimate: string;
      interocularDistanceEstimate: string;
    };
    facialAttributes?: {
      eyebrows: string;
      eyes: string;
      nose: string;
      lips: string;
      chin: string;
      skinTone: string;
      hairstyle: string;
    };
    poseAndCapture?: {
      yaw: string;
      pitch: string;
      roll: string;
      frontalScore: number;
      imageQuality: string;
      sharpness: string;
      exposure: string;
      occlusions: string[];
    };
    expressionAnalysis?: {
      primaryEmotion: string;
      emotionIntensity: number;
      smileLevel: string;
    };
    professionalSummary?: string;
    confidenceByField?: Record<string, number>;
  }> {
    if (!this.model) {
      throw new Error('Gemini API not configured');
    }

    const source = await this.imageToBase64(imageUrl);
    const prompt = `Analyze ONLY the provided face image and return STRICT JSON.

Rules:
- Do not guess attributes that are not visually clear.
- If uncertain, return "unknown".
- Do not infer sensitive attributes from weak evidence.
- Keep values short and evidence-based.
- Return ONLY valid JSON with this schema:
{
  "ageRange": "string",
  "gender": "string",
  "ethnicity": "string",
  "facialHair": "string",
  "glasses": boolean,
  "emotions": ["string"],
  "distinctiveFeatures": ["string"],
  "facialGeometry": {
    "faceShape": "string",
    "jawDefinition": "string",
    "symmetryEstimate": "string",
    "interocularDistanceEstimate": "string"
  },
  "facialAttributes": {
    "eyebrows": "string",
    "eyes": "string",
    "nose": "string",
    "lips": "string",
    "chin": "string",
    "skinTone": "string",
    "hairstyle": "string"
  },
  "poseAndCapture": {
    "yaw": "string",
    "pitch": "string",
    "roll": "string",
    "frontalScore": 0,
    "imageQuality": "string",
    "sharpness": "string",
    "exposure": "string",
    "occlusions": ["string"]
  },
  "expressionAnalysis": {
    "primaryEmotion": "string",
    "emotionIntensity": 0,
    "smileLevel": "string"
  },
  "professionalSummary": "string",
  "confidenceByField": {
    "ageRange": 0,
    "gender": 0,
    "ethnicity": 0,
    "facialHair": 0,
    "glasses": 0,
    "emotions": 0,
    "facialGeometry": 0,
    "facialAttributes": 0,
    "poseAndCapture": 0,
    "expressionAnalysis": 0
  }
}`;

    const result = await this.model.generateContent([
      {
        inlineData: {
          mimeType: source.mimeType,
          data: source.base64Data,
        },
      },
      { text: prompt },
    ]);
    const response = await result.response;
    const parsed = this.parseJsonObject(response.text());

    return {
      ageRange: this.stringOrUnknown(parsed?.ageRange),
      gender: this.stringOrUnknown(parsed?.gender),
      ethnicity: this.stringOrUnknown(parsed?.ethnicity),
      facialHair: this.stringOrUnknown(parsed?.facialHair),
      glasses: Boolean(parsed?.glasses),
      emotions: this.arrayOfStrings(parsed?.emotions),
      distinctiveFeatures: this.arrayOfStrings(parsed?.distinctiveFeatures),
      facialGeometry: {
        faceShape: this.stringOrUnknown(parsed?.facialGeometry?.faceShape),
        jawDefinition: this.stringOrUnknown(parsed?.facialGeometry?.jawDefinition),
        symmetryEstimate: this.stringOrUnknown(
          parsed?.facialGeometry?.symmetryEstimate,
        ),
        interocularDistanceEstimate: this.stringOrUnknown(
          parsed?.facialGeometry?.interocularDistanceEstimate,
        ),
      },
      facialAttributes: {
        eyebrows: this.stringOrUnknown(parsed?.facialAttributes?.eyebrows),
        eyes: this.stringOrUnknown(parsed?.facialAttributes?.eyes),
        nose: this.stringOrUnknown(parsed?.facialAttributes?.nose),
        lips: this.stringOrUnknown(parsed?.facialAttributes?.lips),
        chin: this.stringOrUnknown(parsed?.facialAttributes?.chin),
        skinTone: this.stringOrUnknown(parsed?.facialAttributes?.skinTone),
        hairstyle: this.stringOrUnknown(parsed?.facialAttributes?.hairstyle),
      },
      poseAndCapture: {
        yaw: this.stringOrUnknown(parsed?.poseAndCapture?.yaw),
        pitch: this.stringOrUnknown(parsed?.poseAndCapture?.pitch),
        roll: this.stringOrUnknown(parsed?.poseAndCapture?.roll),
        frontalScore: this.normalizePercentage(parsed?.poseAndCapture?.frontalScore),
        imageQuality: this.stringOrUnknown(parsed?.poseAndCapture?.imageQuality),
        sharpness: this.stringOrUnknown(parsed?.poseAndCapture?.sharpness),
        exposure: this.stringOrUnknown(parsed?.poseAndCapture?.exposure),
        occlusions: this.arrayOfStrings(parsed?.poseAndCapture?.occlusions),
      },
      expressionAnalysis: {
        primaryEmotion: this.stringOrUnknown(
          parsed?.expressionAnalysis?.primaryEmotion,
        ),
        emotionIntensity: this.normalizeConfidence(
          parsed?.expressionAnalysis?.emotionIntensity,
        ),
        smileLevel: this.stringOrUnknown(parsed?.expressionAnalysis?.smileLevel),
      },
      professionalSummary: this.stringOrUnknown(parsed?.professionalSummary),
      confidenceByField: this.normalizeConfidenceMap(parsed?.confidenceByField),
    };
  }

  async generatePersonDescription(imageUrl: string): Promise<string> {
    if (!this.model) {
      throw new Error('Gemini API not configured');
    }

    const source = await this.imageToBase64(imageUrl);
    const prompt = `Describe ONLY what is clearly visible in the provided image.

Rules:
- No assumptions.
- If a detail is not visible, say "No visible".
- Keep description concise and factual for OSINT notes.
- Mention: facial traits, hair, accessories, visible expression, and background.`;

    const result = await this.model.generateContent([
      {
        inlineData: {
          mimeType: source.mimeType,
          data: source.base64Data,
        },
      },
      { text: prompt },
    ]);
    const response = await result.response;
    return response.text();
  }

  async compareFaces(
    imageUrl1: string,
    imageUrl2: string,
  ): Promise<{
    isSamePerson: boolean;
    confidence: number;
    reasoning: string;
  }> {
    if (!this.model) {
      throw new Error('Gemini API not configured');
    }

    const source1 = await this.imageToBase64(imageUrl1);
    const source2 = await this.imageToBase64(imageUrl2);

    const prompt = `Compare the two provided face images and determine if they are the same person.

Rules:
- Use only visible biometric evidence.
- If uncertain, set lower confidence.
- Return ONLY valid JSON:
{
  "isSamePerson": true/false,
  "confidence": 0.0,
  "reasoning": "..."
}`;

    const result = await this.model.generateContent([
      {
        inlineData: {
          mimeType: source1.mimeType,
          data: source1.base64Data,
        },
      },
      {
        inlineData: {
          mimeType: source2.mimeType,
          data: source2.base64Data,
        },
      },
      { text: prompt },
    ]);
    const response = await result.response;
    const parsed = this.parseJsonObject(response.text());

    if (!parsed) {
      throw new Error('Failed to parse Gemini response');
    }

    return {
      isSamePerson: Boolean(parsed.isSamePerson),
      confidence: this.normalizeConfidence(parsed.confidence),
      reasoning: this.stringOrUnknown(parsed.reasoning),
    };
  }

  private async callGeminiImageAPI(
    mimeType: string,
    base64Data: string,
    prompt: string,
  ): Promise<string | undefined> {
    if (!this.apiKey) {
      throw new Error('API Key missing');
    }

    const imageModel =
      this.configService.get<string>('GEMINI_IMAGE_MODEL') ||
      'gemini-2.5-flash-image';
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${imageModel}:generateContent`;

    const body = {
      generationConfig: {
        responseModalities: ['IMAGE'],
      },
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
    };

    const response = await axios.post(`${endpoint}?key=${this.apiKey}`, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: this.imageTimeoutMs,
    });

    const parts: any[] = response.data?.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p: any) =>
      p.inlineData?.mimeType?.startsWith('image/'),
    );

    if (!imagePart) {
      throw new Error('Gemini response has no image payload.');
    }

    return `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
  }

  private async imageToBase64(
    imageInput: string,
  ): Promise<{ mimeType: string; base64Data: string }> {
    if (imageInput.startsWith('data:image/')) {
      const match = imageInput.match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
      if (match) {
        this.securityValidation.validateImageBase64(imageInput, { field: 'image' });
        return { mimeType: match[1], base64Data: match[2] };
      }
    }

    if (imageInput.startsWith('http://') || imageInput.startsWith('https://')) {
      const buffer = await this.securityValidation.fetchPublicUrl(imageInput, {
        field: 'imageUrl',
        allowLocalUploads: true,
        accept: 'image/*,*/*;q=0.8',
      });
      return {
        mimeType: this.guessImageMimeType(imageInput),
        base64Data: buffer.toString('base64'),
      };
    }

    this.securityValidation.validateImageBase64(imageInput, { field: 'image' });
    return { mimeType: 'image/jpeg', base64Data: imageInput };
  }

  private guessImageMimeType(imageUrl: string) {
    const path = new URL(imageUrl).pathname.toLowerCase();
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.webp')) return 'image/webp';
    if (path.endsWith('.gif')) return 'image/gif';
    return 'image/jpeg';
  }

  private summarizeProviderError(error: any): string {
    const raw = error?.response?.data?.error?.message || error?.message || '';
    if (!raw) return 'Error de API desconocido.';

    const first = raw.split('\n')[0].trim();
    const lower = raw.toLowerCase();

    if (
      lower.includes('quota exceeded') ||
      lower.includes('exceeded your current quota') ||
      lower.includes('free_tier') ||
      lower.includes('rate limit') ||
      error?.response?.status === 429
    ) {
      return 'Sin creditos/cuota en Gemini para imagenes. Se intentara fallback con Hugging Face.';
    }

    if (lower.includes('api_key_invalid') || lower.includes('api key not valid')) {
      return 'Clave de API invalida. Actualiza GEMINI_API_KEY en tu .env.';
    }

    if (lower.includes('not found') || error?.response?.status === 404) {
      return 'Modelo de imagen no encontrado o sin acceso para esta clave.';
    }

    return first || 'Error desconocido de la API.';
  }

  private parseJsonObject(text: string): any | null {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      return JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }

  private stringOrUnknown(value: unknown): string {
    if (typeof value !== 'string') return 'unknown';
    const trimmed = value.trim();
    return trimmed ? trimmed : 'unknown';
  }

  private arrayOfStrings(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((v) => typeof v === 'string')
      .map((v) => (v as string).trim())
      .filter(Boolean);
  }

  private normalizeConfidence(value: unknown): number {
    const n = Number(value);
    if (Number.isNaN(n)) return 0;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
  }

  private normalizePercentage(value: unknown): number {
    const n = Number(value);
    if (Number.isNaN(n)) return 0;
    if (n < 0) return 0;
    if (n > 100) return 100;
    return n;
  }

  private normalizeConfidenceMap(value: unknown): Record<string, number> {
    if (!value || typeof value !== 'object') return {};
    const input = value as Record<string, unknown>;
    const output: Record<string, number> = {};
    for (const key of Object.keys(input)) {
      output[key] = this.normalizeConfidence(input[key]);
    }
    return output;
  }

  private buildEnhancementPrompt(request: BiometricImageRequest): string {
    let prompt =
      'Analiza la siguiente imagen facial frontal y extrae puntos biometricos precisos:\n\n';
    if (request.frontImage) {
      prompt += `Vista frontal: ${request.frontImage}\n`;
    }
    if (request.description) {
      prompt += `\nContexto adicional: ${request.description}\n`;
    }

    prompt += `\nProporciona analisis incluyendo:\n- faceOval\n- leftEyebrow\n- rightEyebrow\n- leftEye\n- rightEye\n- noseBridge\n- noseBottom\n- lipUpper\n- lipLower\n- jawLine\n\nFormato JSON con coordenadas [x, y].`;
    return prompt;
  }

  private parseBiometricPoints(text: string): any {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return null;
    } catch {
      return null;
    }
  }
}
