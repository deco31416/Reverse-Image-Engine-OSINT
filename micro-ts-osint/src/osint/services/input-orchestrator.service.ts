import {
  Injectable,
  Logger,
  BadRequestException,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  OsintSearch,
  OsintSearchDocument,
} from '../schemas/osint-search.schema';
import { ExpandedPersonSearchDto } from '../dto/expanded-person-search.dto';
import { SearchType, SearchCategory } from '../dto/create-search.dto';
import { ClusteringService } from './clustering.service';
import { AuditLogService } from './audit-log.service';
import { GeminiImageEnhancementService } from './gemini-image-enhancement.service';
import { CloudinaryService } from './cloudinary.service';
import { EvidenceService } from './evidence.service';
import { StoragePathService } from './storage-path.service';
import { DatasecCurationService } from './datasec-curation.service';
import { SecurityValidationService } from './security-validation.service';

/**
 * Servicio orquestador de input multi-modal
 * Coordina el procesamiento de imagen, datos personales, contexto y opciones
 *
 * Responsabilidades:
 * - Validar input (al menos imagen O personalInfo)
 * - Generar query optimizada para búsqueda
 * - Procesar imagen con Gemini (si aplica)
 * - Crear registro de búsqueda en MongoDB
 * - Asignar cluster letter
 * - Audit logging
 */
@Injectable()
export class InputOrchestratorService {
  private readonly logger = new Logger(InputOrchestratorService.name);

  constructor(
    @InjectModel(OsintSearch.name)
    private osintSearchModel: Model<OsintSearchDocument>,
    private clusteringService: ClusteringService,
    private auditLogService: AuditLogService,
    private evidenceService: EvidenceService,
    private geminiImageService: GeminiImageEnhancementService,
    private cloudinaryService: CloudinaryService,
    private storagePath: StoragePathService,
    private datasecCuration: DatasecCurationService,
    private securityValidation: SecurityValidationService,
  ) {}

