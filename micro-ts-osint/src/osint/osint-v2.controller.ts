import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
  Res,
  StreamableFile,
  UseGuards,
  InternalServerErrorException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { InjectConnection } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { Response } from 'express';
import type { Connection } from 'mongoose';

// Services
import { InputOrchestratorService } from './services/input-orchestrator.service';
import { MultiSearchOrchestratorService } from './services/multi-search-orchestrator.service';
import { EvidenceService } from './services/evidence.service';
import { ScoringService } from './services/scoring.service';
import { ClusteringService } from './services/clustering.service';
import { AuditLogService } from './services/audit-log.service';
import { RateLimitService } from './services/rate-limit.service';
import { MarkdownReportGeneratorService } from './services/markdown-report-generator.service';
import { PdfReportGeneratorService } from './services/pdf-report-generator.service';
import { TimelineGeneratorService } from './services/timeline-generator.service';
import { GoogleVisionService } from './services/google-vision.service';
import { NetworkSchedulerService } from './services/network-scheduler.service';
import { FaceSearchService } from './services/face-search.service';
import { FaceInvestigationJobService } from './services/face-investigation-job.service';
import { GroqKeyRotationService } from './services/groq-key-rotation.service';
import { DarkWebIntelligenceService } from './services/darkweb-intelligence.service';
import { DarkWebSearchService } from './services/darkweb-search.service';
import { MetaIntelligenceService } from './services/meta-intelligence.service';
import { InstagramIntelligenceService } from './services/instagram-intelligence.service';
import { GeminiImageEnhancementService } from './services/gemini-image-enhancement.service';
import { ReverseImageSearchService } from './services/reverse-image-search.service';
import { HypothesisEngineService } from './services/hypothesis-engine.service';
import { DatasecProxyService } from './services/datasec-proxy.service';
import { DatasecCurationService } from './services/datasec-curation.service';
import { SecurityValidationService } from './services/security-validation.service';
import { OsintJobQueueService } from './services/osint-job-queue.service';
import { SocialScraperClientService } from './services/social-scraper-client.service';
import { CloudinaryService } from './services/cloudinary.service';
import { StoragePathService } from './services/storage-path.service';
import { VisualFaceSelectionService } from './services/visual-face-selection.service';
import { IdentityMemoryService } from './services/identity-memory.service';
import type { HypothesisHints } from './services/hypothesis-engine.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CaseAccessService } from './services/case-access.service';
import type { CaseActor } from './services/case-access.service';
import { CaseCleanupService } from './services/case-cleanup.service';

// DTOs
import { ExpandedPersonSearchDto, OsintSearchResponseDto } from './dto/expanded-person-search.dto';
import { DarkWebSearchDto } from './dto/darkweb-search.dto';
import { MetaSearchDto, MetaFbSearchDto } from './dto/meta-search.dto';
import { InstagramSearchDto } from './dto/instagram-search.dto';

/**
 * OSINT Controller V2 - Complete God-Level API
 * 
 * Features:
 * ✅ Multi-modal input (imagen + datos personales + contexto)
 * ✅ Multi-motor search (Bing, DuckDuckGo, YouTube, WebArchive)
 * ✅ Google Vision AI analysis
 * ✅ Evidence system with SHA256 deduplication
 * ✅ Multi-dimensional scoring
 * ✅ Alphabetical clustering (A-Z)
 * ✅ Markdown/PDF report generation
 * ✅ Timeline view
 * ✅ Rate limiting stats
 * ✅ Audit logs
 * 
 * 🔒 Protected by JWT Authentication
 */
@ApiTags('OSINT v2')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('osint')
export class OsintControllerV2 {
  private readonly logger = new Logger(OsintControllerV2.name);

  constructor(
    private inputOrchestrator: InputOrchestratorService,
    private multiSearchOrchestrator: MultiSearchOrchestratorService,
    private evidenceService: EvidenceService,
    private scoringService: ScoringService,
    private clusteringService: ClusteringService,
    private auditLogService: AuditLogService,
    private rateLimitService: RateLimitService,
    private markdownReportGenerator: MarkdownReportGeneratorService,
    private pdfReportGenerator: PdfReportGeneratorService,
    private timelineGenerator: TimelineGeneratorService,
    private googleVisionService: GoogleVisionService,
    private networkScheduler: NetworkSchedulerService,
    private faceSearchService: FaceSearchService,
    private faceInvestigationJobs: FaceInvestigationJobService,
    private groqKeyRotation: GroqKeyRotationService,
    private darkWebIntelligence: DarkWebIntelligenceService,
    private darkWebSearch: DarkWebSearchService,
    private metaIntelligence: MetaIntelligenceService,
    private instagramIntelligence: InstagramIntelligenceService,
    private geminiImageService: GeminiImageEnhancementService,
    private reverseImageSearchService: ReverseImageSearchService,
    private hypothesisEngine: HypothesisEngineService,
    private datasecProxy: DatasecProxyService,
    private datasecCuration: DatasecCurationService,
    private securityValidation: SecurityValidationService,
    private osintJobQueue: OsintJobQueueService,
    private socialScraperClient: SocialScraperClientService,
    private cloudinaryService: CloudinaryService,
    private storagePath: StoragePathService,
    private visualFaceSelection: VisualFaceSelectionService,
    private identityMemory: IdentityMemoryService,
    private configService: ConfigService,
    @InjectConnection() private readonly mongoConnection: Connection,
    private readonly caseAccess: CaseAccessService,
    private readonly caseCleanup: CaseCleanupService,
  ) {}

  // ========================================
  // SEARCH ENDPOINTS
  // ========================================

