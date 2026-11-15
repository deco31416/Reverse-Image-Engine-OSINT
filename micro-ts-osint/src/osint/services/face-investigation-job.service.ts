import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import RedisClient, { Redis } from 'ioredis';
import { ExpandedPersonSearchDto } from '../dto/expanded-person-search.dto';
import { FaceSearchService } from './face-search.service';
import { InputOrchestratorService } from './input-orchestrator.service';
import { MultiSearchOrchestratorService } from './multi-search-orchestrator.service';
import { CloudinaryService } from './cloudinary.service';
import { SecurityValidationService } from './security-validation.service';
import { SocialScraperClientService } from './social-scraper-client.service';
import { IdentityMemoryService } from './identity-memory.service';
import { SocialProfileDiscoveryService } from './social-profile-discovery.service';
import { VisualContextClientService } from './visual-context-client.service';
import { EvidenceService } from './evidence.service';
import { LocalJobQueue } from '../../common/local-job-queue';

type FaceJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

type FaceJobInput = {
  imageUrl?: string;
  imageBase64?: string;
  userId?: string;
  searchDatasec?: boolean;
  datasecImageId?: string;
  datasecCameraId?: string;
  datasecPersonId?: string;
  tempImagePublicId?: string;
  tempImageTemporary?: boolean;
  firstName?: string;
  lastName?: string;
  username?: string;
  profileUrls?: string[];
  mode?: 'quick' | 'standard' | 'deep' | 'custom';
  maxRuntimeMs?: number;
  maxCandidates?: number;
  minCandidateScore?: number;
  platforms?: string[];
  identityMode?: 'unknown' | 'hinted';
  custodyPublicIds?: string[];
  selectedFace?: {
    faceId?: string;
    selectionToken?: string;
    publicId?: string;
    original?: { publicId?: string };
  };
};

