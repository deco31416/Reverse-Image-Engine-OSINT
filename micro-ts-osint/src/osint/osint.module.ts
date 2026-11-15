import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { OsintControllerV2 } from './osint-v2.controller';
import { TestUiController } from './test-ui.controller';
import { OsintService } from './osint.service';
import { ReverseImageSearchService } from './services/reverse-image-search.service';
import { CloudinaryService } from './services/cloudinary.service';
import { GeminiImageEnhancementService } from './services/gemini-image-enhancement.service';
import { WebCrawlerService } from './services/web-crawler.service';
import { GroqIdentificationService } from './services/groq-identification.service';
import { GroqKeyRotationService } from './services/groq-key-rotation.service';
import { DatasecProxyService } from './services/datasec-proxy.service';
import { DatasecCurationService } from './services/datasec-curation.service';
import { StoragePathService } from './services/storage-path.service';
import { SecurityValidationService } from './services/security-validation.service';
import { OsintJobQueueService } from './services/osint-job-queue.service';
import { PersonDetectionOrchestrator } from './services/person-detection-orchestrator.service';

// God-Level services 🔥
import { EvidenceService } from './services/evidence.service';
import { RateLimitService } from './services/rate-limit.service';
import { RegexExtractorService } from './services/regex-extractor.service';
import { AuditLogService } from './services/audit-log.service';
import { ScoringService } from './services/scoring.service';
import { ClusteringService } from './services/clustering.service';
import { ClusterEnrichmentService } from './services/cluster-enrichment.service';
import { InputOrchestratorService } from './services/input-orchestrator.service';
import { CacheService } from './services/cache.service';
import { CleanupService } from './services/cleanup.service';

// Phase 3: Multi-Motor Search Services
import { BingSearchService } from './services/bing-search.service';
import { DuckDuckGoSearchService } from './services/duckduckgo-search.service';
import { SearxngSearchService } from './services/searxng-search.service';
import { TavilySearchService } from './services/tavily-search.service';
import { SerperSearchService } from './services/serper-search.service';
import { YandexImageSearchService } from './services/yandex-image-search.service';
import { YandexReverseImageNativeService } from './services/yandex-reverse-image-native.service';
import { YouTubeSearchService } from './services/youtube-search.service';
import { WebArchiveService } from './services/web-archive.service';
import { MultiSearchOrchestratorService } from './services/multi-search-orchestrator.service';
import { NetworkSchedulerService } from './services/network-scheduler.service';

// Phase 4: Google Vision AI
import { GoogleVisionService } from './services/google-vision.service';

// Phase 5: Face Search Pipeline 🧠
import { FaceSearchService } from './services/face-search.service';
import { FaceInvestigationJobService } from './services/face-investigation-job.service';

// Phase 5: Report Generators
import { MarkdownReportGeneratorService } from './services/markdown-report-generator.service';
import { PdfReportGeneratorService } from './services/pdf-report-generator.service';
import { TimelineGeneratorService } from './services/timeline-generator.service';

// Schemas
import { Evidence, EvidenceSchema } from './schemas/evidence.schema';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';
import { OsintSearch, OsintSearchSchema } from './schemas/osint-search.schema';
import { IdentityCluster, IdentityClusterSchema } from './schemas/identity-cluster.schema';
import { SanctionsScreening, SanctionsScreeningSchema } from './schemas/sanctions-screening.schema';
import { DatasecPerson, DatasecPersonSchema } from './schemas/datasec-person.schema';
import { DatasecAsset, DatasecAssetSchema } from './schemas/datasec-asset.schema';
import { TargetSubject, TargetSubjectSchema } from './schemas/target-subject.schema';
import { IdentityCandidate, IdentityCandidateSchema } from './schemas/identity-candidate.schema';
import { IdentityMemoryService } from './services/identity-memory.service';

// Phase 6: Sanctions Screening 🚨
import { SanctionsScreeningService } from './services/sanctions-screening.service';

// Phase 7: Dark Web Intelligence 🕸️
import { DarkWebSearchService } from './services/darkweb-search.service';
import { DarkWebScraperService } from './services/darkweb-scraper.service';
import { DarkWebIntelligenceService } from './services/darkweb-intelligence.service';
import { DarkWebEvidenceGateService } from './services/darkweb-evidence-gate.service';

// Phase 8: Meta / Facebook OSINT 📘
import { MetaIntelligenceService } from './services/meta-intelligence.service';

// Phase 9: Instagram OSINT 📸
import { InstagramIntelligenceService } from './services/instagram-intelligence.service';
import { HypothesisEngineService } from './services/hypothesis-engine.service';

// Phase 10: Brave Search 🦁
import { BraveSearchService } from './services/brave-search.service';
import { HuggingFaceImageService } from './services/huggingface-image.service';

// Phase 11: SerpAPI Google Lens 🔍🌐
import { SerpApiGoogleLensService } from './services/serpapi-google-lens.service';
import { SocialScraperClientService } from './services/social-scraper-client.service';
import { SocialProfileDiscoveryService } from './services/social-profile-discovery.service';
import { VisualFaceSelectionService } from './services/visual-face-selection.service';
import { FaceBiometricClientService } from './services/face-biometric-client.service';
import { VisualContextClientService } from './services/visual-context-client.service';
import { CaseAccessService } from './services/case-access.service';
import { CaseCleanupService } from './services/case-cleanup.service';

