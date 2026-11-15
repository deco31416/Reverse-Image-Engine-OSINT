import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import FormData = require('form-data');
import * as https from 'https';
import * as http from 'http';
import { SecurityValidationService } from './security-validation.service';

/**
 * A single match returned from Yandex reverse image search.
 */
export interface YandexNativeMatch {
  title: string;
  source_url: string;
  snippet?: string;
  type?: 'page' | 'face_match';
  thumbnail_url?: string;
}

/**
 * Full result from Yandex reverse image search.
 */
export interface YandexNativeResult {
  ok: boolean;
  status_code: number;
  search_url?: string;
  original_image_url?: string;
  cbir_id?: string;
  matches: YandexNativeMatch[];
  error?: string;
}

// Domains filtered from results
const EXCLUDED_DOMAINS = [
  'yandex.', 'yastatic.', 'mc.yandex.', 'favicon.yandex.',
  'avatars.mds.yandex.', 'w3.org', 'schema.org', 'ogp.me',
  'xmlns.com', 'google.com/recaptcha',
];

const NOISE_PATTERN = /login|signin|signup|register|auth|captcha|feedback|support|cookie|privacy|terms|legal|about|help\.yandex|\.css|\.js|\.svg|\.woff|\.ico/i;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
};

/**
 * Native Yandex reverse image search — runs entirely inside the OSINT container.
 *
 * Flow:
 * 1. Upload image to Yandex → obtain cbir_id + search_url
 * 2. Fetch Sites page (cbir_page=sites) → parse CbirSites-Item elements
 * 3. Fetch People page (cbir_page=people) → parse CbirSites-Item + CbirSimilarList-Thumb
 * 4. Optionally fetch Similar page if results are still low
 * 5. Fallback: broad external link extraction
 */
@Injectable()
export class YandexReverseImageNativeService {
  private readonly logger = new Logger(YandexReverseImageNativeService.name);
  private readonly timeout = 120_000;

  constructor(private readonly securityValidation: SecurityValidationService) {}

  // ----------------------------------------------------------------
  // URL helpers
  // ----------------------------------------------------------------

  private isExcluded(href: string): boolean {
    const lower = href.toLowerCase();
    return EXCLUDED_DOMAINS.some((d) => lower.includes(d));
  }

  private normaliseUrl(href: string): string | null {
    href = (href || '').trim();
    if (!href.startsWith('http://') && !href.startsWith('https://')) return null;
    href = href.split('#')[0];
    try {
      const u = new URL(href);
      // Strip Yandex utm tracking params
      const toDelete: string[] = [];
      u.searchParams.forEach((_, k) => {
        if (k.startsWith('utm_')) toDelete.push(k);
      });
      toDelete.forEach((k) => u.searchParams.delete(k));
      let clean = u.toString();
      if (clean.endsWith('?')) clean = clean.slice(0, -1);
      return clean;
    } catch {
      return href;
    }
  }

  private addCbirPage(searchUrl: string, page: string): string {
    try {
      const u = new URL(searchUrl);
      u.searchParams.set('cbir_page', page);
      return u.toString();
    } catch {
      return searchUrl;
    }
  }

  private safeDomain(url: string): string {
    try { return new URL(url).hostname; } catch { return 'unknown'; }
  }

  // ----------------------------------------------------------------
  // Low-level HTTP (bypasses axios to avoid NestJS interceptors)
  // ----------------------------------------------------------------

