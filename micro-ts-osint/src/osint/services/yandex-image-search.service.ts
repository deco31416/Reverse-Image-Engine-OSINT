import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import * as cheerio from 'cheerio';
import * as FormData from 'form-data';
import { EvidenceService } from './evidence.service';
import { RegexExtractorService } from './regex-extractor.service';
import { RateLimitService } from './rate-limit.service';
import { CloudinaryService } from './cloudinary.service';
import { DatasecCurationService } from './datasec-curation.service';

export interface YandexImageResult {
  /** URL de la página donde se encontró la imagen */
  pageUrl: string;
  /** URL de la imagen */
  imageUrl: string;
  /** Thumbnail de la imagen */
  thumbnailUrl?: string;
  /** Título de la página */
  title: string;
  /** Descripción/snippet */
  description?: string;
  /** Dominio fuente */
  domain: string;
  /** Tamaño de imagen original */
  imageSize?: string;
  /** Confianza (calculada por posición) */
  confidence: number;
  /** Tipo de resultado */
  type: 'similar' | 'page' | 'face' | 'crop';
}

export interface YandexImageSearchResponse {
  results: YandexImageResult[];
  totalResults: number;
  /** Tags de lo que Yandex detectó en la imagen */
  detectedTags?: string[];
  /** Texto OCR detectado */
  ocrText?: string;
  /** Si detectó caras */
  facesDetected: boolean;
  /** Búsquedas relacionadas sugeridas por Yandex */
  relatedSearches: string[];
  /** Imágenes visualmente similares */
  similarImages: string[];
  duration: number;
}

/**
 * Yandex Image Search Service 🔥
 *
 * El MEJOR motor de búsqueda inversa de imágenes para OSINT.
 * Superior a Google para:
 * - Reconocimiento facial (detecta y busca caras)
 * - Encontrar la fuente original de una imagen
 * - Detectar imágenes editadas/manipuladas
 * - Buscar objetos raros
 *
 * Técnicas:
 * 1. Búsqueda por URL de imagen → Yandex analiza y busca
 * 2. Upload de imagen (FormData) → Más preciso
 * 3. CBIR (Content-Based Image Retrieval) nativo
 *
 * Endpoints:
 * - yandex.com/images/search → búsqueda por URL
 * - yandex.com/images/touch/search → mobile (menos captchas)
 * - yandex.ru/images/search → servidor ruso (a veces mejores resultados)
 *
 * 100% gratuito, sin API key, sin login
 */
@Injectable()
export class YandexImageSearchService {
  private readonly logger = new Logger(YandexImageSearchService.name);
  private readonly serviceName = 'yandex_images';

