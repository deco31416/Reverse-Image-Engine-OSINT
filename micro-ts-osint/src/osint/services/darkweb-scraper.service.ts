import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';
import * as cheerio from 'cheerio';
import { DARKWEB_USER_AGENTS } from '../constants/darkweb-engines';
import {
  DarkWebSearchResult,
  DarkWebScrapedPage,
} from '../dto/darkweb-search.dto';

/** Timeout por página individual (ms) — .onion sites son lentos pero 15s es suficiente */
const PER_PAGE_TIMEOUT_MS = 15_000;

/** Timeout total para toda la fase de scraping (ms) */
const SCRAPING_PHASE_TIMEOUT_MS = 90_000;

/**
 * DarkWebScraperService — Scraping de URLs .onion via Tor 🕷️
 *
 * ✅ Scraping concurrente con Promise.allSettled (batch-limited)
 * ✅ Extracción de texto limpio (sin scripts/styles)
 * ✅ Truncamiento configurable por página
 * ✅ User-Agent rotation
 * ✅ Timeout configurable (default 45s para latencia Tor)
 * ✅ Fallback: retorna título si scraping falla
 */
@Injectable()
export class DarkWebScraperService {
  private readonly logger = new Logger(DarkWebScraperService.name);
  private readonly torProxy: string;
  private agent: SocksProxyAgent | null = null;

  constructor(private readonly configService: ConfigService) {
    this.torProxy =
      this.configService.get<string>('TOR_SOCKS_PROXY') ||
      'socks5h://127.0.0.1:9050';

    try {
      this.agent = new SocksProxyAgent(this.torProxy);
    } catch {
      this.logger.warn('⚠️  Tor proxy not available for scraping');
    }
  }

