import { Injectable, Logger } from '@nestjs/common';
import * as puppeteer from 'puppeteer';
import { MarkdownReportGeneratorService } from './markdown-report-generator.service';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Servicio generador de reportes en PDF
 *
 * Características:
 * - Convierte reporte Markdown a HTML estilizado
 * - Genera PDF con Puppeteer
 * - Diseño profesional con CSS
 * - Gráficas de scores
 * - Exportable a Buffer o archivo
 */
@Injectable()
export class PdfReportGeneratorService {
  private readonly logger = new Logger(PdfReportGeneratorService.name);

  constructor(
    private markdownReportGenerator: MarkdownReportGeneratorService,
  ) {}

  /**
   * Genera reporte PDF para una búsqueda
   *
   * @param searchId - ID de búsqueda OSINT
   * @param options - Opciones de reporte
   * @returns Buffer con PDF
   */
  async generatePdf(
    searchId: string,
    options?: {
      includeRawData?: boolean;
      includeTimeline?: boolean;
      includeScoreBreakdown?: boolean;
      saveToFile?: boolean;
      outputPath?: string;
      format?: 'A4' | 'Letter';
      landscape?: boolean;
    },
  ): Promise<Buffer> {
    this.logger.log(`Generating PDF report for search ${searchId}...`);

    try {
      // 1. Generar markdown
      const markdown = await this.markdownReportGenerator.generateReport(
        searchId,
        {
          includeRawData: options?.includeRawData,
          includeTimeline: options?.includeTimeline,
          includeScoreBreakdown: options?.includeScoreBreakdown,
          saveToFile: false,
        },
      );

      // 2. Convertir Markdown a HTML
      const html = this.markdownToHtml(markdown);

      // 3. Generar PDF con Puppeteer
      const pdfBuffer = await this.htmlToPdf(html, {
        format: options?.format || 'A4',
        landscape: options?.landscape || false,
      });

      // 4. Guardar a archivo si se especifica
      if (options?.saveToFile) {
        await this.saveToFile(pdfBuffer, searchId, options.outputPath);
      }

      this.logger.log(
        `PDF report generated successfully (${pdfBuffer.length} bytes)`,
      );

      return pdfBuffer;
    } catch (error) {
      this.logger.error(
        `Error generating PDF report: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Convierte Markdown a HTML estilizado
   */
  private markdownToHtml(markdown: string): string {
    // Simplified Markdown to HTML (producción usar marked o markdown-it)
    // Report fields originate in user input and scraped pages. Treat all raw
    // HTML as text before generating our own trusted markup.
    let html = markdown
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^\*\*(.+?)\*\*/gm, '<strong>$1</strong>')
      .replace(/^\- (.+)$/gm, '<li>$1</li>')
      .replace(/\`\`\`([\s\S]*?)\`\`\`/gm, '<pre><code>$1</code></pre>')
      .replace(/\`(.+?)\`/gm, '<code>$1</code>')
      .replace(/\n\n/g, '</p><p>');

    // Envolver listas
    html = html.replace(/(<li>.+<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

    // Envolver en estructura HTML
    return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OSINT Report</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #333;
      padding: 40px;
      background: #fff;
    }
    
    h1 {
      color: #1a1a1a;
      font-size: 28pt;
      margin-bottom: 20px;
      border-bottom: 3px solid #007bff;
      padding-bottom: 10px;
    }
    
    h2 {
      color: #0056b3;
      font-size: 20pt;
      margin-top: 30px;
      margin-bottom: 15px;
      border-bottom: 2px solid #dee2e6;
      padding-bottom: 5px;
    }
    
    h3 {
      color: #495057;
      font-size: 16pt;
      margin-top: 20px;
      margin-bottom: 10px;
    }
    
    p {
      margin-bottom: 12px;
    }
    
    strong {
      color: #000;
      font-weight: 600;
    }
    
    code {
      background: #f4f4f4;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
      font-size: 10pt;
    }
    
    pre {
      background: #f8f9fa;
      border: 1px solid #dee2e6;
      border-radius: 5px;
      padding: 15px;
      margin: 15px 0;
      overflow-x: auto;
    }
    
    pre code {
      background: none;
      padding: 0;
    }
    
    ul {
      margin: 10px 0 10px 25px;
    }
    
    li {
      margin-bottom: 5px;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      font-size: 10pt;
    }
    
    th {
      background: #007bff;
      color: #fff;
      padding: 10px;
      text-align: left;
      font-weight: 600;
    }
    
    td {
      padding: 8px;
      border-bottom: 1px solid #dee2e6;
    }
    
    tr:hover {
      background: #f8f9fa;
    }
    
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 2px solid #dee2e6;
      text-align: center;
      color: #6c757d;
      font-size: 9pt;
    }
    
    .score-bar {
      display: inline-block;
      width: 200px;
      height: 20px;
      background: #e9ecef;
      border-radius: 10px;
      overflow: hidden;
      vertical-align: middle;
      margin-left: 10px;
    }
    
    .score-fill {
      height: 100%;
      background: linear-gradient(90deg, #28a745, #007bff);
    }
  </style>
</head>
<body>
  ${html}
  <div class="footer">
    <p>Este reporte fue generado automáticamente por el sistema de OSINT</p>
    <p>© 2026 OSINT System - Confidencial</p>
  </div>
</body>
</html>
    `;
  }

  /**
   * Convierte HTML a PDF usando Puppeteer
   */
  private async htmlToPdf(
    html: string,
    options: {
      format: 'A4' | 'Letter';
      landscape: boolean;
    },
  ): Promise<Buffer> {
    let browser: puppeteer.Browser | null = null;

    try {
      // Launch Puppeteer
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const page = await browser.newPage();
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        // Reports are self-contained: no network or file resources are needed.
        void request.abort().catch(() => undefined);
      });

      // Set HTML content
      await page.setContent(html, {
        waitUntil: 'domcontentloaded',
      });

      // Generate PDF
      const pdfBuffer = await page.pdf({
        format: options.format,
        landscape: options.landscape,
        printBackground: true,
        margin: {
          top: '20mm',
          right: '15mm',
          bottom: '20mm',
          left: '15mm',
        },
      });

      return Buffer.from(pdfBuffer);
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  /**
   * Guarda PDF a archivo
   */
  private async saveToFile(
    pdfBuffer: Buffer,
    searchId: string,
    outputPath?: string,
  ): Promise<void> {
    try {
      const dir = outputPath || path.join(process.cwd(), 'reports');
      await fs.mkdir(dir, { recursive: true });

      const filename = `osint-report-${searchId}-${Date.now()}.pdf`;
      const filepath = path.join(dir, filename);

      await fs.writeFile(filepath, pdfBuffer);

      this.logger.log(`PDF report saved to: ${filepath}`);
    } catch (error) {
      this.logger.error(`Error saving PDF to file: ${error.message}`);
      throw error;
    }
  }
}
