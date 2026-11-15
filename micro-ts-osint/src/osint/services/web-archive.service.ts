import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { EvidenceService } from './evidence.service';
import { RegexExtractorService } from './regex-extractor.service';

export interface WebArchiveSnapshot {
  url: string;
  timestamp: string; // YYYYMMDDHHMMSS
  archiveUrl: string; // URL en web.archive.org
  statusCode: number;
  mimeType: string;
  digest: string; // Hash del contenido
}

export interface WebArchiveResponse {
  snapshots: WebArchiveSnapshot[];
  totalSnapshots: number;
  oldestSnapshot?: WebArchiveSnapshot;
  newestSnapshot?: WebArchiveSnapshot;
}

/**
 * Servicio de búsqueda en Internet Archive Wayback Machine
 *
 * Características:
 * - Encuentra versiones antiguas de URLs
 * - Timeline histórico de cambios
 * - Auto-guardado de evidencia en MongoDB
 * - Extracción automática de datos estructurados
 *
 * API Docs: https://archive.org/help/wayback_api.php
 *
 * No requiere API key - totalmente gratuito y libre
 *
 * Use cases:
 * - Perfiles sociales eliminados
 * - Páginas web antiguas
 * - Biografías modificadas
 * - Información borrada
 */
@Injectable()
export class WebArchiveService {
  private readonly logger = new Logger(WebArchiveService.name);
  private readonly cdxUrl = 'https://web.archive.org/cdx/search/cdx';
  private readonly waybackUrl = 'https://web.archive.org/web';
  private readonly serviceName = 'webarchive';

  constructor(
    private httpService: HttpService,
    private evidenceService: EvidenceService,
    private regexExtractor: RegexExtractorService,
  ) {}

  /**
   * Busca snapshots de una URL en Wayback Machine
   *
   * @param searchId - ID de búsqueda OSINT en MongoDB
   * @param targetUrl - URL a buscar en archivo
   * @param options - Opciones adicionales
   * @returns Snapshots encontrados con metadatos
   */
  async search(
    searchId: string,
    targetUrl: string,
    options?: {
      fromYear?: number; // Año desde (default: 2000)
      toYear?: number; // Año hasta (default: actual)
      limit?: number; // Máximo snapshots (default: 100)
      statusCode?: number; // Filtrar por status (200, 301, etc.)
      collapse?: string; // Colapsar por campo (timestamp:4 = por hora)
    },
  ): Promise<WebArchiveResponse> {
    this.logger.log(`Searching Web Archive for: "${targetUrl}"`);

    try {
      const response = await this.callWaybackApi(targetUrl, options);

      // Procesar y guardar evidencia
      if (response.snapshots.length > 0) {
        await this.processAndSaveEvidence(searchId, targetUrl, response);
      }

      return response;
    } catch (error) {
      this.logger.error(
        `Web Archive search error: ${error.message}`,
        error.stack,
      );

      // No fallar, retornar respuesta vacía
      return {
        snapshots: [],
        totalSnapshots: 0,
      };
    }
  }

