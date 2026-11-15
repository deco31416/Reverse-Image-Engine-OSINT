import { Injectable, Logger } from '@nestjs/common';
import { ReverseImageSearchService } from './reverse-image-search.service';
import { CloudinaryService } from './cloudinary.service';
import { GeminiImageEnhancementService } from './gemini-image-enhancement.service';
import { WebCrawlerService } from './web-crawler.service';
import { GroqIdentificationService } from './groq-identification.service';
import { DatasecProxyService } from './datasec-proxy.service';
import { StoragePathService } from './storage-path.service';
import { SecurityValidationService } from './security-validation.service';
import {
  PersonSearchDto,
  IdentificationMethod,
  ImageSource,
  SearchEngine,
} from '../dto/person-search.dto';

export interface PersonSearchResult {
  searchId: string;
  status: 'completed' | 'partial' | 'failed';
  person?: {
    name?: string;
    surname?: string;
    fullName?: string;
    username?: string;
    position?: string;
    organization?: string;
    location?: string;
    confidence: number;
    identificationMethod: IdentificationMethod;
    manuallyVerified?: boolean;
  };
  images: {
    original: Array<{ url: string; secureUrl: string; publicId: string }>;
    enhanced?: Array<{ url: string; secureUrl: string; publicId: string }>;
  };
  reverseImageSearch: {
    totalResults: number;
    results: Array<{
      source: string;
      url: string;
      title: string;
      snippet?: string;
      confidence?: number;
    }>;
    visuallySimilarImages: string[];
  };
  socialMediaProfiles: {
    facebook: string[];
    instagram: string[];
    twitter: string[];
    linkedin: string[];
    tiktok: string[];
  };
  crawledPages?: Array<{
    url: string;
    title: string;
    images: string[];
    emails: string[];
    phones: string[];
  }>;
  metadata: {
    imageSource: ImageSource;
    searchEngines: SearchEngine[];
    crawlerEnabled: boolean;
    startTime: Date;
    endTime?: Date;
    processingTime?: number;
    errors?: string[];
  };
}

@Injectable()
export class PersonDetectionOrchestrator {
  private readonly logger = new Logger(PersonDetectionOrchestrator.name);

  constructor(
    private readonly reverseImageSearch: ReverseImageSearchService,
    private readonly cloudinary: CloudinaryService,
    private readonly gemini: GeminiImageEnhancementService,
    private readonly crawler: WebCrawlerService,
    private readonly groq: GroqIdentificationService,
    private readonly datasec: DatasecProxyService,
    private readonly storagePath: StoragePathService,
    private readonly securityValidation: SecurityValidationService,
  ) {}

