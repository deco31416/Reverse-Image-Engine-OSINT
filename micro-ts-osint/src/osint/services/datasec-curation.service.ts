import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { DatasecAsset, DatasecAssetDocument } from '../schemas/datasec-asset.schema';
import { DatasecPerson, DatasecPersonDocument } from '../schemas/datasec-person.schema';
import { Evidence, EvidenceDocument } from '../schemas/evidence.schema';
import { CloudinaryService } from './cloudinary.service';
import { SecurityValidationService } from './security-validation.service';

type PersonInput = Partial<DatasecPerson> & {
  firstName: string;
};

type AssetInput = Omit<Partial<DatasecAsset>, 'personId'> & {
  type?: DatasecAsset['type'];
  origin?: DatasecAsset['origin'];
  personId?: string;
};

@Injectable()
export class DatasecCurationService {
  private readonly logger = new Logger(DatasecCurationService.name);

  constructor(
    @InjectModel(DatasecPerson.name)
    private readonly personModel: Model<DatasecPersonDocument>,
    @InjectModel(DatasecAsset.name)
    private readonly assetModel: Model<DatasecAssetDocument>,
    @InjectModel(Evidence.name)
    private readonly evidenceModel: Model<EvidenceDocument>,
    private readonly cloudinaryService: CloudinaryService,
    private readonly securityValidation: SecurityValidationService,
  ) {}

  async createPerson(input: PersonInput) {
    const firstName = String(input.firstName || '').trim();
    if (!firstName) throw new BadRequestException('firstName is required');

    const person = await this.personModel.create({
      ...input,
      firstName,
      lastName: input.lastName?.trim(),
      aliases: this.cleanArray(input.aliases),
      tags: this.cleanArray(input.tags),
      status: input.status || 'active',
      metadata: input.metadata || {},
    });

    this.logger.log(`Datasec person created: ${person._id}`);
    return person;
  }

  async listPersons(options: { q?: string; page?: number; limit?: number; status?: string }) {
    const page = Math.max(Number(options.page || 1), 1);
    const limit = Math.min(Math.max(Number(options.limit || 20), 1), 100);
    const filter: any = {};

    if (options.status) filter.status = options.status;
    if (options.q?.trim()) filter.$text = { $search: options.q.trim() };

    const [items, total] = await Promise.all([
      this.personModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).exec(),
      this.personModel.countDocuments(filter).exec(),
    ]);