  /**
   * Procesa input multi-modal y crea búsqueda OSINT
   *
   * @param input - DTO con imagen, personalInfo, context, options
   * @returns Documento de búsqueda creado con searchId
   */
  async processInput(
    input: ExpandedPersonSearchDto,
  ): Promise<OsintSearchDocument> {
    this.logger.log('Processing multi-modal input...');

    await this.resolveInternalDatasecImage(input);
    await this.validateImageInputSecurity(input);

    // 1. Validar que al menos haya imagen O personalInfo
    this.validateInput(input);

    // 2. Generar query optimizada
    const query = this.generateQuery(input);
    this.logger.log(`Generated query: "${query}"`);

    // 3. Asignar cluster letter (legacy) + preparar identity cluster
    const clusterLetter = this.clusteringService.getClusterLetter(query);

    // 4. Crear documento de búsqueda temprano para tener searchId estable en storage
    const searchType = input.image ? SearchType.FACE_IMAGE : SearchType.ALL;
    const category = SearchCategory.PERSON;
    this.logger.log(`Creating search doc: searchType=${searchType}, category=${category}`);

    const searchDoc = new this.osintSearchModel({
      query,
      clusterLetter,
      searchType,
      category,
      status: 'pending',
      inputData: {
        image: input.image,
        personalInfo: input.personalInfo,
        context: input.context,
        options: input.options,
      },
      userId: input.userId,
      scores: {
        identity: 0,
        legal: 0,
        financial: 0,
        overall: 0,
      },
    });

    const savedSearch = await searchDoc.save();
    const searchId = savedSearch._id.toString();
    this.logger.log(`Search created with ID: ${searchId}`);

    // 5. Procesar imagen si existe y generateEnhanced está habilitado
    let enhancedImageUrl: string | undefined;
    let originalImageUrl: string | undefined;

    if (input.image && input.options.generateEnhanced) {
      try {
        const imageData = await this.getImageData(input.image, query, clusterLetter, searchId);
        originalImageUrl = imageData.url;
        this.logger.log(`📸 IMAGE URL (original): ${originalImageUrl || 'N/A'}`);

        this.logger.log('Generating enhanced image with Gemini...');
        const enhanced = await this.geminiImageService.generateEnhancedImage({
          frontImage: imageData.data,
          description: this.generateImageContext(input),
        });

        this.logger.log('Uploading enhanced image to Cloudinary...');
        const uploadResult = await this.cloudinaryService.uploadBase64(
          enhanced.enhancedImageBase64,
          `osint-enhanced-${Date.now()}`,
          {
            folder: this.storagePath.searchFolder(query, clusterLetter, searchId, 'enhanced'),
            tags: ['osint', 'enhanced', clusterLetter],
            generateThumbnails: true,
          },
        );
        enhancedImageUrl = uploadResult.url;

        this.logger.log(`✅ Enhanced image uploaded: ${enhancedImageUrl}`);
      } catch (error) {
        this.logger.error(
          `Error processing enhanced image: ${error.message}`,
          error.stack,
        );
        // FALLBACK: si Gemini falla, al menos tenemos la URL original de Cloudinary
        if (!originalImageUrl && input.image) {
          try {
            const fallbackData = await this.getImageData(input.image, query, clusterLetter, searchId);
            originalImageUrl = fallbackData.url;
            this.logger.log(`📸 Fallback IMAGE URL: ${originalImageUrl}`);
          } catch (fallbackErr) {
            this.logger.error(`Fallback image upload also failed: ${fallbackErr.message}`);
          }
        }
      }
    } else if (input.image) {
      const imageData = await this.getImageData(input.image, query, clusterLetter, searchId);
      originalImageUrl = imageData.url;
      this.logger.log(`📸 IMAGE URL (no enhance): ${originalImageUrl || 'N/A'}`);
    }

    this.logger.log(`📊 Image processing result — originalImageUrl: ${originalImageUrl || 'NONE'}, enhancedImageUrl: ${enhancedImageUrl || 'NONE'}`);

    savedSearch.imageUrl = originalImageUrl;
    savedSearch.enhancedImageUrl = enhancedImageUrl;
    await savedSearch.save();

    // 6. Identity Cluster — vincular búsqueda a un cluster de identidad
    try {
      const pi = input.personalInfo;
      const fullName = pi ? [pi.nombre, pi.apellido].filter(Boolean).join(' ') : undefined;
      const cluster = await this.clusteringService.findOrCreateCluster({
        fullName: fullName || undefined,
        username: pi?.username || undefined,
        email: pi?.email || undefined,
        phone: pi?.telefono || undefined,
        searchId,
        imageUrl: enhancedImageUrl || originalImageUrl,
      });

      // Guardar clusterId en el search document
      savedSearch.metadata = {
        ...(savedSearch.metadata || {}),
        clusterId: cluster._id.toString(),
        clusterSlug: cluster.slug,
        clusterDisplayName: cluster.displayName,
      };
      await savedSearch.save();
      this.logger.log(`🔗 Search vinculada a cluster: "${cluster.slug}" (${cluster.displayName})`);
    } catch (clusterError) {
      this.logger.error(`Error vinculando cluster: ${clusterError.message}`);
      // No fallar — el cluster es informativo, la búsqueda sigue
    }

    // 7. Audit log
    await this.auditLogService.logSearchCreated(
      searchId,
      query,
      input.userId,
      {
        hasImage: !!input.image,
        hasPersonalInfo: !!input.personalInfo,
        hasContext: !!input.context,
        deepSearch: input.options.deepSearch,
        searchEngines: input.options.searchEngines,
        ipAddress: input.requestIp,
        userAgent: input.userAgent,
      },
    );

    return savedSearch;
  }

  /**
   * Valida que el input tenga al menos imagen O personalInfo
   */
  private validateInput(input: ExpandedPersonSearchDto): void {
    if (!input.image && !input.personalInfo) {
      throw new BadRequestException(
        'Debe proporcionar al menos una imagen O información personal (nombre, email, teléfono, etc.)',
      );
    }

    // Si solo hay imagen, verificar que tenga una fuente válida
    if (input.image && !input.image.url && !input.image.base64) {
      throw new BadRequestException('La imagen debe tener url o base64');
    }
  }

  private async resolveInternalDatasecImage(input: ExpandedPersonSearchDto) {
    const image = input.image as any;
    if (!image?.datasecImageId || image.url || image.base64) return;

    const asset = await this.datasecCuration.resolveAssetImageUrl(image.datasecImageId);
    image.url = asset.imageUrl;
    image.source = 'datasec';
  }