  /**
   * Obtiene disponibilidad de URL en Wayback Machine (simple check)
   */
  async checkAvailability(url: string): Promise<{
    available: boolean;
    closestSnapshot?: WebArchiveSnapshot;
  }> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.waybackUrl}/available`, {
          params: { url },
          timeout: 15_000,
        }),
      );

      const data = response.data;

      if (data.archived_snapshots?.closest) {
        const closest = data.archived_snapshots.closest;
        return {
          available: closest.available,
          closestSnapshot: {
            url,
            timestamp: closest.timestamp,
            archiveUrl: closest.url,
            statusCode: closest.status ? parseInt(closest.status) : 200,
            mimeType: 'text/html',
            digest: '',
          },
        };
      }

      return { available: false };
    } catch (error) {
      this.logger.error(
        `Web Archive availability check error: ${error.message}`,
      );
      return { available: false };
    }
  }

  /**
   * Llama a Wayback Machine CDX API
   */
  private async callWaybackApi(
    targetUrl: string,
    options?: {
      fromYear?: number;
      toYear?: number;
      limit?: number;
      statusCode?: number;
      collapse?: string;
    },
  ): Promise<WebArchiveResponse> {
    const currentYear = new Date().getFullYear();
    const fromYear = options?.fromYear || 2000;
    const toYear = options?.toYear || currentYear;
    const limit = options?.limit || 100;

    const params: any = {
      url: targetUrl,
      output: 'json',
      from: `${fromYear}`,
      to: `${toYear}`,
      limit: limit.toString(),
      showResumeKey: 'false',
      showNumPages: 'false',
    };

    if (options?.statusCode) {
      params.filter = `statuscode:${options.statusCode}`;
    }

    if (options?.collapse) {
      params.collapse = options.collapse;
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get(this.cdxUrl, {
          params,
          timeout: 30_000,
        }),
      );

      const data = response.data;

      // Primera fila es header
      if (!Array.isArray(data) || data.length <= 1) {
        return {
          snapshots: [],
          totalSnapshots: 0,
        };
      }

      // El resto son datos
      const snapshots: WebArchiveSnapshot[] = data
        .slice(1)
        .map((row: string[]) => {
          const [
            urlkey,
            timestamp,
            original,
            mimetype,
            statuscode,
            digest,
            length,
          ] = row;

          return {
            url: original,
            timestamp,
            archiveUrl: `${this.waybackUrl}/${timestamp}/${original}`,
            statusCode: parseInt(statuscode) || 200,
            mimeType: mimetype,
            digest,
          };
        });

      return {
        snapshots,
        totalSnapshots: snapshots.length,
        oldestSnapshot: snapshots[0],
        newestSnapshot: snapshots[snapshots.length - 1],
      };
    } catch (error) {
      this.logger.error(`Wayback CDX API call failed: ${error.message}`);

      if (error.code === 'ECONNREFUSED') {
        throw new Error('Wayback Machine is unreachable');
      }

      throw error;
    }
  }

  /**
   * Procesa snapshots y guarda como evidencia en MongoDB
   */
  private async processAndSaveEvidence(
    searchId: string,
    targetUrl: string,
    response: WebArchiveResponse,
  ): Promise<void> {
    this.logger.log(
      `Processing ${response.snapshots.length} Web Archive snapshots as evidence...`,
    );

    // Guardar resumen de snapshots como evidencia única
    try {
      const oldestDate = response.oldestSnapshot
        ? this.formatTimestamp(response.oldestSnapshot.timestamp)
        : 'N/A';
      const newestDate = response.newestSnapshot
        ? this.formatTimestamp(response.newestSnapshot.timestamp)
        : 'N/A';

      const evidence = {
        source: 'webarchive',
        url: response.oldestSnapshot?.archiveUrl || targetUrl,
        title: `Web Archive: ${targetUrl}`,
        summary: `${response.totalSnapshots} snapshots found (${oldestDate} - ${newestDate})`,
        category: 'archived_page' as const,
        extractedData: {
          urls: response.snapshots.map((s) => s.archiveUrl),
        },
        fetchedAt: new Date(),
      };

      // Guardar evidencia (con deduplicación automática)
      await this.evidenceService.saveEvidence(searchId, evidence as any);

      this.logger.log(
        `Saved Web Archive summary as evidence (${response.totalSnapshots} snapshots)`,
      );
    } catch (error) {
      this.logger.error(`Error saving Web Archive evidence: ${error.message}`);
    }
  }

  /**
   * Formatea timestamp de Wayback (YYYYMMDDHHMMSS) a formato legible
   */
  private formatTimestamp(timestamp: string): string {
    try {
      const year = timestamp.substring(0, 4);
      const month = timestamp.substring(4, 6);
      const day = timestamp.substring(6, 8);
      const hour = timestamp.substring(8, 10);
      const minute = timestamp.substring(10, 12);
      const second = timestamp.substring(12, 14);

      return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    } catch {
      return timestamp;
    }
  }

  /**
   * Verifica si Web Archive está disponible
   */
  isAvailable(): boolean {
    return true; // Siempre disponible (no requiere API key)
  }
}