    return this.withPagination(items, total, page, limit);
  }

  async getPerson(personId: string) {
    const person = await this.personModel.findById(personId).exec();
    if (!person) throw new NotFoundException('Datasec person not found');

    const assets = await this.assetModel.find({ personId: person._id }).sort({ createdAt: -1 }).limit(200).exec();
    return { person, assets };
  }

  async createAsset(input: AssetInput) {
    const personObjectId = this.toObjectId(input.personId);
    const imageUrl = input.imageUrl
      ? await this.securityValidation.validatePublicUrl(input.imageUrl, {
          field: 'imageUrl',
          allowLocalUploads: true,
        })
      : undefined;
    const thumbnailUrl = input.thumbnailUrl
      ? await this.securityValidation.validatePublicUrl(input.thumbnailUrl, {
          field: 'thumbnailUrl',
          allowLocalUploads: true,
        })
      : undefined;
    const url = input.url
      ? await this.securityValidation.validatePublicUrl(input.url, {
          field: 'url',
          allowLocalUploads: true,
        })
      : undefined;
    const asset = await this.assetModel.create({
      ...input,
      personId: personObjectId,
      imageUrl,
      thumbnailUrl,
      url,
      type: input.type || 'image',
      origin: input.origin || 'manual',
      curationStatus: input.curationStatus || 'candidate',
      tags: this.cleanArray(input.tags),
      metadata: input.metadata || {},
    });

    if (personObjectId && asset.imageUrl) {
      await this.personModel.updateOne(
        { _id: personObjectId, primaryImageUrl: { $exists: false } },
        { $set: { primaryImageUrl: asset.imageUrl } },
      );
    }

    this.logger.log(`Datasec asset created: ${asset._id}`);
    return asset;
  }

  async uploadImage(input: AssetInput & {
    imageBase64: string;
    filename?: string;
    mimeType?: string;
  }) {
    const base64 = String(input.imageBase64 || '').trim();
    if (!base64) throw new BadRequestException('imageBase64 is required');
    this.securityValidation.validateImageBase64(base64, { field: 'imageBase64' });

    const person = input.personId && Types.ObjectId.isValid(input.personId)
      ? await this.personModel.findById(input.personId).exec()
      : null;
    const folder = this.buildStorageFolder(input, person);
    const filename = this.buildStorageFilename(input, person);
    const dataUri = base64.startsWith('data:')
      ? base64
      : `data:${input.mimeType || 'image/jpeg'};base64,${base64}`;

    const upload = await this.cloudinaryService.uploadBase64(dataUri, filename, {
      folder,
      tags: ['datasec', ...(input.personId ? ['person-linked'] : []), ...this.cleanArray(input.tags)],
      context: {
        origin: 'datasec',
        personId: input.personId || '',
        title: input.title || '',
        folder,
      },
      generateThumbnails: true,
    });

    const asset = await this.createAsset({
      ...input,
      type: input.type || 'image',
      origin: input.origin || 'manual',
      imageUrl: upload.secureUrl,
      thumbnailUrl: this.cloudinaryService.getThumbnailUrl(upload.publicId, 'medium'),
      source: input.source || 'dashboard-upload',
      metadata: {
        ...(input.metadata || {}),
        upload: {
          publicId: upload.publicId,
          format: upload.format,
          width: upload.width,
          height: upload.height,
          bytes: upload.bytes,
          createdAt: upload.createdAt,
          filename: input.filename,
          mimeType: input.mimeType,
          folder,
          storageName: filename,
        },
      },
    });

    return { asset, upload };
  }

  async downloadAsset(assetId: string) {
    if (!Types.ObjectId.isValid(assetId)) throw new BadRequestException('Invalid assetId');
    const asset = await this.assetModel.findById(assetId).populate('personId').exec();
    if (!asset) throw new NotFoundException('Datasec asset not found');

    const sourceUrl = asset.imageUrl || asset.thumbnailUrl || asset.url;
    if (!sourceUrl) throw new BadRequestException('Asset has no downloadable URL');
    await this.securityValidation.validatePublicUrl(sourceUrl, {
      field: 'asset.url',
      allowLocalUploads: true,
    });

    const buffer = await this.readAssetBytes(sourceUrl);
    const filename = this.assetDownloadName(asset);

    return {
      buffer,
      filename,
      contentType: this.contentTypeFromFilename(filename),
    };
  }

  async downloadArchive(options: {
    personId?: string;
    origin?: string;
    curationStatus?: string;
    type?: string;
    limit?: number;
  }) {
    const limit = Math.min(Math.max(Number(options.limit || 100), 1), 500);
    const filter: any = {};

    if (options.personId) filter.personId = this.toObjectId(options.personId);
    if (options.origin) filter.origin = options.origin;
    if (options.curationStatus) filter.curationStatus = options.curationStatus;
    if (options.type) filter.type = options.type;

    const assets = await this.assetModel
      .find(filter)
      .populate('personId')
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();

    if (!assets.length) throw new NotFoundException('No Datasec assets found for archive');

    const entries: { name: string; buffer: Buffer }[] = [];
    for (const asset of assets) {
      const sourceUrl = asset.imageUrl || asset.thumbnailUrl || asset.url;
      if (!sourceUrl) continue;

      try {
        await this.securityValidation.validatePublicUrl(sourceUrl, {
          field: 'asset.url',
          allowLocalUploads: true,
        });
        const buffer = await this.readAssetBytes(sourceUrl);
        entries.push({
          name: this.assetArchivePath(asset),
          buffer,
        });
      } catch (error: any) {
        this.logger.warn(`Skipping asset ${asset._id}: ${error.message}`);
      }
    }

    if (!entries.length) throw new NotFoundException('No downloadable files found for archive');

    const tar = Buffer.concat(entries.map((entry) => this.tarEntry(entry.name, entry.buffer)).concat([Buffer.alloc(1024)]));
    const gzip = zlib.gzipSync(tar);

    return {
      buffer: gzip,
      filename: `datasec-export-${new Date().toISOString().slice(0, 10)}.tar.gz`,
      contentType: 'application/gzip',
      total: entries.length,
    };
  }

  async resolveAssetImageUrl(assetId: string) {
    if (!Types.ObjectId.isValid(assetId)) throw new BadRequestException('Invalid datasecAssetId');

    const asset = await this.assetModel.findById(assetId).exec();
    if (!asset) throw new NotFoundException('Datasec asset not found');

    const imageUrl = asset.imageUrl || asset.thumbnailUrl || asset.url;
    if (!imageUrl) throw new BadRequestException('Datasec asset has no image URL');

    return {
      assetId: asset._id.toString(),
      imageUrl,
      title: asset.title,
      type: asset.type,
      origin: asset.origin,
      curationStatus: asset.curationStatus,
    };
  }

  async listFaceCandidates(options: { personId?: string; limit?: number }) {
    const limit = Math.min(Math.max(Number(options.limit || 24), 1), 100);
    const filter: any = {
      type: { $in: ['image', 'face'] },
      curationStatus: { $ne: 'discarded' },
    };

    if (options.personId) filter.personId = this.toObjectId(options.personId);

    const assets = await this.assetModel
      .find(filter)
      .populate('personId')
      .sort({ curationStatus: -1, createdAt: -1 })
      .limit(limit)
      .exec();

    return assets
      .map((asset: any) => {
        const url = asset.imageUrl || asset.thumbnailUrl || asset.url;
        if (!url) return null;
        const person = asset.personId && typeof asset.personId === 'object' ? asset.personId : null;
        return {
          id: asset._id.toString(),
          url,
          secureUrl: url,
          thumbnailUrl: asset.thumbnailUrl,
          title: asset.title,
          source: 'datasec-internal',
          curationStatus: asset.curationStatus,
          confidence: asset.confidence,
          personId: person?._id?.toString?.() || asset.personId?.toString?.(),
          personName: person ? [person.firstName, person.lastName].filter(Boolean).join(' ') : undefined,
          createdAt: asset.createdAt,
        };
      })
      .filter(Boolean);
  }

  async listAssets(options: {
    q?: string;
    page?: number;
    limit?: number;
    personId?: string;
    type?: string;
    curationStatus?: string;
    origin?: string;
  }) {
    const page = Math.max(Number(options.page || 1), 1);
    const limit = Math.min(Math.max(Number(options.limit || 24), 1), 100);
    const filter: any = {};

    if (options.personId) filter.personId = this.toObjectId(options.personId);
    if (options.type) filter.type = options.type;
    if (options.curationStatus) filter.curationStatus = options.curationStatus;
    if (options.origin) filter.origin = options.origin;
    if (options.q?.trim()) filter.$text = { $search: options.q.trim() };

    const [items, total] = await Promise.all([
      this.assetModel.find(filter).populate('personId').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).exec(),
      this.assetModel.countDocuments(filter).exec(),
    ]);

    return this.withPagination(items, total, page, limit);
  }

  async promoteEvidence(body: {
    evidenceId: string;
    personId?: string;
    createPerson?: PersonInput;
    curationStatus?: DatasecAsset['curationStatus'];
    tags?: string[];
  }) {
    if (!body.evidenceId) throw new BadRequestException('evidenceId is required');

    const evidence = await this.evidenceModel.findOne({ evidenceId: body.evidenceId }).exec();
    if (!evidence) throw new NotFoundException('Evidence not found');

    let personId = body.personId;
    if (!personId && body.createPerson?.firstName) {
      const person = await this.createPerson(body.createPerson);
      personId = person._id.toString();
    }

    const existing = await this.assetModel.findOne({ evidenceId: evidence.evidenceId }).exec();
    if (existing) {
      if (personId && !existing.personId) existing.personId = this.toObjectId(personId);
      existing.curationStatus = body.curationStatus || existing.curationStatus;
      existing.tags = Array.from(new Set([...existing.tags, ...this.cleanArray(body.tags)]));
      await existing.save();
      return { asset: existing, evidence, reused: true };
    }

    const asset = await this.createAsset({
      personId,
      type: this.inferAssetType(evidence),
      origin: 'osint',
      title: evidence.title,
      description: evidence.summary,
      url: evidence.url,
      imageUrl: evidence.imageUrl,
      thumbnailUrl: evidence.thumbnailUrl,
      source: evidence.source,
      searchId: evidence.searchId,
      evidenceId: evidence.evidenceId,
      confidence: evidence.matchConfidence || evidence.reliability,
      curationStatus: body.curationStatus || (evidence.validationStatus === 'valid' ? 'validated' : 'candidate'),
      tags: [...this.cleanArray(evidence.tags), ...this.cleanArray(body.tags)],
      metadata: {
        category: evidence.category,
        reliability: evidence.reliability,
        validationStatus: evidence.validationStatus,
        extractedData: evidence.extractedData,
      },
    });

    return { asset, evidence, reused: false };
  }

  async promoteSocialAsset(socialAsset: any, body: {
    personId?: string;
    createPerson?: Partial<PersonInput>;
    curationStatus?: DatasecAsset['curationStatus'];
    tags?: string[];
  }) {
    if (!socialAsset?._id && !socialAsset?.id) throw new BadRequestException('socialAsset is required');
    const socialAssetId = String(socialAsset._id || socialAsset.id);

    let personId = body.personId;
    if (!personId && body.createPerson?.firstName) {
      const person = await this.createPerson(body.createPerson as PersonInput);
      personId = person._id.toString();
    }

    const existing = await this.assetModel.findOne({ 'metadata.socialAssetId': socialAssetId }).exec();
    if (existing) {
      if (personId && !existing.personId) existing.personId = this.toObjectId(personId);
      existing.curationStatus = body.curationStatus || existing.curationStatus;
      existing.tags = Array.from(new Set([...existing.tags, ...this.cleanArray(body.tags), 'social-scraper']));
      await existing.save();
      return { asset: existing, socialAsset, reused: true };
    }

    const metadata = socialAsset.metadata || {};
    const imageUrl = this.pickPublicImageUrl(socialAsset);
    const sourceUrl = this.pickPublicUrl(socialAsset.sourceUrl, metadata.profileUrl, metadata.sourceUrl, metadata.url);
    const title = metadata.name || metadata.username || socialAsset.owner || `${socialAsset.platform || 'social'} asset`;
    const socialType = String(socialAsset.type || 'other');

    const asset = await this.createAsset({
      personId,
      type: this.mapSocialAssetType(socialType, imageUrl),
      origin: 'osint',
      title,
      description: this.socialAssetDescription(socialAsset),
      url: sourceUrl,
      imageUrl,
      thumbnailUrl: this.pickPublicUrl(metadata.thumbnailUrl, metadata.avatarUrl),
      source: `social-scraper:${socialAsset.platform || 'unknown'}`,
      searchId: socialAsset.osintSearchId || socialAsset.searchId,
      confidence: this.normalizeConfidence(metadata.score ?? metadata.similarity ?? metadata.confidence),
      curationStatus: body.curationStatus || (socialAsset.status === 'positive' ? 'validated' : 'candidate'),
      tags: Array.from(new Set([
        'social-scraper',
        socialAsset.platform,
        socialAsset.owner,
        socialAsset.status,
        ...this.cleanArray(body.tags),
      ].filter(Boolean).map(String))),
      metadata: {
        socialAssetId,
        socialStatus: socialAsset.status || 'candidate',
        platform: socialAsset.platform,
        owner: socialAsset.owner,
        sourceUrl: socialAsset.sourceUrl,
        publicUrl: socialAsset.publicUrl,
        relativePath: socialAsset.relativePath,
        filename: socialAsset.filename,
        mimeType: socialAsset.mimeType,
        size: socialAsset.size,
        scraperMetadata: metadata,
      },
    });

    return { asset, socialAsset, reused: false };
  }

  async stats() {
    const [persons, assets, validatedAssets, candidates, images, faces, osintAssets] = await Promise.all([
      this.personModel.countDocuments({ status: 'active' }).exec(),
      this.assetModel.countDocuments({}).exec(),
      this.assetModel.countDocuments({ curationStatus: 'validated' }).exec(),
      this.assetModel.countDocuments({ curationStatus: 'candidate' }).exec(),
      this.assetModel.countDocuments({ type: 'image' }).exec(),
      this.assetModel.countDocuments({ type: 'face' }).exec(),
      this.assetModel.countDocuments({ origin: 'osint' }).exec(),
    ]);

    return { persons, assets, validatedAssets, candidates, images, faces, osintAssets };
  }

  private inferAssetType(evidence: Evidence): DatasecAsset['type'] {
    if (evidence.imageUrl || evidence.thumbnailUrl || evidence.category === 'google_vision') return 'image';
    if (evidence.category === 'social') return 'profile';
    if (evidence.category === 'video') return 'post';
    return 'link';
  }

  private mapSocialAssetType(type: string, imageUrl?: string): DatasecAsset['type'] {
    if (type === 'image' || imageUrl) return 'image';
    if (type === 'profile') return 'profile';
    if (type === 'post') return 'post';
    if (type === 'link') return 'link';
    return 'link';
  }

  private pickPublicImageUrl(socialAsset: any) {
    const metadata = socialAsset?.metadata || {};
    return this.pickPublicUrl(
      socialAsset?.publicUrl,
      metadata?.avatarUrl,
      metadata?.thumbnailUrl,
      metadata?.imageUrl,
    );
  }

  private pickPublicUrl(...values: any[]) {
    return values.find((value) => typeof value === 'string' && /^https?:\/\//i.test(value));
  }

  private socialAssetDescription(socialAsset: any) {
    const metadata = socialAsset?.metadata || {};
    return [
      metadata.bio,
      socialAsset.platform ? `Fuente: ${socialAsset.platform}` : '',
      socialAsset.owner ? `Owner: ${socialAsset.owner}` : '',
      socialAsset.status ? `Estado social: ${socialAsset.status}` : '',
    ].filter(Boolean).join('\n');
  }

  private normalizeConfidence(value: any) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return undefined;
    if (numeric > 1) return Math.min(Math.max(numeric / 100, 0), 1);
    return Math.min(Math.max(numeric, 0), 1);
  }

  private toObjectId(value?: string): Types.ObjectId | undefined {
    if (!value) return undefined;
    if (!Types.ObjectId.isValid(value)) throw new BadRequestException('Invalid personId');
    return new Types.ObjectId(value);
  }

  private cleanArray(value?: string[]) {
    return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
  }

  private buildStorageFolder(input: AssetInput, person?: DatasecPersonDocument | null) {
    const type = this.slug(input.type || 'image');
    if (!person) return `datasec/_/sin-persona/${type}`;

    const name = this.personSlug(person);
    const letter = this.clusterLetter(person.lastName || person.firstName || name);
    return `datasec/${letter}/${name}/${type}`;
  }

  private buildStorageFilename(input: AssetInput, person?: DatasecPersonDocument | null) {
    const personPart = person ? this.personSlug(person) : 'sin-persona';
    const titlePart = this.slug(input.title || (input as any).filename || input.type || 'asset');
    return `${personPart}-${titlePart}`;
  }

  private personSlug(person: any) {
    return this.slug([
      person.firstName,
      person.lastName,
      person.documentId,
    ].filter(Boolean).join('-')) || `persona-${person._id}`;
  }

  private clusterLetter(value: string) {
    const first = this.slug(value).charAt(0).toUpperCase();
    return /^[A-Z]$/.test(first) ? first : '_';
  }

  private assetArchivePath(asset: any) {
    const person = asset.personId && typeof asset.personId === 'object' ? asset.personId : null;
    const folder = this.buildStorageFolder(asset, person);
    return `${folder}/${this.assetDownloadName(asset)}`;
  }

  private assetDownloadName(asset: any) {
    const uploadName = asset.metadata?.upload?.storageName || asset.metadata?.upload?.filename;
    const base = this.slug(asset.title || uploadName || asset.type || 'datasec-asset');
    const ext = this.extensionFromUrl(asset.imageUrl || asset.thumbnailUrl || asset.url) || asset.metadata?.upload?.format || 'jpg';
    return `${base}-${String(asset._id).slice(-6)}.${String(ext).replace('jpeg', 'jpg')}`;
  }

  private async readAssetBytes(sourceUrl: string) {
    const localPath = this.cloudinaryService.getLocalPath(sourceUrl);
    if (localPath && fs.existsSync(localPath)) {
      return fs.readFileSync(localPath);
    }

    return this.securityValidation.fetchPublicUrl(sourceUrl, {
      field: 'asset.url',
      allowLocalUploads: true,
    });
  }

  private contentTypeFromFilename(filename: string) {
    const ext = this.extensionFromUrl(filename);
    if (ext === 'png') return 'image/png';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'gif') return 'image/gif';
    return 'image/jpeg';
  }

  private extensionFromUrl(value?: string) {
    const clean = String(value || '').split('?')[0];
    const ext = path.extname(clean).replace('.', '').toLowerCase();
    return ext || undefined;
  }

  private tarEntry(name: string, buffer: Buffer) {
    const normalizedName = name.replace(/\\/g, '/').slice(0, 100);
    const header = Buffer.alloc(512, 0);
    header.write(normalizedName, 0, 100);
    header.write('0000644\0', 100, 8);
    header.write('0000000\0', 108, 8);
    header.write('0000000\0', 116, 8);
    header.write(buffer.length.toString(8).padStart(11, '0') + '\0', 124, 12);
    header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136, 12);
    header.fill(' ', 148, 156);
    header.write('0', 156, 1);
    header.write('ustar\0', 257, 6);
    header.write('00', 263, 2);

    let checksum = 0;
    for (const byte of header) checksum += byte;
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8);

    const padding = Buffer.alloc((512 - (buffer.length % 512)) % 512, 0);
    return Buffer.concat([header, buffer, padding]);
  }

  private safeFilename(value: string) {
    return this.slug(value) || `datasec-${Date.now()}`;
  }

  private slug(value: string) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  private withPagination<T>(items: T[], total: number, page: number, limit: number) {
    const totalPages = Math.ceil(total / limit);
    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }
}