  private async validateImageInputSecurity(input: ExpandedPersonSearchDto) {
    const image = input.image as any;
    if (!image) return;

    if (image.url) {
      image.url = await this.securityValidation.validatePublicUrl(image.url, {
        field: 'image.url',
        allowLocalUploads: true,
      });
    }

    if (image.base64) {
      this.securityValidation.validateImageBase64(image.base64, { field: 'image.base64' });
    }
  }

  /**
   * Genera query optimizada basada en personalInfo + context
   *
   * Ejemplos:
   * - Solo nombre: "Juan Pérez"
   * - Nombre + org: "Juan Pérez UNAM"
   * - Email: "juan.perez@example.com"
   * - Username: "@juanperez"
   * - Nombre + ciudad: "Juan Pérez Ciudad de México"
   */
  private generateQuery(input: ExpandedPersonSearchDto): string {
    const parts: string[] = [];

    if (input.personalInfo) {
      const { nombre, apellido, username, email, telefono, ciudad } =
        input.personalInfo;

      // Priorizar nombre completo
      if (nombre || apellido) {
        const fullName = [nombre, apellido].filter(Boolean).join(' ');
        parts.push(fullName);
      }

      // Agregar username si existe
      if (username) {
        parts.push(username);
      }

      // Agregar email solo si no hay nombre (evita queries muy largas)
      if (email && !nombre && !apellido) {
        const emailPart = email.split('@')[0];
        parts.push(emailPart);
      }

      // Agregar teléfono siempre que esté disponible (alta señal en directorios)
      if (telefono) {
        parts.push(telefono);
      }

      // RFC/CURP — si no hay nombre, usarlos como query principal
      const { rfc, curp, alias } = input.personalInfo;
      if (rfc && parts.length === 0) {
        parts.push(rfc);
      }
      if (curp && parts.length === 0) {
        parts.push(curp);
      }

      // NO agregar ciudad/país/org - limita los resultados
      // La ciudad y organización se usan solo para clustering, NO para la query principal
      // REGLA DE ORO: solo nombre + username + email + teléfono + rfc/curp
    }

    // Si no hay nada, usar "unknown person" como fallback
    if (parts.length === 0) {
      return 'unknown person search';
    }

    return parts.join(' ');
  }

  /**
   * Genera contexto descriptivo para mejorar análisis de imagen con Gemini
   */
  private generateImageContext(input: ExpandedPersonSearchDto): string {
    const parts: string[] = [];

    if (input.personalInfo) {
      const { nombre, apellido, fechaNacimiento } = input.personalInfo;

      if (nombre || apellido) {
        parts.push(`Persona: ${[nombre, apellido].filter(Boolean).join(' ')}`);
      }

      if (fechaNacimiento) {
        const age = this.calculateAge(fechaNacimiento);
        if (age) {
          parts.push(`Edad aproximada: ${age} años`);
        }
      }
    }

    if (input.context) {
      const { organizacion, cargo, notas } = input.context;

      if (organizacion) {
        parts.push(`Organización: ${organizacion}`);
      }

      if (cargo) {
        parts.push(`Cargo: ${cargo}`);
      }

      if (notas) {
        parts.push(`Notas: ${notas}`);
      }
    }

    return parts.length > 0
      ? parts.join('. ')
      : 'Persona desconocida, buscar características distintivas';
  }

  /**
   * Obtiene datos de imagen desde URL o base64
   * Si es base64, sube a Cloudinary para obtener URL pública
   * (necesaria para reverse image search en Google, Yandex, TinEye)
   */
  private async getImageData(
    image: any,
    query?: string,
    clusterLetter?: string,
    searchId?: string,
  ): Promise<{ url?: string; data: string }> {
    if (image.url) {
      return { url: image.url, data: image.url };
    }

    if (image.base64) {
      // Si es data:image/jpeg;base64,... extraer solo el base64
      const base64Data = image.base64.includes('base64,')
        ? image.base64.split('base64,')[1]
        : image.base64;

      // Subir a Cloudinary para obtener URL pública
      const publicUrl = await this.ensureImageUrl(base64Data, undefined, {
        query,
        clusterLetter,
        searchId,
        kind: 'original',
      });
      this.logger.log(`📸 Image uploaded to Cloudinary: ${publicUrl}`);

      return { data: base64Data, url: publicUrl };
    }

    throw new BadRequestException('Image must have url or base64');
  }

