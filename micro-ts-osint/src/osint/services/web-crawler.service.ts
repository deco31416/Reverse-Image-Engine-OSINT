import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';
import { SecurityValidationService } from './security-validation.service';

export interface CrawlResult {
  url: string;
  title: string;
  description?: string;
  images: string[];
  links: string[];
  socialMediaProfiles: {
    facebook?: string[];
    instagram?: string[];
    twitter?: string[];
    linkedin?: string[];
    tiktok?: string[];
  };
  emails: string[];
  phones: string[];
  metadata: {
    crawledAt: Date;
    statusCode: number;
    redirectUrl?: string;
    loadTime: number;
  };
}

export interface WebCrawlerOptions {
  maxDepth?: number;
  maxPages?: number;
  followExternalLinks?: boolean;
  extractEmails?: boolean;
  extractPhones?: boolean;
  useHeadlessBrowser?: boolean;
  timeout?: number;
}

@Injectable()
export class WebCrawlerService {
  private readonly logger = new Logger(WebCrawlerService.name);
  private readonly headless: boolean;
  private readonly timeout: number;
  private readonly maxPages: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly securityValidation: SecurityValidationService,
  ) {
    this.headless =
      this.configService.get<string>('CRAWLER_HEADLESS') === 'true';
    this.timeout = parseInt(
      this.configService.get<string>('CRAWLER_TIMEOUT') || '30000',
    );
    this.maxPages = parseInt(
      this.configService.get<string>('CRAWLER_MAX_PAGES') || '50',
    );
  }

  /**
   * Crawl a single URL and extract information
   */
  async crawlUrl(
    url: string,
    options?: WebCrawlerOptions,
  ): Promise<CrawlResult> {
    const startTime = Date.now();

    try {
      const safeUrl = await this.securityValidation.validatePublicUrl(url, {
        field: 'url',
      });
      if (!safeUrl) throw new Error('URL is required');

      this.logger.log(`🕷️  Crawling URL: ${safeUrl}`);

      // Use headless browser for JavaScript-heavy sites
      if (options?.useHeadlessBrowser) {
        return await this.crawlWithPuppeteer(safeUrl, options);
      }

      // Use HTTP client for static pages (faster)
      return await this.crawlWithHttp(safeUrl, options);
    } catch (error) {
      this.logger.error(`❌ Crawl failed for ${url}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Crawl multiple URLs in parallel
   */
  async crawlMultipleUrls(
    urls: string[],
    options?: WebCrawlerOptions,
  ): Promise<CrawlResult[]> {
    this.logger.log(`🕸️  Crawling ${urls.length} URLs...`);

    const results: CrawlResult[] = [];
    const maxConcurrent = 5;

    // Process URLs in batches
    for (let i = 0; i < urls.length; i += maxConcurrent) {
      const batch = urls.slice(i, i + maxConcurrent);
      const batchResults = await Promise.allSettled(
        batch.map((url) => this.crawlUrl(url, options)),
      );

      batchResults.forEach((result) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          this.logger.error(`Batch crawl error: ${result.reason}`);
        }
      });
    }

    this.logger.log(`✅ Crawled ${results.length} URLs successfully`);
    return results;
  }

  /**
   * Crawl with HTTP client (fast, but limited to static content)
   */
  private async crawlWithHttp(
    url: string,
    options?: WebCrawlerOptions,
  ): Promise<CrawlResult> {
    const startTime = Date.now();

    try {
      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            'User-Agent':
              this.configService.get<string>('CRAWLER_USER_AGENT') ||
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          timeout: options?.timeout || this.timeout,
          maxRedirects: 0,
          validateStatus: (status) => status >= 200 && status < 300,
        }),
      );

      const $ = cheerio.load(response.data);
      const loadTime = Date.now() - startTime;

      // Extract data
      const title = $('title').text() || $('h1').first().text();
      const description =
        $('meta[name="description"]').attr('content') ||
        $('meta[property="og:description"]').attr('content');

      // Extract images
      const images: string[] = [];
      $('img').each((_, element) => {
        const src = $(element).attr('src');
        if (src) {
          images.push(this.resolveUrl(src, url));
        }
      });

      // Extract links
      const links: string[] = [];
      $('a').each((_, element) => {
        const href = $(element).attr('href');
        if (href) {
          links.push(this.resolveUrl(href, url));
        }
      });

      // Extract social media profiles
      const socialMediaProfiles = this.extractSocialMedia($);

      // Extract emails and phones (if enabled)
      const emails = options?.extractEmails
        ? this.extractEmails(response.data)
        : [];
      const phones = options?.extractPhones
        ? this.extractPhones(response.data)
        : [];

      return {
        url,
        title,
        description,
        images,
        links,
        socialMediaProfiles,
        emails,
        phones,
        metadata: {
          crawledAt: new Date(),
          statusCode: response.status,
          redirectUrl: response.request?.res?.responseUrl,
          loadTime,
        },
      };
    } catch (error) {
      this.logger.error(`HTTP crawl error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Crawl with Puppeteer (slower, but handles JavaScript)
   */
  private async crawlWithPuppeteer(
    url: string,
    options?: WebCrawlerOptions,
  ): Promise<CrawlResult> {
    const startTime = Date.now();
    let browser;

    try {
      this.logger.log('🎭 Launching headless browser...');

      browser = await puppeteer.launch({
        headless: this.headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const page = await browser.newPage();
      await page.setUserAgent(
        this.configService.get<string>('CRAWLER_USER_AGENT') ||
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      );
      await page.setRequestInterception(true);
      page.on('request', async (request) => {
        const requestUrl = request.url();
        if (!requestUrl.startsWith('http://') && !requestUrl.startsWith('https://')) {
          request.continue().catch(() => undefined);
          return;
        }

        try {
          await this.securityValidation.validatePublicUrl(requestUrl, { field: 'url' });
          request.continue().catch(() => undefined);
        } catch {
          request.abort().catch(() => undefined);
        }
      });

      // Navigate to page
      const response = await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: options?.timeout || this.timeout,
      });

      const loadTime = Date.now() - startTime;

      // Extract data
      const title = await page.title();
      const description = await page
        .$eval('meta[name="description"]', (el) => el.getAttribute('content'))
        .catch(() => null);

      // Extract images
      const images = await page.$$eval('img', (imgs) =>
        imgs.map((img) => img.src).filter(Boolean),
      );

      // Extract links
      const links = await page.$$eval('a', (anchors) =>
        anchors.map((a) => a.href).filter(Boolean),
      );

      // Get page content for further parsing
      const content = await page.content();
      const $ = cheerio.load(content);

      // Extract social media profiles
      const socialMediaProfiles = this.extractSocialMedia($);

      // Extract emails and phones
      const emails = options?.extractEmails ? this.extractEmails(content) : [];
      const phones = options?.extractPhones ? this.extractPhones(content) : [];

      await browser.close();

      return {
        url,
        title,
        description,
        images,
        links,
        socialMediaProfiles,
        emails,
        phones,
        metadata: {
          crawledAt: new Date(),
          statusCode: response?.status() || 200,
          redirectUrl: page.url(),
          loadTime,
        },
      };
    } catch (error) {
      if (browser) {
        await browser.close();
      }
      this.logger.error(`Puppeteer crawl error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extract social media profiles from page
   */
  private extractSocialMedia($: cheerio.CheerioAPI): {
    facebook?: string[];
    instagram?: string[];
    twitter?: string[];
    linkedin?: string[];
    tiktok?: string[];
  } {
    const profiles: any = {
      facebook: [],
      instagram: [],
      twitter: [],
      linkedin: [],
      tiktok: [],
    };

    $('a').each((_, element) => {
      const href = $(element).attr('href');
      if (!href) return;

      if (href.includes('facebook.com')) {
        profiles.facebook.push(href);
      } else if (href.includes('instagram.com')) {
        profiles.instagram.push(href);
      } else if (href.includes('twitter.com') || href.includes('x.com')) {
        profiles.twitter.push(href);
      } else if (href.includes('linkedin.com')) {
        profiles.linkedin.push(href);
      } else if (href.includes('tiktok.com')) {
        profiles.tiktok.push(href);
      }
    });

    // Remove duplicates
    Object.keys(profiles).forEach((key) => {
      profiles[key] = [...new Set(profiles[key])];
    });

    return profiles;
  }

  /**
   * Extract email addresses from content
   */
  private extractEmails(content: string): string[] {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const matches = content.match(emailRegex);
    return matches ? [...new Set(matches)] : [];
  }

  /**
   * Extract phone numbers from content
   */
  private extractPhones(content: string): string[] {
    const phoneRegex =
      /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
    const matches = content.match(phoneRegex);
    return matches ? [...new Set(matches)] : [];
  }

  /**
   * Resolve relative URL to absolute
   */
  private resolveUrl(relativeUrl: string, baseUrl: string): string {
    try {
      return new URL(relativeUrl, baseUrl).href;
    } catch {
      return relativeUrl;
    }
  }

  /**
   * Filter results by domain (e.g., only social media)
   */
  filterByDomain(results: CrawlResult[], domains: string[]): CrawlResult[] {
    return results.filter((result) => {
      const url = new URL(result.url);
      return domains.some((domain) => url.hostname.includes(domain));
    });
  }

  /**
   * Find images matching a specific person across crawled pages
   */
  findMatchingImages(
    results: CrawlResult[],
    targetImageUrl: string,
  ): { url: string; matchingImages: string[] }[] {
    // This would require image comparison logic
    // For now, return pages that contain any images
    return results
      .filter((result) => result.images.length > 0)
      .map((result) => ({
        url: result.url,
        matchingImages: result.images,
      }));
  }
}
