import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  OsintSearch,
  OsintSearchDocument,
} from '../schemas/osint-search.schema';
import { EvidenceService } from './evidence.service';
import { ScoringService } from './scoring.service';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Servicio generador de reportes en Markdown
 *
 * Características:
 * - Reporte completo de búsqueda OSINT
 * - Tabla de evidencias con scores
 * - Resumen ejecutivo
 * - Timeline de hallazgos
 * - Datos extraídos (emails, teléfonos, etc.)
 * - Gráficas de scores (ASCII art)
 * - Exportable a archivo .md
 */
@Injectable()
export class MarkdownReportGeneratorService {
  private readonly logger = new Logger(MarkdownReportGeneratorService.name);

  constructor(
    @InjectModel(OsintSearch.name)
    private osintSearchModel: Model<OsintSearchDocument>,
    private evidenceService: EvidenceService,
    private scoringService: ScoringService,
  ) {}

  /**
   * Genera reporte Markdown completo para una búsqueda
   *
   * @param searchId - ID de búsqueda OSINT
   * @param options - Opciones de reporte
   * @returns String con contenido Markdown
   */
  async generateReport(
    searchId: string,
    options?: {
      includeRawData?: boolean; // Incluir datos crudos (default: false)
      includeTimeline?: boolean; // Incluir timeline (default: true)
      includeScoreBreakdown?: boolean; // Incluir desglose de scores (default: true)
      saveToFile?: boolean; // Guardar a archivo (default: false)
      outputPath?: string; // Ruta de salida
    },
  ): Promise<string> {
    this.logger.log(`Generating Markdown report for search ${searchId}...`);

    try {
      // 1. Obtener búsqueda
      const search = await this.osintSearchModel.findById(searchId).exec();
      if (!search) {
        throw new Error(`Search not found: ${searchId}`);
      }

      // 2. Obtener evidencias
      const evidences =
        await this.evidenceService.getEvidenceBySearch(searchId);

      // 3. Calcular scores
      const scores = this.scoringService.computeScores(evidences);
      const scoreDetails = this.scoringService.getScoreBreakdown(evidences);

      // 4. Generar secciones de reporte
      const sections: string[] = [];

      // Header
      sections.push(this.generateHeader(search, evidences.length));

      // Resumen Ejecutivo
      sections.push(this.generateExecutiveSummary(search, evidences, scores));

      // Scores
      if (options?.includeScoreBreakdown !== false) {
        sections.push(this.generateScoresSection(scores, scoreDetails));
      }

      // Input Data
      sections.push(this.generateInputDataSection(search));

      // Evidencias
      sections.push(this.generateEvidencesSection(evidences, options));

      // Datos Extraídos
      sections.push(this.generateExtractedDataSection(evidences));

      // Timeline
      if (options?.includeTimeline !== false) {
        sections.push(this.generateTimelineSection(evidences));
      }

      // Fuentes
      sections.push(this.generateSourcesSection(evidences));

      // Footer
      sections.push(this.generateFooter(search));

      // Unir todo
      const markdown = sections.join('\n\n---\n\n');

      // Guardar a archivo si se especifica
      if (options?.saveToFile) {
        await this.saveToFile(markdown, searchId, options.outputPath);
      }

      return markdown;
    } catch (error) {
      this.logger.error(
        `Error generating Markdown report: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Genera header del reporte
   */
  private generateHeader(
    search: OsintSearchDocument,
    evidenceCount: number,
  ): string {
    return `# 🔍 OSINT Report

**Search ID**: \`${search._id}\`  
**Query**: ${search.query}  
**Status**: ${(search.status || 'pending').toUpperCase()}  
**Created**: ${(search.createdAt || new Date()).toISOString()}  
**Updated**: ${(search.updatedAt || new Date()).toISOString()}  
**Total Evidence**: ${evidenceCount}  
**Cluster**: ${search.clusterLetter || 'N/A'}
`;
  }

  /**
   * Genera resumen ejecutivo
   */
  private generateExecutiveSummary(
    search: OsintSearchDocument,
    evidences: any[],
    scores: any,
  ): string {
    const sources = [...new Set(evidences.map((e) => e.source))];
    const categories = [...new Set(evidences.map((e) => e.category))];

    return `## 📋 Resumen Ejecutivo

Esta búsqueda OSINT recopiló **${evidences.length} evidencias** de **${sources.length} fuentes** diferentes.

- **Score General**: ${scores.overall.toFixed(1)}/100 (${scores.confidence})
- **Score Identidad**: ${scores.identity.toFixed(1)}/100
- **Score Legal**: ${scores.legal.toFixed(1)}/100
- **Score Financiero**: ${scores.financial.toFixed(1)}/100

### Fuentes Consultadas
${sources.map((s) => `- ${s}`).join('\n')}

### Categorías de Evidencia
${categories
  .map((c) => {
    const count = evidences.filter((e) => e.category === c).length;
    return `- ${c}: ${count} evidencias`;
  })
  .join('\n')}
`;
  }

  /**
   * Genera sección de scores con gráficas ASCII
   */
  private generateScoresSection(scores: any, scoreDetails: any): string {
    const identityBar = this.generateProgressBar(scores.identity);
    const legalBar = this.generateProgressBar(scores.legal);
    const financialBar = this.generateProgressBar(scores.financial);
    const overallBar = this.generateProgressBar(scores.overall);

    return `## 📊 Análisis de Scores

### Score General
\`\`\`
${overallBar} ${scores.overall.toFixed(1)}/100
\`\`\`
**Confianza**: ${scores.confidence}

### Scores por Dimensión

#### Identidad (45%)
\`\`\`
${identityBar} ${scores.identity.toFixed(1)}/100
\`\`\`

#### Legal (35%)
\`\`\`
${legalBar} ${scores.legal.toFixed(1)}/100
\`\`\`

#### Financiero (20%)
\`\`\`
${financialBar} ${scores.financial.toFixed(1)}/100
\`\`\`

### Desglose Detallado
- **Total Evidences**: ${scoreDetails.totalEvidence}
- **Unique Sources**: ${scoreDetails.uniqueSources}
- **High Reliability**: ${scoreDetails.highReliabilityCount} (>= 0.8)
- **Average Reliability**: ${scoreDetails.averageReliability.toFixed(2)}
`;
  }

  /**
   * Genera barra de progreso ASCII
   */
  private generateProgressBar(value: number, length: number = 30): string {
    const filled = Math.round((value / 100) * length);
    const empty = length - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
  }

  /**
   * Genera sección de input data
   */
  private generateInputDataSection(search: OsintSearchDocument): string {
    const { inputData } = search;
    let md = `## 📥 Input Data\n\n`;

    if (!inputData) {
      md += `_No input data available_\n\n`;
      return md;
    }

    if (inputData.image) {
      md += `### Imagen\n`;
      md += `- **Source**: ${inputData.image.source}\n`;
      if (search.imageUrl) {
        md += `- **Original URL**: ${search.imageUrl}\n`;
      }
      if (search.enhancedImageUrl) {
        md += `- **Enhanced URL**: ${search.enhancedImageUrl}\n`;
      }
      md += `\n`;
    }

    if (inputData.personalInfo) {
      md += `### Información Personal\n`;
      Object.entries(inputData.personalInfo).forEach(([key, value]) => {
        if (value) {
          md += `- **${key}**: ${value}\n`;
        }
      });
      md += `\n`;
    }

    if (inputData.context) {
      md += `### Contexto\n`;
      Object.entries(inputData.context).forEach(([key, value]) => {
        if (value) {
          md += `- **${key}**: ${value}\n`;
        }
      });
      md += `\n`;
    }

    if (inputData.options) {
      md += `### Opciones de Búsqueda\n`;
      md += `- **Deep Search**: ${inputData.options.deepSearch ? 'Yes' : 'No'}\n`;
      md += `- **YouTube Search**: ${inputData.options.youtubeSearch ? 'Yes' : 'No'}\n`;
      md += `- **Web Archive**: ${inputData.options.webArchiveSearch ? 'Yes' : 'No'}\n`;
      md += `- **Search Engines**: ${(inputData.options.searchEngines || []).join(', ')}\n`;
    }

    return md;
  }

  /**
   * Genera sección de evidencias
   */
  private generateEvidencesSection(evidences: any[], options?: any): string {
    let md = `## 🔎 Evidencias (${evidences.length})\n\n`;

    // Tabla de evidencias
    md += `| # | Source | Category | URL | Reliability | Timestamp |\n`;
    md += `|---|--------|----------|-----|-------------|------------|\n`;

    evidences.forEach((evidence, index) => {
      const url = evidence.sourceUrl?.substring(0, 50) || 'N/A';
      const timestamp = new Date(evidence.timestamp)
        .toISOString()
        .split('T')[0];
      md += `| ${index + 1} | ${evidence.source} | ${evidence.category} | ${url}... | ${(evidence.reliability || 0).toFixed(2)} | ${timestamp} |\n`;
    });

    md += `\n`;

    // Detalles de evidencias (si se solicita)
    if (options?.includeRawData) {
      md += `### Detalles de Evidencias\n\n`;
      evidences.forEach((evidence, index) => {
        md += `#### ${index + 1}. ${evidence.source} - ${evidence.category}\n`;
        md += `- **URL**: ${evidence.sourceUrl}\n`;
        md += `- **Reliability**: ${(evidence.reliability || 0).toFixed(2)}\n`;
        md += `- **Timestamp**: ${new Date(evidence.timestamp).toISOString()}\n`;
        if (evidence.rawData && Object.keys(evidence.rawData).length > 0) {
          md += `- **Raw Data**: \`\`\`json\n${JSON.stringify(evidence.rawData, null, 2)}\n\`\`\`\n`;
        }
        md += `\n`;
      });
    }

    return md;
  }

  /**
   * Genera sección de datos extraídos
   */
  private generateExtractedDataSection(evidences: any[]): string {
    const emails = new Set<string>();
    const phones = new Set<string>();
    const urls = new Set<string>();
    const rfcs = new Set<string>();
    const curps = new Set<string>();

    evidences.forEach((evidence) => {
      if (evidence.extractedData) {
        (evidence.extractedData.emails || []).forEach((e: string) =>
          emails.add(e),
        );
        (evidence.extractedData.phones || []).forEach((p: string) =>
          phones.add(p),
        );
        (evidence.extractedData.urls || []).forEach((u: string) => urls.add(u));
        (evidence.extractedData.rfcs || []).forEach((r: string) => rfcs.add(r));
        (evidence.extractedData.curps || []).forEach((c: string) =>
          curps.add(c),
        );
      }
    });

    let md = `## 📧 Datos Extraídos\n\n`;

    if (emails.size > 0) {
      md += `### Emails (${emails.size})\n`;
      Array.from(emails).forEach((email) => {
        md += `- ${email}\n`;
      });
      md += `\n`;
    }

    if (phones.size > 0) {
      md += `### Teléfonos (${phones.size})\n`;
      Array.from(phones).forEach((phone) => {
        md += `- ${phone}\n`;
      });
      md += `\n`;
    }

    if (rfcs.size > 0) {
      md += `### RFCs (${rfcs.size})\n`;
      Array.from(rfcs).forEach((rfc) => {
        md += `- ${rfc}\n`;
      });
      md += `\n`;
    }

    if (curps.size > 0) {
      md += `### CURPs (${curps.size})\n`;
      Array.from(curps).forEach((curp) => {
        md += `- ${curp}\n`;
      });
      md += `\n`;
    }

    if (urls.size > 0) {
      md += `### URLs Relevantes (${urls.size})\n`;
      Array.from(urls)
        .slice(0, 20)
        .forEach((url) => {
          md += `- ${url}\n`;
        });
      if (urls.size > 20) {
        md += `- ... y ${urls.size - 20} más\n`;
      }
      md += `\n`;
    }

    return md;
  }

  /**
   * Genera timeline de evidencias
   */
  private generateTimelineSection(evidences: any[]): string {
    const sorted = [...evidences].sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    let md = `## ⏱️ Timeline\n\n`;

    sorted.forEach((evidence) => {
      const date = new Date(evidence.timestamp).toISOString();
      md += `- **${date}**: [${evidence.source}] ${evidence.category} - ${evidence.sourceUrl?.substring(0, 80)}...\n`;
    });

    return md;
  }

  /**
   * Genera sección de fuentes
   */
  private generateSourcesSection(evidences: any[]): string {
    const sourceStats: Record<string, number> = {};

    evidences.forEach((evidence) => {
      sourceStats[evidence.source] = (sourceStats[evidence.source] || 0) + 1;
    });

    let md = `## 📚 Fuentes\n\n`;
    md += `| Source | Count | Percentage |\n`;
    md += `|--------|-------|-------------|\n`;

    Object.entries(sourceStats)
      .sort(([, a], [, b]) => b - a)
      .forEach(([source, count]) => {
        const percentage = ((count / evidences.length) * 100).toFixed(1);
        md += `| ${source} | ${count} | ${percentage}% |\n`;
      });

    return md;
  }

  /**
   * Genera footer del reporte
   */
  private generateFooter(search: OsintSearchDocument): string {
    return `## 📝 Notas

Este reporte fue generado automáticamente por el sistema de OSINT.

**Generado**: ${new Date().toISOString()}  
**Search ID**: \`${search._id}\`  
**Version**: 1.0

---

© 2026 OSINT System - Todos los derechos reservados
`;
  }

  /**
   * Guarda reporte a archivo
   */
  private async saveToFile(
    markdown: string,
    searchId: string,
    outputPath?: string,
  ): Promise<void> {
    try {
      const dir = outputPath || path.join(process.cwd(), 'reports');
      await fs.mkdir(dir, { recursive: true });

      const filename = `osint-report-${searchId}-${Date.now()}.md`;
      const filepath = path.join(dir, filename);

      await fs.writeFile(filepath, markdown, 'utf-8');

      this.logger.log(`Report saved to: ${filepath}`);
    } catch (error) {
      this.logger.error(`Error saving report to file: ${error.message}`);
      throw error;
    }
  }
}