  /**
   * Asegura que exista una URL pública para la imagen.
   * Si recibe base64, sube a Cloudinary y retorna la URL.
   * Si recibe URL, la retorna directamente.
   */
  async ensureImageUrl(
    imageBase64?: string,
    imageUrl?: string,
    context?: {
      query?: string;
      clusterLetter?: string;
      searchId?: string;
      kind?: string;
    },
  ): Promise<string | undefined> {
    if (imageUrl) {
      return await this.securityValidation.validatePublicUrl(imageUrl, {
        field: 'imageUrl',
        allowLocalUploads: true,
      });
    }

    if (imageBase64) {
      try {
        this.securityValidation.validateImageBase64(imageBase64, { field: 'imageBase64' });
        const dataUri = imageBase64.startsWith('data:')
          ? imageBase64
          : `data:image/jpeg;base64,${imageBase64}`;

        const uploadResult = await this.cloudinaryService.uploadBase64(
          dataUri,
          this.storagePath.searchName(context?.query, context?.kind || 'original'),
          {
            folder: this.storagePath.searchFolder(
              context?.query || 'unknown-search',
              context?.clusterLetter || this.clusteringService.getClusterLetter(context?.query || 'unknown'),
              context?.searchId || 'pending',
              context?.kind || 'original',
            ),
            tags: ['osint', context?.kind || 'original', 'reverse-search'],
          },
        );

        this.logger.log(`✅ ensureImageUrl: uploaded → ${uploadResult.secureUrl}`);
        return uploadResult.secureUrl;
      } catch (error) {
        this.logger.error(`❌ ensureImageUrl upload failed: ${error.message}`);
        return undefined;
      }
    }

    return undefined;
  }

  /**
   * Calcula edad a partir de fecha de nacimiento
   */
  private calculateAge(birthDate: string): number | null {
    try {
      const birth = new Date(birthDate);
      const today = new Date();
      let age = today.getFullYear() - birth.getFullYear();
      const monthDiff = today.getMonth() - birth.getMonth();

      if (
        monthDiff < 0 ||
        (monthDiff === 0 && today.getDate() < birth.getDate())
      ) {
        age--;
      }

      return age > 0 && age < 120 ? age : null;
    } catch {
      return null;
    }
  }

  // ============================================================================
  // COMPATIBILIDAD CON FRONTEND CARDS (GET /searches, GET /stats)
  // ============================================================================

  /**
   * Obtiene una búsqueda por ID
   */
  async getSearchById(searchId: string): Promise<OsintSearchDocument | null> {
    return this.osintSearchModel.findById(searchId).lean().exec() as any;
  }

  async updateSearchDetails(
    searchId: string,
    input: {
      query?: string;
      description?: string;
      tags?: string[];
      metadata?: Record<string, any>;
    },
  ): Promise<OsintSearchDocument> {
    const search = await this.osintSearchModel.findById(searchId).exec();
    if (!search) {
      throw new NotFoundException(`Búsqueda ${searchId} no encontrada`);
    }

    const query = String(input.query || '').trim();
    if (query) {
      search.query = query.slice(0, 220);
      search.clusterLetter = this.clusteringService.getClusterLetter(search.query);
    }

    if (input.description !== undefined) {
      search.description = String(input.description || '').trim().slice(0, 1000);
    }

    if (Array.isArray(input.tags)) {
      search.tags = this.cleanTags(input.tags);
    }

    search.metadata = {
      ...(search.metadata || {}),
      ...(input.metadata || {}),
      renamedAt: query ? new Date().toISOString() : search.metadata?.renamedAt,
    };
    search.updatedAt = new Date();
    return search.save();
  }