  /**
   * Scraping concurrente de múltiples URLs .onion
   *
   * @param results - Lista de resultados a scrapear
   * @param maxWorkers - Concurrencia máxima
   * @param maxCharsPerPage - Truncar contenido a N chars
   * @returns Array de páginas scrapeadas con contenido
   */
  async scrapeMultiple(
    results: DarkWebSearchResult[],
    maxWorkers: number = 5,
    maxCharsPerPage: number = 2000,
  ): Promise<DarkWebScrapedPage[]> {
    if (!this.agent) {
      this.logger.warn('🕷️  Tor proxy not available — returning titles only');
      return results.map((r) => ({
        url: r.link,
        content: r.title,
        title: r.title,
        truncated: false,
        error: 'Tor proxy not available',
      }));
    }

    this.logger.log(
      `🕷️  Scraping ${results.length} dark web pages (${maxWorkers} concurrent, ${PER_PAGE_TIMEOUT_MS / 1000}s/page, ${SCRAPING_PHASE_TIMEOUT_MS / 1000}s max total)`,
    );

    const pages: DarkWebScrapedPage[] = [];
    const batches = this.chunk(results, maxWorkers);
    const phaseStart = Date.now();
    let batchNum = 0;

    for (const batch of batches) {
      batchNum++;

      // Check overall phase timeout
      const elapsed = Date.now() - phaseStart;
      if (elapsed >= SCRAPING_PHASE_TIMEOUT_MS) {
        this.logger.warn(
          `🕷️  Phase timeout reached (${Math.round(elapsed / 1000)}s) — skipping remaining ${results.length - pages.length} pages`,
        );
        // Add remaining as title-only fallbacks
        const remaining = batches.slice(batchNum - 1).flat();
        for (const r of remaining) {
          pages.push({
            url: r.link,
            content: r.title,
            title: r.title,
            truncated: false,
            error: 'Phase timeout — skipped',
          });
        }
        break;
      }

      this.logger.log(
        `   🕷️  Batch ${batchNum}/${batches.length}: scraping ${batch.length} pages...`,
      );

      const promises = batch.map((result, idx) =>
        this.scrapeSingle(result, maxCharsPerPage).then((page) => {
          const status = page.error ? `FAIL: ${page.error}` : `OK (${page.content.length} chars)`;
          this.logger.debug(
            `   🕷️  [${(batchNum - 1) * maxWorkers + idx + 1}/${results.length}] ${this.truncateUrl(result.link)} → ${status}`,
          );
          return page;
        }),
      );

      // Race batch against remaining phase time
      const remainingTime = SCRAPING_PHASE_TIMEOUT_MS - (Date.now() - phaseStart);
      const batchPromise = Promise.allSettled(promises);
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), Math.max(remainingTime, 1000)),
      );

      const raceResult = await Promise.race([batchPromise, timeoutPromise]);

      if (raceResult === null) {
        this.logger.warn(
          `   🕷️  Batch ${batchNum} timed out — moving on`,
        );
        // Add batch items as title-only fallbacks
        for (const r of batch) {
          pages.push({
            url: r.link,
            content: r.title,
            title: r.title,
            truncated: false,
            error: 'Batch timeout',
          });
        }
        continue;
      }

      for (const item of raceResult as PromiseSettledResult<DarkWebScrapedPage>[]) {
        if (item.status === 'fulfilled') {
          pages.push(item.value);
        }
      }
    }

    const successCount = pages.filter((p) => !p.error).length;
    const totalTime = Date.now() - phaseStart;
    this.logger.log(
      `🕷️  Scraping complete: ${successCount}/${results.length} pages OK (${Math.round(totalTime / 1000)}s)`,
    );

    return pages;
  }

  /** Trunca URL .onion para logging legible */
  private truncateUrl(url: string): string {
    try {
      const u = new URL(url);
      const host = u.hostname.length > 20
        ? u.hostname.substring(0, 17) + '...'
        : u.hostname;
      return `${host}${u.pathname.substring(0, 20)}`;
    } catch {
      return url.substring(0, 40);
    }
  }

  /**
   * Scrape de una URL individual
   */
  private async scrapeSingle(
    result: DarkWebSearchResult,
    maxChars: number,
  ): Promise<DarkWebScrapedPage> {
    const url = result.link;
    const isTor = url.includes('.onion');

    try {
      const client = isTor
        ? axios.create({
            httpAgent: this.agent!,
            httpsAgent: this.agent!,
            headers: { 'User-Agent': this.randomUserAgent() },
            maxRedirects: 3,
            validateStatus: () => true,
          })
        : axios.create({
            headers: { 'User-Agent': this.randomUserAgent() },
            maxRedirects: 3,
            validateStatus: () => true,
          });

      const response = await client.get(url, { timeout: PER_PAGE_TIMEOUT_MS });

      if (response.status !== 200) {
        return {
          url,
          content: result.title,
          title: result.title,
          truncated: false,
          error: `HTTP ${response.status}`,
        };
      }

      // Parse y extraer texto limpio
      const $ = cheerio.load(response.data);

      // Remover scripts, styles, nav, footer
      $('script, style, nav, footer, header, noscript, iframe').remove();

      // Extraer título de la página
      const pageTitle = $('title').text().trim() || result.title;

      // Extraer texto limpio
      let text = $('body').text();
      text = text
        .replace(/\s+/g, ' ')
        .replace(/\n+/g, '\n')
        .trim();

      // Construir contenido: título + texto
      let content = `${pageTitle} - ${text}`;
      const truncated = content.length > maxChars;

      if (truncated) {
        content = content.substring(0, maxChars) + '...(truncated)';
      }

      return {
        url,
        content,
        title: pageTitle,
        truncated,
      };
    } catch (error: any) {
      // Fallback: retornar título como en el Python original
      return {
        url,
        content: result.title,
        title: result.title,
        truncated: false,
        error: error.code === 'ECONNABORTED'
          ? 'Timeout'
          : error.message?.substring(0, 80) || 'Scrape failed',
      };
    }
  }

  /**
   * Formatea los resultados para el prompt del LLM
   * Réplica de _generate_final_string del Python
   */
  formatResultsForLLM(
    results: DarkWebSearchResult[],
    truncate: boolean = false,
  ): string {
    const lines: string[] = [];
    const maxTitle = truncate ? 30 : 200;

    for (let i = 0; i < results.length; i++) {
      const res = results[i];

      // Truncar link en .onion para display
      const truncatedLink = res.link.replace(/(?<=\.onion).*/, '');
      let title = res.title
        .replace(/[^0-9a-zA-ZÀ-ÿ\s\-\.]/g, ' ')
        .trim();

      if (!truncatedLink && !title) continue;

      if (title.length > maxTitle) {
        title = title.substring(0, maxTitle) + '...';
      }

      if (truncate) {
        lines.push(`${i + 1}. ${title}`);
      } else {
        lines.push(`${i + 1}. ${truncatedLink} - ${title}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Formatea contenido scrapeado para el prompt del LLM
   */
  formatScrapedForLLM(pages: DarkWebScrapedPage[]): string {
    const lines: string[] = [];

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      lines.push(`--- Source ${i + 1}: ${page.url} ---`);
      lines.push(page.content);
      lines.push('');
    }

    return lines.join('\n');
  }

  private randomUserAgent(): string {
    return DARKWEB_USER_AGENTS[
      Math.floor(Math.random() * DARKWEB_USER_AGENTS.length)
    ];
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}