  /**
   * POST /api/v1/osint/search
   * Crea búsqueda OSINT multi-modal completa
   */
  @Post('search')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crear búsqueda OSINT multi-modal',
    description: 'Acepta imagen, datos personales, contexto y opciones. Ejecuta búsqueda en todos los motores habilitados.',
  })
  @ApiResponse({ status: 201, description: 'Búsqueda creada exitosamente', type: OsintSearchResponseDto })
  @ApiResponse({ status: 400, description: 'Input inválido' })
  async createSearch(@Body() input: ExpandedPersonSearchDto, @CurrentUser() user: CaseActor): Promise<OsintSearchResponseDto> {
    this.logger.log('📥 Creating OSINT search...');

    try {
      input.userId = this.caseAccess.actorId(user);
      // 1. Procesar input y crear búsqueda
      const search = await this.inputOrchestrator.processInput(input);

      // 2. Encolar búsqueda multi-motor
      const job = await this.osintJobQueue.enqueueSearch(search._id.toString(), 'create-search');

      // 3. Retornar respuesta inmediata
      return {
        searchId: search._id.toString(),
        query: search.query,
        clusterLetter: search.clusterLetter || '',
        enhancedImageUrl: search.enhancedImageUrl,
        status: job.status,
        job,
        createdAt: search.createdAt || new Date(),
      };
    } catch (error) {
      this.logger.error(`Create search error: ${error.message}`);
      throw error;
    }
  }

  /**
   * POST /api/v1/osint/search/:searchId/re-execute
   * Re-lanza todos los motores de búsqueda sobre una búsqueda existente
   */
  @Post('search/:searchId/re-execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-ejecutar búsqueda existente' })
  @ApiParam({ name: 'searchId', description: 'ID de búsqueda MongoDB' })
  async reExecuteSearch(@Param('searchId') searchId: string, @CurrentUser() user: CaseActor) {
    await this.caseAccess.assertSearch(searchId, user);
    this.logger.log(`🔄 Re-executing search ${searchId}...`);
    try {
      const search = await this.inputOrchestrator.getSearchById(searchId);
      if (!search) {
        throw new InternalServerErrorException(`Search ${searchId} not found`);
      }

      const job = await this.osintJobQueue.enqueueSearch(searchId, 're-execute');

      return {
        searchId,
        query: search.query,
        status: job.status,
        job,
        message: 'Búsqueda en cola. Los resultados se irán guardando en background.',
      };
    } catch (error) {
      this.logger.error(`Re-execute error: ${error.message}`);
      throw error;
    }
  }

  @Patch('search/:searchId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar nombre, tags o descripcion de una busqueda' })
  @ApiParam({ name: 'searchId', description: 'ID de búsqueda MongoDB' })
  async updateSearchDetails(
    @Param('searchId') searchId: string,
    @Body() body: { query?: string; description?: string; tags?: string[]; metadata?: Record<string, any> },
    @CurrentUser() user: CaseActor,
  ) {
    await this.caseAccess.assertSearch(searchId, user);
    const updated = await this.inputOrchestrator.updateSearchDetails(searchId, body || {});
    return {
      success: true,
      searchId: updated._id.toString(),
      query: updated.query,
      description: updated.description,
      tags: updated.tags || [],
      clusterLetter: updated.clusterLetter,
      updatedAt: updated.updatedAt,
    };
  }

  @Post('search/:searchId/refine-from-positives')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear una busqueda refinada usando evidencias positivas' })
  @ApiParam({ name: 'searchId', description: 'ID de búsqueda MongoDB original' })
  async refineSearchFromPositives(
    @Param('searchId') searchId: string,
    @Body() body: { query?: string; note?: string; userId?: string },
    @CurrentUser() user: CaseActor,
  ) {
    await this.caseAccess.assertSearch(searchId, user);
    const positiveEvidences = await this.evidenceService.getEvidenceByStatus(searchId, 'valid');
    const refined = await this.inputOrchestrator.createRefinedSearchFromExisting(searchId, {
      ...(body || {}),
      positiveEvidences,
    });
    const job = await this.osintJobQueue.enqueueSearch(refined._id.toString(), 'refine-from-positives');

    return {
      success: true,
      originalSearchId: searchId,
      searchId: refined._id.toString(),
      query: refined.query,
      status: job.status,
      job,
      positiveEvidenceCount: positiveEvidences.length,
      message: 'Búsqueda refinada creada y encolada con evidencias positivas como contexto.',
    };
  }

  @Get('search/:searchId/job')
  @ApiOperation({ summary: 'Estado de ejecución en cola para una búsqueda' })
  @ApiParam({ name: 'searchId', description: 'ID de búsqueda MongoDB' })
  async getSearchJob(@Param('searchId') searchId: string, @CurrentUser() user: CaseActor) {
    await this.caseAccess.assertSearch(searchId, user);
    return this.osintJobQueue.getJob(searchId);
  }

  @Get('jobs/stats')
  @Roles('admin', 'analyst')
  @ApiOperation({ summary: 'Estado operativo de la cola OSINT' })
  async getJobStats() {
    return this.osintJobQueue.getStats();
  }

  /**
   * GET /api/v1/osint/diagnostics
   * Tests every search engine and reports their status
   */
  @Get('diagnostics')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Diagnóstico de motores de búsqueda', description: 'Prueba cada motor y reporta qué funciona y qué no.' })
  @ApiQuery({ name: 'q', required: false, description: 'Query de prueba (default: "test")' })
  async runDiagnostics(@Query('q') testQuery?: string) {
    this.logger.log('🩺 Running diagnostics...');
    return this.multiSearchOrchestrator.runDiagnostics(testQuery || 'test');
  }

  /**
   * GET /api/v1/osint/service-audit
   * Baseline operativo por servicio: health + diagnostics + recomendaciones
   */
  @Get('service-audit')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Auditoría operativa por servicio',
    description: 'Consolida estado de infraestructura y motores para priorizar mejoras por servicio.',
  })
  @ApiQuery({ name: 'q', required: false, description: 'Query de prueba para diagnósticos (default: "test")' })
  @ApiQuery({ name: 'recheckGroq', required: false, description: 'Si es true, fuerza re-ping de Groq cuando no hay keys alive (default: true)' })
  async serviceAudit(@Query('q') testQuery?: string, @Query('recheckGroq') recheckGroq?: string) {
    const startedAt = Date.now();
    const query = testQuery || 'test';
    const shouldRecheckGroq = recheckGroq !== 'false';

    const [health, diagnostics, darkwebHealth, metaHealth, instagramHealth] = await Promise.allSettled([
      this.health(),
      this.multiSearchOrchestrator.runDiagnostics(query),
      this.darkWebSearch.healthCheck(),
      this.metaIntelligence.healthCheck(),
      this.instagramIntelligence.healthCheck(),
    ]);

    const healthData = health.status === 'fulfilled'
      ? health.value
      : { status: 'DOWN', error: health.reason?.message || 'health_check_failed' };

    const diagnosticsData = diagnostics.status === 'fulfilled'
      ? diagnostics.value
      : { _summary: { recommendation: 'Diagnostics failed' }, error: diagnostics.reason?.message || 'diagnostics_failed' };

    const darkwebData = darkwebHealth.status === 'fulfilled'
      ? darkwebHealth.value
      : { connected: false, error: darkwebHealth.reason?.message || 'darkweb_health_failed' };

    const metaData = metaHealth.status === 'fulfilled'
      ? metaHealth.value
      : { available: false, error: metaHealth.reason?.message || 'meta_health_failed' };

    const instagramData = instagramHealth.status === 'fulfilled'
      ? instagramHealth.value
      : { available: false, error: instagramHealth.reason?.message || 'instagram_health_failed' };

    const healthServices = (healthData as any)?.services || {};
    const darkwebConnected = Boolean((darkwebData as any)?.connected || (darkwebData as any)?.torAvailable);

    let groqPool = {
      totalKeys: 0,
      aliveKeys: 0,
      deadKeys: 0,
      totalTextCapacity: 0,
      totalVisionCapacity: 0,
      totalTextRemaining: 0,
      totalVisionRemaining: 0,
    };
    let groqPoolError: string | null = null;

    try {
      const currentPool = await this.groqKeyRotation.getKeyPoolStatus();
      groqPool = {
        totalKeys: currentPool.totalKeys,
        aliveKeys: currentPool.aliveKeys,
        deadKeys: currentPool.deadKeys,
        totalTextCapacity: currentPool.totalTextCapacity,
        totalVisionCapacity: currentPool.totalVisionCapacity,
        totalTextRemaining: currentPool.totalTextRemaining,
        totalVisionRemaining: currentPool.totalVisionRemaining,
      };

      if (shouldRecheckGroq && groqPool.aliveKeys === 0 && groqPool.totalKeys > 0) {
        await this.groqKeyRotation.rePingAllKeys();
        const refreshedPool = await this.groqKeyRotation.getKeyPoolStatus();
        groqPool = {
          totalKeys: refreshedPool.totalKeys,
          aliveKeys: refreshedPool.aliveKeys,
          deadKeys: refreshedPool.deadKeys,
          totalTextCapacity: refreshedPool.totalTextCapacity,
          totalVisionCapacity: refreshedPool.totalVisionCapacity,
          totalTextRemaining: refreshedPool.totalTextRemaining,
          totalVisionRemaining: refreshedPool.totalVisionRemaining,
        };
      }
    } catch (error: any) {
      groqPoolError = error?.message || 'groq_pool_status_failed';
      this.logger.warn(`service-audit: groq pool check failed: ${groqPoolError}`);
    }

    const groqStatus = groqPoolError
      ? 'degraded'
      : groqPool.aliveKeys > 0
        ? 'ok'
        : groqPool.totalKeys > 0
          ? 'runtime_failed'
          : 'no_api_key';

    const auditRows = [
      {
        service: 'infra.mongo',
        status: healthServices?.mongo?.status === 'UP' ? 'ok' : 'down',
        details: healthServices?.mongo || null,
        priority: 'critical',
        action: 'Mantener MongoDB en UP; sin persistencia no hay evidencias.',
      },
      {
        service: 'infra.redis',
        status: healthServices?.redis?.status === 'UP' ? 'ok' : 'degraded',
        details: healthServices?.redis || null,
        priority: 'high',
        action: 'Revisar conectividad Redis y rate limits para evitar bloqueos por cuota.',
      },
      {
        service: 'ai.groq',
        status: groqStatus,
        details: {
          totalKeys: groqPool.totalKeys,
          aliveKeys: groqPool.aliveKeys,
          deadKeys: groqPool.deadKeys,
          totalTextCapacity: groqPool.totalTextCapacity,
          totalVisionCapacity: groqPool.totalVisionCapacity,
          totalTextRemaining: groqPool.totalTextRemaining,
          totalVisionRemaining: groqPool.totalVisionRemaining,
          error: groqPoolError,
        },
        priority: 'critical',
        action: 'Si aliveKeys=0, refrescar/rotar keys y verificar límites diarios de texto/visión.',
      },
      {
        service: 'search.serper',
        status: diagnosticsData?.serper?.status || 'unknown',
        details: diagnosticsData?.serper || null,
        priority: 'critical',
        action: 'Verificar API key, cuotas y latencia; es el motor principal confiable.',
      },
      {
        service: 'search.searxng',
        status: diagnosticsData?.searxng?.status || 'unknown',
        details: diagnosticsData?.searxng || null,
        priority: 'medium',
        action: 'Tratar como Tier-2 por inestabilidad de instancias públicas.',
      },
      {
        service: 'search.duckduckgo',
        status: diagnosticsData?.duckduckgo?.status || 'unknown',
        details: diagnosticsData?.duckduckgo || null,
        priority: 'medium',
        action: 'Mantener como fallback; scraping puede ser bloqueado por bot protection.',
      },
      {
        service: 'search.bing',
        status: diagnosticsData?.bing?.status || 'unknown',
        details: diagnosticsData?.bing || null,
        priority: 'high',
        action: 'Configurar BING_SEARCH_API_KEY para redundancia API-based.',
      },
      {
        service: 'search.tavily',
        status: diagnosticsData?.tavily?.status || 'unknown',
        details: diagnosticsData?.tavily || null,
        priority: 'high',
        action: 'Configurar TAVILY_API_KEY para enriquecimiento semántico.',
      },
      {
        service: 'search.brave',
        status: diagnosticsData?.brave?.status || 'unknown',
        details: diagnosticsData?.brave || null,
        priority: 'high',
        action: 'Configurar BRAVE_SEARCH_API_KEY como backup estable de Serper.',
      },
      {
        service: 'social.meta',
        status: diagnosticsData?.meta?.status || (metaData?.available ? 'configured' : 'no_api_key'),
        details: metaData || diagnosticsData?.meta || null,
        priority: 'medium',
        action: 'Probar endpoint real y ajustar rate-limit/backoff de RapidAPI.',
      },
      {
        service: 'social.instagram',
        status: diagnosticsData?.instagram?.status || (instagramData?.available ? 'configured' : 'no_api_key'),
        details: instagramData || diagnosticsData?.instagram || null,
        priority: 'medium',
        action: 'Monitorear bloqueos 429 y aumentar estrategia de espera/reintento.',
      },
      {
        service: 'social.scraper',
        status: diagnosticsData?.socialScraper?.available
          ? (diagnosticsData?.socialScraper?.service?.status === 'ok' || diagnosticsData?.socialScraper?.service?.status === 'UP' ? 'ok' : 'configured')
          : (diagnosticsData?.socialScraper?.status || 'not_configured'),
        details: diagnosticsData?.socialScraper || null,
        priority: 'high',
        action: 'Mantener osint-social-scraper activo para búsquedas faciales/sociales, assets y fallback cuando RapidAPI no responda.',
      },
      {
        service: 'darkweb.tor',
        status: darkwebConnected ? 'ok' : 'down',
        details: darkwebData || null,
        priority: 'low',
        action: 'Solo habilitar cuando Tor local esté activo y necesario para investigación.',
      },
    ];

    const totals = {
      ok: auditRows.filter((r) => r.status === 'ok').length,
      degraded: auditRows.filter((r) => ['degraded', 'configured'].includes(r.status)).length,
      failed: auditRows.filter((r) => !['ok', 'degraded', 'configured'].includes(r.status)).length,
    };

    const totalsByState = {
      runtime_ok: auditRows.filter((r) => r.status === 'ok').length,
      configured_only: auditRows.filter((r) => r.status === 'configured').length,
      degraded: auditRows.filter((r) => r.status === 'degraded').length,
      runtime_failed: auditRows.filter((r) => !['ok', 'configured', 'degraded'].includes(r.status)).length,
    };

    return {
      timestamp: new Date().toISOString(),
      query,
      durationMs: Date.now() - startedAt,
      totals,
      totalsByState,
      recommendation: diagnosticsData?._summary?.recommendation || 'Sin recomendación disponible',
      health: healthData,
      diagnostics: diagnosticsData,
      groqPool,
      auditRows,
    };
  }

  /**
   * GET /api/v1/osint/search/:searchId
   * Obtiene estado y resultados de búsqueda
   */
  @Get('search/:searchId')
  @ApiOperation({ summary: 'Obtener búsqueda por ID' })
  @ApiParam({ name: 'searchId', description: 'ID de búsqueda MongoDB' })
  async getSearch(@Param('searchId') searchId: string, @CurrentUser() user: CaseActor) {
    await this.caseAccess.assertSearch(searchId, user);
    this.logger.log(`Getting search ${searchId}...`);
    
    // Get the search document from MongoDB
    const search = await this.inputOrchestrator.getSearchById(searchId);
    const evidences = await this.evidenceService.getEvidenceBySearch(searchId);
    const scores = this.scoringService.computeScores(evidences);
    const stats = await this.evidenceService.getEvidenceStats(searchId);

    return {
      searchId,
      query: search?.query || '',
      status: search?.status || 'unknown',
      searchType: search?.searchType || 'all',
      category: search?.category || 'person',
      clusterLetter: search?.clusterLetter || '',
      createdAt: search?.createdAt,
      updatedAt: search?.updatedAt,
      evidenceCount: evidences.length,
      scores,
      stats,
    };
  }

  /**
   * DELETE /api/v1/osint/searches/all
   * Elimina TODAS las búsquedas y sus evidencias (uso administrativo)
  */
  @Delete('searches/all')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Borrar TODAS las búsquedas y evidencias' })
  async deleteAllSearches() {
    this.logger.warn('⚠️  deleteAllSearches called — wiping entire OSINT database...');
    const result = await this.inputOrchestrator.deleteAllSearches();
    return { success: true, ...result };
  }

  /**
   * DELETE /api/v1/osint/search/:searchId
   * Elimina una búsqueda y TODAS sus evidencias de MongoDB
  */
  @Delete('search/:searchId')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar búsqueda y sus evidencias' })
  @ApiParam({ name: 'searchId', description: 'ID de búsqueda MongoDB' })
  async deleteSearch(@Param('searchId') searchId: string, @CurrentUser() user: CaseActor) {
    await this.caseAccess.assertSearch(searchId, user);
    const result = await this.caseCleanup.execute(searchId);
    await this.auditLogService.log(
      result.completed ? 'case_cleanup_completed' : 'case_cleanup_incomplete',
      'search', searchId, this.caseAccess.actorId(user), result,
    );
    return { success: result.completed, searchId, ...result };
  }

  @Get('search/:searchId/cleanup-preview')
  @Roles('admin')
  @ApiOperation({ summary: 'Inventario previo a la eliminación integral del expediente' })
  async getCaseCleanupPreview(@Param('searchId') searchId: string, @CurrentUser() user: CaseActor) {
    await this.caseAccess.assertSearch(searchId, user);
    return this.caseCleanup.preview(searchId);
  }

  /**
   * DELETE /api/v1/osint/evidence/:evidenceId
   * Elimina una evidencia individual por su SHA256 evidenceId
  */
  @Delete('evidence/:evidenceId')
  @Roles('admin', 'analyst')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archivar evidencia individual de forma reversible' })
  @ApiParam({ name: 'evidenceId', description: 'SHA256 evidenceId de la evidencia' })
  async deleteEvidence(@Param('evidenceId') evidenceId: string, @CurrentUser() user: CaseActor) {
    await this.caseAccess.assertEvidence(evidenceId, user);
    const actorId = this.caseAccess.actorId(user);
    const archived = await this.evidenceService.archiveEvidence(evidenceId, actorId, 'Archivada desde el dashboard operativo');
    await this.auditLogService.log('evidence_archived', 'evidence', evidenceId, actorId, { searchId: archived.searchId });
    return { success: true, evidenceId, archived: true, archivedAt: archived.archivedAt };
  }

  @Get('evidence/:searchId/archived')
  @ApiOperation({ summary: 'Listar evidencias archivadas de un expediente' })
  async getArchivedEvidence(@Param('searchId') searchId: string, @CurrentUser() user: CaseActor) {
    await this.caseAccess.assertSearch(searchId, user);
    return this.evidenceService.getArchivedEvidence(searchId);
  }

  @Patch('evidence/:evidenceId/restore')
  @Roles('admin', 'analyst')
  @ApiOperation({ summary: 'Restaurar una evidencia archivada' })
  async restoreEvidence(@Param('evidenceId') evidenceId: string, @CurrentUser() user: CaseActor) {
    await this.caseAccess.assertEvidence(evidenceId, user);
    const actorId = this.caseAccess.actorId(user);
    const restored = await this.evidenceService.restoreEvidence(evidenceId, actorId);
    await this.auditLogService.log('evidence_restored', 'evidence', evidenceId, actorId, { searchId: restored.searchId });
    return { success: true, evidenceId, restored: true, restoredAt: restored.restoredAt };
  }

  /**
   * DELETE /api/v1/osint/search/:searchId/evidences
   * Limpia TODAS las evidencias de una búsqueda sin borrar la búsqueda misma
  */
  @Delete('search/:searchId/evidences')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Limpiar todas las evidencias de una búsqueda' })
  @ApiParam({ name: 'searchId', description: 'ID de búsqueda MongoDB' })
  async clearSearchEvidences(@Param('searchId') searchId: string) {
    this.logger.log(`Clearing all evidences for search ${searchId}...`);
    const count = await this.evidenceService.deleteEvidenceBySearch(searchId);
    return { success: true, searchId, evidencesDeleted: count };
  }

  // ========================================
  // EVIDENCE ENDPOINTS
  // ========================================

  /**
   * GET /api/v1/osint/evidence/:searchId
   * Obtiene evidencias de una búsqueda con paginación y filtros avanzados
   */
  @Get('evidence/:searchId')
  @ApiOperation({ 
    summary: 'Obtener evidencias de búsqueda con paginación',
    description: 'Soporta filtros por fuente, categoría, reliability mínima, validación y ordenamiento'
  })
  @ApiParam({ name: 'searchId', description: 'ID de búsqueda' })
  @ApiQuery({ name: 'page', required: false, description: 'Número de página', type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, description: 'Resultados por página', type: Number, example: 50 })
  @ApiQuery({ name: 'source', required: false, description: 'Filtrar por fuente', example: 'duckduckgo' })
  @ApiQuery({ name: 'category', required: false, description: 'Filtrar por categoría', example: 'identity' })
  @ApiQuery({ name: 'minReliability', required: false, description: 'Reliability mínima (0-1)', type: Number, example: 0.7 })
  @ApiQuery({ name: 'validationStatus', required: false, description: 'Estado de validación', enum: ['pending', 'valid', 'false_positive'] })
  @ApiQuery({ name: 'sortBy', required: false, description: 'Campo para ordenar', enum: ['reliability', 'createdAt', 'matchConfidence'] })
  @ApiQuery({ name: 'sortOrder', required: false, description: 'Orden', enum: ['asc', 'desc'] })
  async getEvidence(
    @Param('searchId') searchId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('source') source?: string,
    @Query('category') category?: string,
    @Query('minReliability') minReliability?: number,
    @Query('validationStatus') validationStatus?: 'pending' | 'valid' | 'false_positive',
    @Query('sortBy') sortBy?: 'reliability' | 'createdAt' | 'matchConfidence',
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    @CurrentUser() user?: CaseActor,
  ) {
    await this.caseAccess.assertSearch(searchId, user);
    this.logger.log(`Getting evidence for search ${searchId} (page: ${page || 1})...`);

    const result = await this.evidenceService.getEvidenceBySearchPaginated(searchId, {
      page,
      limit,
      source,
      category,
      minReliability,
      validationStatus,
      sortBy,
      sortOrder,
    });

    return {
      searchId,
      ...result,
    };
  }

  /**
   * GET /api/v1/osint/evidence/:searchId/stats
   * Estadísticas de evidencias
   */
  @Get('evidence/:searchId/stats')
  @ApiOperation({ summary: 'Estadísticas de evidencias' })
  async getEvidenceStats(@Param('searchId') searchId: string, @CurrentUser() user: CaseActor) {
    await this.caseAccess.assertSearch(searchId, user);
    return this.evidenceService.getEvidenceStats(searchId);
  }

  /**
   * GET /api/v1/osint/evidence/:searchId/service-coverage
   * Verifica si las evidencias incrementan por servicio esperado
   */
  @Get('evidence/:searchId/service-coverage')
  @ApiOperation({ summary: 'Cobertura de evidencias por servicio' })
  @ApiParam({ name: 'searchId', description: 'ID de búsqueda MongoDB' })
  async getEvidenceServiceCoverage(@Param('searchId') searchId: string, @CurrentUser() user: CaseActor) {
    await this.caseAccess.assertSearch(searchId, user);
    const [search, stats] = await Promise.all([
      this.inputOrchestrator.getSearchById(searchId),
      this.evidenceService.getEvidenceStats(searchId),
    ]);

    const sourceEntries = Object.entries(stats?.bySource || {});

    const countByService = {
      serper: sourceEntries
        .filter(([source]) => source.toLowerCase().includes('serper'))
        .reduce((sum, [, count]) => sum + Number(count), 0),
      tavily: sourceEntries
        .filter(([source]) => source.toLowerCase().includes('tavily'))
        .reduce((sum, [, count]) => sum + Number(count), 0),
      bing: sourceEntries
        .filter(([source]) => source.toLowerCase().includes('bing'))
        .reduce((sum, [, count]) => sum + Number(count), 0),
      brave: sourceEntries
        .filter(([source]) => source.toLowerCase().includes('brave'))
        .reduce((sum, [, count]) => sum + Number(count), 0),
      searxng: sourceEntries
        .filter(([source]) => source.toLowerCase().includes('searxng'))
        .reduce((sum, [, count]) => sum + Number(count), 0),
      duckduckgo: sourceEntries
        .filter(([source]) => source.toLowerCase().includes('duckduckgo'))
        .reduce((sum, [, count]) => sum + Number(count), 0),
      youtube: sourceEntries
        .filter(([source]) => source.toLowerCase().includes('youtube'))
        .reduce((sum, [, count]) => sum + Number(count), 0),
      meta: sourceEntries
        .filter(([source]) => {
          const s = source.toLowerCase();
          return s.includes('facebook') || s.includes('meta');
        })
        .reduce((sum, [, count]) => sum + Number(count), 0),
      instagram: sourceEntries
        .filter(([source]) => source.toLowerCase().includes('instagram'))
        .reduce((sum, [, count]) => sum + Number(count), 0),
      webarchive: sourceEntries
        .filter(([source]) => {
          const s = source.toLowerCase();
          return s.includes('archive') || s.includes('wayback');
        })
        .reduce((sum, [, count]) => sum + Number(count), 0),
    };

    const options = (search?.inputData as any)?.options || {};
    const rawSelected = Array.isArray(options.searchEngines) ? options.searchEngines : [];
    const aliasMap: Record<string, string> = { google: 'serper' };
    const selected = new Set(
      rawSelected
        .map((s: string) => aliasMap[(s || '').toLowerCase()] || (s || '').toLowerCase())
        .filter(Boolean),
    );

    if (selected.size === 0) {
      ['serper', 'tavily', 'searxng', 'duckduckgo'].forEach((s) => selected.add(s));
    }
    if (options.youtubeSearch) selected.add('youtube');
    if (options.webArchiveSearch) selected.add('webarchive');

    const services = Object.entries(countByService).map(([service, evidenceCount]) => {
      const expected = selected.has(service);
      const hasEvidence = evidenceCount > 0;
      let status: 'incremented' | 'no_increment' | 'unexpected_increment' | 'not_expected' = 'not_expected';

      if (expected && hasEvidence) status = 'incremented';
      else if (expected && !hasEvidence) status = 'no_increment';
      else if (!expected && hasEvidence) status = 'unexpected_increment';

      return {
        service,
        expected,
        evidenceCount,
        hasEvidence,
        status,
      };
    });

    return {
      searchId,
      query: search?.query || '',
      totalEvidence: stats?.total || 0,
      selectedEngines: Array.from(selected),
      services,
      rawBySource: stats?.bySource || {},
      summary: {
        incremented: services.filter((s) => s.status === 'incremented').length,
        noIncrement: services.filter((s) => s.status === 'no_increment').length,
        unexpectedIncrement: services.filter((s) => s.status === 'unexpected_increment').length,
      },
    };
  }

  /**
   * PATCH /api/v1/osint/evidence/:evidenceId/validate
   * Valida o marca evidencia como falso positivo
   */
  @Patch('evidence/:evidenceId/validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: 'Validar evidencia',
    description: 'Marca una evidencia como válida o falso positivo'
  })
  @ApiParam({ name: 'evidenceId', description: 'ID de evidencia (SHA256 hash)' })
  async validateEvidence(
    @Param('evidenceId') evidenceId: string,
    @Body() body: { status: 'valid' | 'false_positive' },
    @CurrentUser() user: { userId?: string; username?: string },
  ) {
    await this.caseAccess.assertEvidence(evidenceId, user);
    this.logger.log(`Validating evidence ${evidenceId} as ${body.status}...`);
    
    const updated = await this.evidenceService.validateEvidence(
      evidenceId,
      body.status,
      user?.userId || user?.username || 'authenticated-user',
    );

    if (!updated) {
      throw new Error(`Evidence ${evidenceId} not found`);
    }

    return {
      success: true,
      evidenceId,
      validationStatus: updated.validationStatus,
      validatedAt: updated.validatedAt,
    };
  }

  /**
   * GET /api/v1/osint/evidence/:searchId/validation-stats
   * Estadísticas de validación
   */
  @Get('evidence/:searchId/validation-stats')
  @ApiOperation({ summary: 'Estadísticas de validación de evidencias' })
  async getValidationStats(@Param('searchId') searchId: string, @CurrentUser() user: CaseActor) {
    await this.caseAccess.assertSearch(searchId, user);
    return this.evidenceService.getValidationStats(searchId);
  }

  /**
   * GET /api/v1/osint/evidence/:searchId/by-status/:status
   * Obtener evidencias filtradas por estado de validación
   */
  @Get('evidence/:searchId/by-status/:status')
  @ApiOperation({ summary: 'Obtener evidencias por estado de validación' })
  @ApiParam({ name: 'status', enum: ['pending', 'valid', 'false_positive'] })
  async getEvidenceByStatus(
    @Param('searchId') searchId: string,
    @Param('status') status: 'pending' | 'valid' | 'false_positive',
    @CurrentUser() user?: CaseActor,
  ) {
    await this.caseAccess.assertSearch(searchId, user);
    const evidences = await this.evidenceService.getEvidenceByStatus(searchId, status);
    
    return {
      searchId,
      status,
      total: evidences.length,
      evidences,
    };
  }

  // ========================================
  // DATASEC CURATED MEMORY
  // ========================================

  @Get('datasec/stats')
  @ApiOperation({ summary: 'Resumen de Datasec curado' })
  async getDatasecStats() {
    return this.datasecCuration.stats();
  }

  @Get('datasec/persons')
  @ApiOperation({ summary: 'Listar personas Datasec' })
  async listDatasecPersons(
    @Query('q') q?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
  ) {
    return this.datasecCuration.listPersons({ q, page, limit, status });
  }

  @Post('datasec/persons')
  @Roles('admin', 'analyst')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear persona Datasec' })
  async createDatasecPerson(@Body() body: any) {
    return this.datasecCuration.createPerson(body);
  }

  @Get('datasec/persons/:personId')
  @ApiOperation({ summary: 'Detalle de persona Datasec con assets' })
  async getDatasecPerson(@Param('personId') personId: string) {
    return this.datasecCuration.getPerson(personId);
  }

  @Get('datasec/assets')
  @ApiOperation({ summary: 'Listar assets Datasec' })
  async listDatasecAssets(
    @Query('q') q?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('personId') personId?: string,
    @Query('type') type?: string,
    @Query('curationStatus') curationStatus?: string,
    @Query('origin') origin?: string,
  ) {
    return this.datasecCuration.listAssets({ q, page, limit, personId, type, curationStatus, origin });
  }

  @Post('datasec/assets')
  @Roles('admin', 'analyst')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear asset Datasec manual' })
  async createDatasecAsset(@Body() body: any) {
    return this.datasecCuration.createAsset(body);
  }

  @Post('datasec/upload')
  @Roles('admin', 'analyst')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Subir imagen Datasec y crear asset visual' })
  async uploadDatasecImage(@Body() body: any) {
    return this.datasecCuration.uploadImage(body);
  }

  @Post('datasec/promote-evidence')
  @Roles('admin', 'analyst')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Guardar evidencia OSINT en Datasec curado' })
  async promoteEvidenceToDatasec(@Body() body: any, @CurrentUser() user: CaseActor) {
    await this.caseAccess.assertEvidence(body.evidenceId, user);
    return this.datasecCuration.promoteEvidence(body);
  }

  @Get('datasec/assets/:assetId/download')
  @ApiOperation({ summary: 'Descargar asset Datasec individual' })
  async downloadDatasecAsset(
    @Param('assetId') assetId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const download = await this.datasecCuration.downloadAsset(assetId);
    res.set({
      'Content-Type': download.contentType,
      'Content-Disposition': `attachment; filename="${download.filename}"`,
    });
    return new StreamableFile(download.buffer);
  }

  @Get('datasec/assets/export')
  @ApiOperation({ summary: 'Exportar assets Datasec comprimidos' })
  async exportDatasecAssets(
    @Query('personId') personId: string | undefined,
    @Query('origin') origin: string | undefined,
    @Query('curationStatus') curationStatus: string | undefined,
    @Query('type') type: string | undefined,
    @Query('limit') limit: number | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const archive = await this.datasecCuration.downloadArchive({ personId, origin, curationStatus, type, limit });
    res.set({
      'Content-Type': archive.contentType,
      'Content-Disposition': `attachment; filename="${archive.filename}"`,
      'X-Archive-Items': String(archive.total),
    });
    return new StreamableFile(archive.buffer);
  }

  @Get('social-assets')
  @ApiOperation({ summary: 'Listar activos sociales del scraper agregado' })
  async listSocialAssets(
    @Query('platform') platform?: string,
    @Query('owner') owner?: string,
    @Query('status') status?: string,
    @Query('osintSearchId') osintSearchId?: string,
    @Query('limit') limit = '50',
    @CurrentUser() user?: CaseActor,
  ) {
    let osintSearchIds: string | undefined;
    if (osintSearchId) await this.caseAccess.assertSearch(osintSearchId, user);
    else if (!this.caseAccess.isPrivileged(user)) {
      const ids = await this.caseAccess.ownedSearchIds(user);
      if (!ids.length) return [];
      osintSearchIds = ids.join(',');
    }
    return this.socialScraperClient.listAssets({
      platform,
      owner,
      status,
      osintSearchId,
      ...(osintSearchIds ? { osintSearchIds } : {}),
      limit,
    });
  }

  @Patch('social-assets/:assetId/status')
  @Roles('admin', 'analyst')
  @ApiOperation({ summary: 'Marcar activo social como candidato, positivo, falso positivo o archivado' })
  async markSocialAssetStatus(
    @Param('assetId') assetId: string,
    @Body() body: { status: 'candidate' | 'positive' | 'false_positive' | 'archived'; note?: string },
    @CurrentUser() user?: CaseActor,
  ) {
    const asset = await this.socialScraperClient.getAsset(assetId);
    if (!asset) throw new NotFoundException('Social asset not found');
    await this.assertSocialAssetAccess(asset, user);
    return this.socialScraperClient.markAssetStatus(assetId, body);
  }

  @Post('social-assets/:assetId/promote-datasec')
  @Roles('admin', 'analyst')
  @ApiOperation({ summary: 'Guardar activo social del scraper en Datasec curado' })
  async promoteSocialAssetToDatasec(
    @Param('assetId') assetId: string,
    @Body() body: {
      personId?: string;
      createPerson?: any;
      curationStatus?: 'candidate' | 'validated' | 'discarded';
      tags?: string[];
    },
    @CurrentUser() user?: CaseActor,
  ) {
    const socialAsset = await this.socialScraperClient.getAsset(assetId);
    if (!socialAsset) throw new NotFoundException('Social asset not found');
    await this.assertSocialAssetAccess(socialAsset, user);

    const promoted = await this.datasecCuration.promoteSocialAsset(socialAsset, body);
    await this.socialScraperClient.markAssetStatus(assetId, {
      status: 'positive',
      note: `Promovido a Datasec: ${promoted.asset?._id || promoted.asset?.id || 'asset'}`,
    });
    return promoted;
  }

  // ========================================
  // SCORING ENDPOINTS
  // ========================================

  private async assertSocialAssetAccess(asset: any, user?: CaseActor) {
    if (this.caseAccess.isPrivileged(user)) return;
    if (!asset.osintSearchId) throw new ForbiddenException('This asset is not linked to an accessible case');
    await this.caseAccess.assertSearch(String(asset.osintSearchId), user);
  }

  /**
   * GET /api/v1/osint/scores/:searchId
   * Obtiene scores multi-dimensionales
   */
  @Get('scores/:searchId')
  @ApiOperation({ summary: 'Obtener scores multi-dimensionales' })
  async getScores(@Param('searchId') searchId: string, @CurrentUser() user: CaseActor) {
    await this.caseAccess.assertSearch(searchId, user);
    const evidences = await this.evidenceService.getEvidenceBySearch(searchId);
    const scores = this.scoringService.computeScores(evidences);
    const breakdown = this.scoringService.getScoreBreakdown(evidences);
    const description = this.scoringService.getScoreDescription(scores.overall);

    return {
      searchId,
      scores,
      breakdown,
      description,
    };
  }

  /**
   * POST /api/v1/osint/search/:searchId/hypotheses
   * Genera hipótesis investigativas asistidas por IA
   */
  @Post('search/:searchId/hypotheses')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generar hipótesis investigativas asistidas por IA' })
  async generateHypotheses(@Param('searchId') searchId: string, @Body() hints?: HypothesisHints, @CurrentUser() user?: CaseActor) {
    await this.caseAccess.assertSearch(searchId, user);
    this.logger.log(`🧠 Generating hypotheses for search ${searchId}...`);
    return this.hypothesisEngine.generateForSearch(searchId, hints);
  }

  // ========================================
  // CLUSTERING ENDPOINTS
  // ========================================

  /**
   * GET /api/v1/osint/clusters
   * Obtiene agrupación alfabética de búsquedas (A-Z)
   */
  @Get('clusters')
  @ApiOperation({ summary: 'Obtener clusters alfabéticos (A-Z)' })
  async getClusters(@CurrentUser() user: CaseActor) {
    this.logger.log('📊 Fetching alphabetical clusters...');
    if (!this.caseAccess.isPrivileged(user) && !this.caseAccess.actorId(user)) {
      throw new ForbiddenException('Authenticated case owner required');
    }

    try {
      // MongoDB aggregation server-side — no JS grouping, no OOM risk
      const clusters = await this.inputOrchestrator.getClustersSummary(
        this.caseAccess.isPrivileged(user) ? undefined : this.caseAccess.actorId(user),
      );
      this.logger.log(`✅ Found ${clusters.length} clusters`);
      return clusters;
    } catch (error) {
      this.logger.warn(`⚠️ Error fetching clusters (returning []): ${error.message}`);
      return [];
    }
  }

  // ========================================
  // REPORT ENDPOINTS
  // ========================================

  /**
   * GET /api/v1/osint/report/:searchId/markdown
   * Genera reporte en Markdown
   */
  @Get('report/:searchId/markdown')
  @ApiOperation({ summary: 'Generar reporte Markdown' })
  @ApiQuery({ name: 'includeRawData', required: false, type: Boolean })
  @ApiQuery({ name: 'includeTimeline', required: false, type: Boolean })
  async getMarkdownReport(
    @Param('searchId') searchId: string,
    @Query('includeRawData') includeRawData?: boolean,
    @Query('includeTimeline') includeTimeline?: boolean,
    @CurrentUser() user?: CaseActor,
  ) {
    await this.caseAccess.assertSearch(searchId, user);
    this.logger.log(`Generating Markdown report for ${searchId}...`);

    const markdown = await this.markdownReportGenerator.generateReport(searchId, {
      includeRawData: includeRawData === true,
      includeTimeline: includeTimeline !== false,
    });

    return {
      searchId,
      format: 'markdown',
      content: markdown,
    };
  }

  /**
   * GET /api/v1/osint/report/:searchId/pdf
   * Genera reporte en PDF (streaming)
   */
  @Get('report/:searchId/pdf')
  @ApiOperation({ summary: 'Generar reporte PDF' })
  async getPdfReport(
    @Param('searchId') searchId: string,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user?: CaseActor,
  ): Promise<StreamableFile> {
    await this.caseAccess.assertSearch(searchId, user);
    this.logger.log(`Generating PDF report for ${searchId}...`);

    const pdfBuffer = await this.pdfReportGenerator.generatePdf(searchId);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="osint-report-${searchId}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });

    return new StreamableFile(pdfBuffer);
  }

  // ========================================
  // TIMELINE ENDPOINTS
  // ========================================

  /**
   * GET /api/v1/osint/timeline/:searchId
   * Genera timeline cronológico
   */
  @Get('timeline/:searchId')
  @ApiOperation({ summary: 'Generar timeline cronológico' })
  @ApiQuery({ name: 'format', required: false, enum: ['json', 'markdown'] })
  async getTimeline(
    @Param('searchId') searchId: string,
    @Query('format') format: 'json' | 'markdown' = 'json',
    @CurrentUser() user?: CaseActor,
  ) {
    await this.caseAccess.assertSearch(searchId, user);
    this.logger.log(`Generating timeline for ${searchId}...`);

if (format === 'markdown') {
      const markdown = await this.timelineGenerator.exportToMarkdown(searchId);
      return {
        searchId,
        format: 'markdown',
        content: markdown,
      };
    }

    return this.timelineGenerator.generateTimeline(searchId);
  }

  // ========================================
  // RATE LIMITING ENDPOINTS
  // ========================================

  /**
   * GET /api/v1/osint/rate-limits
   * Obtiene uso de APIs
   */
  @Get('rate-limits')
  @ApiOperation({ summary: 'Obtener uso de rate limits' })
  async getRateLimits() {
    const services = ['groq', 'gemini', 'google_cse', 'bing', 'youtube'];
    const stats = await Promise.all(
      services.map(async (service) => ({
        service,
        usage: await this.rateLimitService.getUsageStats(service),
      })),
    );

    return { services: stats };
  }

  /**
   * GET /api/v1/osint/rate-limits/:service
   * Obtiene uso de API específica
   */
  @Get('rate-limits/:service')
  @ApiOperation({ summary: 'Obtener uso de servicio específico' })
  async getRateLimitForService(@Param('service') service: string) {
    return this.rateLimitService.getUsageStats(service);
  }

  // ========================================
  // AUDIT LOG ENDPOINTS
  // ========================================

  /**
   * GET /api/v1/osint/audit-logs
   * Obtiene logs de auditoría
   */
  @Get('audit-logs')
  @Roles('admin')
  @ApiOperation({ summary: 'Obtener logs de auditoría' })
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getAuditLogs(
    @Query('action') action?: string,
    @Query('userId') userId?: string,
    @Query('limit') limit: number = 100,
  ) {
    const logs = await this.auditLogService.getAllLogs({
      action,
      userId,
      limit: Number(limit),
    });

    return {
      total: logs.length,
      filters: { action, userId, limit },
      logs,
    };
  }

  /**
   * GET /api/v1/osint/audit-logs/stats
   * Estadísticas de audit logs
   */
  @Get('audit-logs/stats')
  @Roles('admin')
  @ApiOperation({ summary: 'Estadísticas de audit logs' })
  async getAuditLogStats() {
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 días
    const endDate = new Date();

    return this.auditLogService.getStats(startDate, endDate);
  }

  // ========================================
  // GOOGLE VISION ENDPOINTS
  // ========================================

  /**
   * POST /api/v1/osint/vision/analyze
   * Analiza imagen con Google Vision AI
   */
  @Post('vision/analyze')
  @ApiOperation({ summary: 'Analizar imagen con Google Vision AI' })
  async analyzeImageWithVision(
    @Body() body: { searchId: string; imageUrl: string },
  ) {
    const { searchId, imageUrl } = body;

    if (!this.googleVisionService.isAvailable()) {
      return {
        error: 'Google Vision AI not configured',
        message: 'Set GOOGLE_APPLICATION_CREDENTIALS environment variable',
      };
    }

    const safeImageUrl = await this.securityValidation.validatePublicUrl(imageUrl, {
      field: 'imageUrl',
      allowLocalUploads: true,
    });
    if (!safeImageUrl) throw new BadRequestException('imageUrl is required');

    return this.googleVisionService.analyzeImage(searchId, safeImageUrl);
  }

  // ========================================
  // COMPATIBILITY ENDPOINTS (FRONTEND CARDS)
  // ========================================

  /**
   * GET /api/v1/osint/searches
   * Lista todas las búsquedas con paginación (compatible con OsintSearchList)
   */
  @Get('searches')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Listar todas las búsquedas',
    description: 'Obtiene lista paginada de búsquedas OSINT para dashboard y cards',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 50 })
  @ApiQuery({ name: 'offset', required: false, type: Number, example: 0 })
  @ApiQuery({ name: 'status', required: false, type: String, example: 'completed' })
  async getAllSearches(@Query() query: { limit?: number; offset?: number; status?: string }, @CurrentUser() user: CaseActor) {
    this.logger.log(`📋 Fetching searches (limit: ${query.limit || 50}, offset: ${query.offset || 0})`);
    try {
      return await this.inputOrchestrator.getAllSearches({
        ...query,
        ...(user?.role === 'admin' || user?.authType === 'api-key' ? {} : { ownerId: this.caseAccess.actorId(user) }),
      });
    } catch (error) {
      this.logger.error(`❌ getAllSearches error: ${error.message}`);
      throw new InternalServerErrorException(error.message || 'Error al obtener búsquedas');
    }
  }

  /**
   * GET /api/v1/osint/stats
   * Estadísticas generales de búsquedas (compatible con OsintDashboard)
   */
  @Get('stats')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Estadísticas generales',
    description: 'Obtiene estadísticas de búsquedas: total, activas, por tipo, por categoría, clusters',
  })
  async getStats(@CurrentUser() user: CaseActor) {
    this.logger.log('📊 Fetching OSINT statistics');
    try {
      return await this.inputOrchestrator.getStats(
        this.caseAccess.isPrivileged(user) ? undefined : this.caseAccess.actorId(user),
      );
    } catch (error) {
      this.logger.error(`❌ getStats error: ${error.message}`);
      throw new InternalServerErrorException(error.message || 'Error al obtener estadísticas');
    }
  }

  // ========================================
  // HEALTH CHECK
  // ========================================

  /**
   * GET /api/v1/osint/health
   * Health check endpoint con verificación de dependencias
   */
  @Get('health')
  @Public()
  @ApiOperation({ summary: 'Health check con estado de dependencias' })
  async health() {
    const mongoStatus = await this.checkMongoConnection();
    const redisStatus = await this.checkRedisConnection();

    const allHealthy = mongoStatus.status === 'UP' && redisStatus.status === 'UP';

    return {
      status: allHealthy ? 'UP' : 'DEGRADED',
      timestamp: new Date().toISOString(),
      version: '2.7.0',
      services: {
        api: 'UP',
        mongo: mongoStatus,
        redis: redisStatus,
        gemini: this.isServiceConfigured('GEMINI_API_KEY'),
        groq: this.groqKeyRotation.isAvailable()
          ? `ALIVE (${this.groqKeyRotation.getAliveKeyCount()}/${this.groqKeyRotation.getKeyCount()} keys)`
          : 'NO_ALIVE_KEYS',
        google: this.isServiceConfigured('GOOGLE_API_KEY'),
        youtube: this.isServiceConfigured('YOUTUBE_API_KEY'),
        storage: this.getStorageHealth(),
        cloudinary: this.configService.get<string>('CLOUDINARY_ENABLED') === 'false'
          ? 'DISABLED'
          : this.isServiceConfigured('CLOUDINARY_CLOUD_NAME'),
        darkweb: this.darkWebSearch.isAvailable() ? 'TOR_CONNECTED' : 'TOR_NOT_AVAILABLE',
        meta: this.metaIntelligence.isAvailable() ? 'RAPIDAPI_CONFIGURED' : 'RAPIDAPI_NOT_CONFIGURED',
        instagram: this.instagramIntelligence.isAvailable() ? 'AVAILABLE' : 'NOT_AVAILABLE',
        instagramRapidApi: this.instagramIntelligence.isRapidApiAvailable() ? 'RAPIDAPI_CONFIGURED' : 'RAPIDAPI_NOT_CONFIGURED',
      },
    };
  }

  private async checkMongoConnection() {
    try {
      const readyState = this.mongoConnection.readyState;
      return readyState === 1
        ? { status: 'UP' }
        : { status: 'DOWN', message: `Mongoose readyState=${readyState}` };
    } catch (error) {
      return { status: 'DOWN', message: error.message };
    }
  }

  private async checkRedisConnection() {
    try {
      const healthy = await this.rateLimitService.healthCheck();
      return healthy
        ? { status: 'UP' }
        : { status: 'DOWN', message: 'Redis ping failed' };
    } catch (error) {
      return { status: 'DOWN', message: error.message };
    }
  }

  private getStorageHealth() {
    const cloudinaryEnabled = this.configService.get<string>('CLOUDINARY_ENABLED') !== 'false';
    const uploadDir = this.configService.get<string>('UPLOAD_DIR') || './uploads';
    const publicBaseUrl =
      this.configService.get<string>('UPLOAD_PUBLIC_BASE_URL') ||
      `http://localhost:${this.configService.get<string>('PORT') || process.env.PORT || 7105}`;

    return {
      status: 'UP',
      provider: cloudinaryEnabled ? 'cloudinary' : 'local-volume',
      cloudinaryEnabled,
      uploadDir,
      publicBaseUrl,
      staticPath: '/uploads',
      railwayVolumeReady: uploadDir === '/app/uploads' || uploadDir.startsWith('/app/uploads/'),
    };
  }

  private isServiceConfigured(envKey: string): string {
    const value = process.env[envKey];
    return value ? 'CONFIGURED' : 'NOT_CONFIGURED';
  }

  // ========================================
  // DARK WEB INTELLIGENCE 🕸️
  // ========================================

  /**
   * POST /api/v1/osint/darkweb/search
   * Pipeline Coplito v2 — Evidence-Based Dark Web Intelligence:
   * [1] Refine query con IA → [2] Search 16 engines via Tor
   * [3] Filter top 20 con IA → [4] Scrape .onion pages
   * [5] Evidence Gate (literal match + scoring) → [6] Report (LLM o NO ENCONTRADO)
   */
  @Post('darkweb/search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Dark Web Intelligence Pipeline v2.1 (Evidence-Based + Coverage)',
    description: 'Pipeline: refine(deterministic) → search 16 engines → pre-gate filter(deterministic) → scrape → Evidence Gate (literal match) → report. Confidence score matemático + coverage stats. 0 Groq calls si alias no encontrado.',
  })
  async executeDarkWebSearch(@Body() dto: DarkWebSearchDto) {
    this.logger.log(`🕸️  Dark Web search v2: "${dto.query}" (preset: ${dto.preset || 'threat_intel'})`);
    try {
      const result = await this.darkWebIntelligence.executePipeline(dto);
      return {
        success: true,
        query: result.originalQuery,
        refinedQuery: result.refinedQuery,
        preset: result.preset,
        // v2: Evidence Gate core fields
        aliasFound: result.aliasFound,
        reportSource: result.reportSource,
        evidenceGate: result.evidenceGate,
        literalEvidence: result.literalEvidence,
        detectedEntities: result.detectedEntities,
        // v2.1: Confidence + Coverage
        confidenceScore: result.confidenceScore,
        confidenceLabel: result.confidenceLabel,
        coverageStats: result.coverageStats,
        // Original fields
        results: result.selectedResults,
        filteredResults: result.selectedResults,
        scrapedPages: result.scrapedPages,
        intelligenceReport: result.intelligenceReport,
        engineStatuses: result.engineStatuses,
        groqKeysUsed: result.groqKeysUsed.length,
        timing: {
          refineMs: result.timing.refineMs,
          searchMs: result.timing.searchMs,
          preGateMs: result.timing.preGateMs,
          scrapeMs: result.timing.scrapeMs,
          evidenceGateMs: result.timing.evidenceGateMs,
          reportMs: result.timing.reportMs,
          totalMs: result.totalTimeMs,
        },
        pipeline: {
          step1_refine: {
            completed: dto.refineQuery !== false,
            refinedQuery: result.refinedQuery,
            method: 'deterministic',
          },
          step2_search: {
            completed: true,
            enginesQueried: result.engineStatuses?.length || 0,
            totalResults: result.totalRawResults,
          },
          step3_pregate: {
            completed: true,
            method: 'deterministic',
            preGatePassed: result.coverageStats?.preGatePassed ?? result.totalFilteredResults,
            preGateDiscarded: result.coverageStats?.preGateDiscarded ?? 0,
            filteredCount: result.totalFilteredResults,
          },
          step4_scrape: {
            completed: dto.scrapeContent !== false,
            pagesScraped: result.totalScrapedPages,
            totalChars: result.scrapedPages.reduce((sum, p) => sum + (p.content?.length || 0), 0),
          },
          step5_evidence_gate: {
            completed: true,
            aliasFound: result.aliasFound,
            passed: result.evidenceGate.totalPassed,
            discarded: result.evidenceGate.totalDiscarded,
            totalProcessed: result.evidenceGate.totalProcessed,
          },
          step6_report: {
            completed: !!result.intelligenceReport,
            reportLength: result.intelligenceReport?.length || 0,
            source: result.reportSource,
          },
        },
        totalRawResults: result.totalRawResults,
        totalUniqueResults: result.totalUniqueResults,
      };
    } catch (error: any) {
      this.logger.error(`❌ Dark Web pipeline error: ${error.message}`, error.stack);
      return {
        success: false,
        message: error.message || 'Error ejecutando Dark Web Intelligence pipeline',
        query: dto.query,
        preset: dto.preset || 'threat_intel',
      };
    }
  }

  /**
   * GET /api/v1/osint/darkweb/health
   * Health check de Tor + motores dark web
   */
  @Get('darkweb/health')
  @ApiOperation({
    summary: 'Dark Web Health Check',
    description: 'Verifica conectividad Tor y disponibilidad del servicio',
  })
  async darkWebHealth() {
    try {
      const torHealth = await this.darkWebSearch.healthCheck();
      return {
        darkweb: {
          available: this.darkWebIntelligence.isAvailable(),
          tor: torHealth,
          groqPool: this.groqKeyRotation.isAvailable()
            ? `${this.groqKeyRotation.getAliveKeyCount()} keys alive`
            : 'No alive keys',
        },
      };
    } catch (error: any) {
      this.logger.error(`❌ Dark Web health check error: ${error.message}`);
      return {
        darkweb: {
          available: false,
          tor: { connected: false, error: error.message },
          groqPool: this.groqKeyRotation.isAvailable()
            ? `${this.groqKeyRotation.getAliveKeyCount()} keys alive`
            : 'No alive keys',
        },
      };
    }
  }

  // ========================================
  // GROQ KEY POOL STATUS
  // ========================================

  /**
   * GET /api/v1/osint/groq-pool
   * Dashboard del pool de API keys de Groq — uso, salud, capacidad
   */
  @Get('groq-pool')
  @ApiOperation({
    summary: 'Groq Key Pool Dashboard',
    description: 'Muestra el estado de todas las API keys de Groq: alive/dead, uso por modelo (texto/visión), capacidad restante',
  })
  async getGroqPoolStatus() {
    return this.groqKeyRotation.getKeyPoolStatus();
  }

  /**
   * POST /api/v1/osint/groq-pool/re-ping
   * Fuerza un re-ping de todas las keys (admin)
   */
  @Post('groq-pool/re-ping')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Re-Ping Groq Keys',
    description: 'Fuerza un health check de todas las API keys de Groq (cuenta como 1 uso por key)',
  })
  async rePingGroqKeys() {
    const results = await this.groqKeyRotation.rePingAllKeys();
    return {
      message: `Re-ping completed: ${results.filter((r) => r.alive).length}/${results.length} alive`,
      results,
    };
  }

  // ========================================
  // IMAGE GALLERY & VISUALIZATION
  // ========================================

  /**
   * GET /api/v1/osint/evidence/:searchId/images
   * Obtiene todas las imágenes encontradas en una búsqueda
   */
  @Get('evidence/:searchId/images')
  @ApiOperation({ 
    summary: 'Galería de imágenes de una búsqueda',
    description: 'Obtiene todas las imágenes (thumbnails y URLs) encontradas en evidencias'
  })
  @ApiParam({ name: 'searchId', description: 'ID de búsqueda' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 50 })
  async getSearchImages(
    @Param('searchId') searchId: string,
    @Query('limit') limit?: number,
    @CurrentUser() user?: CaseActor,
  ) {
    await this.caseAccess.assertSearch(searchId, user);
    this.logger.log(`Getting images for search ${searchId}...`);

    const evidences = await this.evidenceService.getEvidenceBySearch(searchId);
    
    // Filtrar evidencias que tienen imágenes
    const evidencesWithImages = evidences.filter(e => e.imageUrl || e.thumbnailUrl);
    
    if (limit) {
      evidencesWithImages.splice(limit);
    }

    const images = evidencesWithImages.map(e => ({
      evidenceId: e.evidenceId,
      imageUrl: e.imageUrl,
      thumbnailUrl: e.thumbnailUrl,
      title: e.title,
      source: e.source,
      url: e.url,
      reliability: e.reliability,
      matchConfidence: e.matchConfidence,
      fetchedAt: e.fetchedAt,
    }));

    return {
      searchId,
      total: images.length,
      images,
    };
  }

  /**
   * GET /api/v1/osint/evidence/:searchId/visual-summary
   * Resumen visual de una búsqueda con imágenes destacadas
   */
  @Get('evidence/:searchId/visual-summary')
  @ApiOperation({ 
    summary: 'Resumen visual con imágenes destacadas',
    description: 'Top imágenes por relevancia para visualización rápida'
  })
  @ApiParam({ name: 'searchId', description: 'ID de búsqueda' })
  async getVisualSummary(@Param('searchId') searchId: string, @CurrentUser() user: CaseActor) {
    await this.caseAccess.assertSearch(searchId, user);
    this.logger.log(`Getting visual summary for search ${searchId}...`);

    const evidences = await this.evidenceService.getEvidenceBySearch(searchId);
    const stats = await this.evidenceService.getEvidenceStats(searchId);
    const scores = this.scoringService.computeScores(evidences);

    // Top imágenes por reliability y match confidence
    const topImages = evidences
      .filter(e => e.imageUrl || e.thumbnailUrl)
      .sort((a, b) => {
        const scoreA = (a.reliability || 0) * (a.matchConfidence || 0.5);
        const scoreB = (b.reliability || 0) * (b.matchConfidence || 0.5);
        return scoreB - scoreA;
      })
      .slice(0, 12)
      .map(e => ({
        evidenceId: e.evidenceId,
        imageUrl: e.imageUrl,
        thumbnailUrl: e.thumbnailUrl,
        title: e.title,
        source: e.source,
        reliability: e.reliability,
        matchConfidence: e.matchConfidence,
      }));

    return {
      searchId,
      scores,
      stats: {
        totalEvidences: stats.total,
        imagesFound: evidences.filter(e => e.imageUrl).length,
        averageReliability: stats.averageReliability,
      },
      topImages,
      categories: stats.byCategory,
      sources: stats.bySource,
    };
  }

  /**
   * POST /api/v1/osint/search/by-image
   * Búsqueda OSINT solo por imagen (reverse image search)
   */
  @Post('search/by-image')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Búsqueda solo por imagen',
    description: 'Búsqueda inversa de imágenes con Yandex (modo imagen-only)'
  })
  @ApiResponse({ status: 201, description: 'Búsqueda creada', type: OsintSearchResponseDto })
  async searchByImage(
    @Body() input: { imageUrl?: string; imageBase64?: string; datasecImageId?: string; datasecCameraId?: string; datasecPersonId?: string; searchDatasec?: boolean; userId?: string },
    @CurrentUser() user: CaseActor,
  ) {
    this.logger.log('📸 Creating image-only search...');

    const visualInput = await this.resolveVisualInput(input);
    if (!visualInput.imageUrl && !visualInput.imageBase64) {
      throw new Error('imageUrl, imageBase64 or datasecImageId required');
    }

    // Crear búsqueda OSINT con imagen — generateEnhanced MUST be true
    // so the image gets uploaded to Cloudinary and a public URL is generated
    // for Yandex reverse image search in image-only mode
    const expandedInput: ExpandedPersonSearchDto = {
      image: {
        source: 'upload',
        url: visualInput.imageUrl,
        base64: visualInput.imageBase64,
      },
      options: {
        searchEngines: ['yandex'],
        reverseImageSearch: true,
        deepSearch: false,
        youtubeSearch: false,
        webArchiveSearch: false,
        imageOnlyMode: true,
        generateEnhanced: true,
      } as any,
      userId: input.userId,
    } as any;

    const created = await this.createSearch(expandedInput, user);
    const datasec = await this.getDatasecContext(input);
    return {
      ...created,
      datasec,
    };
  }

  /**
   * POST /api/v1/osint/search/face
   * Búsqueda OSINT por rostro — pipeline completo tipo PimEyes
   * detect → crop → upload → reverse search → face match
   */
  @Post('search/face')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Búsqueda facial tipo PimEyes',
    description: 'Detecta rostro, recorta, sube a Cloudinary, busca en Yandex/Google/TinEye/FaceCheck'
  })
  @ApiResponse({ status: 201, description: 'Búsqueda facial completada' })
  async searchByFace(@Body() input: { imageUrl?: string; imageBase64?: string; datasecImageId?: string; datasecCameraId?: string; datasecPersonId?: string; searchDatasec?: boolean; userId?: string }, @CurrentUser() user: CaseActor) {
    input.userId = this.caseAccess.actorId(user);
    this.logger.log('🧠 Creating face search...');

    const visualInput = await this.resolveVisualInput(input);
    if (!visualInput.imageUrl && !visualInput.imageBase64) {
      return {
        error: 'imageUrl, imageBase64 or datasecImageId required',
        statusCode: 400,
      };
    }

    try {
    // 1. Crear search document primero (para tener searchId)
    const expandedInput: ExpandedPersonSearchDto = {
      image: {
        source: 'upload',
        url: visualInput.imageUrl,
        base64: visualInput.imageBase64,
      },
      options: {
        searchEngines: ['duckduckgo'],
        reverseImageSearch: true,
        deepSearch: false,
        youtubeSearch: false,
        webArchiveSearch: false,
        generateEnhanced: false, // Face search has its own pipeline — don't waste Gemini quota
      } as any,
      userId: input.userId,
    } as any;

    this.logger.log(`🧠 Face search input: imageUrl=${!!visualInput.imageUrl}, imageBase64=${!!visualInput.imageBase64} (${visualInput.imageBase64 ? (visualInput.imageBase64.length / 1024).toFixed(0) + 'KB' : '0'})`);

    const search = await this.inputOrchestrator.processInput(expandedInput);
    const searchId = search._id.toString();
    this.logger.log(`🧠 Face search document created: ${searchId}`);

    // 2. Ejecutar face search pipeline
    const faceResult = await this.faceSearchService.executeFaceSearch(
      searchId,
      visualInput.imageBase64,
      search.imageUrl || visualInput.imageUrl,
    );

    this.logger.log(`🧠 Face search pipeline complete: ${faceResult.totalMatches} matches, ${faceResult.searchEnginesUsed.length} engines, ${faceResult.processingTime}ms`);

    // 3. Ejecutar también el multi-search normal en paralelo
    this.multiSearchOrchestrator
      .executeSearch(searchId)
      .catch((error) => this.logger.error(`Multi-search failed: ${error.message}`));

    const datasec = await this.getDatasecContext(input);

    return {
      searchId,
      status: 'processing',
      faceSearch: {
        facesDetected: faceResult.facesDetected,
        originalImageUrl: faceResult.originalImageUrl,
        croppedFaceUrl: faceResult.croppedFaceUrl,
        totalMatches: faceResult.totalMatches,
        matches: faceResult.matches.slice(0, 20), // Top 20
        socialProfiles: faceResult.socialProfiles,
        searchEnginesUsed: faceResult.searchEnginesUsed,
        processingTime: faceResult.processingTime,
      },
      datasec,
    };
    } catch (error) {
      this.logger.error(`🧠 Face search FAILED: ${error.message}`, error.stack);
      return {
        error: `Face search pipeline error: ${error.message}`,
        statusCode: 500,
      };
    }
  }

  /**
   * POST /api/v1/osint/face-jobs
   * Investigación facial por job: Redis, progreso, reintentos y consulta por polling.
   */
  @Post('face-jobs')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crear investigación facial por job',
    description: 'Encola una búsqueda facial larga con progreso consultable para UI agentica.',
  })
  async createFaceJob(@Body() input: {
    imageUrl?: string;
    imageBase64?: string;
    datasecImageId?: string;
    datasecCameraId?: string;
    datasecPersonId?: string;
    searchDatasec?: boolean;
    userId?: string;
    firstName?: string;
    lastName?: string;
    username?: string;
    profileUrls?: string[];
    mode?: 'quick' | 'standard' | 'deep' | 'custom';
    maxRuntimeMs?: number;
    maxCandidates?: number;
    minCandidateScore?: number;
    platforms?: string[];
    selectedFace?: {
      faceId?: string;
      selectionToken?: string;
      publicId?: string;
      original?: { publicId?: string };
    };
  }, @CurrentUser() user: CaseActor) {
    this.logger.log('🧠 Queueing face investigation job...');
    input.userId = this.caseAccess.actorId(user);

    const visualInput = await this.resolveVisualInput(input);
    if (!visualInput.imageUrl && !visualInput.imageBase64) {
      throw new BadRequestException('imageUrl, imageBase64 or datasecImageId required');
    }
    if (!visualInput.imageUrl || !this.visualFaceSelection.verifySelection(
      String(input.selectedFace?.faceId || ''),
      visualInput.imageUrl,
      String(input.selectedFace?.selectionToken || ''),
    )) {
      throw new BadRequestException('Primero verifica y selecciona un rostro detectado antes de iniciar la búsqueda.');
    }

    const persistedImage = await this.persistFaceJobImage(visualInput.imageBase64, visualInput.imageUrl);

    const job = await this.faceInvestigationJobs.enqueue({
      imageUrl: persistedImage.imageUrl,
      tempImagePublicId: persistedImage.publicId,
      tempImageTemporary: persistedImage.temporary,
      datasecImageId: input.datasecImageId,
      datasecCameraId: input.datasecCameraId,
      datasecPersonId: input.datasecPersonId,
      searchDatasec: input.searchDatasec,
      userId: input.userId,
      firstName: input.firstName,
      lastName: input.lastName,
      username: input.username,
      profileUrls: input.profileUrls,
      mode: input.mode,
      maxRuntimeMs: input.maxRuntimeMs,
      maxCandidates: input.maxCandidates,
      minCandidateScore: input.minCandidateScore,
      platforms: input.platforms,
      selectedFace: input.selectedFace,
      custodyPublicIds: [
        input.selectedFace?.publicId,
        input.selectedFace?.original?.publicId,
        persistedImage.publicId,
      ].filter(Boolean) as string[],
    });

    const datasec = await this.getDatasecContext(input);
    return {
      ...job,
      datasec,
    };
  }

  @Post('evidence/:evidenceId/enrich-image')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Intentar recuperar y custodiar la imagen pública de un perfil verificado' })
  async enrichEvidenceImage(@Param('evidenceId') evidenceId: string, @CurrentUser() user: CaseActor) {
    await this.caseAccess.assertEvidence(evidenceId, user);
    return this.evidenceService.enrichMissingImage(evidenceId);
  }

  @Get('identity-memory/subjects/:searchId')
  @ApiOperation({ summary: 'Consultar sujeto objetivo y candidatos separados de una investigación facial' })
  async getIdentityMemorySubject(@Param('searchId') searchId: string, @CurrentUser() user: CaseActor) {
    await this.caseAccess.assertSearch(searchId, user);
    return this.identityMemory.getSubject(searchId);
  }

  @Post('identity-memory/subjects/:searchId/preserve-candidates')
  @ApiOperation({ summary: 'Preservar imágenes accesibles de candidatos todavía no confirmados' })
  async preserveIdentityCandidates(@Param('searchId') searchId: string, @CurrentUser() user: CaseActor) {
    await this.caseAccess.assertSearch(searchId, user);
    return this.identityMemory.preserveSubjectCandidates(searchId);
  }

  @Post('identity-memory/subjects/:searchId/views')
  @ApiOperation({ summary: 'Agregar y validar otra vista facial del mismo sujeto objetivo' })
  async addIdentitySubjectView(
    @Param('searchId') searchId: string,
    @Body() body: { imageBase64?: string; imageUrl?: string; acceptMismatch?: boolean },
    @CurrentUser() user: CaseActor,
  ) {
    await this.caseAccess.assertSearch(searchId, user);
    if (!body?.imageBase64 && !body?.imageUrl) throw new BadRequestException('imageBase64 or imageUrl is required');
    return this.identityMemory.addSubjectView(searchId, body);
  }

  @Patch('identity-memory/candidates/:candidateId/review')
  @ApiOperation({ summary: 'Revisar un candidato sin fusionarlo automáticamente' })
  async reviewIdentityCandidate(
    @Param('candidateId') candidateId: string,
    @Body() body: { status: 'probable' | 'confirmed' | 'rejected'; personId?: string; reason?: string },
    @CurrentUser() user: { userId?: string; username?: string },
  ) {
    await this.caseAccess.assertCandidate(candidateId, user);
    return this.identityMemory.reviewCandidate(
      candidateId,
      body.status,
      user?.userId || user?.username || 'authenticated-user',
      String(body.reason || ''),
      body.personId,
    );
  }

  @Post('visual/detect-faces')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Detectar rostros seleccionables',
    description: 'Guarda la imagen original, detecta rostros, crea crops y devuelve candidatos para que el usuario elija a quién buscar.',
  })
  async detectSelectableFaces(@Body() input: {
    imageUrl?: string;
    imageBase64?: string;
    datasecImageId?: string;
    userId?: string;
    label?: string;
  }, @CurrentUser() user: CaseActor) {
    this.logger.log('🧭 Detecting selectable faces...');
    input.userId = this.caseAccess.actorId(user);
    return this.visualFaceSelection.detectFaces(input);
  }

  @Get('face-jobs/stats')
  @ApiOperation({ summary: 'Estado de cola de investigaciones faciales' })
  async getFaceJobStats() {
    return this.faceInvestigationJobs.getStats();
  }

  @Get('face-jobs/:jobId')
  @ApiOperation({ summary: 'Consultar progreso de investigación facial' })
  async getFaceJob(@Param('jobId') jobId: string, @CurrentUser() user: CaseActor) {
    await this.caseAccess.assertSearch(jobId, user);
    return this.faceInvestigationJobs.getJob(jobId);
  }

  @Post('face-jobs/:jobId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancelar investigación facial' })
  async cancelFaceJob(@Param('jobId') jobId: string, @CurrentUser() user: CaseActor) {
    await this.caseAccess.assertSearch(jobId, user);
    return this.faceInvestigationJobs.cancel(jobId);
  }

  private async persistFaceJobImage(imageBase64?: string, imageUrl?: string) {
    if (!imageBase64) {
      return { imageUrl, publicId: undefined, temporary: false };
    }

    const dataUri = imageBase64.startsWith('data:')
      ? imageBase64
      : `data:image/jpeg;base64,${imageBase64}`;
    const tempId = `face-job-${Date.now()}`;
    const upload = await this.cloudinaryService.uploadBase64(
      dataUri,
      `${this.storagePath.safeSegment(tempId)}-source`,
      {
        folder: `face-jobs/${this.storagePath.safeSegment(tempId)}/source`,
        tags: ['face-job', 'source'],
        context: { scope: 'face-investigation-job' },
      },
    );

    return { imageUrl: upload.secureUrl, publicId: upload.publicId, temporary: true };
  }

  private async resolveVisualInput(input: { imageUrl?: string; imageBase64?: string; datasecImageId?: string }) {
    if (input.imageUrl || input.imageBase64 || !input.datasecImageId) {
      const imageUrl = input.imageUrl
        ? await this.securityValidation.validatePublicUrl(input.imageUrl, {
            field: 'imageUrl',
            allowLocalUploads: true,
          })
        : undefined;
      if (input.imageBase64) this.securityValidation.validateImageBase64(input.imageBase64, { field: 'imageBase64' });
      return {
        imageUrl,
        imageBase64: input.imageBase64,
      };
    }

    const internalAsset = await this.datasecCuration.resolveAssetImageUrl(input.datasecImageId).catch(() => null);
    if (internalAsset?.imageUrl) {
      return {
        imageUrl: await this.securityValidation.validatePublicUrl(internalAsset.imageUrl, {
          field: 'datasecImageId',
          allowLocalUploads: true,
        }),
        imageBase64: undefined,
      };
    }

    const datasecImage = await this.datasecProxy.getImageById(input.datasecImageId);
    if (!datasecImage?.url) {
      throw new BadRequestException(`Datasec image not found: ${input.datasecImageId}`);
    }

    return {
      imageUrl: await this.securityValidation.validatePublicUrl(datasecImage.url, {
        field: 'datasecImageId',
        allowLocalUploads: true,
      }),
      imageBase64: undefined,
    };
  }

  private async getDatasecContext(input: { datasecImageId?: string; datasecCameraId?: string; datasecPersonId?: string; searchDatasec?: boolean }) {
    if (!input.searchDatasec && !input.datasecImageId && !input.datasecCameraId && !input.datasecPersonId) {
      return null;
    }

    try {
      const internalSourceImage = input.datasecImageId
        ? await this.datasecCuration.resolveAssetImageUrl(input.datasecImageId).catch(() => null)
        : null;
      const internalCandidates = await this.searchInternalDatasecCandidates(input).catch(() => []);
      const [sourceImage, faceCrops, candidates] = await Promise.all([
        internalSourceImage
          ? Promise.resolve({
              id: internalSourceImage.assetId,
              url: internalSourceImage.imageUrl,
              source: 'datasec-internal',
              title: internalSourceImage.title,
              curationStatus: internalSourceImage.curationStatus,
            })
          : input.datasecImageId ? this.datasecProxy.getImageById(input.datasecImageId).catch(() => null) : Promise.resolve(null),
        internalSourceImage ? Promise.resolve([]) : input.datasecImageId ? this.datasecProxy.getFaceCrops(input.datasecImageId).catch(() => []) : Promise.resolve([]),
        this.searchDatasecCandidates(input).catch(() => []),
      ]);
      const mergedCandidates = this.mergeDatasecCandidates(internalCandidates, candidates);

      return {
        enabled: true,
        sourceImage,
        faceCrops,
        candidates: mergedCandidates.slice(0, 24),
        totalCandidates: mergedCandidates.length,
        internalCandidates: internalCandidates.length,
      };
    } catch (error: any) {
      return {
        enabled: false,
        error: error?.message || 'Datasec context failed',
        candidates: [],
        faceCrops: [],
        totalCandidates: 0,
      };
    }
  }

  private async searchDatasecCandidates(input: { datasecCameraId?: string; datasecPersonId?: string; searchDatasec?: boolean }) {
    if (input.datasecPersonId) {
      return this.datasecProxy.getImagesByPerson(input.datasecPersonId);
    }
    if (input.datasecCameraId) {
      return this.datasecProxy.getRecentImages(input.datasecCameraId, 24);
    }
    if (input.searchDatasec) {
      return this.datasecProxy.getImagesWithFaces(50);
    }
    return [];
  }

  private async searchInternalDatasecCandidates(input: { datasecPersonId?: string; searchDatasec?: boolean }) {
    if (input.datasecPersonId || input.searchDatasec) {
      return this.datasecCuration.listFaceCandidates({
        personId: input.datasecPersonId,
        limit: 50,
      });
    }
    return [];
  }

  private mergeDatasecCandidates(internalCandidates: any[], externalCandidates: any[]) {
    const seen = new Set<string>();
    return [...internalCandidates, ...externalCandidates].filter((item: any) => {
      const key = String(item?.id || item?.url || item?.secureUrl || '');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ========================================
  // INTERNAL / NETWORK DIAGNOSTICS
  // ========================================

  /**
   * GET /api/v1/osint/internal/network-stats
   * Real-time stats: global governor, per-domain queues, circuit breakers, cache, latency
   */
  @Get('internal/network-stats')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Network scheduler real-time stats',
    description: 'Returns global governor metrics, per-domain queue stats, circuit breaker states, cache size, and latency info.',
  })
  @ApiResponse({ status: 200, description: 'Network stats' })
  getNetworkStats() {
    return this.networkScheduler.getStats();
  }

  /**
   * GET /api/v1/osint/internal/network-ledger
   * Request audit ledger (hashed queries, no PII)
   */
  @Get('internal/network-ledger')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Network request audit ledger',
    description: 'Returns last 500 network events with hashed queries (OPSEC-safe, no PII).',
  })
  @ApiResponse({ status: 200, description: 'Network ledger' })
  @ApiQuery({ name: 'domain', required: false, description: 'Filter by domain' })
  getNetworkLedger(@Query('domain') domain?: string) {
    const ledger = this.networkScheduler.getLedger();
    if (domain) {
      return ledger.filter(e => e.domain === domain);
    }
    return ledger;
  }

  /**
   * POST /api/v1/osint/internal/case-profile
   * Apply a case profile: silent | stealth | standard | aggressive
   */
  @Post('internal/case-profile')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Apply case profile to network scheduler',
    description: 'Changes global concurrency, rate limits, delays, and stealth behavior. Options: silent, stealth, standard, aggressive.',
  })
  @ApiResponse({ status: 200, description: 'Profile applied' })
  applyCaseProfile(@Body() body: { profile: string }) {
    const profileName = body.profile || 'standard';
    this.networkScheduler.applyCaseProfile(profileName);
    return {
      applied: profileName,
      profile: this.networkScheduler.getCaseProfile(),
      stats: this.networkScheduler.getStats()?._global,
    };
  }

  // ========================================
  // META / FACEBOOK OSINT 📘
  // ========================================

  /**
   * POST /api/v1/osint/meta/search
   * Pipeline Meta/Facebook OSINT: Profile + Page Details + Posts
   */
  @Post('meta/search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Meta/Facebook OSINT Pipeline',
    description: 'Obtiene perfil, detalles de página y posts recientes de Facebook via RapidAPI. 3 endpoints en paralelo, sin LLM.',
  })
  @ApiResponse({ status: 200, description: 'Resultados del pipeline Meta' })
  async executeMetaSearch(@Body() dto: MetaSearchDto) {
    this.logger.log(`📘 Meta search: "${dto.username}"`);
    try {
      const result = await this.metaIntelligence.executePipeline(dto);
      return {
        success: true,
        ...result,
      };
    } catch (error: any) {
      this.logger.error(`❌ Meta pipeline error: ${error.message}`, error.stack);
      return {
        success: false,
        message: error.message || 'Error ejecutando Meta OSINT pipeline',
        username: dto.username,
      };
    }
  }

  /**
   * GET /api/v1/osint/meta/health
   * Health check de Meta OSINT (RapidAPI)
   */
  @Get('meta/health')
  @ApiOperation({
    summary: 'Meta OSINT Health Check',
    description: 'Verifica disponibilidad del servicio Meta/Facebook OSINT',
  })
  async metaHealth() {
    try {
      const health = await this.metaIntelligence.healthCheck();
      return {
        meta: health,
      };
    } catch (error: any) {
      this.logger.error(`❌ Meta health check error: ${error.message}`);
      return {
        meta: {
          available: false,
          error: error.message,
        },
      };
    }
  }

  /**
   * POST /api/v1/osint/meta/search-fb
   * Facebook Search: people, pages, posts, global, locations
   */
  @Post('meta/search-fb')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Facebook Search (people, pages, posts, global, locations)',
    description: 'Búsqueda en Facebook via facebook-scraper3 RapidAPI',
  })
  @ApiResponse({ status: 200, description: 'Resultados de la búsqueda' })
  async executeFbSearch(@Body() dto: MetaFbSearchDto) {
    this.logger.log(`📘 FB search: type=${dto.searchType}, query="${dto.query}"`);
    try {
      const result = await this.metaIntelligence.executeSearch(dto);
      return {
        success: true,
        ...result,
      };
    } catch (error: any) {
      this.logger.error(`❌ FB search error: ${error.message}`, error.stack);
      return {
        success: false,
        message: error.message || 'Error ejecutando Facebook Search',
        query: dto.query,
      };
    }
  }

  // ========================================
  // INSTAGRAM OSINT 📸
  // ========================================

  /**
   * POST /api/v1/osint/instagram/search
   * Instagram OSINT Pipeline: Direct API + RapidAPI Stats
   */
  @Post('instagram/search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Instagram OSINT Pipeline',
    description: 'Obtiene perfil, posts, colaboradores y estadísticas de Instagram. Dual approach: Direct API + RapidAPI.',
  })
  @ApiResponse({ status: 200, description: 'Resultados del pipeline Instagram' })
  async executeInstagramSearch(@Body() dto: InstagramSearchDto) {
    this.logger.log(`📸 Instagram search: "${dto.username}"`);
    try {
      const result = await this.instagramIntelligence.executePipeline(dto);
      return {
        success: true,
        ...result,
      };
    } catch (error: any) {
      this.logger.error(`❌ Instagram pipeline error: ${error.message}`, error.stack);
      return {
        success: false,
        message: error.message || 'Error ejecutando Instagram OSINT pipeline',
        username: dto.username,
      };
    }
  }

  /**
   * GET /api/v1/osint/instagram/health
   * Health check de Instagram OSINT
   */
  @Get('instagram/health')
  @ApiOperation({
    summary: 'Instagram OSINT Health Check',
    description: 'Verifica disponibilidad del servicio Instagram OSINT (Direct API + RapidAPI)',
  })
  async instagramHealth() {
    try {
      const health = await this.instagramIntelligence.healthCheck();
      return {
        instagram: health,
      };
    } catch (error: any) {
      this.logger.error(`❌ Instagram health check error: ${error.message}`);
      return {
        instagram: {
          available: false,
          error: error.message,
        },
      };
    }
  }

  // ========================================
  // AI FACE TOOLS — Gemini
  // ========================================

  /**
   * POST /api/v1/osint/ai/enhance-image
   * Mejora imagen facial con Gemini y extrae puntos biométricos
   */
  @Post('ai/enhance-image')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mejorar imagen facial con Gemini AI' })
  async enhanceImage(@Body() body: { frontImage?: string; frontImageDatasecAssetId?: string; leftProfileImage?: string; rightProfileImage?: string; description?: string }) {
    this.logger.log('🎨 AI: enhance-image request');
    try {
      const frontImage = await this.resolveAiImageInput(body.frontImage, body.frontImageDatasecAssetId, 'frontImage');
      const result = await this.geminiImageService.generateEnhancedImage({ ...body, frontImage });
      return result;
    } catch (error: any) {
      this.logger.error(`❌ enhance-image failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * POST /api/v1/osint/ai/analyze-face
   * Analiza un rostro con Gemini: edad, género, etnia, emociones, rasgos
   */
  @Post('ai/analyze-face')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Analizar rostro con Gemini AI' })
  async analyzeFace(@Body() body: { imageUrl?: string; imageDatasecAssetId?: string }) {
    this.logger.log('👤 AI: analyze-face request');
    try {
      const imageUrl = await this.resolveAiImageInput(body.imageUrl, body.imageDatasecAssetId, 'imageUrl');
      const result = await this.geminiImageService.analyzeFacialFeatures(imageUrl);
      return result;
    } catch (error: any) {
      this.logger.error(`❌ analyze-face failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * POST /api/v1/osint/ai/compare-faces
   * Compara dos rostros con Gemini y determina si son la misma persona
   */
  @Post('ai/compare-faces')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Comparar dos rostros con Gemini AI' })
  async compareFaces(@Body() body: { imageUrl1?: string; imageUrl2?: string; imageDatasecAssetId1?: string; imageDatasecAssetId2?: string }) {
    this.logger.log('🔍 AI: compare-faces request');
    try {
      const imageUrl1 = await this.resolveAiImageInput(body.imageUrl1, body.imageDatasecAssetId1, 'imageUrl1');
      const imageUrl2 = await this.resolveAiImageInput(body.imageUrl2, body.imageDatasecAssetId2, 'imageUrl2');
      const result = await this.geminiImageService.compareFaces(imageUrl1, imageUrl2);
      return result;
    } catch (error: any) {
      this.logger.error(`❌ compare-faces failed: ${error.message}`);
      throw error;
    }
  }

  private async resolveAiImageInput(image?: string, datasecAssetId?: string, fieldName = 'image'): Promise<string> {
    const directImage = String(image || '').trim();
    const assetId = String(datasecAssetId || '').trim();

    if (directImage) {
      if (directImage.startsWith('http://') || directImage.startsWith('https://')) {
        const safeImageUrl = await this.securityValidation.validatePublicUrl(directImage, {
          field: fieldName,
          allowLocalUploads: true,
        });
        if (!safeImageUrl) throw new BadRequestException(`${fieldName} is required`);
        return safeImageUrl;
      }
      this.securityValidation.validateImageBase64(directImage, { field: fieldName });
      return directImage;
    }
    if (!assetId) throw new BadRequestException(`${fieldName} or datasecAssetId is required`);

    const asset = await this.datasecCuration.resolveAssetImageUrl(assetId);
    return asset.imageUrl;
  }

  /**
   * POST /api/v1/osint/ai/reverse-image-search
   * Búsqueda inversa de imagen (Google Lens + fallback engines)
   */
  @Post('ai/reverse-image-search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Búsqueda inversa de imagen con motores OSINT' })
  async reverseImageSearchAI(@Body() body: { imageUrl?: string; imageBase64?: string }) {
    this.logger.log('🖼️ AI: reverse-image-search request');

    if (!body?.imageUrl && !body?.imageBase64) {
      throw new BadRequestException('imageUrl or imageBase64 is required');
    }

    try {
      const imageUrl = body.imageUrl
        ? await this.securityValidation.validatePublicUrl(body.imageUrl, {
            field: 'imageUrl',
            allowLocalUploads: true,
          })
        : undefined;
      if (body.imageBase64) this.securityValidation.validateImageBase64(body.imageBase64, { field: 'imageBase64' });
      return await this.reverseImageSearchService.searchByImage(imageUrl, body.imageBase64);
    } catch (error: any) {
      this.logger.error(`❌ reverse-image-search failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * POST /api/v1/osint/reverse-image-search
   * Alias de compatibilidad para frontend/proxy legacy
   */
  @Post('reverse-image-search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Alias de compatibilidad para reverse-image-search' })
  async reverseImageSearchCompat(@Body() body: { imageUrl?: string; imageBase64?: string }) {
    return this.reverseImageSearchAI(body);
  }
}