  /**
   * Main orchestrator for person search workflow
   */
  async searchPerson(request: PersonSearchDto): Promise<PersonSearchResult> {
    const searchId = this.generateSearchId();
    const startTime = new Date();
    const errors: string[] = [];

    this.logger.log(`🚀 Starting person search [${searchId}]`);
    this.logger.log(`   Source: ${request.imageSource}`);
    this.logger.log(`   Engines: ${request.searchEngines.join(', ')}`);
    this.logger.log(`   Enhanced: ${request.generateEnhanced}`);
    this.logger.log(`   Crawler: ${request.enableCrawler}`);

    const result: PersonSearchResult = {
      searchId,
      status: 'partial',
      images: { original: [] },
      reverseImageSearch: {
        totalResults: 0,
        results: [],
        visuallySimilarImages: [],
      },
      socialMediaProfiles: {
        facebook: [],
        instagram: [],
        twitter: [],
        linkedin: [],
        tiktok: [],
      },
      metadata: {
        imageSource: request.imageSource,
        searchEngines: request.searchEngines,
        crawlerEnabled: request.enableCrawler,
        startTime,
        errors,
      },
    };

    try {
      // STEP 1: Get source image
      this.logger.log('📥 Step 1: Fetching source image...');
      const sourceImage = await this.getSourceImage(request);

      // STEP 2: Upload original to Cloudinary
      this.logger.log('☁️  Step 2: Uploading original image to Cloudinary...');
      const originalUpload = await this.cloudinary.uploadFromUrl(
        sourceImage.url,
        `${this.storagePath.safeSegment(searchId)}-person-original`,
        {
          folder: this.storagePath.personDetectionFolder(searchId, 'original'),
          tags: ['osint', 'person-search', searchId],
        },
      );
      result.images.original.push(originalUpload);

      // STEP 3: Generate enhanced image (if enabled)
      let enhancedImageUrl = sourceImage.url;
      if (request.generateEnhanced) {
        try {
          this.logger.log(
            '✨ Step 3: Generating enhanced image with Gemini...',
          );
          const enhanced = await this.gemini.generateEnhancedImage({
            frontImage: sourceImage.url,
            description: request.context,
          });

          if (enhanced.enhancedImageUrl) {
            // Upload enhanced image to Cloudinary
            const enhancedUpload = await this.cloudinary.uploadFromUrl(
              enhanced.enhancedImageUrl,
              `${this.storagePath.safeSegment(searchId)}-person-enhanced`,
              {
                folder: this.storagePath.personDetectionFolder(searchId, 'enhanced'),
                tags: ['osint', 'person-search', 'enhanced', searchId],
              },
            );
            result.images.enhanced = [enhancedUpload];
            enhancedImageUrl = enhancedUpload.url;
          }
        } catch (error) {
          errors.push(`Enhanced image generation failed: ${error.message}`);
          this.logger.warn('⚠️  Continuing without enhanced image');
        }
      }

      // STEP 4: Reverse image search (original + enhanced)
      this.logger.log('🔍 Step 4: Running reverse image search...');
      const searchResults = await this.performReverseImageSearch(
        sourceImage.url,
        enhancedImageUrl,
        request.searchEngines,
      );
      result.reverseImageSearch = searchResults;

      // Extract social media profiles
      result.socialMediaProfiles = this.extractAllSocialMedia(
        searchResults.results,
      );

      // STEP 5: Web crawler (if enabled)
      if (request.enableCrawler && searchResults.results.length > 0) {
        try {
          this.logger.log('🕷️  Step 5: Crawling found URLs...');
          const urlsToCrawl = searchResults.results
            .slice(0, 10)
            .map((r) => r.url);
          const crawlResults = await this.crawler.crawlMultipleUrls(
            urlsToCrawl,
            {
              maxPages: 10,
              extractEmails: true,
              extractPhones: true,
            },
          );

          result.crawledPages = crawlResults.map((cr) => ({
            url: cr.url,
            title: cr.title,
            images: cr.images,
            emails: cr.emails,
            phones: cr.phones,
          }));

          // Merge social media from crawled pages
          crawlResults.forEach((cr) => {
            Object.keys(cr.socialMediaProfiles).forEach((platform) => {
              const profiles = cr.socialMediaProfiles[platform];
              if (profiles && profiles.length > 0) {
                result.socialMediaProfiles[platform] = [
                  ...new Set([
                    ...result.socialMediaProfiles[platform],
                    ...profiles,
                  ]),
                ];
              }
            });
          });
        } catch (error) {
          errors.push(`Web crawler failed: ${error.message}`);
          this.logger.warn('⚠️  Continuing without crawler results');
        }
      }

      // STEP 6: Person identification
      this.logger.log('👤 Step 6: Identifying person...');
      const identification = await this.identifyPerson(
        result,
        request.identificationMethod,
      );
      result.person = identification;

      // STEP 7: Finalize
      const endTime = new Date();
      result.metadata.endTime = endTime;
      result.metadata.processingTime = endTime.getTime() - startTime.getTime();
      result.status = errors.length === 0 ? 'completed' : 'partial';

      this.logger.log(
        `✅ Search completed [${searchId}] in ${result.metadata.processingTime}ms`,
      );
      if (result.person) {
        this.logger.log(
          `   Person: ${result.person.fullName || 'Unknown'} (${result.person.confidence}% confidence)`,
        );
      }

      return result;
    } catch (error) {
      this.logger.error(`❌ Search failed [${searchId}]: ${error.message}`);
      errors.push(error.message);
      result.status = 'failed';
      return result;
    }
  }

  /**
   * Get source image based on image source type
   */
  private async getSourceImage(
    request: PersonSearchDto,
  ): Promise<{ url: string; metadata?: any }> {
    switch (request.imageSource) {
      case ImageSource.CAMERA:
        if (!request.cameraId) {
          throw new Error('Camera ID required for camera source');
        }
        // Get latest image from camera via datasec
        const cameraImages = await this.datasec.getRecentImages(
          request.cameraId,
          1,
        );
        if (cameraImages.length === 0) {
          throw new Error(`No images found for camera ${request.cameraId}`);
        }
        return {
          url: await this.safeSourceUrl(cameraImages[0].url, 'camera image URL'),
          metadata: cameraImages[0].metadata,
        };

      case ImageSource.DATASEC:
        if (!request.datasecImageId) {
          throw new Error('Datasec image ID required');
        }
        const datasecImage = await this.datasec.getImageById(
          request.datasecImageId,
        );
        if (!datasecImage) {
          throw new Error(
            `Image ${request.datasecImageId} not found in datasec`,
          );
        }
        return {
          url: await this.safeSourceUrl(datasecImage.url, 'datasec image URL'),
          metadata: datasecImage.metadata,
        };

      case ImageSource.UPLOAD:
        if (request.imageUrl) {
          return { url: await this.safeSourceUrl(request.imageUrl, 'imageUrl') };
        }
        if (request.imageBase64) {
          this.securityValidation.validateImageBase64(request.imageBase64, { field: 'imageBase64' });
          const uploadLabel = (request as any).name || (request as any).username || 'unknown-person';
          // Upload base64 to Cloudinary first
          const upload = await this.cloudinary.uploadBase64(
            request.imageBase64,
            `${this.storagePath.safeSegment(uploadLabel)}-upload`,
            {
              folder: this.storagePath.personDetectionFolder(uploadLabel, 'uploads'),
            },
          );
          return { url: upload.url };
        }
        throw new Error('Image URL or base64 required for upload source');

      case ImageSource.OSINT:
        // Would fetch from OSINT database
        throw new Error('OSINT source not yet implemented');

      default:
        throw new Error(`Unknown image source: ${request.imageSource}`);
    }
  }