@Injectable()
export class FaceInvestigationJobService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FaceInvestigationJobService.name);
  private readonly prefix: string;
  private readonly concurrency: number;
  private readonly pollMs: number;
  private readonly maxAttempts: number;
  private readonly retryBackoffMs: number;
  private readonly processingTimeoutMs: number;
  private readonly tempImageTtlMs: number;
  private readonly deleteTempOnComplete: boolean;
  private readonly ownsRedis: boolean;
  private readonly active = new Set<string>();
  private readonly abortControllers = new Map<string, AbortController>();
  private stopped = false;
  private timer?: NodeJS.Timeout;
  private readonly localQueue: LocalJobQueue;

  constructor(
    @Inject('REDIS_CLIENT') private redis: Redis | null,
    private readonly configService: ConfigService,
    private readonly inputOrchestrator: InputOrchestratorService,
    private readonly faceSearchService: FaceSearchService,
    private readonly multiSearchOrchestrator: MultiSearchOrchestratorService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly securityValidation: SecurityValidationService,
    private readonly socialScraperClient: SocialScraperClientService,
    private readonly identityMemory: IdentityMemoryService,
    private readonly socialProfileDiscovery: SocialProfileDiscoveryService,
    private readonly visualContextClient: VisualContextClientService,
    private readonly evidenceService: EvidenceService,
  ) {
    this.prefix = this.configService.get<string>('FACE_JOB_QUEUE_PREFIX') || 'osint:face-jobs';
    this.concurrency = Math.max(Number(this.configService.get<string>('FACE_JOB_CONCURRENCY') || 1), 1);
    this.localQueue = new LocalJobQueue(this.concurrency);
    this.pollMs = Math.max(Number(this.configService.get<string>('FACE_JOB_POLL_MS') || 1000), 250);
    this.maxAttempts = Math.max(Number(this.configService.get<string>('FACE_JOB_MAX_ATTEMPTS') || 2), 1);
    this.retryBackoffMs = Math.max(Number(this.configService.get<string>('FACE_JOB_RETRY_BACKOFF_MS') || 30000), 1000);
    this.processingTimeoutMs = Math.max(Number(this.configService.get<string>('FACE_JOB_PROCESSING_TIMEOUT_MS') || 1800000), 60000);
    this.tempImageTtlMs = Math.max(Number(this.configService.get<string>('FACE_JOB_IMAGE_TTL_HOURS') || 24), 1) * 60 * 60 * 1000;
    this.deleteTempOnComplete = this.configService.get<string>('FACE_JOB_DELETE_TEMP_ON_COMPLETE') === 'true';

    const queueUrl = this.configService.get<string>('REDIS_QUEUE_URL');
    const redisUrl = this.configService.get<string>('REDIS_URL');
    this.ownsRedis = Boolean(queueUrl && queueUrl !== redisUrl);

    if (this.ownsRedis && queueUrl) {
      this.redis = new RedisClient(queueUrl, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      });
      this.redis
        .connect()
        .then(() => this.logger.log('Face investigation queue connected to REDIS_QUEUE_URL'))
        .catch((error) => this.logger.warn(`Face investigation Redis connection failed: ${error.message}`));
    }
  }

  onModuleInit() {
    this.stopped = false;
    this.schedule();
  }

  onModuleDestroy() {
    this.stopped = true;
    this.localQueue.close();
    for (const controller of this.abortControllers.values()) controller.abort();
    this.abortControllers.clear();
    if (this.timer) clearTimeout(this.timer);
    if (this.ownsRedis) this.redis?.disconnect();
  }

  async enqueue(input: FaceJobInput) {
    if (!this.redis) this.localQueue.assertCapacity();
    const controls = this.normalizeControls(input);
    const identityMode = this.hasIdentityHints(input) ? 'hinted' : 'unknown';
    const search = await this.createSearchDocument(input);
    const searchId = search._id.toString();
    await this.identityMemory.ensureUnknownSubject(searchId, search.imageUrl || input.imageUrl);
    const now = new Date().toISOString();
    const payload = JSON.stringify({
      imageUrl: search.imageUrl || input.imageUrl,
      userId: input.userId,
      searchDatasec: Boolean(input.searchDatasec),
      datasecImageId: input.datasecImageId,
      datasecCameraId: input.datasecCameraId,
      datasecPersonId: input.datasecPersonId,
      tempImagePublicId: input.tempImagePublicId,
      tempImageTemporary: Boolean(input.tempImageTemporary),
      firstName: input.firstName,
      lastName: input.lastName,
      username: input.username,
      profileUrls: input.profileUrls,
      identityMode,
      selectedFace: input.selectedFace,
      ...controls,
    });

    if (!this.redis) {
      const local = this.localQueue.enqueue(searchId, () => this.runDirect(searchId, payload));
      return {
        jobId: searchId,
        searchId,
        status: local.status,
        stage: 'starting',
        progress: 5,
        message: 'Investigación facial iniciada sin Redis disponible.',
        mode: 'direct-fallback',
        queuedAt: now,
      };
    }

    await this.redis
      .multi()
      .lrem(this.queueKey(), 0, searchId)
      .hset(this.statusKey(searchId), {
        jobId: searchId,
        searchId,
        status: 'queued',
        stage: 'queued',
        progress: 5,
        message: 'Investigación facial en cola.',
        events: JSON.stringify([this.jobEvent('queued', 'En cola', 'Investigación facial recibida y lista para ejecutarse.')]),
        modeProfile: controls.mode,
        maxRuntimeMs: controls.maxRuntimeMs,
        maxCandidates: controls.maxCandidates,
        minCandidateScore: controls.minCandidateScore,
        platforms: JSON.stringify(controls.platforms),
        attempts: 0,
        payload,
        queuedAt: now,
        updatedAt: now,
      })
      .rpush(this.queueKey(), searchId)
      .exec();

    this.schedule(0);

    return {
      jobId: searchId,
      searchId,
      status: 'queued' as FaceJobStatus,
      stage: 'queued',
      progress: 5,
      message: 'Investigación facial en cola.',
      mode: 'redis',
      modeProfile: controls.mode,
      maxRuntimeMs: controls.maxRuntimeMs,
      maxCandidates: controls.maxCandidates,
      minCandidateScore: controls.minCandidateScore,
      platforms: controls.platforms,
      queuedAt: now,
    };
  }

  async getJob(jobId: string) {
    if (!this.redis) {
      return {
        jobId,
        searchId: jobId,
        ...(this.localQueue.get(jobId) || { status: 'unknown' }),
        mode: 'direct-fallback',
      };
    }

    const job = await this.redis.hgetall(this.statusKey(jobId));
    if (!Object.keys(job).length) return { jobId, searchId: jobId, status: 'unknown', mode: 'redis' };
    return this.cleanJob(job);
  }

  async cancel(jobId: string) {
    const now = new Date().toISOString();
    this.abortControllers.get(jobId)?.abort();
    if (!this.redis) {
      this.localQueue.cancel(jobId);
      const cancelled = this.active.has(jobId) || this.localQueue.get(jobId)?.status === 'cancelled';
      return {
        jobId,
        searchId: jobId,
        status: cancelled ? 'cancelled' : 'unknown',
        stage: cancelled ? 'cancelled' : 'unknown',
        progress: cancelled ? 100 : 0,
        message: this.active.has(jobId) ? 'Cancelación aplicada al proceso local.' : 'Trabajo local no encontrado.',
        mode: 'direct-fallback',
      };
    }

    await this.redis
      .multi()
      .lrem(this.queueKey(), 0, jobId)
      .zrem(this.delayedKey(), jobId)
      .hset(this.statusKey(jobId), {
        status: 'cancelled',
        stage: 'cancelled',
        progress: 100,
        cancelledAt: now,
        updatedAt: now,
        message: this.active.has(jobId)
          ? 'Cancelación marcada. Si ya estaba procesando, terminará la etapa activa antes de detenerse.'
          : 'Investigación facial cancelada.',
      })
      .exec();

    return this.getJob(jobId);
  }

  async getStats() {
    if (!this.redis) {
      return {
        mode: 'direct-fallback',
        ...this.localQueue.stats(),
        maxAttempts: this.maxAttempts,
        tempImageTtlHours: Math.round(this.tempImageTtlMs / 3600000),
        deleteTempOnComplete: this.deleteTempOnComplete,
      };
    }

    const [queued, processing, delayed] = await Promise.all([
      this.redis.llen(this.queueKey()),
      this.redis.scard(this.processingKey()),
      this.redis.zcard(this.delayedKey()),
    ]);

    return {
      mode: 'redis',
      queued,
      delayed,
      processing,
      active: this.active.size,
      concurrency: this.concurrency,
      maxAttempts: this.maxAttempts,
      processingTimeoutMs: this.processingTimeoutMs,
      prefix: this.prefix,
    };
  }

  private async createSearchDocument(input: FaceJobInput) {
    const hasIdentityHints = this.hasIdentityHints(input);
    const expandedInput: ExpandedPersonSearchDto = {
      image: {
        source: 'upload',
        url: input.imageUrl,
        base64: input.imageBase64,
      },
      personalInfo: hasIdentityHints
        ? {
            nombre: input.firstName,
            apellido: input.lastName,
            username: input.username,
          } as any
        : undefined,
      context: {
        notas: hasIdentityHints
          ? 'Búsqueda facial iniciada desde el dashboard con pistas sociales opcionales.'
          : 'Investigación visual sin identidad inicial. Priorizar imagen inversa, Datasec y memoria social guardada.',
      } as any,
      options: {
        searchEngines: hasIdentityHints ? ['serper', 'tavily', 'duckduckgo', 'youtube'] : [],
        reverseImageSearch: true,
        deepSearch: hasIdentityHints,
        youtubeSearch: hasIdentityHints,
        webArchiveSearch: false,
        generateEnhanced: false,
      } as any,
      userId: input.userId,
    } as any;

    const search = await this.inputOrchestrator.processInput(expandedInput);
    search.metadata = {
      ...(search.metadata || {}),
      identityMode: hasIdentityHints ? 'hinted' : 'unknown',
      textualSearchEnabled: hasIdentityHints,
      identityHintSource: hasIdentityHints ? 'explicit_user_input' : 'none',
      custodyPublicIds: Array.from(new Set((input.custodyPublicIds || []).filter(Boolean))),
    };
    await search.save();
    return search;
  }

  private schedule(delay = this.pollMs) {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.processQueue().catch((error) => this.logger.error(`Face queue processing error: ${error.message}`));
    }, delay);
  }

  private async processQueue() {
    if (this.stopped || !this.redis) return;

    await this.recoverStaleProcessing();
    await this.releaseDelayedJobs();
    await this.cleanupExpiredTempImages();

    while (this.active.size < this.concurrency) {
      const jobId = await this.redis.rpoplpush(this.queueKey(), this.processingListKey());
      if (!jobId) break;
      if (this.active.has(jobId)) continue;
      const job = await this.redis.hgetall(this.statusKey(jobId));
      if (job.status === 'cancelled') {
        await this.redis.lrem(this.processingListKey(), 0, jobId);
        continue;
      }
      this.runRedisJob(jobId);
    }

    this.schedule();
  }

  private runRedisJob(jobId: string) {
    this.active.add(jobId);
    this.abortControllers.set(jobId, new AbortController());

    void (async () => {
      try {
        const attempts = await this.incrementAttempts(jobId);
        await this.updateJob(jobId, {
          status: 'processing',
          stage: 'starting',
          progress: 10,
          attempts,
          startedAt: new Date().toISOString(),
          message: 'Preparando imagen y motores de búsqueda.',
        });
        await this.addJobEvent(jobId, 'starting', 'Preparando imagen', 'El investigador facial está preparando la imagen y los motores.');
        await this.redis?.sadd(this.processingKey(), jobId);

        const job = await this.redis!.hgetall(this.statusKey(jobId));
        const payload = this.parsePayload(job.payload);
        await this.executeInvestigation(jobId, payload);
      } catch (error: any) {
        await this.handleJobFailure(jobId, error);
      } finally {
        await this.redis?.lrem(this.processingListKey(), 0, jobId);
        await this.redis?.srem(this.processingKey(), jobId);
        this.active.delete(jobId);
        this.abortControllers.delete(jobId);
        this.schedule(0);
      }
    })();
  }

  private runDirect(jobId: string, payload: string) {
    this.active.add(jobId);
    this.abortControllers.set(jobId, new AbortController());
    return this.executeInvestigation(jobId, this.parsePayload(payload))
      .catch((error) => { this.logger.error(`Direct face job failed (${jobId}): ${error.message}`); throw error; })
      .finally(() => {
        this.active.delete(jobId);
        this.abortControllers.delete(jobId);
      });
  }

  private async executeInvestigation(jobId: string, payload: FaceJobInput) {
    const controls = this.normalizeControls(payload);
    const jobStartedAt = Date.now();
    const deadline = jobStartedAt + controls.maxRuntimeMs;
    const runtimeImageBase64 = payload.imageBase64 || await this.loadBase64FromImageUrl(payload.imageUrl);
    const runtimePayload = { ...payload, imageBase64: runtimeImageBase64 };
    await this.stopIfCancelled(jobId, deadline);

    try {
      await this.identityMemory.addSubjectView(jobId, {
        imageBase64: runtimeImageBase64,
        imageUrl: runtimeImageBase64 ? undefined : runtimePayload.imageUrl,
      });
    } catch (error: any) {
      this.logger.warn(`Biometric subject bootstrap unavailable (${jobId}): ${error.message}`);
    }

    await this.updateJob(jobId, {
      stage: 'analyzing_image',
      progress: 18,
      message: `Analizando rostro con perfil ${controls.mode}. Presupuesto: ${Math.round(controls.maxRuntimeMs / 60000)} min.`,
    });
    await this.addJobEvent(jobId, 'analyzing_image', 'Analizando rostro', `Perfil ${controls.mode}; presupuesto ${Math.round(controls.maxRuntimeMs / 60000)} min.`);

    const visualContext = await this.awaitCancellable(
      jobId,
      this.runVisualContextAnalysis(jobId, runtimeImageBase64, deadline),
      deadline,
    );
    await this.persistVisualContextEvidence(jobId, visualContext).catch((error) => {
      this.logger.warn(`Visual context evidence could not be saved for ${jobId}: ${error?.message || error}`);
    });

    await this.updateJob(jobId, {
      stage: 'open_visual_search',
      progress: 35,
      message: 'Buscando coincidencias visuales en fuentes abiertas.',
    });
    await this.addJobEvent(jobId, 'open_visual_search', 'Buscando coincidencias', 'Revisando fuentes abiertas y motores de imagen inversa.');

    const preDiscovery = await this.awaitCancellable(
      jobId,
      this.runSocialDiscovery(jobId, runtimePayload, controls, 42, deadline),
      deadline,
    );

    const faceResult = await this.awaitCancellable(jobId, this.faceSearchService.executeFaceSearch(
      jobId,
      runtimePayload.imageBase64,
      runtimePayload.imageUrl,
      {
        socialPlatforms: controls.platforms,
        socialLimit: Math.min(controls.maxCandidates, 50),
      },
    ), deadline);
    const effectiveFacesDetected = Math.max(Number(faceResult.facesDetected || 0), payload.selectedFace?.faceId ? 1 : 0);
    await this.stopIfCancelled(jobId, deadline);
    const bridgeDiscovery = await this.awaitCancellable(
      jobId,
      this.discoverSocialProfilesFromVisualPages(jobId, controls, faceResult.matches, 66, deadline),
      deadline,
    );
    const socialSeedMatches = [
      ...faceResult.matches,
      ...bridgeDiscovery.matches,
    ];
    const postDiscovery = await this.awaitCancellable(
      jobId,
      this.resolveSocialUrlsAndCompare(jobId, runtimePayload, controls, socialSeedMatches, 74, deadline),
      deadline,
    );
    if (postDiscovery.matches.length) {
      faceResult.matches.push(...postDiscovery.matches);
      faceResult.matches = this.dedupeFaceMatches(faceResult.matches);
      faceResult.totalMatches = faceResult.matches.length;
      faceResult.socialScraper = {
        available: true,
        total: (faceResult.socialScraper?.total || 0) + postDiscovery.matches.length,
        matches: [...(faceResult.socialScraper?.matches || []), ...postDiscovery.rawMatches],
        profiles: [...(faceResult.socialScraper?.profiles || []), ...postDiscovery.profiles],
      };
    }
    const nonNoisyMatches = faceResult.matches.filter((match) => !this.isNoisyVisualMatch(match));
    const noiseFiltered = Math.max((faceResult.matches || []).length - nonNoisyMatches.length, 0);
    const reviewCandidates = this.selectVisualReviewCandidates(faceResult.matches, controls.maxCandidates);
    const filteredMatches = nonNoisyMatches
      .filter((match) => Number(match.similarity || 0) >= controls.minCandidateScore)
      .map((match) => ({
        ...match,
        confidenceBand: this.faceConfidenceBand(Number(match.similarity || 0)),
      }))
      .slice(0, controls.maxCandidates);
    await this.identityMemory.addVisualCandidates(
      jobId,
      filteredMatches,
      () => this.stopIfCancelled(jobId, deadline),
    );
    if (reviewCandidates.length) {
      await this.identityMemory.addVisualCandidates(
        jobId,
        reviewCandidates,
        () => this.stopIfCancelled(jobId, deadline),
      );
      await this.persistVisualReviewCandidateEvidence(jobId, reviewCandidates).catch((error) => {
        this.logger.warn(`Visual review candidate evidence could not be saved for ${jobId}: ${error?.message || error}`);
      });
    }

    await this.updateJob(jobId, {
      stage: 'background_osint',
      progress: 82,
      message: 'Cruzando resultados con motores OSINT y evidencias del caso.',
      facesDetected: effectiveFacesDetected,
      matchesFound: filteredMatches.length,
      enginesUsed: JSON.stringify(faceResult.searchEnginesUsed || []),
      socialProfiles: JSON.stringify(faceResult.socialProfiles || {}),
      faceResult: JSON.stringify({
        facesDetected: effectiveFacesDetected,
        rawFacesDetected: faceResult.facesDetected,
        originalImageUrl: faceResult.originalImageUrl,
        croppedFaceUrl: faceResult.croppedFaceUrl,
        totalMatches: filteredMatches.length,
        rawMatches: faceResult.totalMatches,
        matches: filteredMatches,
        socialProfiles: faceResult.socialProfiles,
        socialScraper: faceResult.socialScraper,
        searchEnginesUsed: faceResult.searchEnginesUsed,
        processingTime: faceResult.processingTime,
        controls,
        visualContext,
        discovery: {
          beforeVisualCompare: preDiscovery,
          visualToSocialBridge: {
            ...bridgeDiscovery.summary,
            profiles: bridgeDiscovery.profiles.slice(0, 20),
          },
          afterSocialUrls: postDiscovery.summary,
          noiseFiltered,
          reviewCandidates: reviewCandidates.map((match) => ({
            title: match.title,
            url: match.url,
            imageUrl: match.imageUrl || match.thumbnailUrl,
            source: match.source,
            domain: match.domain || this.extractDomain(match.url || ''),
            similarity: match.similarity,
            confidenceBand: match.confidenceBand,
            reviewReason: match.reviewReason,
          })).slice(0, 25),
        },
      }),
    });
    await this.addJobEvent(
      jobId,
      'background_osint',
      'Validando candidatos',
      `${filteredMatches.length} candidatos superaron el filtro inicial. ${noiseFiltered} resultados genéricos fueron descartados.`,
    );
    if (reviewCandidates.length) {
      await this.addJobEvent(
        jobId,
        'visual_review_candidates_saved',
        'Candidatos en revisión guardados',
        `${reviewCandidates.length} candidatos visuales fuertes fueron guardados para contexto/Datasec sin marcarlos como identidad confirmada.`,
      );
    }

    await this.stopIfCancelled(jobId, deadline);
    const hasIdentityHints = this.hasIdentityHints(payload);
    if (hasIdentityHints && Date.now() - jobStartedAt < controls.maxRuntimeMs) {
      await this.awaitCancellable(jobId, this.multiSearchOrchestrator.executeSearch(jobId), deadline);
    } else if (!hasIdentityHints) {
      await this.updateJob(jobId, {
        stage: 'visual_only_complete',
        message: 'Cruce textual omitido: el rostro no tiene identidad ni perfil aportado por el usuario.',
      });
      await this.addJobEvent(
        jobId,
        'visual_only_complete',
        'Búsqueda solo visual',
        'No se usó el nombre del archivo o del caso como nombre, alias o username.',
      );
    } else {
      await this.updateJob(jobId, {
        stage: 'budget_exhausted',
        message: 'Se agotó el presupuesto de tiempo antes del cruce OSINT final.',
      });
      await this.addJobEvent(jobId, 'budget_exhausted', 'Presupuesto agotado', 'Se cerró antes del cruce OSINT final por límite de tiempo.');
    }

    await this.stopIfCancelled(jobId, deadline);
    const completedAt = new Date().toISOString();
    await this.cleanupTempImageIfConfigured(jobId, payload);
    await this.updateJob(jobId, {
      status: 'completed',
      stage: filteredMatches.length > 0 ? 'completed_with_candidates' : 'completed_without_candidates',
      progress: 100,
      completedAt,
      tempImageExpiresAt: payload.tempImageTemporary && !this.deleteTempOnComplete
        ? new Date(Date.now() + this.tempImageTtlMs).toISOString()
        : '',
      tempImageCleanedAt: payload.tempImageTemporary && this.deleteTempOnComplete
        ? new Date().toISOString()
        : '',
      message: filteredMatches.length > 0
        ? `Investigación finalizada con ${filteredMatches.length} candidatos visuales.`
        : 'Investigación finalizada sin coincidencias confiables.',
      processingTimeMs: String(faceResult.processingTime),
      error: '',
    });
    await this.addJobEvent(
      jobId,
      'completed',
      filteredMatches.length > 0 ? 'Finalizado con candidatos' : 'Finalizado sin coincidencias',
      filteredMatches.length > 0
        ? `Se encontraron ${filteredMatches.length} candidatos visuales.`
        : 'No se encontraron coincidencias confiables con el umbral seleccionado.',
    );
  }

  private async cleanupTempImageIfConfigured(jobId: string, payload: FaceJobInput) {
    if (!this.deleteTempOnComplete || !payload.tempImageTemporary || !payload.tempImagePublicId) return;
    await this.deleteTempImage(jobId, payload.tempImagePublicId);
  }

  private async runVisualContextAnalysis(jobId: string, imageBase64: string | undefined, deadline: number) {
    const empty = {
      available: false,
      detections: 0,
      people: 0,
      labels: {},
      contextTags: [] as string[],
      warnings: [] as string[],
    };

    if (!imageBase64 || !this.visualContextClient.isAvailable()) return empty;
    await this.stopIfCancelled(jobId, deadline);
    await this.addJobEvent(
      jobId,
      'visual_context',
      'Contexto visual',
      'Analizando persona, objetos, ropa, gorras, vehículos y señales visuales para enriquecer la búsqueda.',
    );

    const context = await this.visualContextClient.analyzeImage(imageBase64, {
      includeCrops: false,
      confidence: 0.25,
      maxDetections: 80,
    });
    if (!context) return empty;

    await this.addJobEvent(
      jobId,
      'visual_context_done',
      'Contexto visual listo',
      `${context.summary?.total || 0} detecciones; etiquetas: ${(context.summary?.contextTags || []).slice(0, 8).join(', ') || 'sin etiquetas'}.`,
    );

    return {
      available: Boolean(context.yoloAvailable),
      model: context.model,
      detections: context.summary?.total || context.detections?.length || 0,
      people: context.summary?.people || 0,
      labels: context.summary?.labels || {},
      contextTags: context.summary?.contextTags || [],
      topDetections: (context.detections || []).slice(0, 20).map((item) => ({
        label: item.label,
        confidence: item.confidence,
        box: item.box,
      })),
      warnings: context.warnings || [],
    };
  }

  private async persistVisualContextEvidence(searchId: string, visualContext: any) {
    if (!visualContext || visualContext.available === false) return;

    const labels = visualContext.labels && typeof visualContext.labels === 'object'
      ? Object.entries(visualContext.labels)
          .map(([label, count]) => `${this.humanVisualLabel(label)} x${Number(count) || 0}`)
          .slice(0, 10)
      : [];
    const topDetections = Array.isArray(visualContext.topDetections)
      ? visualContext.topDetections.slice(0, 10)
      : [];
    const detectionSummary = topDetections
      .map((item: any) => `${this.humanVisualLabel(item.label)} ${Math.round(Number(item.confidence || 0) * 100)}%`)
      .filter(Boolean)
      .slice(0, 6);
    const tags = [
      'rostro',
      'contexto-visual',
      'sensor-yolo',
      ...(Array.isArray(visualContext.contextTags) ? visualContext.contextTags : []),
    ].map((tag) => String(tag).toLowerCase().replace(/\s+/g, '-')).slice(0, 20);

    await this.evidenceService.saveEvidence(searchId, {
      source: 'visual_context_yolo',
      category: 'visual_context' as any,
      title: '[VISUAL] Contexto de escena detectado',
      summary: [
        `Personas detectadas: ${Number(visualContext.people || 0)}.`,
        labels.length ? `Etiquetas: ${labels.join(', ')}.` : '',
        detectionSummary.length ? `Detecciones principales: ${detectionSummary.join(', ')}.` : '',
        'Evidencia auxiliar: no confirma identidad por sí sola; sirve para priorizar y comparar contexto operativo.',
      ].filter(Boolean).join(' '),
      reliability: 0.72,
      signals: {
        identity: Number(visualContext.people || 0) > 0 ? 1 : 0,
        legal: 0,
        financial: 0,
        social: 0,
      },
      tags: Array.from(new Set(tags)),
      extractedData: {
        visualContext: {
          model: visualContext.model,
          people: visualContext.people,
          labels: visualContext.labels,
          contextTags: visualContext.contextTags,
          topDetections,
          warnings: visualContext.warnings,
        },
      } as any,
      fetchedAt: new Date(),
      validationStatus: 'pending',
    });
  }

  private async persistVisualReviewCandidateEvidence(searchId: string, candidates: any[]) {
    for (const [index, candidate] of candidates.slice(0, 20).entries()) {
      const score = Number(candidate.similarity || 0);
      const domain = candidate.domain || this.extractDomain(candidate.url || '');
      await this.evidenceService.saveEvidence(searchId, {
        source: candidate.source || 'visual_review_candidate',
        category: 'identity',
        title: `[REVIEW] ${candidate.title || `Candidato visual ${index + 1}`}`,
        summary: [
          `Candidato visual fuerte para revisión contextual (${Math.round(score * 100)}%).`,
          domain ? `Dominio: ${domain}.` : '',
          candidate.reviewReason ? `Razón: ${candidate.reviewReason}.` : '',
          'No confirma identidad; debe abrirse la fuente, extraer contexto/nombres/redes y comparar nuevamente contra el rostro.',
        ].filter(Boolean).join(' '),
        url: candidate.url,
        imageUrl: candidate.imageUrl || candidate.thumbnailUrl,
        thumbnailUrl: candidate.thumbnailUrl || candidate.imageUrl,
        matchConfidence: score,
        reliability: score >= 0.95 ? 0.58 : 0.52,
        signals: {
          identity: score >= 0.95 ? 2 : 1,
          legal: 0,
          financial: 0,
          social: candidate.isSocialMedia ? 1 : 0,
        },
        tags: Array.from(new Set([
          'rostro',
          'revision-contextual',
          'no-confirmado',
          score >= 0.95 ? 'score-95-plus' : 'score-90-plus',
          domain ? `domain-${domain.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '-').toLowerCase()}` : '',
        ].filter(Boolean))),
        extractedData: {
          urls: [candidate.url, candidate.imageUrl || candidate.thumbnailUrl].filter(Boolean),
          visualReview: {
            source: candidate.source,
            domain,
            score,
            confidenceBand: candidate.confidenceBand,
            reviewReason: candidate.reviewReason,
            originalTitle: candidate.title,
            snippet: candidate.snippet,
            identityVerified: false,
          },
        } as any,
        fetchedAt: new Date(),
        validationStatus: 'pending',
      });
    }
  }

  private humanVisualLabel(label?: any) {
    const value = String(label || '').trim();
    const known: Record<string, string> = {
      person: 'persona',
      car: 'vehiculo',
      truck: 'camion',
      bus: 'bus',
      motorcycle: 'moto',
      bicycle: 'bicicleta',
      backpack: 'morral',
      handbag: 'bolso',
      tie: 'corbata',
      cell_phone: 'telefono',
      'cell phone': 'telefono',
      laptop: 'laptop',
      dog: 'perro',
      cat: 'gato',
    };
    return known[value.toLowerCase()] || value.replace(/_/g, ' ');
  }

  private async cleanupExpiredTempImages() {
    if (!this.redis || this.deleteTempOnComplete) return;
    const stream = this.redis.scanStream({
      match: `${this.prefix}:job:*`,
      count: 50,
    });
    const now = Date.now();

    for await (const keys of stream as AsyncIterable<string[]>) {
      for (const key of keys) {
        const job = await this.redis.hgetall(key);
        if (!job.tempImagePublicId || job.tempImageCleanedAt) continue;
        const terminal = ['completed', 'failed', 'cancelled'].includes(job.status);
        if (!terminal) continue;
        const completedAt = Date.parse(job.completedAt || job.failedAt || job.cancelledAt || job.updatedAt || '');
        if (!completedAt || now - completedAt < this.tempImageTtlMs) continue;
        await this.deleteTempImage(job.searchId || job.jobId || key, job.tempImagePublicId);
        await this.redis.hset(key, {
          tempImageCleanedAt: new Date().toISOString(),
          tempImageExpiresAt: '',
        });
      }
    }
  }

  private async deleteTempImage(jobId: string, publicId: string) {
    try {
      await this.cloudinaryService.deleteImage(publicId);
      this.logger.log(`Face job temp image cleaned (${jobId}): ${publicId}`);
    } catch (error: any) {
      this.logger.warn(`Face job temp image cleanup failed (${jobId}): ${error.message}`);
    }
  }

  private async loadBase64FromImageUrl(imageUrl?: string) {
    if (!imageUrl) return undefined;
    try {
      const buffer = await this.securityValidation.fetchPublicUrl(imageUrl, {
        field: 'faceJobImageUrl',
        allowLocalUploads: true,
        accept: 'image/*,*/*;q=0.8',
      });
      return buffer.toString('base64');
    } catch (error: any) {
      this.logger.warn(`Face job could not hydrate image from URL: ${error.message}`);
      return undefined;
    }
  }

  private async runSocialDiscovery(jobId: string, payload: FaceJobInput, controls: ReturnType<FaceInvestigationJobService['normalizeControls']>, progress: number, deadline: number) {
    const discovery = {
      username: null as any,
      name: null as any,
      profileUrls: [] as any[],
      totalProfiles: 0,
      note: 'Sin pistas sociales adicionales.',
    };

    if (!this.socialScraperClient.isAvailable()) {
      discovery.note = 'Social scraper no configurado.';
      return discovery;
    }

    const username = String(payload.username || '').replace(/^@/, '').trim();
    const fullName = [payload.firstName, payload.lastName].map((item) => String(item || '').trim()).filter(Boolean).join(' ');
    const profileUrls = Array.isArray(payload.profileUrls) ? payload.profileUrls.filter(Boolean).slice(0, 8) : [];

    if (!username && !fullName && !profileUrls.length) return discovery;

    await this.updateJob(jobId, {
      stage: 'social_discovery',
      progress,
      message: 'Explorando perfiles sociales con pistas antes de comparar rostros.',
    });
    await this.addJobEvent(jobId, 'social_discovery', 'Explorando redes', 'Buscando por nombre, username y perfiles conocidos.');

    if (username) {
      await this.stopIfCancelled(jobId, deadline);
      discovery.username = await this.socialScraperClient.searchByUsername(username, controls.platforms as any, Math.min(controls.maxCandidates, 25));
      discovery.totalProfiles += Number(discovery.username?.total || 0);
    }

    if (fullName) {
      await this.stopIfCancelled(jobId, deadline);
      discovery.name = await this.socialScraperClient.searchByName(fullName, controls.platforms as any, Math.min(controls.maxCandidates, 25));
      discovery.totalProfiles += Number(discovery.name?.total || 0);
    }

    for (const url of profileUrls) {
      await this.stopIfCancelled(jobId, deadline);
      const resolved = await this.socialScraperClient.resolveProfileUrl(url).catch(() => null);
      if (resolved) {
        discovery.profileUrls.push(resolved);
        discovery.totalProfiles += Number(resolved.total || 0);
      }
    }

    discovery.note = discovery.totalProfiles
      ? `Scraper alimentó memoria social con ${discovery.totalProfiles} perfiles candidatos.`
      : 'Scraper no encontró perfiles nuevos con esas pistas.';
    await this.addJobEvent(jobId, 'social_discovery_done', 'Redes revisadas', discovery.note);
    return discovery;
  }

  private async resolveSocialUrlsAndCompare(
    jobId: string,
    payload: FaceJobInput,
    controls: ReturnType<FaceInvestigationJobService['normalizeControls']>,
    matches: Array<{ url?: string; socialPlatform?: string; isSocialMedia?: boolean; thumbnailUrl?: string }>,
    progress: number,
    deadline: number,
  ) {
    const empty = {
      summary: { resolvedUrls: 0, matches: 0, profiles: 0 },
      matches: [] as any[],
      rawMatches: [] as any[],
      profiles: [] as any[],
    };

    if (!payload.imageBase64 || !this.socialScraperClient.isAvailable()) return empty;

    const urls = [...new Set(matches
      .filter((match) => match.isSocialMedia && match.url)
      .map((match) => String(match.url))
      .filter(Boolean))]
      .slice(0, 10);

    if (!urls.length) return empty;

    await this.updateJob(jobId, {
      stage: 'social_url_expansion',
      progress,
      message: 'Resolviendo perfiles sociales detectados y comparando nuevas imágenes capturadas.',
    });
    await this.addJobEvent(jobId, 'social_url_expansion', 'Resolviendo perfiles', 'Abriendo perfiles sociales detectados y buscando nuevas imágenes.');

    let resolvedUrls = 0;
    for (const url of urls) {
      await this.stopIfCancelled(jobId, deadline);
      const resolved = await this.socialScraperClient.resolveProfileUrl(url).catch(() => null);
      if (resolved?.total) resolvedUrls += 1;
    }

    await this.stopIfCancelled(jobId, deadline);
    const imageCompare = await this.socialScraperClient.searchByImage(
      payload.imageBase64,
      controls.platforms as any,
      Math.min(controls.maxCandidates, 50),
    );

    const rawMatches = imageCompare?.matches || [];
    const profiles = imageCompare?.profiles || [];
    const mappedMatches = rawMatches.map((match: any) => ({
      url: match.publicUrl || match.relativePath || '',
      title: `Social discovery match - ${match.platform || 'social'} / ${match.owner || 'unknown'}`,
      snippet: `Social discovery score ${match.score ?? 0}`,
      thumbnailUrl: match.publicUrl,
      similarity: typeof match.similarity === 'number' ? match.similarity : (match.score || 0) / 100,
      source: 'osint-social-scraper-discovery',
      domain: 'local-social-volume',
      isSocialMedia: true,
      socialPlatform: match.platform,
    }));

    const response = {
      summary: { resolvedUrls, matches: mappedMatches.length, profiles: profiles.length },
      matches: mappedMatches,
      rawMatches,
      profiles,
    };
    await this.addJobEvent(jobId, 'social_compare_done', 'Comparación social', `${mappedMatches.length} coincidencias nuevas desde memoria social.`);
    return response;
  }

  private async discoverSocialProfilesFromVisualPages(
    jobId: string,
    controls: ReturnType<FaceInvestigationJobService['normalizeControls']>,
    matches: Array<{ url?: string; title?: string; snippet?: string; domain?: string; source?: string; isSocialMedia?: boolean; socialPlatform?: string }>,
    progress: number,
    deadline: number,
  ) {
    const empty = {
      summary: { pagesVisited: 0, profilesFound: 0, sourcePageProfiles: 0, possibleSubjectProfiles: 0 },
      matches: [] as any[],
      profiles: [] as any[],
    };

    if (!matches?.length) return empty;

    await this.updateJob(jobId, {
      stage: 'visual_to_social_bridge',
      progress,
      message: 'Buscando perfiles sociales dentro de páginas candidatas visuales.',
    });
    await this.addJobEvent(
      jobId,
      'visual_to_social_bridge',
      'Puente visual a redes',
      'Abriendo páginas candidatas para extraer Instagram, Facebook, TikTok, X y otras redes.',
    );

    await this.stopIfCancelled(jobId, deadline);
    const discovery = await this.socialProfileDiscovery.discoverFromVisualCandidates(matches, {
      maxPages: controls.mode === 'deep' ? 16 : controls.mode === 'quick' ? 6 : 10,
      maxProfiles: Math.min(controls.maxCandidates, 40),
      platforms: controls.platforms,
    });

    const classifiedProfiles = discovery.profiles.map((profile) => ({
      ...profile,
      relationshipToSubject: this.classifySocialProfileRelationship(profile),
    }));
    const sourcePageProfiles = classifiedProfiles.filter((profile) => profile.relationshipToSubject === 'source_page_profile').length;
    const possibleSubjectProfiles = classifiedProfiles.length - sourcePageProfiles;

    const mappedMatches = classifiedProfiles.map((profile) => ({
      url: profile.url,
      title: `Perfil social candidato - ${profile.platform}`,
      snippet: profile.sourceTitle
        ? `Perfil encontrado desde página visual: ${profile.sourceTitle}`
        : `Perfil encontrado desde página visual: ${profile.sourcePageUrl}`,
      similarity: profile.relationshipToSubject === 'source_page_profile' ? 0.25 : 0.5,
      source: 'visual-to-social-bridge',
      domain: this.extractDomain(profile.url),
      isSocialMedia: true,
      socialPlatform: profile.platform,
      sourcePageUrl: profile.sourcePageUrl,
      relationshipToSubject: profile.relationshipToSubject,
      metadata: {
        relationshipToSubject: profile.relationshipToSubject,
        note: profile.relationshipToSubject === 'source_page_profile'
          ? 'Red social de la página/fuente candidata; no se debe tratar como perfil del sujeto sin validación biométrica.'
          : 'Perfil social posible para revisión; requiere comparación de imagen y validación humana.',
      },
    }));

    await this.addJobEvent(
      jobId,
      'visual_to_social_done',
      'Redes extraídas',
      `${discovery.profilesFound} perfiles sociales detectados: ${possibleSubjectProfiles} posibles del sujeto y ${sourcePageProfiles} de páginas/fuentes.`,
    );

    return {
      summary: {
        pagesVisited: discovery.pagesVisited,
        profilesFound: discovery.profilesFound,
        sourcePageProfiles,
        possibleSubjectProfiles,
      },
      matches: mappedMatches,
      profiles: classifiedProfiles,
    };
  }

  private classifySocialProfileRelationship(profile: any): 'source_page_profile' | 'possible_subject_profile' {
    const profileUrl = String(profile?.url || '').toLowerCase();
    const sourcePageUrl = String(profile?.sourcePageUrl || '').toLowerCase();
    const sourceTitle = String(profile?.sourceTitle || '').toLowerCase();
    const sourceDomain = this.extractDomain(sourcePageUrl).toLowerCase().replace(/^www\./, '');
    const profileHandle = this.socialHandle(profileUrl);

    const knownPublisherHandles = [
      'grmdaily',
      'hitztvng',
      'hitztv.hq',
      'realhotnewhiphop',
      'hotnewhiphop',
      'kurrco',
      'soundcloud',
      'spotify',
      'shazam',
      'youtube',
    ];
    if (knownPublisherHandles.some((handle) => profileHandle === handle || profileHandle.includes(handle))) {
      return 'source_page_profile';
    }

    const sourceDomainHints = sourceDomain
      .split('.')
      .filter((part) => !['com', 'net', 'org', 'co', 'ng', 'ru', 'www'].includes(part));
    if (sourceDomainHints.some((hint) => hint.length >= 4 && profileHandle.includes(hint))) {
      return 'source_page_profile';
    }

    if (profileHandle && sourceTitle.includes(profileHandle.replace(/[._-]/g, ' '))) {
      return 'source_page_profile';
    }

    return 'possible_subject_profile';
  }

  private socialHandle(url: string) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (host.includes('youtube.com')) {
        return String(parts.find((part) => part.startsWith('@')) || parts.at(-1) || '').replace(/^@/, '').toLowerCase();
      }
      if (host.includes('tiktok.com') || host.includes('threads.net')) {
        return String(parts.find((part) => part.startsWith('@')) || parts.at(-1) || '').replace(/^@/, '').toLowerCase();
      }
      if (host === 'x.com' || host === 'twitter.com' || host.includes('instagram.com') || host.includes('facebook.com')) {
        return String(parts[0] || '').replace(/^@/, '').toLowerCase();
      }
      return String(parts.at(-1) || '').replace(/^@/, '').toLowerCase();
    } catch {
      return '';
    }
  }

  private extractDomain(url: string) {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  private dedupeFaceMatches(matches: any[]) {
    const seen = new Set<string>();
    return matches.filter((match) => {
      const key = match.url || match.thumbnailUrl || `${match.source}:${match.title}`;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private selectVisualReviewCandidates(matches: any[], maxCandidates: number) {
    const minReviewScore = 0.9;
    return this.dedupeFaceMatches(matches || [])
      .filter((match) => {
        const score = Number(match?.similarity || 0);
        if (score < minReviewScore) return false;
        const url = String(match?.url || '').trim();
        const imageUrl = String(match?.imageUrl || match?.thumbnailUrl || '').trim();
        return Boolean(url || imageUrl);
      })
      .map((match) => {
        const score = Number(match?.similarity || 0);
        const noisy = this.isNoisyVisualMatch(match);
        return {
          ...match,
          imageUrl: match.imageUrl || match.thumbnailUrl,
          domain: match.domain || this.extractDomain(match.url || ''),
          confidenceBand: this.faceConfidenceBand(score),
          reviewReason: noisy
            ? 'resultado fuerte filtrado del match final; guardar para extracción de contexto y validación humana'
            : 'resultado fuerte apto para revisión y enriquecimiento secundario',
          metadata: {
            ...(match.metadata || {}),
            reviewOnly: noisy,
            identityVerified: false,
          },
        };
      })
      .slice(0, Math.min(Math.max(maxCandidates, 10), 80));
  }

  private isNoisyVisualMatch(match: any) {
    const url = String(match?.url || '').toLowerCase();
    const domain = String(match?.domain || this.extractDomain(match?.url || '') || '').toLowerCase();
    const text = [
      match?.title,
      match?.snippet,
      match?.source,
      match?.domain,
    ].map((item) => String(item || '').toLowerCase()).join(' ');

    const stockDomains = [
      'unsplash.com',
      'freepik.com',
      'magnific.com',
      'stock.adobe.com',
      'adobe.com',
      'shutterstock.com',
      'istockphoto.com',
      'gettyimages.com',
      'dreamstime.com',
      'alamy.com',
      'depositphotos.com',
      'pixabay.com',
      'vecteezy.com',
      'stockcake.com',
      'wikipedia.org',
      'wikimedia.org',
      'encrypted-tbn0.gstatic.com',
      'google.com/s2/favicons',
    ];
    if (stockDomains.some((item) => url.includes(item) || domain.includes(item))) return true;

    const blockedSocialProfiles = [
      'instagram.com/soundcloud',
      'facebook.com/soundcloud',
      'twitter.com/soundcloud',
      'x.com/soundcloud',
      'instagram.com/shazam',
      'facebook.com/shazam',
      'twitter.com/shazam',
      'x.com/shazam',
      'instagram.com/spotify',
      'facebook.com/spotify',
      'x.com/spotify',
      'twitter.com/spotify',
      'facebook.com/leicesterbbc',
      'twitter.com/bbcleicester',
      'x.com/bbcleicester',
      'instagram.com/bbcleicester',
    ];
    if (blockedSocialProfiles.some((item) => url.includes(item))) return true;

    return /\b(stock photos?|royalty-free|free photos?|free images?|download free images?|browse [\d,]+ stock|vectors?|wallpaper|human face|person face|man face|woman face|african men faces?|average faces?|faces around the world|generic face|image result for .*faces?)\b/i.test(text);
  }

  private faceConfidenceBand(score: number) {
    if (score >= 0.98) return 'critical_review';
    if (score >= 0.95) return 'strong_review';
    if (score >= 0.85) return 'weak_medium';
    return 'low_noise';
  }

  private normalizeControls(input: FaceJobInput) {
    const mode = input.mode || 'standard';
    const profiles = {
      quick: { maxRuntimeMs: 5 * 60 * 1000, maxCandidates: 12, minCandidateScore: 0.45 },
      standard: { maxRuntimeMs: 15 * 60 * 1000, maxCandidates: 25, minCandidateScore: 0.4 },
      deep: { maxRuntimeMs: 60 * 60 * 1000, maxCandidates: 80, minCandidateScore: 0.35 },
      custom: { maxRuntimeMs: 15 * 60 * 1000, maxCandidates: 25, minCandidateScore: 0.4 },
    } as const;
    const selected = profiles[mode] || profiles.standard;
    const maxRuntimeMs = clampNumber(input.maxRuntimeMs, 60_000, 3_600_000, selected.maxRuntimeMs);
    const maxCandidates = clampNumber(input.maxCandidates, 1, 200, selected.maxCandidates);
    const minCandidateScore = normalizeScore(input.minCandidateScore, selected.minCandidateScore);
    const allowedPlatforms = ['github', 'reddit', 'instagram', 'facebook', 'tiktok', 'x', 'pinterest', 'linkedin', 'medium', 'youtube', 'telegram', 'discord', 'threads', 'mastodon', 'bluesky'];
    const platforms = Array.isArray(input.platforms) && input.platforms.length
      ? input.platforms
          .map((item) => String(item).trim())
          .filter((item) => allowedPlatforms.includes(item))
          .slice(0, 12)
      : ['instagram', 'facebook', 'tiktok', 'x', 'youtube', 'telegram', 'threads', 'bluesky'];

    return {
      mode,
      maxRuntimeMs,
      maxCandidates,
      minCandidateScore,
      platforms,
    };
  }

  private hasIdentityHints(input: FaceJobInput) {
    return Boolean(
      String(input.firstName || '').trim()
      || String(input.lastName || '').trim()
      || String(input.username || '').replace(/^@/, '').trim()
      || (Array.isArray(input.profileUrls) && input.profileUrls.some((url) => /^https?:\/\//i.test(String(url || '').trim()))),
    );
  }

  private async updateJob(jobId: string, data: Record<string, any>) {
    if (!this.redis) return;
    const currentStatus = await this.redis.hget(this.statusKey(jobId), 'status');
    if (currentStatus === 'cancelled' && data.status !== 'cancelled') return;
    await this.redis.hset(this.statusKey(jobId), {
      ...data,
      updatedAt: new Date().toISOString(),
    });
  }

  private async addJobEvent(jobId: string, stage: string, title: string, message: string) {
    if (!this.redis) return;
    const key = this.statusKey(jobId);
    const raw = await this.redis.hget(key, 'events');
    let events: any[] = [];
    if (raw) {
      try {
        events = JSON.parse(raw);
      } catch {
        events = [];
      }
    }
    events.push(this.jobEvent(stage, title, message));
    await this.redis.hset(key, {
      events: JSON.stringify(events.slice(-30)),
      updatedAt: new Date().toISOString(),
    });
  }

  private jobEvent(stage: string, title: string, message: string) {
    return {
      stage,
      title,
      message,
      at: new Date().toISOString(),
    };
  }

  private async stopIfCancelled(jobId: string, deadline?: number) {
    if (this.abortControllers.get(jobId)?.signal.aborted) throw new Error('face_job_cancelled');
    if (deadline && Date.now() >= deadline) throw new Error('face_job_timeout');
    if (!this.redis) return;
    const status = await this.redis.hget(this.statusKey(jobId), 'status');
    if (status === 'cancelled') {
      throw new Error('face_job_cancelled');
    }
  }

  private async awaitCancellable<T>(jobId: string, operation: Promise<T>, deadline: number): Promise<T> {
    await this.stopIfCancelled(jobId, deadline);
    const signal = this.abortControllers.get(jobId)?.signal;
    if (signal?.aborted) throw new Error('face_job_cancelled');
    const remaining = Math.max(1, deadline - Date.now());
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let timer: NodeJS.Timeout;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        callback();
      };
      const onAbort = () => finish(() => reject(new Error('face_job_cancelled')));
      timer = setTimeout(() => finish(() => reject(new Error('face_job_timeout'))), remaining);
      signal?.addEventListener('abort', onAbort, { once: true });
      operation.then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
    });
  }

  private async handleJobFailure(jobId: string, error: any) {
    if (!this.redis) return;
    const attempts = Number((await this.redis.hget(this.statusKey(jobId), 'attempts')) || 1);
    const message = error?.message || 'unknown error';
    const now = new Date().toISOString();

    if (message === 'face_job_cancelled') {
      await this.updateJob(jobId, {
        status: 'cancelled',
        stage: 'cancelled',
        progress: 100,
        message: 'Investigación facial cancelada.',
      });
      await this.addJobEvent(jobId, 'cancelled', 'Investigación cancelada', 'El usuario detuvo la investigación facial.');
      return;
    }

    if (message === 'face_job_timeout') {
      await this.updateJob(jobId, {
        status: 'completed',
        stage: 'time_limit_reached',
        progress: 100,
        completedAt: now,
        message: 'Se alcanzó el tiempo máximo. Se conservaron los resultados parciales obtenidos.',
      });
      await this.addJobEvent(jobId, 'time_limit_reached', 'Tiempo máximo alcanzado', 'La investigación se cerró de forma controlada y conservó sus resultados parciales.');
      return;
    }

    if (attempts < this.maxAttempts) {
      const retryAt = Date.now() + this.retryBackoffMs * attempts;
      await this.redis
        .multi()
        .hset(this.statusKey(jobId), {
          status: 'queued',
          stage: 'retry_scheduled',
          progress: 8,
          retryAt: new Date(retryAt).toISOString(),
          updatedAt: now,
          error: message,
          message: 'La investigación falló temporalmente. Reintentando automáticamente.',
        })
        .zadd(this.delayedKey(), retryAt, jobId)
        .exec();
      this.logger.warn(`Face job retry scheduled (${jobId}) attempt ${attempts}/${this.maxAttempts}: ${message}`);
      await this.addJobEvent(jobId, 'retry_scheduled', 'Reintento programado', 'Hubo un fallo temporal; se reintentará automáticamente.');
      return;
    }

    await this.updateJob(jobId, {
      status: 'failed',
      stage: 'failed',
      progress: 100,
      failedAt: now,
      error: message,
      message: `Investigación facial fallida: ${message}`,
    });
    await this.addJobEvent(jobId, 'failed', 'Investigación fallida', message);
    this.logger.error(`Face job failed permanently (${jobId}) after ${attempts} attempts: ${message}`);
  }

  private async releaseDelayedJobs() {
    if (!this.redis) return;
    const due = await this.redis.zrangebyscore(this.delayedKey(), 0, Date.now(), 'LIMIT', 0, 20);
    if (!due.length) return;

    const pipeline = this.redis.multi();
    due.forEach((jobId) => {
      pipeline.zrem(this.delayedKey(), jobId);
      pipeline.rpush(this.queueKey(), jobId);
      pipeline.hset(this.statusKey(jobId), {
        status: 'queued',
        stage: 'queued',
        updatedAt: new Date().toISOString(),
        message: 'Reintento de investigación facial en cola.',
      });
    });
    await pipeline.exec();
  }

  private async recoverStaleProcessing() {
    if (!this.redis) return;
    const processing = await this.redis.smembers(this.processingKey());
    if (!processing.length) return;

    const now = Date.now();
    for (const jobId of processing) {
      if (this.active.has(jobId)) continue;
      const job = await this.redis.hgetall(this.statusKey(jobId));
      const started = Date.parse(job.startedAt || job.updatedAt || '');
      if (!started || now - started < this.processingTimeoutMs) continue;

      await this.redis
        .multi()
        .hset(this.statusKey(jobId), {
          status: 'queued',
          stage: 'recovered',
          recoveredAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          error: 'Recovered stale face job',
          message: 'Investigación recuperada después de quedar estancada.',
        })
        .lrem(this.processingListKey(), 0, jobId)
        .srem(this.processingKey(), jobId)
        .rpush(this.queueKey(), jobId)
        .exec();
      this.logger.warn(`Recovered stale face job: ${jobId}`);
    }
  }

  private async incrementAttempts(jobId: string) {
    const current = Number((await this.redis?.hget(this.statusKey(jobId), 'attempts')) || 0);
    return current + 1;
  }

  private parsePayload(payload?: string): FaceJobInput {
    if (!payload) return {};
    try {
      return JSON.parse(payload);
    } catch {
      return {};
    }
  }

  private cleanJob(job: Record<string, string>) {
    const copy: Record<string, any> = { ...job };
    delete copy.payload;

    for (const key of ['progress', 'attempts', 'facesDetected', 'matchesFound', 'processingTimeMs', 'maxRuntimeMs', 'maxCandidates', 'minCandidateScore']) {
      if (copy[key] !== undefined && copy[key] !== '') copy[key] = Number(copy[key]);
    }

    for (const key of ['enginesUsed', 'socialProfiles', 'faceResult', 'platforms', 'events']) {
      if (!copy[key]) continue;
      try {
        copy[key] = JSON.parse(copy[key]);
      } catch {
        // Keep raw value if older jobs stored plain text.
      }
    }

    return copy;
  }

  private queueKey() {
    return `${this.prefix}:queue`;
  }

  private processingListKey() {
    return `${this.prefix}:processing`;
  }

  private processingKey() {
    return `${this.prefix}:processing:set`;
  }

  private delayedKey() {
    return `${this.prefix}:delayed`;
  }

  private statusKey(jobId: string) {
    return `${this.prefix}:job:${jobId}`;
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, min), max);
}

function normalizeScore(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const ratio = numeric > 1 ? numeric / 100 : numeric;
  return Math.min(Math.max(ratio, 0), 1);
}