  private httpGet(url: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const mod = parsedUrl.protocol === 'https:' ? https : http;
      const req = mod.request(
        url,
        {
          method: 'GET',
          headers: { ...HEADERS },
          timeout: this.timeout,
        },
        (res) => {
          // Follow redirects
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = res.headers.location.startsWith('http')
              ? res.headers.location
              : new URL(res.headers.location, url).toString();
            this.httpGet(redirectUrl).then(resolve).catch(reject);
            res.resume();
            return;
          }
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') });
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.end();
    });
  }

  private httpPostMultipart(
    url: string,
    form: FormData,
    queryParams: Record<string, string>,
  ): Promise<{ status: number; body: string; headers: Record<string, string> }> {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      for (const [k, v] of Object.entries(queryParams)) {
        u.searchParams.set(k, v);
      }
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.request(
        u.toString(),
        {
          method: 'POST',
          headers: {
            ...HEADERS,
            ...form.getHeaders(),
          },
          timeout: this.timeout,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const respHeaders: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.headers)) {
              if (typeof v === 'string') respHeaders[k] = v;
            }
            resolve({
              status: res.statusCode || 0,
              body: Buffer.concat(chunks).toString('utf-8'),
              headers: respHeaders,
            });
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      form.pipe(req);
    });
  }

  // ----------------------------------------------------------------
  // Yandex upload
  // ----------------------------------------------------------------

  private async yandexUpload(
    imageBytes: Buffer,
    contentType: string,
    filename: string,
  ): Promise<{ searchUrl: string; originalImageUrl?: string; cbirId?: string } | null> {
    const payload = JSON.stringify({ blocks: [{ block: 'b-page_type_search-by-image__link' }] });

    const form = new FormData();
    form.append('upfile', imageBytes, { filename, contentType });

    const resp = await this.httpPostMultipart(
      'https://yandex.com/images/search',
      form,
      { rpt: 'imageview', format: 'json', request: payload },
    );

    if (resp.status !== 200) {
      this.logger.warn(`Yandex upload failed: HTTP ${resp.status}`);
      return null;
    }

    let data: any;
    try {
      data = JSON.parse(resp.body);
    } catch {
      this.logger.warn('Yandex upload: response is not JSON');
      return null;
    }

    const blocks = Array.isArray(data?.blocks) ? data.blocks : [];
    if (!blocks.length || typeof blocks[0] !== 'object') {
      const keys = data ? Object.keys(data).join(', ') : 'null';
      const bodyPreview = resp.body.substring(0, 500);
      this.logger.warn(`Yandex upload: no blocks in response. Keys: [${keys}]. Body preview: ${bodyPreview}`);
      return null;
    }

    const params = blocks[0]?.params || {};
    const originalImageUrl: string | undefined = params.originalImageUrl;
    const cbirId: string | undefined = params.cbirId;
    const urlPath: string | undefined = params.url;

    let searchUrl: string | undefined;
    if (urlPath) {
      searchUrl = urlPath.startsWith('http') ? urlPath
        : urlPath.startsWith('//') ? `https:${urlPath}`
        : `https://yandex.com${urlPath}`;
    } else if (cbirId) {
      searchUrl = `https://yandex.com/images/search?cbir_id=${encodeURIComponent(cbirId)}&rpt=imageview`;
    }

    if (!searchUrl) {
      this.logger.warn('Yandex upload: could not derive search_url');
      return null;
    }

    return { searchUrl, originalImageUrl, cbirId };
  }

  // ----------------------------------------------------------------
  // Structured parsers (cheerio equivalents of BeautifulSoup selectors)
  // ----------------------------------------------------------------

  private parseCbirSites($: cheerio.CheerioAPI, maxResults: number): YandexNativeMatch[] {
    const results: YandexNativeMatch[] = [];
    const seen = new Set<string>();

    // Primary: structured CbirSites items
    $('li.CbirSites-Item, div.CbirSites-Item').each((_, item) => {
      if (results.length >= maxResults) return false;
      const $item = $(item);

      // Sites page: <a class="CbirSites-ItemTitle">
      // People page: <div class="CbirSites-ItemTitle"><a class="Link">
      let href: string | null = null;
      const directAnchor = $item.find('a.CbirSites-ItemTitle').first();
      if (directAnchor.length) {
        href = this.normaliseUrl(directAnchor.attr('href') || '');
      }
      if (!href) {
        const titleDiv = $item.find('.CbirSites-ItemTitle').first();
        if (titleDiv.length) {
          const inner = titleDiv.find('a[href]').first();
          if (inner.length) href = this.normaliseUrl(inner.attr('href') || '');
        }
      }
      if (!href) {
        const fallbackA = $item.find('a[href]').first();
        if (fallbackA.length) href = this.normaliseUrl(fallbackA.attr('href') || '');
      }
      if (!href || this.isExcluded(href) || seen.has(href)) return;
      seen.add(href);

      const title = $item.find('.CbirSites-ItemTitle').text().trim();
      const desc = $item.find('.CbirSites-ItemDescription').text().trim();

      // Extract thumbnail from the item
      const thumbImg = $item.find('.CbirSites-ItemThumb img').first();
      const thumbSrc = (thumbImg.attr('src') || thumbImg.attr('data-src') || '').trim();
      const thumbnail_url = thumbSrc && thumbSrc.startsWith('http') ? thumbSrc
        : thumbSrc && thumbSrc.startsWith('//') ? `https:${thumbSrc}`
        : undefined;

      results.push({
        title: (title || desc || href).slice(0, 200),
        source_url: href,
        snippet: desc.slice(0, 300) || undefined,
        thumbnail_url,
      });
    });

    // Secondary: links in CbirSites containers
    $('[class*="CbirSites"]').each((_, container) => {
      if (results.length >= maxResults) return false;
      $(container).find('a[href]').each((_, anchor) => {
        if (results.length >= maxResults) return false;
        const href = this.normaliseUrl($(anchor).attr('href') || '');
        if (!href || this.isExcluded(href) || seen.has(href)) return;
        seen.add(href);
        const title = $(anchor).text().trim() || href;
        results.push({ title: title.slice(0, 200), source_url: href });
      });
    });

    this.logger.log(`CbirSites parser: ${results.length} results`);
    return results;
  }

  private parseCbirPeople($: cheerio.CheerioAPI, maxResults: number): YandexNativeMatch[] {
    const results: YandexNativeMatch[] = [];
    const seen = new Set<string>();

    // 1. CbirSites-Items on the People page
    $('li.CbirSites-Item, div.CbirSites-Item').each((_, item) => {
      if (results.length >= maxResults) return false;
      const $item = $(item);

      let href: string | null = null;
      const titleDiv = $item.find('.CbirSites-ItemTitle').first();
      if (titleDiv.length) {
        const inner = titleDiv.find('a[href]').first();
        if (inner.length) href = this.normaliseUrl(inner.attr('href') || '');
      }
      if (!href) {
        const directA = $item.find('a.CbirSites-ItemTitle').first();
        if (directA.length) href = this.normaliseUrl(directA.attr('href') || '');
      }
      if (!href) {
        const fallback = $item.find('a[href]').first();
        if (fallback.length) href = this.normaliseUrl(fallback.attr('href') || '');
      }
      if (!href || this.isExcluded(href) || seen.has(href)) return;
      seen.add(href);

      const title = $item.find('.CbirSites-ItemTitle').text().trim();
      const desc = $item.find('.CbirSites-ItemDescription').text().trim();
      const domain = $item.find('.CbirSites-ItemDomain').text().trim();

      // Extract thumbnail
      const thumbImg = $item.find('.CbirSites-ItemThumb img').first();
      const thumbSrc = (thumbImg.attr('src') || thumbImg.attr('data-src') || '').trim();
      const thumbnail_url = thumbSrc && thumbSrc.startsWith('http') ? thumbSrc
        : thumbSrc && thumbSrc.startsWith('//') ? `https:${thumbSrc}`
        : undefined;

      results.push({
        title: (title || desc || domain || href).slice(0, 200),
        source_url: href,
        snippet: desc.slice(0, 300) || undefined,
        type: 'face_match',
        thumbnail_url,
      });
    });

    this.logger.log(`CbirPeople sites: ${results.length} results`);

    // 2. CbirSimilarList-Thumb face image URLs
    let faceImgCount = 0;
    $('.CbirSimilarList-Thumb').each((_, thumb) => {
      if (results.length >= maxResults) return false;
      $(thumb).find('a[href]').each((_, anchor) => {
        if (results.length >= maxResults) return false;
        const hrefRaw = $(anchor).attr('href') || '';
        let imgUrl: string | undefined;
        try {
          const u = new URL(hrefRaw, 'https://yandex.com');
          imgUrl = u.searchParams.get('img_url') || undefined;
        } catch { /* skip */ }
        if (!imgUrl || seen.has(imgUrl) || this.isExcluded(imgUrl)) return;
        seen.add(imgUrl);
        const imgDomain = this.safeDomain(imgUrl);

        // The face thumbnail is the <img> inside the thumb element
        const faceThumbImg = $(anchor).find('img').first();
        let faceThumbnail = (faceThumbImg.attr('src') || faceThumbImg.attr('data-src') || '').trim();
        if (faceThumbnail && faceThumbnail.startsWith('//')) faceThumbnail = `https:${faceThumbnail}`;
        // For face matches, the source_url (img_url) is itself an image
        const thumbnail_url = (faceThumbnail && faceThumbnail.startsWith('http')) ? faceThumbnail : imgUrl;

        faceImgCount++;
        results.push({
          title: `Face match image from ${imgDomain}`,
          source_url: imgUrl,
          type: 'face_match',
          thumbnail_url,
        });
      });
    });

    this.logger.log(`CbirPeople face images: ${faceImgCount}`);
    this.logger.log(`CbirPeople total: ${results.length} results`);
    return results;
  }

  private parseCbirSimilar($: cheerio.CheerioAPI, maxResults: number): YandexNativeMatch[] {
    const results: YandexNativeMatch[] = [];
    const seen = new Set<string>();

    $('[class*="CbirSimilar"] a[href], .other-sites__item a[href], .serp-item a[href]').each((_, el) => {
      if (results.length >= maxResults) return false;
      const href = this.normaliseUrl($(el).attr('href') || '');
      if (!href || this.isExcluded(href) || seen.has(href)) return;
      seen.add(href);
      const title = $(el).text().trim() || href;
      results.push({ title: title.slice(0, 200), source_url: href });
    });

    this.logger.log(`CbirSimilar parser: ${results.length} results`);
    return results;
  }

  private fallbackExternalLinks($: cheerio.CheerioAPI, maxResults: number, alreadySeen: Set<string>): YandexNativeMatch[] {
    const results: YandexNativeMatch[] = [];

    $('a[href]').each((_, el) => {
      if (results.length >= maxResults) return false;
      const href = this.normaliseUrl($(el).attr('href') || '');
      if (!href || this.isExcluded(href) || alreadySeen.has(href)) return;
      if (NOISE_PATTERN.test(href)) return;
      alreadySeen.add(href);
      let title = $(el).text().trim() || href;
      if (title.length < 3 || title === href) {
        const parent = $(el).closest('li, div, td');
        if (parent.length) {
          const alt = parent.text().trim().slice(0, 200);
          if (alt.length > title.length) title = alt;
        }
      }
      results.push({ title: title.slice(0, 200), source_url: href });
    });

    this.logger.log(`Fallback links: ${results.length} results`);
    return results;
  }

  // ----------------------------------------------------------------
  // Main orchestrator
  // ----------------------------------------------------------------

  /**
   * Download image bytes from a public URL.
   */
  async downloadImage(imageUrl: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    try {
      const bytes = await this.securityValidation.fetchPublicUrl(imageUrl, {
        field: 'imageUrl',
        allowLocalUploads: true,
        accept: 'image/*,*/*;q=0.8',
      });
      if (!bytes.length) {
        this.logger.warn('Failed to download image from URL: empty response');
        return null;
      }
      return { bytes, contentType: this.guessImageMimeType(imageUrl) };
    } catch (err: any) {
      this.logger.warn(`Error downloading image from URL: ${err.message}`);
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

  async reverseSearch(imageBytes: Buffer, contentType: string, maxResults = 50): Promise<YandexNativeResult> {
    const filename = contentType.includes('png') ? 'image.png' : 'image.jpg';

    // 1. Upload to Yandex (retry once on failure)
    let upload = await this.yandexUpload(imageBytes, contentType, filename);
    if (!upload) {
      this.logger.warn('First Yandex upload attempt failed, retrying after 2s...');
      await new Promise((r) => setTimeout(r, 2000));
      upload = await this.yandexUpload(imageBytes, contentType, filename);
    }
    if (!upload) {
      return { ok: false, status_code: 0, error: 'Yandex upload/redirect failed', matches: [] };
    }

    const { searchUrl } = upload;
    const allMatches: YandexNativeMatch[] = [];
    const seenUrls = new Set<string>();

    const addMatches = (matches: YandexNativeMatch[], prepend = false) => {
      for (const m of matches) {
        if (!seenUrls.has(m.source_url)) {
          seenUrls.add(m.source_url);
          if (prepend) allMatches.unshift(m);
          else allMatches.push(m);
        }
      }
    };

    // 2. Sites page
    const sitesUrl = this.addCbirPage(searchUrl, 'sites');
    const sitesResp = await this.httpGet(sitesUrl);
    this.logger.log(`Yandex Sites page: HTTP ${sitesResp.status}, ${sitesResp.body.length} bytes`);
    const $sites = cheerio.load(sitesResp.body);
    addMatches(this.parseCbirSites($sites, maxResults));

    // 3. People page (face matches — always, high-value for OSINT)
    try {
      const peopleUrl = this.addCbirPage(searchUrl, 'people');
      const peopleResp = await this.httpGet(peopleUrl);
      this.logger.log(`Yandex People page: HTTP ${peopleResp.status}, ${peopleResp.body.length} bytes`);
      const $people = cheerio.load(peopleResp.body);
      const people = this.parseCbirPeople($people, maxResults);
      addMatches(people, true); // prepend — face matches get priority
      this.logger.log(`People matches added: ${people.length}`);
    } catch (err: any) {
      this.logger.warn(`People page fetch failed: ${err.message}`);
    }

    // 4. Similar page (if still below target)
    if (allMatches.length < maxResults) {
      try {
        const similarUrl = this.addCbirPage(searchUrl, 'similar');
        const similarResp = await this.httpGet(similarUrl);
        const $similar = cheerio.load(similarResp.body);
        addMatches(this.parseCbirSimilar($similar, maxResults - allMatches.length));
      } catch (err: any) {
        this.logger.warn(`Similar page fetch failed: ${err.message}`);
      }
    }

    // 5. Fallback: external links from Sites page
    if (allMatches.length < maxResults) {
      addMatches(this.fallbackExternalLinks($sites, maxResults - allMatches.length, seenUrls));
    }

    this.logger.log(`Yandex total matches: ${allMatches.length}`);

    return {
      ok: true,
      status_code: sitesResp.status,
      search_url: sitesUrl,
      original_image_url: upload.originalImageUrl,
      cbir_id: upload.cbirId,
      matches: allMatches.slice(0, maxResults),
    };
  }
}