  private async safeSourceUrl(url: string, field: string) {
    const safeUrl = await this.securityValidation.validatePublicUrl(url, {
      field,
      allowLocalUploads: true,
    });
    if (!safeUrl) throw new Error(`${field} is required`);
    return safeUrl;
  }

  /**
   * Perform reverse image search on both original and enhanced images
   */
  private async performReverseImageSearch(
    originalUrl: string,
    enhancedUrl: string,
    engines: SearchEngine[],
  ): Promise<{
    totalResults: number;
    results: any[];
    visuallySimilarImages: string[];
  }> {
    const allResults: any[] = [];
    const visuallySimilar: string[] = [];

    // Search with original image
    try {
      const originalSearch =
        await this.reverseImageSearch.searchByImage(originalUrl);
      allResults.push(...originalSearch.results);
      if (originalSearch.visuallySimilarImages) {
        visuallySimilar.push(...originalSearch.visuallySimilarImages);
      }
    } catch (error) {
      this.logger.error(`Original image search failed: ${error.message}`);
    }

    // Search with enhanced image (if different)
    if (enhancedUrl !== originalUrl) {
      try {
        const enhancedSearch =
          await this.reverseImageSearch.searchByImage(enhancedUrl);
        allResults.push(...enhancedSearch.results);
        if (enhancedSearch.visuallySimilarImages) {
          visuallySimilar.push(...enhancedSearch.visuallySimilarImages);
        }
      } catch (error) {
        this.logger.error(`Enhanced image search failed: ${error.message}`);
      }
    }

    // Remove duplicates by URL
    const uniqueResults = Array.from(
      new Map(allResults.map((item) => [item.url, item])).values(),
    );

    return {
      totalResults: uniqueResults.length,
      results: uniqueResults,
      visuallySimilarImages: [...new Set(visuallySimilar)],
    };
  }

  /**
   * Extract all social media profiles from search results
   */
  private extractAllSocialMedia(results: any[]): {
    facebook: string[];
    instagram: string[];
    twitter: string[];
    linkedin: string[];
    tiktok: string[];
  } {
    const profiles: {
      facebook: string[];
      instagram: string[];
      twitter: string[];
      linkedin: string[];
      tiktok: string[];
    } = {
      facebook: [],
      instagram: [],
      twitter: [],
      linkedin: [],
      tiktok: [],
    };

    results.forEach((result) => {
      const url = result.url.toLowerCase();
      if (url.includes('facebook.com')) profiles.facebook.push(result.url);
      else if (url.includes('instagram.com'))
        profiles.instagram.push(result.url);
      else if (url.includes('twitter.com') || url.includes('x.com'))
        profiles.twitter.push(result.url);
      else if (url.includes('linkedin.com')) profiles.linkedin.push(result.url);
      else if (url.includes('tiktok.com')) profiles.tiktok.push(result.url);
    });

    // Remove duplicates
    Object.keys(profiles).forEach((key) => {
      profiles[key] = [...new Set(profiles[key])];
    });

    return profiles;
  }

  /**
   * Identify person using Groq AI or manual method
   */
  private async identifyPerson(
    result: PersonSearchResult,
    method: IdentificationMethod,
  ): Promise<any> {
    if (method === IdentificationMethod.MANUAL) {
      return {
        confidence: 0,
        identificationMethod: IdentificationMethod.MANUAL,
        manuallyVerified: false,
      };
    }

    try {
      const context = {
        searchResults: result.reverseImageSearch.results
          .slice(0, 20)
          .map((r) => ({
            title: r.title,
            snippet: r.snippet || '',
            url: r.url,
          })),
        crawledContent: result.crawledPages?.slice(0, 10).map((p) => ({
          url: p.url,
          title: p.title,
          content: '', // Would need to be fetched separately
          emails: p.emails,
          phones: p.phones,
        })),
        socialMediaProfiles: result.socialMediaProfiles,
      };

      const identification = await this.groq.identifyPerson(context);

      return {
        name: identification.name,
        surname: identification.surname,
        fullName: identification.fullName,
        username: identification.username,
        position: identification.position,
        organization: identification.organization,
        location: identification.location,
        confidence: identification.confidence,
        identificationMethod:
          method === IdentificationMethod.HYBRID
            ? IdentificationMethod.HYBRID
            : IdentificationMethod.GROQ,
        manuallyVerified: false,
      };
    } catch (error) {
      this.logger.error(`Groq identification failed: ${error.message}`);
      return {
        confidence: 0,
        identificationMethod: method,
        manuallyVerified: false,
      };
    }
  }

  /**
   * Generate unique search ID
   */
  private generateSearchId(): string {
    return `search-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

}