/**
 * OSINT Module - God-Level Edition 🔥
 * Open Source Intelligence gathering and management
 *
 * Features:
 * ✅ Multi-platform search (Google, Twitter, LinkedIn, Facebook, Instagram, YouTube)
 * ✅ Reverse image search (Google Images, Yandex, TinEye)
 * ✅ AI-powered image enhancement (Google Gemini)
 * ✅ Web crawler with Puppeteer
 * ✅ Person identification (Groq AI)
 * ✅ Cloudinary image storage
 * 🔥 Evidence System with SHA256 deduplication
 * 🔥 Redis-based Rate Limiting (protects API costs)
 * 🔥 Automatic Regex extraction (emails, phones, RFCs, CURPs)
 * 🔥 Audit Logs for compliance
 * 🔥 MongoDB persistence with Mongoose
 * 🔥 Multi-dimensional scoring
 * 🔥 Alphabetical clustering
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    HttpModule.register({
      timeout: 30000, // Increased for crawler
      maxRedirects: 5,
    }),
    // Register Mongoose schemas
    MongooseModule.forFeature([
      { name: Evidence.name, schema: EvidenceSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: OsintSearch.name, schema: OsintSearchSchema },
      { name: IdentityCluster.name, schema: IdentityClusterSchema },
      { name: SanctionsScreening.name, schema: SanctionsScreeningSchema },
      { name: DatasecPerson.name, schema: DatasecPersonSchema },
      { name: DatasecAsset.name, schema: DatasecAssetSchema },
      { name: TargetSubject.name, schema: TargetSubjectSchema },
      { name: IdentityCandidate.name, schema: IdentityCandidateSchema },
    ]),
  ],
  controllers: [OsintControllerV2, TestUiController],
  providers: [
    // Original services
    OsintService,
    ReverseImageSearchService,
    CloudinaryService,
    GeminiImageEnhancementService,
    HuggingFaceImageService,
    WebCrawlerService,
    GroqIdentificationService,
    GroqKeyRotationService,
    DatasecProxyService,
    DatasecCurationService,
    IdentityMemoryService,
    StoragePathService,
    SecurityValidationService,
    OsintJobQueueService,
    PersonDetectionOrchestrator,
    // God-Level services 🔥
    EvidenceService,
    RateLimitService,
    RegexExtractorService,
    AuditLogService,
    ScoringService,
    ClusteringService,
    ClusterEnrichmentService,
    InputOrchestratorService,
    CacheService,
    CleanupService,
    // Phase 3: Multi-Motor Search 🚀
    BingSearchService,
    DuckDuckGoSearchService,
    SearxngSearchService,
    TavilySearchService,
    SerperSearchService,
    YandexImageSearchService,
    YandexReverseImageNativeService,
    YouTubeSearchService,
    WebArchiveService,
    MultiSearchOrchestratorService,
    // Network Scheduler: per-domain queues, circuit breaker, retry 🛡️
    NetworkSchedulerService,
    // Phase 4: Google Vision AI 👁️
    GoogleVisionService,
    // Phase 5: Face Search Pipeline 🧠
    FaceSearchService,
    FaceInvestigationJobService,
    // Phase 5: Report Generators 📄
    MarkdownReportGeneratorService,
    PdfReportGeneratorService,
    TimelineGeneratorService,
    // Phase 6: Sanctions Screening 🚨
    SanctionsScreeningService,
    // Phase 7: Dark Web Intelligence 🕸️
    DarkWebSearchService,
    DarkWebScraperService,
    DarkWebEvidenceGateService,
    DarkWebIntelligenceService,
    // Phase 8: Meta / Facebook OSINT 📘
    MetaIntelligenceService,
    // Phase 9: Instagram OSINT 📸
    InstagramIntelligenceService,
    HypothesisEngineService,
    // Phase 10: Brave Search 🦁
    BraveSearchService,
    // Phase 11: SerpAPI Google Lens 🔍🌐
    SerpApiGoogleLensService,
    SocialScraperClientService,
    SocialProfileDiscoveryService,
    VisualFaceSelectionService,
    FaceBiometricClientService,
    VisualContextClientService,
    CaseAccessService,
    CaseCleanupService,
  ],
  exports: [
    OsintService,
    PersonDetectionOrchestrator,
    EvidenceService,
    MultiSearchOrchestratorService,
    RateLimitService,
    RegexExtractorService,
    AuditLogService,
    ScoringService,
    ClusteringService,
    ClusterEnrichmentService,
    InputOrchestratorService,
    CacheService,
    SanctionsScreeningService,
    TavilySearchService,
    SerperSearchService,
    YandexImageSearchService,
    NetworkSchedulerService,
    GroqKeyRotationService,
    DatasecCurationService,
    StoragePathService,
    SecurityValidationService,
    OsintJobQueueService,
    DarkWebSearchService,
    DarkWebEvidenceGateService,
    DarkWebIntelligenceService,
    MetaIntelligenceService,
    InstagramIntelligenceService,
    HypothesisEngineService,
    SerpApiGoogleLensService,
    SocialScraperClientService,
    FaceInvestigationJobService,
    VisualFaceSelectionService,
    FaceBiometricClientService,
    CaseAccessService,
    CaseCleanupService,
  ],
})
export class OsintModule {}