  async createRefinedSearchFromExisting(
    searchId: string,
    input: {
      query?: string;
      positiveEvidences?: any[];
      note?: string;
      userId?: string;
    },
  ): Promise<OsintSearchDocument> {
    const original = await this.osintSearchModel.findById(searchId).lean().exec() as any;
    if (!original) {
      throw new NotFoundException(`Búsqueda ${searchId} no encontrada`);
    }

    const originalInput = original.inputData || {};
    const positiveHints = (input.positiveEvidences || [])
      .slice(0, 8)
      .map((item) => [item.title, item.url, item.source].filter(Boolean).join(' | '))
      .filter(Boolean);

    const refinedInput: ExpandedPersonSearchDto = {
      image: originalInput.image,
      personalInfo: {
        ...(originalInput.personalInfo || {}),
      },
      context: {
        ...(originalInput.context || {}),
        notas: [
          originalInput.context?.notas,
          input.note,
          positiveHints.length ? `Evidencias positivas para refinar: ${positiveHints.join(' ; ')}` : '',
        ].filter(Boolean).join('\n'),
      },
      options: {
        ...(originalInput.options || {}),
        deepSearch: true,
        youtubeSearch: true,
        webArchiveSearch: true,
        searchEngines: [
          ...new Set([
            ...((originalInput.options?.searchEngines || []) as string[]),
            'serper',
            'tavily',
            'youtube',
          ]),
        ],
      } as any,
      userId: input.userId || original.userId,
    };

    const query = String(input.query || '').trim();
    if (query) {
      const [nombre, ...rest] = query.split(/\s+/).filter(Boolean);
      refinedInput.personalInfo = {
        ...(refinedInput.personalInfo || {}),
        nombre: refinedInput.personalInfo?.nombre || nombre,
        apellido: refinedInput.personalInfo?.apellido || rest.join(' '),
        alias: [
          refinedInput.personalInfo?.alias,
          original.query,
        ].filter(Boolean).join(', '),
      } as any;
    }

    const refined = await this.processInput(refinedInput);
    refined.metadata = {
      ...(refined.metadata || {}),
      refinedFromSearchId: searchId,
      positiveEvidenceCount: positiveHints.length,
      positiveHints,
    };
    await refined.save();
    return refined;
  }

  /**
   * Elimina una búsqueda y todas sus evidencias de MongoDB
   */
  async deleteSearch(searchId: string): Promise<{ deleted: true; evidencesDeleted: number }> {
    const search = await this.osintSearchModel.findById(searchId).exec();
    if (!search) {
      throw new NotFoundException(`Búsqueda ${searchId} no encontrada`);
    }

    const evidencesDeleted = await this.evidenceService.deleteEvidenceBySearch(searchId);
    await this.osintSearchModel.findByIdAndDelete(searchId).exec();

    this.logger.log(`Deleted search ${searchId} and ${evidencesDeleted} evidences`);
    return { deleted: true, evidencesDeleted };
  }

  private cleanTags(tags: string[]) {
    return [...new Set(
      tags
        .map((tag) => String(tag || '').trim().toLowerCase())
        .filter(Boolean)
        .map((tag) => tag.slice(0, 40)),
    )].slice(0, 20);
  }

  /**
   * Elimina TODAS las búsquedas y TODAS sus evidencias de MongoDB
   */
  async deleteAllSearches(): Promise<{ deleted: number; evidencesDeleted: number }> {
    const allSearches = await this.osintSearchModel.find({}, '_id').lean().exec();
    let totalEvidences = 0;

    // Borrar evidencias en paralelo para cada búsqueda
    await Promise.allSettled(
      allSearches.map(async (s: any) => {
        const sid = s._id.toString();
        const count = await this.evidenceService.deleteEvidenceBySearch(sid).catch(() => 0);
        totalEvidences += count;
      }),
    );

    const result = await this.osintSearchModel.deleteMany({}).exec();
    this.logger.warn(`[deleteAllSearches] Deleted ${result.deletedCount} searches and ${totalEvidences} evidences`);
    return { deleted: result.deletedCount, evidencesDeleted: totalEvidences };
  }

