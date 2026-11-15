import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import sharp from 'sharp';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { CloudinaryService } from './cloudinary.service';
import { GoogleVisionService } from './google-vision.service';
import { EvidenceService } from './evidence.service';
import { ReverseImageSearchService } from './reverse-image-search.service';
import { SerperSearchService } from './serper-search.service';
import { StoragePathService } from './storage-path.service';
import { SecurityValidationService } from './security-validation.service';
import { SocialScraperClientService } from './social-scraper-client.service';

// ============================================================================
// INTERFACES
// ============================================================================

export interface FaceDetectionResult {
  detected: boolean;
  faces: FaceBoundingBox[];
  totalFaces: number;
  primaryFace?: FaceBoundingBox;
  visionLabels?: string[];
  visionDescription?: string;
  visionWebMatches?: FaceSearchMatch[];
}

export interface FaceBoundingBox {
  /** Pixel coordinates (absolute, not %) */
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  emotions?: string[];
  age?: { min: number; max: number };
}

export interface FaceCropResult {
  croppedBase64: string;
  croppedUrl?: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
}

export interface FaceSearchMatch {
  url: string;
  title: string;
  snippet?: string;
  thumbnailUrl?: string;
  similarity: number;
  source: string;
  domain: string;
  isSocialMedia: boolean;
  socialPlatform?: string;
}

export interface FaceSearchResult {
  searchId: string;
  originalImageUrl?: string;
  croppedFaceUrl?: string;
  facesDetected: number;
  faceAnalysis?: {
    emotions: string[];
    age?: { min: number; max: number };
    labels: string[];
    description: string;
  };
  matches: FaceSearchMatch[];
  totalMatches: number;
  socialProfiles: {
    facebook: string[];
    instagram: string[];
    twitter: string[];
    linkedin: string[];
    tiktok: string[];
    vk: string[];
  };
  searchEnginesUsed: string[];
  socialScraper?: {
    available: boolean;
    total: number;
    matches: any[];
    profiles: any[];
  };
  processingTime: number;
  timestamp: Date;
}

/**
 * Face Search Service — Pipeline propio sin APIs costosas de terceros
 *
 * Usa SOLO las APIs que ya tienes configuradas:
 * - Google Cloud Vision AI (GOOGLE_API_KEY) -> Face detection + labels + WEB_DETECTION
 * - Bing Visual Search API (BING_SEARCH_API_KEY) -> Visual search + image search
 * - Sharp -> Face crop local
 * - Cloudinary -> Hosting de imagenes
 * - Yandex/Google/TinEye scraping -> Complemento gratuito
 *
 * Pipeline:
 * 1. Upload imagen original -> Cloudinary (URL publica)
 * 2. Google Vision AI -> detectar rostro(s) con fdBoundingPoly REAL + WEB_DETECTION
 * 3. Sharp -> recortar rostro con coordenadas exactas de Vision AI
 * 4. Upload rostro recortado -> Cloudinary
 * 5. Busqueda en paralelo:
 *    a. Bing Visual Search API (imagen -> matches visuales)
 *    b. Bing Image Search (labels de Vision AI -> busqueda por texto)
 *    c. Yandex reverse image (mejor para rostros, scraping)
 *    d. Google reverse image (scraping)
 *    e. TinEye (exact match, scraping)
 * 6. Extraer redes sociales de resultados
 * 7. Guardar como evidencias en MongoDB
 */
