import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  IdentityCluster,
  IdentityClusterDocument,
} from '../schemas/identity-cluster.schema';

/**
 * Identity Clustering Service
 *
 * Vincula búsquedas a identidades reales:
 * - "Usuario Demo" + "operador-demo" → cluster único
 * - Próxima búsqueda de "operador-demo" → mismo cluster, agrega evidencias
 * - Hay miles de "Usuario Demo" pero solo UNO con alias "operador-demo"
 *
 * Matching rules:
 * 1. Username EXACTO → mismo cluster (username es globalmente único)
 * 2. Email EXACTO → mismo cluster
 * 3. Teléfono EXACTO → mismo cluster
 * 4. Slug (nombre+username) → mismo cluster
 */
@Injectable()
export class ClusteringService {
  private readonly logger = new Logger(ClusteringService.name);

  constructor(
    @InjectModel(IdentityCluster.name)
    private clusterModel: Model<IdentityClusterDocument>,
  ) {}

  /**
   * Genera un slug limpio para el cluster
   * "Usuario Demo" + "operador-demo" → "usuario-demo-operador-demo"
   */
  private generateSlug(fullName?: string, username?: string): string {
    const parts: string[] = [];

    if (fullName) {
      parts.push(
        fullName
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9\s]/g, '')
          .trim()
          .replace(/\s+/g, '-'),
      );
    }

    if (username) {
      const clean = username
        .toLowerCase()
        .replace(/^@/, '')
        .replace(/[^a-z0-9_-]/g, '');
      if (clean && !parts.includes(clean)) {
        parts.push(clean);
      }
    }

    if (parts.length === 0) {
      return `unknown-${Date.now()}`;
    }

    return parts.join('-');
  }

  /**
   * Escapa caracteres especiales de regex
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Busca un cluster existente que coincida con la identidad.
   *
   * Prioridad:
   * 1. Username exacto en aliases → match seguro
   * 2. Email exacto en emails → match seguro
   * 3. Teléfono exacto → match seguro
   * 4. Slug (nombre+username) → match
   */
  async findMatchingCluster(identity: {
    fullName?: string;
    username?: string;
    email?: string;
    phone?: string;
  }): Promise<IdentityClusterDocument | null> {
    const { fullName, username, email, phone } = identity;

    // 1. Username match (globalmente único)
    if (username) {
      const clean = username.toLowerCase().replace(/^@/, '');
      const byUsername = await this.clusterModel
        .findOne({
          aliases: { $regex: new RegExp(`^${this.escapeRegex(clean)}$`, 'i') },
          isActive: true,
        })
        .exec();
      if (byUsername) {
        this.logger.log(`🔗 Cluster match por username "${clean}": ${byUsername.slug}`);
        return byUsername;
      }
    }

    // 2. Email match
    if (email) {
      const byEmail = await this.clusterModel
        .findOne({
          emails: { $regex: new RegExp(`^${this.escapeRegex(email)}$`, 'i') },
          isActive: true,
        })
        .exec();
      if (byEmail) {
        this.logger.log(`🔗 Cluster match por email "${email}": ${byEmail.slug}`);
        return byEmail;
      }
    }

    // 3. Phone match
    if (phone) {
      const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
      const byPhone = await this.clusterModel
        .findOne({ phones: cleanPhone, isActive: true })
        .exec();
      if (byPhone) {
        this.logger.log(`🔗 Cluster match por teléfono: ${byPhone.slug}`);
        return byPhone;
      }
    }

    // 4. Slug match only when a username is present. A name alone is not an
    // identity key: many different people can share the same full name.
    if (username) {
      const slug = this.generateSlug(fullName, username);
      const bySlug = await this.clusterModel
        .findOne({ slug, isActive: true })
        .exec();
      if (bySlug) {
        this.logger.log(`🔗 Cluster match por slug "${slug}": ${bySlug.slug}`);
        return bySlug;
      }
    }

    return null;
  }

  /**
   * Busca o crea un cluster para la identidad proporcionada.
   * Si ya existe → lo actualiza con datos nuevos y agrega el searchId.
   * Si no existe → lo crea.
   */
  async findOrCreateCluster(identity: {
    fullName?: string;
    username?: string;
    email?: string;
    phone?: string;
    searchId: string;
    imageUrl?: string;
  }): Promise<IdentityClusterDocument> {
    const { fullName, username, email, phone, searchId, imageUrl } = identity;

    const existing = await this.findMatchingCluster({ fullName, username, email, phone });

    if (existing) {
      return this.updateCluster(existing, { fullName, username, email, phone, searchId, imageUrl });
    }

    return this.createCluster({ fullName, username, email, phone, searchId, imageUrl });
  }

  /**
   * Crea un cluster nuevo
   */
  private async createCluster(identity: {
    fullName?: string;
    username?: string;
    email?: string;
    phone?: string;
    searchId: string;
    imageUrl?: string;
  }): Promise<IdentityClusterDocument> {
    const { fullName, username, email, phone, searchId, imageUrl } = identity;
    const baseSlug = this.generateSlug(fullName, username);
    const slug = username || email || phone
      ? baseSlug
      : `${baseSlug}-${searchId.slice(-8).toLowerCase()}`;

    const aliases: string[] = [];
    if (username) {
      const clean = username.toLowerCase().replace(/^@/, '');
      aliases.push(clean);
      if (!clean.startsWith('@')) aliases.push(`@${clean}`);
    }
    if (fullName) aliases.push(fullName.toLowerCase());

    const emails: string[] = [];
    if (email) emails.push(email.toLowerCase());

    const phones: string[] = [];
    if (phone) phones.push(phone.replace(/[\s\-\(\)]/g, ''));

    const displayName = fullName
      ? username ? `${fullName} (${username})` : fullName
      : username || 'Unknown';

    const cluster = new this.clusterModel({
      slug,
      displayName,
      fullName: fullName || undefined,
      aliases,
      emails,
      phones,
      searchIds: [searchId],
      totalEvidence: 0,
      platforms: [],
      confirmedProfiles: [],
      primaryImageUrl: imageUrl,
      isActive: true,
      lastSearched: new Date(),
    });

    const saved = await cluster.save();
    this.logger.log(`🆕 Nuevo cluster de identidad: "${saved.slug}" (${saved.displayName})`);
    this.logger.log(`   Aliases: [${saved.aliases.join(', ')}] | Emails: [${saved.emails.join(', ')}]`);

    return saved;
  }

  /**
   * Actualiza un cluster existente con datos nuevos
   */
  private async updateCluster(
    cluster: IdentityClusterDocument,
    identity: {
      fullName?: string;
      username?: string;
      email?: string;
      phone?: string;
      searchId: string;
      imageUrl?: string;
    },
  ): Promise<IdentityClusterDocument> {
    const { fullName, username, email, phone, searchId, imageUrl } = identity;

    if (!cluster.searchIds.includes(searchId)) {
      cluster.searchIds.push(searchId);
    }

    if (username) {
      const clean = username.toLowerCase().replace(/^@/, '');
      if (!cluster.aliases.includes(clean)) cluster.aliases.push(clean);
      const handle = `@${clean}`;
      if (!cluster.aliases.includes(handle)) cluster.aliases.push(handle);
    }
    if (fullName) {
      const lower = fullName.toLowerCase();
      if (!cluster.aliases.includes(lower)) cluster.aliases.push(lower);
    }
    if (email) {
      const lower = email.toLowerCase();
      if (!cluster.emails.includes(lower)) cluster.emails.push(lower);
    }
    if (phone) {
      const clean = phone.replace(/[\s\-\(\)]/g, '');
      if (!cluster.phones.includes(clean)) cluster.phones.push(clean);
    }

    if (fullName && !cluster.fullName) {
      cluster.fullName = fullName;
      cluster.displayName = username ? `${fullName} (${username})` : fullName;
    }
    if (imageUrl && !cluster.primaryImageUrl) {
      cluster.primaryImageUrl = imageUrl;
    }

    cluster.lastSearched = new Date();
    const saved = await cluster.save();
    this.logger.log(`🔄 Cluster actualizado: "${saved.slug}" - ${saved.searchIds.length} búsquedas, ${saved.aliases.length} aliases`);
    return saved;
  }

  /**
   * Actualiza estadísticas del cluster después de una búsqueda
   */
  async updateClusterStats(
    clusterId: string,
    stats: {
      totalEvidence: number;
      platforms: string[];
      scores?: { identity: number; legal: number; financial: number; overall: number };
    },
  ): Promise<void> {
    const cluster = await this.clusterModel.findById(clusterId).exec();
    if (!cluster) return;

    cluster.totalEvidence = stats.totalEvidence;
    const allPlatforms = new Set([...cluster.platforms, ...stats.platforms]);
    cluster.platforms = [...allPlatforms];
    if (stats.scores) cluster.scores = stats.scores;
    await cluster.save();
  }

  /**
   * Obtiene cluster por ID
   */
  async getClusterById(id: string): Promise<IdentityClusterDocument | null> {
    return this.clusterModel.findById(id).exec();
  }

  /**
   * Obtiene cluster por slug
   */
  async getClusterBySlug(slug: string): Promise<IdentityClusterDocument | null> {
    return this.clusterModel.findOne({ slug, isActive: true }).exec();
  }

  /**
   * Lista todos los clusters activos
   */
  async listClusters(options: {
    page?: number;
    limit?: number;
    search?: string;
  } = {}): Promise<{
    clusters: IdentityClusterDocument[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const page = options.page || 1;
    const limit = options.limit || 20;
    const skip = (page - 1) * limit;

    const filter: any = { isActive: true };
    if (options.search) {
      filter.$or = [
        { slug: { $regex: options.search, $options: 'i' } },
        { displayName: { $regex: options.search, $options: 'i' } },
        { aliases: { $regex: options.search, $options: 'i' } },
        { emails: { $regex: options.search, $options: 'i' } },
      ];
    }

    const [clusters, total] = await Promise.all([
      this.clusterModel.find(filter).sort({ lastSearched: -1 }).skip(skip).limit(limit).exec(),
      this.clusterModel.countDocuments(filter).exec(),
    ]);

    return { clusters, total, page, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Obtiene los searchIds de un cluster (para cargar TODAS las evidencias)
   */
  getClusterSearchIds(cluster: IdentityClusterDocument): string[] {
    return cluster.searchIds;
  }

  // ========================================
  // Legacy (retrocompatibilidad)
  // ========================================
  getClusterLetter(query: string): string {
    if (!query || query.trim().length === 0) return '#';
    const firstChar = query.trim()[0].toUpperCase();
    return /[A-Z]/.test(firstChar) ? firstChar : '#';
  }
}