  /**
   * Agrupa búsquedas por clusterLetter usando aggregation de MongoDB.
   * Mucho más rápido que getAllSearches + JS grouping porque MongoDB hace
   * el join/sort server-side y solo devuelve el resultado comprimido.
   */
  async getClustersSummary(ownerId?: string): Promise<Array<{ letter: string; count: number; searches: any[] }>> {
    const raw = await this.osintSearchModel.aggregate([
      ...(ownerId ? [{ $match: { $or: [{ userId: ownerId }, { createdBy: ownerId }] } }] : []),
      // Sort descending so $push collects newest-first
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: { $ifNull: ['$clusterLetter', '#'] },
          count: { $sum: 1 },
          searches: {
            $push: {
              id:            { $toString: '$_id' },
              query:         '$query',
              status:        '$status',
              searchType:    { $ifNull: ['$searchType', 'all'] },
              category:      { $ifNull: ['$category', 'person'] },
              clusterLetter: { $ifNull: ['$clusterLetter', '#'] },
              isActive:      { $cond: { if: { $in: ['$status', ['completed', 'processing', 'pending']] }, then: true, else: false } },
              resultCount:   { $ifNull: ['$resultCount', 0] },
              createdAt:     '$createdAt',
              updatedAt:     '$updatedAt',
            },
          },
        },
      },
      // Keep at most 50 searches per cluster to avoid huge payloads
      {
        $project: {
          letter:   '$_id',
          count:    1,
          searches: { $slice: ['$searches', 50] },
        },
      },
      { $sort: { letter: 1 } },
    ]);

    return raw.map((c: any) => ({
      letter:   c.letter,
      count:    c.count,
      searches: c.searches,
    }));
  }

  /**
   * Obtiene todas las búsquedas con paginación y filtros avanzados
   * Compatible con OsintSearchList y OsintDashboard
   */
  async getAllSearches(
    query: {
      limit?: number;
      offset?: number;
      status?: string;
      clusterLetter?: string;
      sortBy?: 'createdAt' | 'updatedAt' | 'query' | 'resultCount';
      sortOrder?: 'asc' | 'desc';
      ownerId?: string;
    } = {},
  ): Promise<{
    searches: any[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const limit = Number(query.limit) || 50;
    const offset = Number(query.offset) || 0;
    const TIMEOUT_MS = 20_000;

    const filter: any = {};
    if (query.status) filter.status = query.status;
    if (query.clusterLetter) filter.clusterLetter = query.clusterLetter;
    if (query.ownerId) filter.$or = [{ userId: query.ownerId }, { createdBy: query.ownerId }];

    // Siempre ordenar por _id DESC — índice nativo de MongoDB, sin full-scan
    const sort: any = { _id: -1 };

    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('getAllSearches internal timeout')), TIMEOUT_MS),
      );

      // estimatedDocumentCount lee metadatos del collection (O(1), sin scan)
      // Solo usamos countDocuments si hay filtros activos
      const hasFilter = Object.keys(filter).length > 0;
      // Proyección de inclusión — solo los campos que usa transformedSearches.
      // Más seguro que exclusión: nuevos campos pesados no afectan performance.
      const PROJECTION = {
        query: 1, description: 1, tags: 1, searchType: 1, category: 1,
        status: 1, resultCount: 1, clusterLetter: 1, lastSearched: 1,
        scores: 1, error: 1, createdAt: 1, updatedAt: 1,
      };

      const [searches, total] = await Promise.race([
        Promise.all([
          this.osintSearchModel
            .find(filter)
            .select(PROJECTION)
            .sort(sort)
            .skip(offset)
            .limit(limit)
            .maxTimeMS(12_000)   // MongoDB cancela la query a nivel servidor si tarda > 12s
            .lean()
            .exec(),
          hasFilter
            ? this.osintSearchModel.countDocuments(filter).exec()
            : this.osintSearchModel.estimatedDocumentCount().exec(),
        ]),
        timeoutPromise,
      ]);

      const transformedSearches = (searches as any[]).map((search: any) => ({
        id: search._id.toString(),
        query: search.query,
        description: search.description || undefined,
        tags: search.tags || [],
        searchType: search.searchType || 'all',
        category: search.category || 'person',
        isActive: search.status === 'completed' || search.status === 'processing' || search.status === 'pending',
        resultCount: search.resultCount || 0,
        clusterLetter: search.clusterLetter || '',
        lastSearched: search.lastSearched,
        createdAt: search.createdAt,
        updatedAt: search.updatedAt,
        status: search.status,
        scores: search.scores,
        error: search.error,
      }));

      this.logger.log(`Retrieved ${transformedSearches.length} searches (total: ${total})`);
      return { searches: transformedSearches, total: total as number, limit, offset };
    } catch (error: any) {
      this.logger.warn(`⚠️ getAllSearches failed (returning empty): ${error.message}`);
      return { searches: [], total: 0, limit, offset };
    }
  }

  /**
   * Obtiene estadísticas generales de búsquedas
   * Compatible con OsintDashboard stats card
   */
  async getStats(ownerId?: string): Promise<{
    totalSearches: number;
    activeSearches: number;
    searchesByType: Record<string, number>;
    searchesByCategory: Record<string, number>;
    clusters: Array<{ letter: string; count: number }>;
  }> {
    const TIMEOUT_MS = 6_000;
    const ownerFilter = ownerId ? { $or: [{ userId: ownerId }, { createdBy: ownerId }] } : {};
    const ownerStages = ownerId ? [{ $match: ownerFilter }] : [];
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const fallback = {
      totalSearches: 0,
      activeSearches: 0,
      searchesByType: { google: 0, bing: 0, duckduckgo: 0, all: 0 },
      searchesByCategory: { person: 0 },
      clusters: [],
    };

    try {
      // Todas las consultas en paralelo — eliminamos la ejecución en serie
      const timeoutPromise = new Promise<never>((_, reject) =>
        timeout = setTimeout(() => reject(new Error('getStats internal timeout')), TIMEOUT_MS),
      );

      const work = Promise.all([
        this.osintSearchModel.countDocuments(ownerFilter).lean(),
        this.osintSearchModel.countDocuments({ ...ownerFilter, status: { $in: ['completed', 'processing', 'pending'] } }).lean(),
        this.osintSearchModel.aggregate([
          ...ownerStages,
          { $group: { _id: { $ifNull: ['$searchType', 'all'] }, count: { $sum: 1 } } },
        ]),
        this.osintSearchModel.aggregate([
          ...ownerStages,
          { $group: { _id: { $ifNull: ['$clusterLetter', '#'] }, count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ]),
      ]);

      const [totalSearches, activeSearches, engineAgg, clusterAgg] = await Promise.race([
        work,
        timeoutPromise,
      ]);

      const searchesByType: Record<string, number> = {
        google: 0, bing: 0, duckduckgo: 0, searxng: 0, tavily: 0,
        serper: 0, youtube: 0, webarchive: 0, yandex: 0, all: 0,
      };
      (engineAgg as any[]).forEach((item: { _id: string; count: number }) => {
        searchesByType[item._id] = (searchesByType[item._id] || 0) + item.count;
      });

      const clusters = (clusterAgg as any[])
        .filter((c) => c._id !== null)
        .map((c: any) => ({ letter: c._id || '#', count: c.count }));

      this.logger.log(`Stats: ${totalSearches} total, ${activeSearches} active, ${clusters.length} clusters`);

      return {
        totalSearches: totalSearches as number,
        activeSearches: activeSearches as number,
        searchesByType,
        searchesByCategory: { person: totalSearches as number },
        clusters,
      };
    } catch (error: any) {
      this.logger.warn(`⚠️ getStats failed (returning fallback): ${error.message}`);
      return fallback;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  // ============================================================================
  // FACE SEARCH PIPELINE — STUBS (preparado para implementación futura)
  // ============================================================================

  /**
   * Detecta rostros en una imagen usando Google Vision o similar.
   * @stub — Retorna placeholder hasta implementar VisionAI real.
   */
  async detectFace(
    _imageBase64: string,
  ): Promise<{ detected: boolean; boundingBox?: { x: number; y: number; width: number; height: number }; confidence?: number }> {
    this.logger.warn('⚠️ detectFace() — STUB: no implementado aún');
    return { detected: false };
  }

  /**
   * Recorta el rostro detectado de la imagen completa.
   * @stub — Requiere sharp + boundingBox de detectFace()
   */
  async cropFace(
    _imageBase64: string,
    _boundingBox: { x: number; y: number; width: number; height: number },
  ): Promise<{ croppedBase64: string; width: number; height: number } | null> {
    this.logger.warn('⚠️ cropFace() — STUB: no implementado aún');
    return null;
  }

  /**
   * Busca un rostro en servicios especializados (PimEyes, FaceCheck, etc.)
   * @stub — Requiere API key de servicio de búsqueda facial.
   */
  async searchFace(
    _croppedFaceBase64: string,
  ): Promise<{ matches: Array<{ url: string; similarity: number; source: string }> }> {
    this.logger.warn('⚠️ searchFace() — STUB: no implementado aún');
    return { matches: [] };
  }
}