@Injectable()
export class FaceSearchService {
  private readonly logger = new Logger(FaceSearchService.name);
  private readonly bingApiKey: string;
  private readonly bingEnabled: boolean;
  private readonly googleApiKey: string;
  private readonly visionBaseUrl = 'https://vision.googleapis.com/v1';
  private readonly geminiModel: any;
  private readonly serperEnabled: boolean;
  private readonly candidateRerankLimit = 80;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly googleVisionService: GoogleVisionService,
    private readonly evidenceService: EvidenceService,
    private readonly reverseImageSearch: ReverseImageSearchService,
    private readonly serperSearchService: SerperSearchService,
    private readonly storagePath: StoragePathService,
    private readonly securityValidation: SecurityValidationService,
    private readonly socialScraperClient: SocialScraperClientService,
  ) {
    this.bingApiKey =
      this.configService.get<string>('BING_SEARCH_API_KEY') || '';
    this.bingEnabled = !!this.bingApiKey;

    this.googleApiKey =
      this.configService.get<string>('GOOGLE_API_KEY') || '';

    // Initialize Gemini 2.5 Flash as fallback for face analysis when Vision API is unavailable
    const geminiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (geminiKey) {
      const genAI = new GoogleGenerativeAI(geminiKey);
      this.geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    }

    this.serperEnabled = this.serperSearchService.isAvailable();

    const engines: string[] = [];
    if (this.bingEnabled) engines.push('Bing Visual Search', 'Bing Image Search');
    if (this.googleApiKey) {
      engines.push(
        'Google Vision AI (face+labels+web)',
        'Google Vision Web Detection matches',
      );
    }
    if (this.geminiModel) engines.push('Gemini 2.5 Flash (face analysis fallback)');
    if (this.serperEnabled) engines.push('Serper Images (Google Images API)');
    if (this.socialScraperClient.isAvailable()) engines.push('OSINT Social Scraper');
    engines.push('Yandex', 'Google Scraping', 'TinEye');

    this.logger.log(
      `FaceSearchService initialized — engines: [${engines.join(', ')}]`,
    );
  }

  // ============================================================================
  // MAIN PIPELINE
  // ============================================================================

  async executeFaceSearch(
    searchId: string,
    imageBase64?: string,
    imageUrl?: string,
    options?: { socialPlatforms?: string[]; socialLimit?: number },
  ): Promise<FaceSearchResult> {
    const startTime = Date.now();
    this.logger.log(`Starting face search pipeline for ${searchId}...`);

    const result: FaceSearchResult = {
      searchId,
      facesDetected: 0,
      matches: [],
      totalMatches: 0,
      socialProfiles: {
        facebook: [],
        instagram: [],
        twitter: [],
        linkedin: [],
        tiktok: [],
        vk: [],
      },
      searchEnginesUsed: [],
      processingTime: 0,
      timestamp: new Date(),
    };

    try {
      // -- Step 1: Asegurar URL publica de la imagen original --
      let publicImageUrl = imageUrl;
      if (!publicImageUrl && imageBase64) {
        const dataUri = imageBase64.startsWith('data:')
          ? imageBase64
          : `data:image/jpeg;base64,${imageBase64}`;
        const upload = await this.cloudinaryService.uploadBase64(
          dataUri,
          `${this.storagePath.safeSegment(searchId)}-face-original`,
          {
            folder: this.storagePath.faceFolder(searchId, 'original'),
            tags: ['face-search', 'original', searchId],
          },
        );
        publicImageUrl = upload.secureUrl;
        this.logger.log(`Original image uploaded: ${publicImageUrl}`);
      }
      result.originalImageUrl = publicImageUrl;

      // -- Step 2: Detectar rostros con Google Vision AI (raw API) --
      const rawBase64 = imageBase64
        ? imageBase64.includes('base64,')
          ? imageBase64.split('base64,')[1]
          : imageBase64
        : undefined;

      const faceDetection = await this.detectFacesRaw(publicImageUrl, rawBase64);
      result.facesDetected = faceDetection.totalFaces;
      result.faceAnalysis = {
        emotions: faceDetection.primaryFace?.emotions || [],
        age: faceDetection.primaryFace?.age,
        labels: faceDetection.visionLabels || [],
        description: faceDetection.visionDescription || '',
      };
      this.logger.log(
        `Faces detected: ${faceDetection.totalFaces} (confidence: ${faceDetection.primaryFace?.confidence?.toFixed(2) || 'N/A'})`,
      );

      // -- Step 3: Recortar rostro principal --
      let croppedFaceUrl: string | undefined;
      if (faceDetection.primaryFace && rawBase64) {
        const crop = await this.cropFace(rawBase64, faceDetection.primaryFace);
        if (crop) {
          const cropUpload = await this.cloudinaryService.uploadBase64(
            `data:image/jpeg;base64,${crop.croppedBase64}`,
            `${this.storagePath.safeSegment(searchId)}-face-crop`,
            {
              folder: this.storagePath.faceFolder(searchId, 'crops'),
              tags: ['face-search', 'crop', searchId],
            },
          );
          croppedFaceUrl = cropUpload.secureUrl;
          result.croppedFaceUrl = croppedFaceUrl;
          this.logger.log(`Face cropped and uploaded: ${croppedFaceUrl}`);
        }
      }

      // -- Step 4: Buscar rostro en la web --
      const searchUrl = croppedFaceUrl || publicImageUrl;
      if (!searchUrl) {
        this.logger.warn('No image URL available for face search');
        result.processingTime = Date.now() - startTime;
        return result;
      }

      // 4a. Bing Visual Search API (si hay key)
      const searchPromises: Promise<FaceSearchMatch[]>[] = [];

      if (faceDetection.visionWebMatches?.length) {
        result.matches.push(...faceDetection.visionWebMatches);
        result.searchEnginesUsed.push('google-vision-web');
        this.logger.log(
          `Google Vision Web Detection added ${faceDetection.visionWebMatches.length} direct matches`,
        );
      }

      if (this.bingEnabled) {
        searchPromises.push(
          this.searchBingVisual(searchUrl, rawBase64).then((r) => {
            result.searchEnginesUsed.push('bing-visual');
            return r;
          }),
        );
        if (faceDetection.visionLabels?.length) {
          const labelQuery = faceDetection.visionLabels.slice(0, 5).join(' ');
          searchPromises.push(
            this.searchBingImages(searchUrl, labelQuery).then((r) => {
              result.searchEnginesUsed.push('bing-images');
              return r;
            }),
          );
        }
      }

      // 4b. Serper Google Images API (confiable, sin scraping)
      if (this.serperEnabled) {
        const labels = faceDetection.visionLabels || [];
        const description = faceDetection.visionDescription || '';
        // Build a descriptive search query from Gemini/Vision labels
        const serperQuery = description
          ? `"${description}" face`
          : labels.length > 0
            ? labels.slice(0, 5).join(' ') + ' face photo'
            : 'person face';

        searchPromises.push(
          this.serperSearchService
            .searchImages(searchId, serperQuery, { maxResults: 20 })
            .then((images) => {
              result.searchEnginesUsed.push('serper-images');
              this.logger.log(`Serper Images returned ${images.length} results for "${serperQuery}"`);
              return images.map((img) => {
                const socialInfo = this.detectSocialPlatform(img.link || img.imageUrl);
                return {
                  url: img.link || img.imageUrl,
                  title: img.title || '',
                  snippet: img.source || '',
                  thumbnailUrl: img.thumbnailUrl || img.imageUrl,
                  similarity: 0.5, // text-based search, lower confidence
                  source: 'serper-images',
                  domain: this.extractDomain(img.link || img.imageUrl),
                  isSocialMedia: socialInfo.isSocial,
                  socialPlatform: socialInfo.platform,
                } as FaceSearchMatch;
              });
            })
            .catch((err) => {
              result.searchEnginesUsed.push('serper-images');
              this.logger.error(`Serper Images failed: ${err.message}`);
              return [] as FaceSearchMatch[];
            }),
        );
      }

      // 4c. Reutilizar ReverseImageSearchService (Yandex + Google + TinEye)
      // Este servicio YA funciona y tiene los selectores correctos
      searchPromises.push(
        this.reverseImageSearch
          .searchByImage(searchUrl)
          .then((response) => {
            // Siempre registrar los motores, aun con 0 resultados
            result.searchEnginesUsed.push('yandex', 'google-scraping', 'tineye');
            this.logger.log(`Reverse image search returned ${response.results.length} results from ${response.results.map(r => r.source).join(', ') || 'none'}`);
            return response.results.map((r) => {
              const socialInfo = this.detectSocialPlatform(r.url);
              return {
                url: r.url,
                title: r.title || '',
                snippet: r.snippet,
                thumbnailUrl: r.thumbnail || r.imageUrl,
                similarity: r.confidence || 0.7,
                source: r.source,
                domain: r.domain || this.extractDomain(r.url),
                isSocialMedia: socialInfo.isSocial,
                socialPlatform: socialInfo.platform,
              } as FaceSearchMatch;
            });
          })
          .catch((err) => {
            result.searchEnginesUsed.push('yandex', 'google-scraping', 'tineye');
            this.logger.error(`Reverse image search failed: ${err.message}`);
            return [] as FaceSearchMatch[];
          }),
      );

      const allResults = await Promise.allSettled(searchPromises);

      for (const res of allResults) {
        if (res.status === 'fulfilled') {
          result.matches.push(...res.value);
        }
      }

      // 4d. Servicio agregado: osint-social-scraper
      // Compara la foto recibida contra imágenes sociales guardadas y enriquece perfiles.
      if (rawBase64 && this.socialScraperClient.isAvailable()) {
        const socialScraperResult = await this.socialScraperClient.searchByImage(
          rawBase64,
          (options?.socialPlatforms?.length ? options.socialPlatforms : ['instagram', 'facebook', 'tiktok', 'x', 'youtube', 'telegram', 'threads', 'bluesky']) as any,
          options?.socialLimit || 20,
        );

        if (socialScraperResult) {
          result.searchEnginesUsed.push('osint-social-scraper');
          result.socialScraper = {
            available: true,
            total: socialScraperResult.total || 0,
            matches: socialScraperResult.matches || [],
            profiles: socialScraperResult.profiles || [],
          };

          const scraperMatches = (socialScraperResult.matches || []).map((match: any) => ({
            url: match.publicUrl || match.relativePath || '',
            title: `Social image match — ${match.platform || 'social'} / ${match.owner || 'unknown'}`,
            snippet: `Local social image match score ${match.score ?? 0}`,
            thumbnailUrl: match.publicUrl,
            similarity: typeof match.similarity === 'number' ? match.similarity : (match.score || 0) / 100,
            source: 'osint-social-scraper',
            domain: 'local-social-volume',
            isSocialMedia: true,
            socialPlatform: match.platform,
          })) as FaceSearchMatch[];

          result.matches.push(...scraperMatches);
          this.logger.log(
            `OSINT Social Scraper added ${scraperMatches.length} visual matches and ${(socialScraperResult.profiles || []).length} profiles`,
          );
        }
      }

      // Re-rank with real visual similarity against the input face image.
      // This sharply reduces generic "similar woman/man" false positives.
      result.matches = await this.rerankMatchesByVisualSimilarity(
        result.matches,
        searchUrl,
      );

      // Additional quality gate: penalize candidates where no face is detected
      // in thumbnail/preview images (common source of false positives).
      result.matches = await this.penalizeNonFaceCandidates(result.matches);

      result.matches = this.deduplicateMatches(result.matches);
      result.matches = this.filterAndDiversifyMatches(result.matches);
      result.totalMatches = result.matches.length;

      // -- Step 5: Extraer perfiles de redes sociales --
      result.socialProfiles = this.extractSocialProfiles(result.matches);
      this.mergeSocialScraperProfiles(result);

      // -- Step 6: Guardar evidencias --
      await this.saveAsEvidences(searchId, result);

      result.processingTime = Date.now() - startTime;
      this.logger.log(
        `Face search complete: ${result.totalMatches} matches in ${result.processingTime}ms`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Face search pipeline failed: ${error.message}`,
        error.stack,
      );
      result.processingTime = Date.now() - startTime;
      return result;
    }
  }

  // ============================================================================
  // STEP 2: FACE DETECTION — Google Vision AI RAW (fdBoundingPoly real)
  // ============================================================================

  /**
   * Llama a Google Vision AI directamente para obtener faceAnnotations
   * con coordenadas REALES del bounding box (fdBoundingPoly).
   * Tambien obtiene labels y WEB_DETECTION para enriquecer la busqueda.
   */
  async detectFacesRaw(
    imageUrl?: string,
    imageBase64?: string,
    allowGeminiFallback = true,
  ): Promise<FaceDetectionResult> {
    this.logger.log('Detecting faces with Google Vision AI (raw API)...');

    const fallback: FaceDetectionResult = {
      detected: false,
      faces: [],
      totalFaces: 0,
      visionLabels: [],
      visionDescription: '',
      visionWebMatches: [],
    };

    const imageSource = imageUrl || imageBase64;
    if (!imageSource) return fallback;

    if (!this.googleApiKey) {
      this.logger.warn(
        'Google Vision AI not configured — using full image as face region',
      );
      return {
        detected: true,
        faces: [{ x: 0, y: 0, width: -1, height: -1, confidence: 0.5 }],
        totalFaces: 1,
        primaryFace: { x: 0, y: 0, width: -1, height: -1, confidence: 0.5 },
        visionLabels: ['person', 'face'],
        visionDescription: 'Unknown person',
        visionWebMatches: [],
      };
    }

    try {
      const imagePayload = imageSource.startsWith('http')
        ? { source: { imageUri: imageSource } }
        : { content: imageSource };

      const requestBody = {
        requests: [
          {
            image: imagePayload,
            features: [
              { type: 'FACE_DETECTION', maxResults: 10 },
              { type: 'LABEL_DETECTION', maxResults: 15 },
              { type: 'WEB_DETECTION', maxResults: 10 },
            ],
          },
        ],
      };

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.visionBaseUrl}/images:annotate?key=${this.googleApiKey}`,
          requestBody,
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 20000,
          },
        ),
      );

      const apiResult = response.data?.responses?.[0];

      if (apiResult?.error) {
        throw new Error(`Vision API: ${apiResult.error.message}`);
      }

      // -- Parse face annotations (coordenadas REALES en pixeles) --
      const faceAnnotations = apiResult?.faceAnnotations || [];
      const faces: FaceBoundingBox[] = [];

      for (const face of faceAnnotations) {
        const poly =
          face.fdBoundingPoly?.vertices ||
          face.boundingPoly?.vertices ||
          [];

        if (poly.length >= 4) {
          const xs = poly.map((v: any) => v.x || 0);
          const ys = poly.map((v: any) => v.y || 0);
          const minX = Math.min(...xs);
          const minY = Math.min(...ys);
          const maxX = Math.max(...xs);
          const maxY = Math.max(...ys);

          const emotions: string[] = [];
          if (face.joyLikelihood === 'LIKELY' || face.joyLikelihood === 'VERY_LIKELY')
            emotions.push('joy');
          if (face.sorrowLikelihood === 'LIKELY' || face.sorrowLikelihood === 'VERY_LIKELY')
            emotions.push('sorrow');
          if (face.angerLikelihood === 'LIKELY' || face.angerLikelihood === 'VERY_LIKELY')
            emotions.push('anger');
          if (face.surpriseLikelihood === 'LIKELY' || face.surpriseLikelihood === 'VERY_LIKELY')
            emotions.push('surprise');
          if (emotions.length === 0) emotions.push('neutral');

          faces.push({
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
            confidence: face.detectionConfidence || 0,
            emotions,
          });
        }
      }

      // -- Parse labels --
      const labels: string[] = (apiResult?.labelAnnotations || [])
        .map((l: any) => l.description)
        .filter(Boolean);

      // -- Parse web detection --
      const webDetection = apiResult?.webDetection;
      const bestGuess = webDetection?.bestGuessLabels?.[0]?.label || '';
      const webEntities = (webDetection?.webEntities || [])
        .filter((e: any) => e.description && e.score > 0.5)
        .map((e: any) => e.description);
      const visionWebMatches = this.extractVisionWebMatches(webDetection);

      const descParts = [bestGuess, ...webEntities.slice(0, 3)].filter(Boolean);
      const visionDescription = descParts.join(', ') || labels.slice(0, 5).join(', ');

      this.logger.log(
        `Vision AI: ${faces.length} faces, ${labels.length} labels, bestGuess="${bestGuess}"`,
      );
      this.logger.log(`Web entities: ${webEntities.slice(0, 5).join(', ')}`);
      this.logger.log(`Vision web matches: ${visionWebMatches.length}`);

      if (faces.length === 0) {
        this.logger.log('No faces detected — using full image as search target');
        return {
          detected: false,
          faces: [{ x: 0, y: 0, width: -1, height: -1, confidence: 0.3 }],
          totalFaces: 0,
          primaryFace: { x: 0, y: 0, width: -1, height: -1, confidence: 0.3 },
          visionLabels: labels,
          visionDescription,
          visionWebMatches,
        };
      }

      faces.sort((a, b) => b.confidence - a.confidence);

      return {
        detected: true,
        faces,
        totalFaces: faces.length,
        primaryFace: faces[0],
        visionLabels: labels,
        visionDescription,
        visionWebMatches,
      };
    } catch (error) {
      this.logger.error(`Face detection raw error: ${error.message}`);

      // ── Fallback: use Gemini 2.5 Flash for face analysis ──
      if (allowGeminiFallback && this.geminiModel) {
        this.logger.log('Falling back to Gemini 2.5 Flash for face analysis...');
        // Retry up to 2 times with backoff (free tier has per-minute quotas)
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            return await this.detectFacesWithGemini(imageUrl, imageBase64);
          } catch (geminiErr) {
            const msg = geminiErr.message || '';
            const isRateLimit = msg.includes('429') || msg.includes('quota') || msg.includes('Too Many Requests');
            if (isRateLimit && attempt < 2) {
              const waitSec = 15 * attempt; // 15s, 30s
              this.logger.warn(`Gemini rate limited, retrying in ${waitSec}s (attempt ${attempt}/2)...`);
              await new Promise((r) => setTimeout(r, waitSec * 1000));
            } else {
              this.logger.error(`Gemini face analysis fallback failed: ${geminiErr.message}`);
            }
          }
        }
      }

      return {
        detected: false,
        faces: [{ x: 0, y: 0, width: -1, height: -1, confidence: 0.2 }],
        totalFaces: 0,
        primaryFace: { x: 0, y: 0, width: -1, height: -1, confidence: 0.2 },
        visionLabels: [],
        visionDescription: '',
        visionWebMatches: [],
      };
    }
  }

  // ============================================================================
  // STEP 2b: FACE DETECTION FALLBACK — Gemini 2.5 Flash
  // ============================================================================

  /**
   * Usa Gemini 2.5 Flash como fallback cuando Vision AI devuelve 403 (billing).
   * Analiza la imagen y devuelve descripción + labels aunque sin bounding box exacto.
   */
  private async detectFacesWithGemini(
    imageUrl?: string,
    imageBase64?: string,
  ): Promise<FaceDetectionResult> {
    const prompt = `Analyze this image for face detection. Respond ONLY with valid JSON (no markdown, no code blocks):
{
  "facesDetected": <number>,
  "description": "<brief description of the person(s) visible>",
  "labels": ["<label1>", "<label2>", ...],
  "emotions": ["<emotion1>", ...],
  "ageRange": { "min": <number>, "max": <number> },
  "gender": "<male|female|unknown>",
  "distinctiveFeatures": ["<feature1>", ...]
}`;

    const parts: any[] = [{ text: prompt }];

    if (imageUrl) {
      // Fetch the image and send as inline data
      try {
        const imageBuffer = await this.securityValidation.fetchPublicUrl(imageUrl, {
          field: 'imageUrl',
          allowLocalUploads: true,
          accept: 'image/*,*/*;q=0.8',
        });
        const base64Data = imageBuffer.toString('base64');
        parts.push({
          inlineData: { mimeType: this.guessImageMimeType(imageUrl), data: base64Data },
        });
      } catch {
        // If URL fetch fails and we have base64, use that
        if (imageBase64) {
          parts.push({
            inlineData: { mimeType: 'image/jpeg', data: imageBase64 },
          });
        }
      }
    } else if (imageBase64) {
      parts.push({
        inlineData: { mimeType: 'image/jpeg', data: imageBase64 },
      });
    }

    const result = await this.geminiModel.generateContent(parts);
    const response = await result.response;
    const text = response.text();

    // Parse JSON from Gemini response (strip markdown code blocks if present)
    const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      this.logger.warn(`Gemini response not valid JSON: ${text.substring(0, 200)}`);
      parsed = { facesDetected: 1, description: 'Person detected', labels: ['person', 'face'], emotions: ['neutral'] };
    }

    const facesDetected = parsed.facesDetected || 0;
    const labels = parsed.labels || ['person'];
    const emotions = parsed.emotions || ['neutral'];
    const description = parsed.description || '';
    const features = parsed.distinctiveFeatures || [];

    this.logger.log(
      `Gemini 2.5 Flash: ${facesDetected} face(s), labels=[${labels.slice(0, 5).join(', ')}], desc="${description.substring(0, 80)}"`,
    );

    // Sin Vision AI no tenemos bounding box exacto → usar imagen completa
    // pero enriquecemos con labels y descripción de Gemini
    const confidence = facesDetected > 0 ? 0.75 : 0.3;

    return {
      detected: facesDetected > 0,
      faces: [{
        x: 0,
        y: 0,
        width: -1,
        height: -1,
        confidence,
        emotions,
        age: parsed.ageRange || undefined,
      }],
      totalFaces: facesDetected,
      primaryFace: {
        x: 0,
        y: 0,
        width: -1,
        height: -1,
        confidence,
        emotions,
        age: parsed.ageRange || undefined,
      },
      visionLabels: [...labels, ...features],
      visionDescription: description,
    };
  }

  // ============================================================================
  // STEP 3: FACE CROP (Sharp) — coordenadas REALES de Vision AI
  // ============================================================================

  async cropFace(
    imageBase64: string,
    boundingBox: FaceBoundingBox,
  ): Promise<FaceCropResult | null> {
    this.logger.log('Cropping face with Sharp...');

    try {
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      const metadata = await sharp(imageBuffer).metadata();

      if (!metadata.width || !metadata.height) {
        this.logger.warn('Could not read image metadata');
        return null;
      }

      const imgW = metadata.width;
      const imgH = metadata.height;

      let left: number, top: number, width: number, height: number;

      if (boundingBox.width === -1 || boundingBox.height === -1) {
        // Sin deteccion precisa -> center crop al 70%
        const cropSize = Math.round(Math.min(imgW, imgH) * 0.7);
        left = Math.round((imgW - cropSize) / 2);
        top = Math.round((imgH - cropSize) / 2);
        width = cropSize;
        height = cropSize;
        this.logger.log(`Using center crop: ${width}x${height}`);
      } else {
        // Coordenadas en pixeles de Vision AI (fdBoundingPoly)
        left = boundingBox.x;
        top = boundingBox.y;
        width = boundingBox.width;
        height = boundingBox.height;

        // Agregar padding 25% para contexto
        const padX = Math.round(width * 0.25);
        const padY = Math.round(height * 0.25);
        left = Math.max(0, left - padX);
        top = Math.max(0, top - padY);
        width = Math.min(imgW - left, width + padX * 2);
        height = Math.min(imgH - top, height + padY * 2);

        this.logger.log(
          `Vision AI bbox: (${boundingBox.x},${boundingBox.y}) ${boundingBox.width}x${boundingBox.height} -> padded: (${left},${top}) ${width}x${height}`,
        );
      }

      if (width < 30 || height < 30) {
        this.logger.warn('Face region too small, center crop fallback');
        const cropSize = Math.round(Math.min(imgW, imgH) * 0.6);
        left = Math.round((imgW - cropSize) / 2);
        top = Math.round((imgH - cropSize) / 2);
        width = cropSize;
        height = cropSize;
      }

      // Clamp to image bounds
      left = Math.max(0, Math.min(left, imgW - 1));
      top = Math.max(0, Math.min(top, imgH - 1));
      width = Math.min(width, imgW - left);
      height = Math.min(height, imgH - top);

      const cropped = await sharp(imageBuffer)
        .extract({ left, top, width, height })
        .resize(512, 512, { fit: 'inside', withoutEnlargement: false })
        .jpeg({ quality: 90 })
        .toBuffer();

      this.logger.log(
        `Face cropped: ${width}x${height} -> ${cropped.length} bytes`,
      );

      return {
        croppedBase64: cropped.toString('base64'),
        width: 512,
        height: 512,
        originalWidth: imgW,
        originalHeight: imgH,
      };
    } catch (error) {
      this.logger.error(`Face crop error: ${error.message}`);
      return null;
    }
  }

  // ============================================================================
  // STEP 4a: BING VISUAL SEARCH API — misma BING_SEARCH_API_KEY
  // ============================================================================

  private async searchBingVisual(
    imageUrl: string,
    imageBase64?: string,
  ): Promise<FaceSearchMatch[]> {
    if (!this.bingEnabled) return [];
    this.logger.log('Bing Visual Search...');

    try {
      const matches: FaceSearchMatch[] = [];

      const knowledgeRequest = JSON.stringify({
        imageInfo: { url: imageUrl },
      });

      const FormDataModule = await import('form-data');
      const form = new FormDataModule.default();
      form.append('knowledgeRequest', knowledgeRequest);

      if (imageBase64) {
        const imgBuffer = Buffer.from(imageBase64, 'base64');
        form.append('image', imgBuffer, {
          filename: 'face.jpg',
          contentType: 'image/jpeg',
        });
      }

      const response = await firstValueFrom(
        this.httpService.post(
          'https://api.bing.microsoft.com/v7.0/images/visualsearch',
          form,
          {
            headers: {
              'Ocp-Apim-Subscription-Key': this.bingApiKey,
              ...form.getHeaders(),
            },
            timeout: 20000,
          },
        ),
      );

      const tags = response.data?.tags || [];

      for (const tag of tags) {
        const actions = tag.actions || [];

        for (const action of actions) {
          // PagesIncluding
          if (action.actionType === 'PagesIncluding' && action.data?.value) {
            for (const page of action.data.value) {
              const socialInfo = this.detectSocialPlatform(page.hostPageUrl || '');
              matches.push({
                url: page.hostPageUrl || page.contentUrl || '',
                title: page.name || page.hostPageDisplayUrl || 'Bing match',
                snippet: page.snippet || undefined,
                thumbnailUrl: page.thumbnailUrl || page.contentUrl || undefined,
                similarity: 0.8,
                source: 'bing-visual',
                domain: page.hostPageDomainFriendlyName || this.extractDomain(page.hostPageUrl),
                isSocialMedia: socialInfo.isSocial,
                socialPlatform: socialInfo.platform,
              });
            }
          }

          // VisuallySimilarImages
          if (action.actionType === 'VisuallySimilarImages' && action.data?.value) {
            for (const img of action.data.value) {
              const pageUrl = img.hostPageUrl || img.contentUrl || '';
              const socialInfo = this.detectSocialPlatform(pageUrl);
              matches.push({
                url: pageUrl,
                title: img.name || 'Similar image',
                thumbnailUrl: img.thumbnailUrl || img.contentUrl || undefined,
                similarity: 0.7,
                source: 'bing-visual',
                domain: img.hostPageDomainFriendlyName || this.extractDomain(pageUrl),
                isSocialMedia: socialInfo.isSocial,
                socialPlatform: socialInfo.platform,
              });
            }
          }

          // VisualSearch results
          if (action.actionType === 'VisualSearch' && action.data?.value) {
            for (const item of action.data.value.slice(0, 5)) {
              const itemUrl = item.hostPageUrl || item.contentUrl || '';
              if (itemUrl) {
                const socialInfo = this.detectSocialPlatform(itemUrl);
                matches.push({
                  url: itemUrl,
                  title: item.name || 'Visual match',
                  thumbnailUrl: item.thumbnailUrl || undefined,
                  similarity: 0.65,
                  source: 'bing-visual',
                  domain: this.extractDomain(itemUrl),
                  isSocialMedia: socialInfo.isSocial,
                  socialPlatform: socialInfo.platform,
                });
              }
            }
          }
        }
      }

      this.logger.log(`Bing Visual Search: ${matches.length} matches`);
      return matches;
    } catch (error) {
      this.logger.error(`Bing Visual Search error: ${error.message}`);
      return [];
    }
  }

  // ============================================================================
  // STEP 4b: BING IMAGE SEARCH — busqueda por descripcion de Vision AI
  // ============================================================================

  private async searchBingImages(
    imageUrl: string,
    query: string,
  ): Promise<FaceSearchMatch[]> {
    if (!this.bingEnabled || !query) return [];
    this.logger.log(`Bing Image Search: "${query}"...`);

    try {
      const response = await firstValueFrom(
        this.httpService.get(
          'https://api.bing.microsoft.com/v7.0/images/search',
          {
            params: {
              q: query,
              count: 15,
              mkt: 'en-US',
              safeSearch: 'Off',
            },
            headers: {
              'Ocp-Apim-Subscription-Key': this.bingApiKey,
            },
            timeout: 15000,
          },
        ),
      );

      const matches: FaceSearchMatch[] = [];
      const items = response.data?.value || [];

      for (const img of items) {
        const pageUrl = img.hostPageUrl || img.contentUrl || '';
        if (!pageUrl) continue;

        const socialInfo = this.detectSocialPlatform(pageUrl);
        matches.push({
          url: pageUrl,
          title: img.name || 'Bing Image match',
          snippet: img.hostPageDisplayUrl || undefined,
          thumbnailUrl: img.thumbnailUrl || img.contentUrl || undefined,
          similarity: 0.55,
          source: 'bing-images',
          domain: img.hostPageDomainFriendlyName || this.extractDomain(pageUrl),
          isSocialMedia: socialInfo.isSocial,
          socialPlatform: socialInfo.platform,
        });
      }

      this.logger.log(`Bing Image Search: ${matches.length} matches`);
      return matches;
    } catch (error) {
      this.logger.error(`Bing Image Search error: ${error.message}`);
      return [];
    }
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================

  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url.substring(0, 50);
    }
  }

  private detectSocialPlatform(url: string): {
    isSocial: boolean;
    platform?: string;
  } {
    let host = '';
    try {
      host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return { isSocial: false };
    }
    const platforms: Record<string, string> = {
      'facebook.com': 'facebook',
      'fb.com': 'facebook',
      'instagram.com': 'instagram',
      'twitter.com': 'twitter',
      'x.com': 'twitter',
      'linkedin.com': 'linkedin',
      'tiktok.com': 'tiktok',
      'vk.com': 'vk',
      'vk.ru': 'vk',
      'youtube.com': 'youtube',
      'reddit.com': 'reddit',
      'pinterest.com': 'pinterest',
      'tumblr.com': 'tumblr',
      'flickr.com': 'flickr',
    };

    for (const [domain, platform] of Object.entries(platforms)) {
      const normalizedDomain = domain.toLowerCase().replace(/^www\./, '');
      if (host === normalizedDomain || host.endsWith(`.${normalizedDomain}`)) {
        return { isSocial: true, platform };
      }
    }

    return { isSocial: false };
  }

  private deduplicateMatches(matches: FaceSearchMatch[]): FaceSearchMatch[] {
    const seen = new Map<string, FaceSearchMatch>();

    for (const match of matches) {
      const key = match.url
        .replace(/^https?:\/\/(www\.)?/, '')
        .replace(/\/+$/, '')
        .toLowerCase();

      const existing = seen.get(key);
      if (!existing || match.similarity > existing.similarity) {
        seen.set(key, match);
      }
    }

    return Array.from(seen.values()).sort(
      (a, b) => b.similarity - a.similarity,
    );
  }

  /**
   * Applies stricter post-ranking quality rules to reduce generic false positives:
   * - source-specific minimum similarity thresholds
   * - prioritization of candidates with image evidence
   * - domain diversity in top results
   */
  private filterAndDiversifyMatches(matches: FaceSearchMatch[]): FaceSearchMatch[] {
    if (matches.length === 0) return matches;

    const sourceThreshold: Record<string, number> = {
      'google-vision-web': 0.48,
      'bing-visual': 0.38,
      'bing-images': 0.44,
      'serper-images': 0.46,
      yandex: 0.36,
      'google-scraping': 0.37,
      tineye: 0.34,
    };

    const withEvidenceBoost = matches
      .map((m) => {
        const hasImageEvidence = !!m.thumbnailUrl || /\.(jpe?g|png|webp|bmp|gif)(\?|$)/i.test(m.url);
        const boosted = hasImageEvidence
          ? this.clamp01(m.similarity + 0.015)
          : this.clamp01(m.similarity - 0.04);

        return { ...m, similarity: boosted };
      })
      .filter((m) => {
        const threshold = sourceThreshold[m.source] ?? 0.4;

        // Social profiles can survive with slightly lower score if still plausible.
        if (m.isSocialMedia) {
          return m.similarity >= threshold - 0.04;
        }

        return m.similarity >= threshold;
      })
      .sort((a, b) => b.similarity - a.similarity);

    // Keep result head diverse: avoid flooding top results with same domain clones.
    const maxPerDomainInHead = 2;
    const headSize = Math.min(20, withEvidenceBoost.length);
    const selectedHead: FaceSearchMatch[] = [];
    const selectedTail: FaceSearchMatch[] = [];
    const domainCount = new Map<string, number>();

    for (const match of withEvidenceBoost) {
      if (selectedHead.length < headSize) {
        const count = domainCount.get(match.domain) || 0;
        if (count < maxPerDomainInHead) {
          selectedHead.push(match);
          domainCount.set(match.domain, count + 1);
        } else {
          selectedTail.push(match);
        }
      } else {
        selectedTail.push(match);
      }
    }

    return [...selectedHead, ...selectedTail];
  }

  /**
   * Converts Google Vision WEB_DETECTION output into direct candidate matches.
   * This is the closest built-in signal to Google Lens-style visual matches.
   */
  private extractVisionWebMatches(webDetection: any): FaceSearchMatch[] {
    if (!webDetection) return [];

    const byUrl = new Map<string, FaceSearchMatch>();

    const upsert = (
      url: string | undefined,
      title: string,
      sourceType: 'full' | 'partial' | 'page',
      thumbnailUrl?: string,
    ) => {
      if (!url) return;

      const normalized = url.trim();
      if (!normalized.startsWith('http')) return;

      const socialInfo = this.detectSocialPlatform(normalized);
      const baseSimilarity =
        sourceType === 'full' ? 0.9 : sourceType === 'partial' ? 0.78 : 0.66;

      const candidate: FaceSearchMatch = {
        url: normalized,
        title: title || 'Google Vision match',
        snippet: 'Google Vision Web Detection',
        thumbnailUrl,
        similarity: baseSimilarity,
        source: 'google-vision-web',
        domain: this.extractDomain(normalized),
        isSocialMedia: socialInfo.isSocial,
        socialPlatform: socialInfo.platform,
      };

      const existing = byUrl.get(normalized);
      if (!existing || candidate.similarity > existing.similarity) {
        byUrl.set(normalized, candidate);
      }
    };

    const pages = webDetection.pagesWithMatchingImages || [];
    for (const page of pages) {
      const pageUrl = page?.url as string | undefined;
      const pageTitle = page?.pageTitle as string | undefined;

      upsert(pageUrl, pageTitle || 'Google Vision page match', 'page');

      const full = page?.fullMatchingImages || [];
      for (const image of full) {
        upsert(
          image?.url,
          pageTitle || 'Google Vision full image match',
          'full',
          image?.url,
        );
      }

      const partial = page?.partialMatchingImages || [];
      for (const image of partial) {
        upsert(
          image?.url,
          pageTitle || 'Google Vision partial image match',
          'partial',
          image?.url,
        );
      }
    }

    const fullMatchingImages = webDetection.fullMatchingImages || [];
    for (const image of fullMatchingImages) {
      upsert(image?.url, 'Google Vision full image match', 'full', image?.url);
    }

    const partialMatchingImages = webDetection.partialMatchingImages || [];
    for (const image of partialMatchingImages) {
      upsert(
        image?.url,
        'Google Vision partial image match',
        'partial',
        image?.url,
      );
    }

    return Array.from(byUrl.values())
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 40);
  }

  /**
   * Computes image-to-image similarity between the source face and candidate thumbnails,
   * then adjusts final ranking score to prioritize actual facial matches over text-noisy hits.
   */
  private async rerankMatchesByVisualSimilarity(
    matches: FaceSearchMatch[],
    referenceImageUrl?: string,
  ): Promise<FaceSearchMatch[]> {
    if (!referenceImageUrl || matches.length === 0) return matches;

    const referenceBuffer = await this.downloadImageBuffer(referenceImageUrl);
    if (!referenceBuffer) return matches;

    const referenceDescriptor = await this.createImageDescriptor(referenceBuffer);
    if (!referenceDescriptor) return matches;

    // Evaluate best candidates first to keep latency under control.
    const ranked = [...matches]
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, this.candidateRerankLimit);

    const reranked = await Promise.all(
      ranked.map(async (match) => {
        const candidateImageUrl =
          match.thumbnailUrl ||
          (/(\.(jpe?g|png|webp|bmp|gif))(\?|$)/i.test(match.url)
            ? match.url
            : undefined);

        if (!candidateImageUrl) {
          return this.applySourcePenalty(match, 0);
        }

        const candidateBuffer = await this.downloadImageBuffer(candidateImageUrl);
        if (!candidateBuffer) {
          return this.applySourcePenalty(match, 0);
        }

        const candidateDescriptor = await this.createImageDescriptor(candidateBuffer);
        if (!candidateDescriptor) {
          return this.applySourcePenalty(match, 0);
        }

        const visualSimilarity = this.compareDescriptors(
          referenceDescriptor,
          candidateDescriptor,
        );

        // Blend engine score + visual score, favoring visual match for identity quality.
        const blended = this.clamp01(match.similarity * 0.45 + visualSimilarity * 0.55);
        const rescored: FaceSearchMatch = {
          ...match,
          similarity: this.applySourcePenalty({ ...match, similarity: blended }, visualSimilarity).similarity,
        };
        return rescored;
      }),
    );

    // Keep untouched tail matches (beyond rerank window), but after reranked block.
    const tail = [...matches]
      .sort((a, b) => b.similarity - a.similarity)
      .slice(this.candidateRerankLimit);

    return [...reranked, ...tail].sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Penalizes candidates that do not contain detectable human faces.
   * This removes many noisy visual matches (objects/scenes/graphics).
   */
  private async penalizeNonFaceCandidates(matches: FaceSearchMatch[]): Promise<FaceSearchMatch[]> {
    if (matches.length === 0) return matches;

    const head = [...matches].sort((a, b) => b.similarity - a.similarity).slice(0, 25);
    const tail = [...matches].sort((a, b) => b.similarity - a.similarity).slice(25);

    const rescored = await Promise.all(
      head.map(async (match) => {
        const candidateImageUrl =
          match.thumbnailUrl ||
          (/\.(jpe?g|png|webp|bmp|gif)(\?|$)/i.test(match.url) ? match.url : undefined);

        if (!candidateImageUrl) {
          return match;
        }

        const detection = await this.detectFacesRaw(candidateImageUrl, undefined, false);
        const hasFace = detection.totalFaces > 0 || detection.detected;
        if (hasFace) {
          return match;
        }

        // Strong penalty when candidate has no face at all.
        return { ...match, similarity: this.clamp01(match.similarity * 0.6) };
      }),
    );

    return [...rescored, ...tail].sort((a, b) => b.similarity - a.similarity);
  }

  private applySourcePenalty(match: FaceSearchMatch, visualSimilarity: number): FaceSearchMatch {
    let adjusted = match.similarity;

    // Text-based engines are noisier for identity; require better visual corroboration.
    if ((match.source === 'bing-images' || match.source === 'serper-images') && visualSimilarity < 0.45) {
      adjusted *= 0.75;
    }

    // Hard penalty for very weak visual overlap.
    if (visualSimilarity > 0 && visualSimilarity < 0.3) {
      adjusted *= 0.7;
    }

    return { ...match, similarity: this.clamp01(adjusted) };
  }

  private async downloadImageBuffer(url: string): Promise<Buffer | null> {
    try {
      return await this.securityValidation.fetchPublicUrl(url, {
        field: 'imageUrl',
        allowLocalUploads: true,
        accept: 'image/*,*/*;q=0.8',
      });
    } catch {
      return null;
    }
  }

  private guessImageMimeType(imageUrl: string) {
    const path = new URL(imageUrl).pathname.toLowerCase();
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.webp')) return 'image/webp';
    if (path.endsWith('.gif')) return 'image/gif';
    return 'image/jpeg';
  }

  private async createImageDescriptor(buffer: Buffer): Promise<Buffer | null> {
    try {
      // Normalized grayscale descriptor for robust perceptual comparison.
      return await sharp(buffer)
        .grayscale()
        .resize(64, 64, { fit: 'cover' })
        .raw()
        .toBuffer();
    } catch {
      return null;
    }
  }

  private compareDescriptors(a: Buffer, b: Buffer): number {
    if (a.length !== b.length || a.length === 0) return 0;

    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff += Math.abs(a[i] - b[i]);
    }

    const avgDiff = diff / a.length;
    return this.clamp01(1 - avgDiff / 255);
  }

  private clamp01(v: number): number {
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }

  private extractSocialProfiles(
    matches: FaceSearchMatch[],
  ): FaceSearchResult['socialProfiles'] {
    const profiles: FaceSearchResult['socialProfiles'] = {
      facebook: [],
      instagram: [],
      twitter: [],
      linkedin: [],
      tiktok: [],
      vk: [],
    };

    for (const match of matches) {
      if (!match.isSocialMedia || !match.socialPlatform) continue;
      const platform = match.socialPlatform as keyof typeof profiles;
      if (profiles[platform] && !profiles[platform].includes(match.url)) {
        profiles[platform].push(match.url);
      }
    }

    return profiles;
  }

  private mergeSocialScraperProfiles(result: FaceSearchResult): void {
    const profiles = result.socialScraper?.profiles || [];
    for (const profile of profiles) {
      const platform = this.normalizeSocialProfilePlatform(profile.platform);
      const url = profile.profileUrl || profile.url;
      if (!platform || !url) continue;
      if (!result.socialProfiles[platform].includes(url)) {
        result.socialProfiles[platform].push(url);
      }
    }
  }

  private normalizeSocialProfilePlatform(platform?: string): keyof FaceSearchResult['socialProfiles'] | null {
    const value = String(platform || '').toLowerCase();
    if (value === 'x' || value === 'twitter') return 'twitter';
    if (value === 'facebook' || value === 'instagram' || value === 'linkedin' || value === 'tiktok' || value === 'vk') {
      return value as keyof FaceSearchResult['socialProfiles'];
    }
    return null;
  }

  private async saveAsEvidences(
    searchId: string,
    result: FaceSearchResult,
  ): Promise<void> {
    this.logger.log(
      `Saving ${result.totalMatches} face search matches as evidence...`,
    );

    for (const match of result.matches) {
      try {
        // Fix protocol-relative URLs (Yandex returns //avatars.mds.yandex.net/...)
        const fixUrl = (u?: string) =>
          u ? (u.startsWith('//') ? 'https:' + u : u) : undefined;

        const thumbUrl = fixUrl(match.thumbnailUrl);
        // Use thumbnailUrl, or the match URL itself if it looks like an image
        const imgUrl =
          thumbUrl ||
          (/\.(jpe?g|png|gif|webp|bmp|svg)(\?|$)/i.test(match.url)
            ? match.url
            : undefined);

        await this.evidenceService.saveEvidence(searchId, {
          source: `face_search_${match.source}`,
          category: 'identity',
          title: `[VISUAL] ${match.title}`,
          summary:
            match.snippet ||
            `Visual candidate on ${match.domain} (${(match.similarity * 100).toFixed(0)}% discovery score; facial identity not verified)`,
          url: match.url,
          imageUrl: imgUrl,
          thumbnailUrl: thumbUrl || imgUrl,
          matchConfidence: match.similarity,
          extractedData: {
            urls: [match.url],
            isFaceMatch: false,
            scoreType: 'visual_candidate',
            identityVerified: false,
            faceSearchSource: match.source,
            socialPlatform: match.socialPlatform,
            croppedFaceUrl: result.croppedFaceUrl,
            originalImageUrl: result.originalImageUrl,
          },
        } as any);
      } catch (err) {
        this.logger.error(`Error saving face evidence: ${err.message}`);
      }
    }

    for (const profile of result.socialScraper?.profiles || []) {
      try {
        const platform = profile.platform || 'social';
        const username = profile.username ? `@${profile.username}` : '';
        const title = `${platform} profile ${username}`.trim();
        const url = profile.profileUrl || profile.url;
        if (!url) continue;

        await this.evidenceService.saveEvidence(searchId, {
          source: `social_scraper_${platform}`,
          category: 'social',
          title,
          summary: profile.bio || profile.name || `Social scraper candidate profile for ${platform}`,
          url,
          imageUrl: profile.avatarUrl,
          thumbnailUrl: profile.avatarUrl,
          matchConfidence: profile.confidence || 0.5,
          reliability: profile.source === 'api' ? 0.85 : 0.65,
          extractedData: {
            urls: [url],
            socialProfiles: [{ platform, url, username: profile.username }],
            source: profile.source,
            metadata: profile.metadata || {},
            originalImageUrl: result.originalImageUrl,
            croppedFaceUrl: result.croppedFaceUrl,
          },
        } as any);
      } catch (err) {
        this.logger.error(`Error saving social scraper profile evidence: ${err.message}`);
      }
    }

    this.logger.log('Face evidences saved');
  }
}
