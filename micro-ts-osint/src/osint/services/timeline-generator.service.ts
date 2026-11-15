import { Injectable, Logger } from '@nestjs/common';
import { EvidenceService } from './evidence.service';

export interface TimelineEntry {
  timestamp: Date;
  source: string;
  category: string;
  title: string;
  description: string;
  url?: string;
  reliability: number;
}

export interface TimelineResponse {
  entries: TimelineEntry[];
  totalEntries: number;
  dateRange: {
    earliest: Date;
    latest: Date;
  };
  groupedByMonth: Record<string, TimelineEntry[]>;
  groupedByYear: Record<string, TimelineEntry[]>;
}

/**
 * Servicio generador de líneas de tiempo
 *
 * Características:
 * - Timeline cronológico de evidencias
 * - Agrupación por mes/año
 * - Filtros por fecha, fuente, categoría
 * - Exportable a JSON, Markdown, HTML
 */
@Injectable()
export class TimelineGeneratorService {
  private readonly logger = new Logger(TimelineGeneratorService.name);

  constructor(private evidenceService: EvidenceService) {}

  /**
   * Genera timeline completo para una búsqueda
   *
   * @param searchId - ID de búsqueda OSINT
   * @param options - Opciones de filtrado
   * @returns Timeline estructurado
   */
  async generateTimeline(
    searchId: string,
    options?: {
      startDate?: Date;
      endDate?: Date;
      sources?: string[];
      categories?: string[];
      sortOrder?: 'asc' | 'desc';
      limit?: number;
    },
  ): Promise<TimelineResponse> {
    this.logger.log(`Generating timeline for search ${searchId}...`);

    try {
      // 1. Obtener evidencias
      let evidences = await this.evidenceService.getEvidenceBySearch(searchId);

      // 2. Aplicar filtros
      if (options?.startDate) {
        evidences = evidences.filter(
          (e) => new Date(e.fetchedAt) >= options.startDate!,
        );
      }

      if (options?.endDate) {
        evidences = evidences.filter(
          (e) => new Date(e.fetchedAt) <= options.endDate!,
        );
      }

      if (options?.sources && options.sources.length > 0) {
        evidences = evidences.filter((e) =>
          options.sources!.includes(e.source),
        );
      }

      if (options?.categories && options.categories.length > 0) {
        evidences = evidences.filter((e) =>
          options.categories!.includes(e.category),
        );
      }

      // 3. Ordenar por timestamp
      const sortOrder = options?.sortOrder || 'asc';
      evidences.sort((a, b) => {
        const timeA = new Date(a.fetchedAt).getTime();
        const timeB = new Date(b.fetchedAt).getTime();
        return sortOrder === 'asc' ? timeA - timeB : timeB - timeA;
      });

      // 4. Limitar resultados
      if (options?.limit) {
        evidences = evidences.slice(0, options.limit);
      }

      // 5. Convertir a timeline entries
      const entries: TimelineEntry[] = evidences.map((evidence) => ({
        timestamp: new Date(evidence.fetchedAt),
        source: evidence.source,
        category: evidence.category,
        title: this.generateTitle(evidence),
        description: this.generateDescription(evidence),
        url: evidence.url,
        reliability: evidence.reliability || 0,
      }));

      // 6. Calcular date range
      const dateRange = {
        earliest: entries.length > 0 ? entries[0].timestamp : new Date(),
        latest:
          entries.length > 0
            ? entries[entries.length - 1].timestamp
            : new Date(),
      };

      // 7. Agrupar por mes y año
      const groupedByMonth = this.groupByMonth(entries);
      const groupedByYear = this.groupByYear(entries);

      return {
        entries,
        totalEntries: entries.length,
        dateRange,
        groupedByMonth,
        groupedByYear,
      };
    } catch (error) {
      this.logger.error(
        `Error generating timeline: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Genera título para entry de timeline
   */
  private generateTitle(evidence: any): string {
    if (evidence.rawData?.title) {
      return evidence.rawData.title;
    }

    if (evidence.category === 'search_result') {
      return `Resultado de búsqueda en ${evidence.source}`;
    }

    if (evidence.category === 'video') {
      return evidence.rawData?.title || 'Video encontrado';
    }

    if (evidence.category === 'crawled_page') {
      return evidence.rawData?.title || 'Página web crawleada';
    }

    if (evidence.category === 'historical_data') {
      return `Archivo histórico en ${evidence.source}`;
    }

    return `${evidence.category} - ${evidence.source}`;
  }

  /**
   * Genera descripción para entry de timeline
   */
  private generateDescription(evidence: any): string {
    if (evidence.rawData?.snippet) {
      return evidence.rawData.snippet.substring(0, 200);
    }

    if (evidence.rawData?.description) {
      return evidence.rawData.description.substring(0, 200);
    }

    if (evidence.rawData?.content) {
      return evidence.rawData.content.substring(0, 200);
    }

    return `Evidencia de ${evidence.source} - ${evidence.category}`;
  }

  /**
   * Agrupa entries por mes (YYYY-MM)
   */
  private groupByMonth(
    entries: TimelineEntry[],
  ): Record<string, TimelineEntry[]> {
    const grouped: Record<string, TimelineEntry[]> = {};

    entries.forEach((entry) => {
      const key = `${entry.timestamp.getFullYear()}-${String(entry.timestamp.getMonth() + 1).padStart(2, '0')}`;

      if (!grouped[key]) {
        grouped[key] = [];
      }

      grouped[key].push(entry);
    });

    return grouped;
  }

  /**
   * Agrupa entries por año (YYYY)
   */
  private groupByYear(
    entries: TimelineEntry[],
  ): Record<string, TimelineEntry[]> {
    const grouped: Record<string, TimelineEntry[]> = {};

    entries.forEach((entry) => {
      const key = entry.timestamp.getFullYear().toString();

      if (!grouped[key]) {
        grouped[key] = [];
      }

      grouped[key].push(entry);
    });

    return grouped;
  }

  /**
   * Exporta timeline a Markdown
   */
  async exportToMarkdown(searchId: string, options?: any): Promise<string> {
    const timeline = await this.generateTimeline(searchId, options);

    let md = `# ⏱️ Timeline - ${searchId}\n\n`;
    md += `**Total Entries**: ${timeline.totalEntries}\n`;
    md += `**Date Range**: ${timeline.dateRange.earliest.toISOString()} — ${timeline.dateRange.latest.toISOString()}\n\n`;

    md += `---\n\n`;

    timeline.entries.forEach((entry) => {
      const date = entry.timestamp.toISOString();
      md += `## ${date}\n\n`;
      md += `**Source**: ${entry.source} | **Category**: ${entry.category} | **Reliability**: ${entry.reliability.toFixed(2)}\n\n`;
      md += `### ${entry.title}\n\n`;
      md += `${entry.description}\n\n`;

      if (entry.url) {
        md += `🔗 [View Source](${entry.url})\n\n`;
      }

      md += `---\n\n`;
    });

    return md;
  }

  /**
   * Exporta timeline a JSON
   */
  async exportToJson(searchId: string, options?: any): Promise<string> {
    const timeline = await this.generateTimeline(searchId, options);
    return JSON.stringify(timeline, null, 2);
  }
}