  /**
   * User agents realistas que rotan para evitar bloqueos
   */
  private readonly USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  ];

  /**
   * Dominios de Yandex para rotar (backup si uno falla/bloquea)
   */
  private readonly YANDEX_DOMAINS = [
    'https://yandex.com',
    'https://yandex.ru',
  ];

  private currentDomainIndex = 0;
  private currentUAIndex = 0;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly evidenceService: EvidenceService,
    private readonly regexExtractor: RegexExtractorService,
    private readonly rateLimitService: RateLimitService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly datasecCurationService: DatasecCurationService,
  ) {
    this.logger.log('✅ Yandex Image Search initialized (free, no API key)');
  }

  /**
   * Búsqueda inversa de imagen por URL
   * El método principal para OSINT
   */
  async reverseImageSearch(
    searchId: string,
    imageUrl: string,
  ): Promise<YandexImageSearchResponse> {
    const startTime = Date.now();
    this.logger.log(`🔍 Yandex reverse image search: ${imageUrl.substring(0, 80)}...`);

    // Rate limit: 100 requests/day para no ser bloqueados
    const canUse = await this.rateLimitService.canUseAPI(this.serviceName, 100);
    if (!canUse) {
      this.logger.warn('⚠️ Yandex Images daily limit reached');
      return this.emptyResponse(Date.now() - startTime);
    }

    try {
      const domain = this.getNextDomain();
      const ua = this.getNextUserAgent();

      // 1. Hacer la búsqueda por URL → Yandex CBIR
      const searchUrl = `${domain}/images/search?url=${encodeURIComponent(imageUrl)}&rpt=imageview&cbir_page=sites`;

      const response = await firstValueFrom(
        this.httpService.get(searchUrl, {
          headers: {
            'User-Agent': ua,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Referer': `${domain}/images/`,
            'DNT': '1',
          },
          timeout: 20000,
          maxRedirects: 5,
        }),
      );

      await this.rateLimitService.registerCall(this.serviceName, 100);

      const result = this.parseYandexResponse(response.data);

      // 2. Si encontró resultados, intentar también la pestaña "Similar images"
      if (result.results.length > 0) {
        try {
          const similarUrl = `${domain}/images/search?url=${encodeURIComponent(imageUrl)}&rpt=imageview&cbir_page=similar`;
          const similarResponse = await firstValueFrom(
            this.httpService.get(similarUrl, {
              headers: {
                'User-Agent': ua,
                'Accept': 'text/html',
                'Referer': searchUrl,
              },
              timeout: 15000,
            }),
          );

          const similarResult = this.parseSimilarImages(similarResponse.data);
          result.similarImages.push(...similarResult);

          await this.delay(500); // Cortesía
        } catch {
          // Similar images is optional
        }
      }

      // 3. Save all results as evidence
      await this.saveResults(searchId, imageUrl, result);

      const duration = Date.now() - startTime;
      result.duration = duration;

      this.logger.log(
        `✅ Yandex: ${result.results.length} pages found, ` +
        `${result.similarImages.length} similar images, ` +
        `faces: ${result.facesDetected} (${duration}ms)`,
      );

      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;

      if (error.response?.status === 403) {
        this.logger.error('❌ Yandex: Access blocked (captcha/IP ban). Rotating domain...');
        this.currentDomainIndex = (this.currentDomainIndex + 1) % this.YANDEX_DOMAINS.length;
      } else if (error.code === 'ECONNABORTED') {
        this.logger.error('❌ Yandex: Timeout');
      } else {
        this.logger.error(`❌ Yandex search failed: ${error.message}`);
      }

      return this.emptyResponse(duration);
    }
  }

  /**
   * Búsqueda por texto para encontrar imágenes de una persona
   * Complementa la búsqueda inversa
   */
  async searchByText(
    searchId: string,
    query: string,
    options: { maxResults?: number } = {},
  ): Promise<YandexImageResult[]> {
    const canUse = await this.rateLimitService.canUseAPI(this.serviceName, 100);
    if (!canUse) return [];

    try {
      const domain = this.getNextDomain();
      const ua = this.getNextUserAgent();
      const maxResults = options.maxResults || 20;

      this.logger.log(`🔍 Yandex text→images: "${query}"`);

      const searchUrl = `${domain}/images/search?text=${encodeURIComponent(query)}&noreask=1&isize=medium`;

      const response = await firstValueFrom(
        this.httpService.get(searchUrl, {
          headers: {
            'User-Agent': ua,
            'Accept': 'text/html',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': `${domain}/images/`,
          },
          timeout: 15000,
        }),
      );

      await this.rateLimitService.registerCall(this.serviceName, 100);

      const results = this.parseTextSearchResults(response.data, maxResults);

      // Save as evidence
      for (const result of results) {
        try {
          await this.evidenceService.saveEvidence(searchId, {
            source: 'yandex_image_text',
            category: 'identity' as const,
            title: result.title || `Yandex Image: ${query}`,
            summary: result.description || `Image from ${result.domain}`,
            url: result.pageUrl,
            imageUrl: result.imageUrl,
            thumbnailUrl: result.thumbnailUrl,
            matchConfidence: result.confidence,
            extractedData: {
              emails: [],
              phones: [],
              rfcs: [],
              curps: [],
              urls: [result.pageUrl, result.imageUrl].filter(Boolean),
            },
          } as any);
        } catch (err: any) {
          // Dedup will handle it
        }
      }

      this.logger.log(`✅ Yandex text→images: ${results.length} results`);
      return results;
    } catch (error: any) {
      this.logger.error(`❌ Yandex text search failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Parse respuesta HTML de Yandex /images/search?url=...&cbir_page=sites
   */
  private parseYandexResponse(html: string): YandexImageSearchResponse {
    const $ = cheerio.load(html);
    const results: YandexImageResult[] = [];
    const detectedTags: string[] = [];
    const relatedSearches: string[] = [];
    let facesDetected = false;
    let ocrText: string | undefined;
    const debugCandidateUrls: string[] = [];

    // === Detectar si Yandex encontró caras ===
    const pageText = $.text().toLowerCase();
    if (pageText.includes('face') || pageText.includes('person') || pageText.includes('people') || pageText.includes('лицо')) {
      facesDetected = true;
    }

    // === Detectar tags/labels que Yandex asignó a la imagen ===
    $('.CbirTags-Tag, .Tags-Tag, .cbir-tags__tag').each((_, el) => {
      const tag = $(el).text().trim();
      if (tag) detectedTags.push(tag);
    });

    // === Resultados "Pages with this image" (cbir_page=sites) ===
    // Yandex muestra las páginas donde aparece esta imagen
    $('.serp-item, .CbirSites-Item, .cbir-section__content .serp-list .serp-item').each((i, el) => {
      try {
        const $el = $(el);

        // Modern cbir sites layout: the first <a> is often thumbnail/original image,
        // while the valid match URL is in title/domain anchors.
        if ($el.hasClass('CbirSites-Item')) {
          const pageHref = (
            $el.find('.CbirSites-ItemTitle a').first().attr('href')
            || $el.find('.CbirSites-ItemDomain').first().attr('href')
            || ''
          ).trim();
          const thumbHref = ($el.find('.CbirSites-ItemThumb a').first().attr('href') || '').trim();
          const imgSrc = (
            $el.find('.CbirSites-ItemThumb img').first().attr('src')
            || $el.find('.CbirSites-ItemThumb img').first().attr('data-src')
            || ''
          ).trim();
          const title = $el.find('.CbirSites-ItemTitle').text().trim();
          const desc = $el.find('.CbirSites-ItemDescription').text().trim();

          if (this.isLikelyResultUrl(pageHref)) {
            debugCandidateUrls.push(pageHref);
            results.push({
              pageUrl: pageHref,
              imageUrl: imgSrc || (this.isLikelyImageAssetUrl(thumbHref) ? thumbHref : ''),
              thumbnailUrl: imgSrc || undefined,
              title: title || this.extractDomain(pageHref),
              description: desc,
              domain: this.extractDomain(pageHref),
              confidence: Math.max(0.5, 1 - (i * 0.05)),
              type: 'page',
            });
            return;
          }
        }

        // Intentar extraer datos del JSON embebido en data-bem
        const dataBem = $el.attr('data-bem');
        if (dataBem) {
          try {
            const parsed = JSON.parse(dataBem);
            const item = parsed?.['serp-item'] || parsed;
            const pageHref = (item?.href || item?.url || '').trim();
            if (this.isLikelyResultUrl(pageHref)) {
              results.push({
                pageUrl: pageHref,
                imageUrl: item.img_href || item.thumb?.url || '',
                thumbnailUrl: item.thumb?.url || '',
                title: item.title || item.snippet || '',
                description: item.snippet || item.text || '',
                domain: this.extractDomain(pageHref),
                confidence: Math.max(0.5, 1 - (i * 0.05)),
                type: 'page',
              });
              return;
            }
          } catch {
            // Not JSON, parse HTML instead
          }
        }

        // Fallback: parse HTML elements
        const title = $el.find('.serp-item__title, .CbirSites-ItemTitle, a').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const desc = $el.find('.serp-item__text, .CbirSites-ItemDescription, .serp-item__snippet').text().trim();
        const thumb = $el.find('img').first().attr('src') || '';

        if (this.isLikelyResultUrl(link) && (title || desc)) {
          results.push({
            pageUrl: link.startsWith('http') ? link : `https://yandex.com${link}`,
            imageUrl: thumb || '',
            thumbnailUrl: thumb,
            title: title || 'Yandex result',
            description: desc,
            domain: this.extractDomain(link),
            confidence: Math.max(0.4, 1 - (i * 0.05)),
            type: 'page',
          });
        }
      } catch {
        // Skip malformed results
      }
    });

    // === Alternate selectors for modern Yandex layout ===
    if (results.length === 0) {
      $('li.serp-item, .other-sites__item, .cbir-panel__content a').each((i, el) => {
        const $el = $(el);
        const link = $el.attr('href') || $el.find('a').attr('href') || '';
        const title = $el.find('.other-sites__title, .cbir-panel__title').text().trim() || $el.text().trim();

        if (this.isLikelyResultUrl(link)) {
          results.push({
            pageUrl: link,
            imageUrl: '',
            title: title || 'Untitled',
            domain: this.extractDomain(link),
            confidence: Math.max(0.3, 0.8 - (i * 0.05)),
            type: 'page',
          });
        }
      });
    }

    // === Priority raw fallback for CbirSites blocks (server-rendered HTML) ===
    if (results.length === 0) {
      const cbirItems = this.extractCbirItemsFromRawHtml(html, 40);
      this.logger.log(`Yandex raw CbirSites fallback found ${cbirItems.length} items`);
      for (const [i, item] of cbirItems.entries()) {
        debugCandidateUrls.push(item.pageUrl);
        results.push({
          pageUrl: item.pageUrl,
          imageUrl: item.imageUrl || '',
          thumbnailUrl: item.thumbnailUrl,
          title: item.title,
          description: item.description,
          domain: item.domain,
          confidence: Math.max(0.3, 0.9 - (i * 0.03)),
          type: 'page',
        });
      }
    }

    // === Last fallback: external links from page anchors (modern layout changes) ===
    if (results.length === 0) {
      const externalMatches = this.extractExternalLinksFromHtml(html, 20);
      for (const [i, match] of externalMatches.entries()) {
        results.push({
          pageUrl: match.url,
          imageUrl: '',
          thumbnailUrl: undefined,
          title: match.title,
          description: 'Recovered from Yandex external links fallback',
          domain: this.extractDomain(match.url),
          confidence: Math.max(0.25, 0.65 - (i * 0.03)),
          type: 'page',
        });
      }
    }

    // === Final fallback: parse URLs embedded in scripts/JSON blobs ===
    // Some Yandex layouts render links client-side and keep targets only in inline JSON.
    if (results.length === 0) {
      const rawMatches = this.extractCbirSiteLinksFromRawHtml(html, 30);
      this.logger.log(`Yandex raw CbirSites links fallback found ${rawMatches.length} links`);
      for (const [i, match] of rawMatches.entries()) {
        debugCandidateUrls.push(match.url);
        results.push({
          pageUrl: match.url,
          imageUrl: '',
          thumbnailUrl: undefined,
          title: match.title,
          description: 'Recovered from Yandex CbirSites raw HTML fallback',
          domain: this.extractDomain(match.url),
          confidence: Math.max(0.22, 0.62 - (i * 0.02)),
          type: 'page',
        });
      }
    }

    // === Ultimate fallback: broad URL extraction from inline content ===
    if (results.length === 0) {
      const rawMatches = this.extractExternalLinksFromRawContent(html, 30);
      this.logger.log(`Yandex inline raw URL fallback found ${rawMatches.length} links`);
      for (const [i, match] of rawMatches.entries()) {
        debugCandidateUrls.push(match.url);
        results.push({
          pageUrl: match.url,
          imageUrl: '',
          thumbnailUrl: undefined,
          title: match.title,
          description: 'Recovered from Yandex inline JSON/script fallback',
          domain: this.extractDomain(match.url),
          confidence: Math.max(0.2, 0.6 - (i * 0.02)),
          type: 'page',
        });
      }
    }

    // === OCR text detection ===
    const ocrEl = $('.CbirOcr-Text, .cbir-ocr__text');
    if (ocrEl.length > 0) {
      ocrText = ocrEl.text().trim();
    }

    // === Related searches ===
    $('.CbirRelatedTerms-Item, .related-searches__item, .Tags-Tag').each((_, el) => {
      const text = $(el).text().trim();
      if (text && !detectedTags.includes(text)) {
        relatedSearches.push(text);
      }
    });

    const deduplicatedResults = this.deduplicateResults(results);
    this.logger.log(
      `Yandex parse summary: cssItems=${$('li.CbirSites-Item').length}, candidates=${debugCandidateUrls.length}, dedup=${deduplicatedResults.length}`,
    );
    if (debugCandidateUrls.length > 0) {
      this.logger.log(`Yandex candidate URLs: ${debugCandidateUrls.slice(0, 5).join(' | ')}`);
    }

    return {
      results: deduplicatedResults,
      totalResults: results.length,
      detectedTags,
      ocrText,
      facesDetected,
      relatedSearches,
      similarImages: [],
      duration: 0,
    };
  }

  /**
   * Parse similar images from cbir_page=similar
   */
  private parseSimilarImages(html: string): string[] {
    const $ = cheerio.load(html);
    const images: string[] = [];

    $('img.serp-item__thumb, .CbirSimilar-Thumb img, .thumb-image__image').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src') || '';
      if (src && src.startsWith('http')) {
        images.push(src);
      }
    });

    // Also check data-bem for image URLs
    $('.serp-item').each((_, el) => {
      const dataBem = $(el).attr('data-bem');
      if (dataBem) {
        try {
          const parsed = JSON.parse(dataBem);
          const imgUrl = parsed?.['serp-item']?.img_href || parsed?.['serp-item']?.preview?.[0]?.url;
          if (imgUrl) images.push(imgUrl);
        } catch {
          // Skip
        }
      }
    });

    return [...new Set(images)].slice(0, 30);
  }

  /**
   * Parse text-based image search results
   */
  private parseTextSearchResults(html: string, maxResults: number): YandexImageResult[] {
    const $ = cheerio.load(html);
    const results: YandexImageResult[] = [];

    $('.serp-item').each((i, el) => {
      if (results.length >= maxResults) return false;

      try {
        const $el = $(el);
        const dataBem = $el.attr('data-bem');

        if (dataBem) {
          const parsed = JSON.parse(dataBem);
          const item = parsed?.['serp-item'];
          if (item) {
            results.push({
              pageUrl: item.href || item.url || '',
              imageUrl: item.img_href || item.preview?.[0]?.url || '',
              thumbnailUrl: item.thumb?.url || '',
              title: item.snippet?.title || item.title || '',
              description: item.snippet?.text || '',
              domain: this.extractDomain(item.href || item.url || ''),
              imageSize: item.originalImage ? `${item.originalImage.width}x${item.originalImage.height}` : undefined,
              confidence: Math.max(0.3, 0.9 - (i * 0.04)),
              type: 'similar',
            });
          }
        }
      } catch {
        // Skip malformed items
      }

      return undefined; // continue
    });

    return results;
  }

  /**
   * Deduplicate results by page URL
   */
  private deduplicateResults(results: YandexImageResult[]): YandexImageResult[] {
    const seen = new Set<string>();
    return results.filter(r => {
      const key = r.pageUrl || r.imageUrl;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Save all Yandex results as evidence
   */
  private async saveResults(
    searchId: string,
    originalImageUrl: string,
    response: YandexImageSearchResponse,
  ): Promise<void> {
    let persistedVisualAssets = 0;

    // Save page results (donde apareció la imagen)
    for (const result of response.results) {
      try {
        const textToAnalyze = `${result.title} ${result.description || ''} ${result.pageUrl}`;
        const extracted = this.regexExtractor.extractAll(textToAnalyze);
        const visualAsset = await this.persistYandexVisualAsset(searchId, result, persistedVisualAssets);
        if (visualAsset.persisted) persistedVisualAssets += 1;

        const evidence = await this.evidenceService.saveEvidence(searchId, {
          source: 'yandex_reverse_image',
          category: this.categorizeDomain(result.domain),
          title: result.title || `Found on ${result.domain}`,
          summary: result.description || `Image found on ${result.domain} via Yandex reverse image search`,
          url: result.pageUrl,
          imageUrl: visualAsset.imageUrl || result.imageUrl || originalImageUrl,
          thumbnailUrl: visualAsset.thumbnailUrl || result.thumbnailUrl,
          matchConfidence: result.confidence,
          extractedData: {
            emails: extracted.emails,
            phones: extracted.phones,
            rfcs: extracted.rfcs,
            curps: extracted.curps,
            urls: [result.pageUrl, result.imageUrl, result.thumbnailUrl, visualAsset.imageUrl].filter(Boolean),
            scoreType: 'reverse_image_relevance',
            identityVerified: false,
            custodyStatus: visualAsset.persisted ? 'preserved' : 'external_reference_only',
          },
        } as any);

        if (visualAsset.assetId && evidence?.evidenceId) {
          await this.datasecCurationService.createAsset({
            type: 'image',
            origin: 'osint',
            title: result.title || `Yandex visual match - ${result.domain}`,
            description: result.description || 'Visual match detected by Yandex reverse image search.',
            url: result.pageUrl,
            imageUrl: visualAsset.imageUrl,
            thumbnailUrl: visualAsset.thumbnailUrl || visualAsset.imageUrl,
            source: 'yandex_reverse_image',
            searchId,
            evidenceId: evidence.evidenceId,
            confidence: result.confidence,
            curationStatus: 'candidate',
            tags: ['rostro', 'imagen-inversa', 'yandex', 'osint'],
            metadata: {
              persistedFrom: 'yandex_reverse_image',
              uploadPublicId: visualAsset.publicId,
              uploadBytes: visualAsset.bytes,
              uploadFormat: visualAsset.format,
              originalImageUrl: result.imageUrl,
              originalThumbnailUrl: result.thumbnailUrl,
              custodyStatus: visualAsset.persisted ? 'preserved' : 'external_reference_only',
              domain: result.domain,
              type: result.type,
            },
          });
        }
      } catch (err: any) {
        // Dedup handles duplicates
      }
    }

    // Save detected tags as meta-evidence
    if (response.detectedTags && response.detectedTags.length > 0) {
      try {
        await this.evidenceService.saveEvidence(searchId, {
          source: 'yandex_image_analysis',
          category: 'identity' as const,
          title: `Yandex Image Tags: ${response.detectedTags.slice(0, 5).join(', ')}`,
          summary: `Yandex detected: ${response.detectedTags.join(', ')}. Faces: ${response.facesDetected ? 'YES' : 'NO'}${response.ocrText ? `. OCR: ${response.ocrText.substring(0, 200)}` : ''}`,
          url: originalImageUrl,
          imageUrl: originalImageUrl,
          matchConfidence: 0.80,
          extractedData: {
            emails: [],
            phones: [],
            rfcs: [],
            curps: [],
            urls: [],
          },
        } as any);
      } catch {
        // Optional
      }
    }

    // Save OCR text as evidence if found
    if (response.ocrText) {
      try {
        const extracted = this.regexExtractor.extractAll(response.ocrText);
        await this.evidenceService.saveEvidence(searchId, {
          source: 'yandex_ocr',
          category: 'identity' as const,
          title: `Text detected in image (Yandex OCR)`,
          summary: response.ocrText.substring(0, 500),
          url: originalImageUrl,
          matchConfidence: 0.75,
          extractedData: {
            emails: extracted.emails,
            phones: extracted.phones,
            rfcs: extracted.rfcs,
            curps: extracted.curps,
            urls: extracted.urls || [],
          },
        } as any);
      } catch {
        // Optional
      }
    }

    // Save technical execution evidence so image-only searches don't look empty
    // when Yandex runs successfully but returns no matches.
    if (
      response.results.length === 0
      && (!response.detectedTags || response.detectedTags.length === 0)
      && !response.ocrText
    ) {
      const yandexSearchUrl = `https://yandex.com/images/search?url=${encodeURIComponent(originalImageUrl)}&rpt=imageview&cbir_page=sites`;
      await this.evidenceService.saveEvidence(searchId, {
        source: 'yandex_reverse_image_status',
        category: 'identity',
        title: 'Yandex reverse image ejecutado sin coincidencias visibles',
        summary: `Yandex procesó la imagen correctamente (0 resultados). URL de búsqueda: ${yandexSearchUrl}`,
        url: yandexSearchUrl,
        imageUrl: originalImageUrl,
        matchConfidence: 0.2,
        extractedData: {
          emails: [],
          phones: [],
          rfcs: [],
          curps: [],
          urls: [yandexSearchUrl],
        },
      } as any).catch(() => {});
    }
  }

  private async persistYandexVisualAsset(
    searchId: string,
    result: YandexImageResult,
    currentCount: number,
  ): Promise<{
    persisted: boolean;
    assetId?: string;
    imageUrl?: string;
    thumbnailUrl?: string;
    publicId?: string;
    bytes?: number;
    format?: string;
  }> {
    if (this.configService.get<string>('YANDEX_PERSIST_VISUAL_ASSETS') === 'false') {
      return { persisted: false };
    }

    const maxAssets = Math.min(
      Math.max(Number(this.configService.get<string>('YANDEX_VISUAL_ASSET_LIMIT') || 12), 0),
      50,
    );
    if (currentCount >= maxAssets) return { persisted: false };

    const sourceImageUrl = result.imageUrl || result.thumbnailUrl;
    if (!sourceImageUrl || !/^https?:\/\//i.test(sourceImageUrl)) {
      return { persisted: false };
    }

    try {
      const uploaded = await this.cloudinaryService.uploadFromUrl(
        sourceImageUrl,
        this.yandexAssetFilename(result),
        {
          folder: `osint/yandex/${new Date().toISOString().slice(0, 10)}/${searchId}`,
          tags: ['osint', 'yandex', 'reverse-image', 'datasec-candidate'],
          context: {
            searchId,
            source: 'yandex_reverse_image',
            domain: result.domain || '',
            pageUrl: result.pageUrl || '',
          },
        },
      );

      return {
        persisted: true,
        assetId: uploaded.publicId,
        imageUrl: uploaded.secureUrl,
        thumbnailUrl: uploaded.secureUrl,
        publicId: uploaded.publicId,
        bytes: uploaded.bytes,
        format: uploaded.format,
      };
    } catch (error: any) {
      this.logger.warn(`Yandex visual asset skipped (${result.domain || 'unknown'}): ${error.message}`);
      return { persisted: false };
    }
  }

  private yandexAssetFilename(result: YandexImageResult) {
    const domain = this.safeAssetSegment(result.domain || 'yandex');
    const title = this.safeAssetSegment(result.title || 'visual-match');
    const extension = this.extensionFromUrl(result.imageUrl || result.thumbnailUrl || '') || 'jpg';
    return `${domain}-${title}.${extension}`;
  }

  private safeAssetSegment(value: string) {
    return String(value || 'asset')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'asset';
  }

  private extensionFromUrl(value: string) {
    try {
      const pathname = new URL(value).pathname.toLowerCase();
      const match = pathname.match(/\.(png|jpe?g|webp)$/);
      return match?.[1]?.replace('jpeg', 'jpg');
    } catch {
      return undefined;
    }
  }

  private extractExternalLinksFromHtml(html: string, maxResults: number): Array<{ url: string; title: string }> {
    const $ = cheerio.load(html);
    const seen = new Set<string>();
    const out: Array<{ url: string; title: string }> = [];

    $('a[href]').each((_, el) => {
      if (out.length >= maxResults) return false;

      const hrefRaw = ($(el).attr('href') || '').trim();
      if (!hrefRaw.startsWith('http://') && !hrefRaw.startsWith('https://')) {
        return undefined;
      }

      const href = hrefRaw.split('#')[0];
      if (this.isExcludedYandexUrl(href)) {
        return undefined;
      }

      if (seen.has(href)) {
        return undefined;
      }
      seen.add(href);

      const title = $(el).text().trim() || this.extractDomain(href);
      out.push({ url: href, title: title.slice(0, 220) });
      return undefined;
    });

    return out;
  }

  private extractExternalLinksFromRawContent(
    html: string,
    maxResults: number,
  ): Array<{ url: string; title: string }> {
    const seen = new Set<string>();
    const out: Array<{ url: string; title: string }> = [];

    const patterns = [
      /https?:\\\/\\\/[^\s"'<>]+/g,
      /https?:\/\/[^\s"'<>]+/g,
    ];

    for (const pattern of patterns) {
      const matches = html.match(pattern) || [];
      for (const raw of matches) {
        if (out.length >= maxResults) break;

        const normalized = this.normalizeEscapedUrl(raw);
        if (!this.isLikelyResultUrl(normalized)) {
          continue;
        }

        const url = normalized.split('#')[0];
        if (seen.has(url)) {
          continue;
        }
        seen.add(url);

        out.push({
          url,
          title: this.extractDomain(url),
        });
      }
      if (out.length >= maxResults) break;
    }

    return out;
  }

  private extractCbirSiteLinksFromRawHtml(
    html: string,
    maxResults: number,
  ): Array<{ url: string; title: string }> {
    const seen = new Set<string>();
    const out: Array<{ url: string; title: string }> = [];

    const patterns = [
      /CbirSites-ItemTitle[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([^<]*)</gi,
      /CbirSites-ItemDomain[^>]*href="([^"]+)"[^>]*>([^<]*)</gi,
    ];

    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(html)) !== null) {
        if (out.length >= maxResults) {
          break;
        }

        const hrefRaw = this.decodeHtmlEntities((match[1] || '').trim());
        if (!this.isLikelyResultUrl(hrefRaw)) {
          continue;
        }

        const url = hrefRaw.split('#')[0];
        if (seen.has(url)) {
          continue;
        }
        seen.add(url);

        const titleRaw = this.decodeHtmlEntities((match[2] || '').trim());
        out.push({
          url,
          title: titleRaw || this.extractDomain(url),
        });
      }

      if (out.length >= maxResults) {
        break;
      }
    }

    return out;
  }

  private extractCbirItemsFromRawHtml(
    html: string,
    maxResults: number,
  ): Array<{
    pageUrl: string;
    imageUrl?: string;
    thumbnailUrl?: string;
    title: string;
    description?: string;
    domain: string;
  }> {
    const out: Array<{
      pageUrl: string;
      imageUrl?: string;
      thumbnailUrl?: string;
      title: string;
      description?: string;
      domain: string;
    }> = [];

    const seen = new Set<string>();
    const itemRegex = /<li class="CbirSites-Item">([\s\S]*?)<\/li>/gi;
    let itemMatch: RegExpExecArray | null;

    while ((itemMatch = itemRegex.exec(html)) !== null) {
      if (out.length >= maxResults) break;

      const block = itemMatch[1] || '';

      const titleHref = this.firstMatch(
        /CbirSites-ItemTitle[\s\S]*?<a[^>]*href="([^"]+)"/i,
        block,
      );
      const domainHref = this.firstMatch(
        /CbirSites-ItemDomain[^>]*href="([^"]+)"/i,
        block,
      );
      const pageUrl = this.decodeHtmlEntities((titleHref || domainHref || '').trim());

      if (!this.isLikelyResultUrl(pageUrl)) {
        continue;
      }
      if (seen.has(pageUrl)) {
        continue;
      }
      seen.add(pageUrl);

      const rawTitle = this.decodeHtmlEntities(
        this.firstMatch(/CbirSites-ItemTitle[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i, block) || '',
      );
      const rawDescription = this.decodeHtmlEntities(
        this.firstMatch(/CbirSites-ItemDescription[^>]*>([\s\S]*?)<\/div>/i, block) || '',
      );

      const thumbAnchor = this.decodeHtmlEntities(
        this.firstMatch(/CbirSites-ItemThumb[\s\S]*?<a[^>]*href="([^"]+)"/i, block) || '',
      );
      const thumbImgSrcRaw = this.decodeHtmlEntities(
        this.firstMatch(/CbirSites-ItemThumb[\s\S]*?<img[^>]*src="([^"]+)"/i, block) || '',
      );
      const thumbImgSrc = thumbImgSrcRaw.startsWith('//') ? `https:${thumbImgSrcRaw}` : thumbImgSrcRaw;

      const title = this.stripTags(rawTitle).trim() || this.extractDomain(pageUrl);
      const description = this.stripTags(rawDescription).trim();

      out.push({
        pageUrl,
        imageUrl: this.isLikelyImageAssetUrl(thumbAnchor) ? thumbAnchor : undefined,
        thumbnailUrl: thumbImgSrc || undefined,
        title,
        description: description || undefined,
        domain: this.extractDomain(pageUrl),
      });
    }

    return out;
  }

  private firstMatch(regex: RegExp, input: string): string | null {
    const m = regex.exec(input);
    return m && m[1] ? m[1] : null;
  }

  private stripTags(value: string): string {
    return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private decodeHtmlEntities(value: string): string {
    return value
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  private normalizeEscapedUrl(raw: string): string {
    return raw
      .replace(/\\u002F/gi, '/')
      .replace(/\\u003A/gi, ':')
      .replace(/\\\//g, '/')
      .replace(/\\u0026/gi, '&')
      .replace(/\\u003F/gi, '?')
      .replace(/\\u003D/gi, '=')
      .replace(/&amp;/g, '&');
  }

  private isExcludedYandexUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return (
      lower.includes('yandex.')
      || lower.includes('yabs.yandex')
      || lower.includes('clck.yandex')
      || lower.includes('avatars.mds.yandex')
      || lower.includes('favicon.yandex')
      || lower.includes('mc.yandex')
      || lower.includes('ogp.me')
      || lower.includes('w3.org')
      || lower.includes('schema.org')
      || lower.includes('xmlns.com')
    );
  }

  private isLikelyImageAssetUrl(url: string): boolean {
    if (!url) return false;
    const lower = url.toLowerCase();
    return /\.(png|jpe?g|webp|gif|svg|bmp|ico|avif)(\?|$)/i.test(lower);
  }

  private isLikelyResultUrl(url: string): boolean {
    if (!url) return false;

    const normalized = url.trim();
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      return false;
    }
    if (this.isExcludedYandexUrl(normalized)) {
      return false;
    }

    const lower = normalized.toLowerCase();
    if (
      lower.includes('yastatic.net')
      || lower.includes('googleusercontent.com')
      || lower.includes('ggpht.com')
      || lower.includes('yt3.googleusercontent.com')
      || lower.includes('avatars.')
      || lower.includes('/favicon')
    ) {
      return false;
    }

    // Exclude raw image assets, keep webpage URLs.
    if (this.isLikelyImageAssetUrl(lower)) {
      return false;
    }

    return true;
  }

  /**
   * Categorize by domain name
   */
  private categorizeDomain(domain: string): 'identity' | 'social' | 'legal' | 'other' {
    const d = domain.toLowerCase();

    if (d.match(/facebook|instagram|twitter|x\.com|tiktok|vk\.com|snapchat|pinterest|reddit/)) return 'social';
    if (d.match(/linkedin|github|stackoverflow|behance|dribbble|kaggle/)) return 'social';
    if (d.match(/gob\.mx|interpol|tribunal|juzgado|dof/)) return 'legal';
    if (d.match(/profile|about\.me|gravatar|linktree/)) return 'identity';

    return 'other';
  }

  /**
   * Extract domain from URL safely
   */
  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url.split('/')[2] || 'unknown';
    }
  }

  /**
   * Get next Yandex domain (rotation)
   */
  private getNextDomain(): string {
    const domain = this.YANDEX_DOMAINS[this.currentDomainIndex];
    this.currentDomainIndex = (this.currentDomainIndex + 1) % this.YANDEX_DOMAINS.length;
    return domain;
  }

  /**
   * Get next User-Agent (rotation)
   */
  private getNextUserAgent(): string {
    const ua = this.USER_AGENTS[this.currentUAIndex];
    this.currentUAIndex = (this.currentUAIndex + 1) % this.USER_AGENTS.length;
    return ua;
  }

  private emptyResponse(duration: number): YandexImageSearchResponse {
    return {
      results: [],
      totalResults: 0,
      facesDetected: false,
      relatedSearches: [],
      similarImages: [],
      duration,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
