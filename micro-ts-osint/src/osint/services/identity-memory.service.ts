import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { createHash } from 'crypto';
import { IdentityCandidate, IdentityCandidateDocument } from '../schemas/identity-candidate.schema';
import { TargetSubject, TargetSubjectDocument } from '../schemas/target-subject.schema';
import { SecurityValidationService } from './security-validation.service';
import { CloudinaryService } from './cloudinary.service';
import { FaceBiometricClientService } from './face-biometric-client.service';
import { DatasecPerson, DatasecPersonDocument } from '../schemas/datasec-person.schema';

@Injectable()
export class IdentityMemoryService {
  constructor(
    @InjectModel(TargetSubject.name) private readonly subjectModel: Model<TargetSubjectDocument>,
    @InjectModel(IdentityCandidate.name) private readonly candidateModel: Model<IdentityCandidateDocument>,
    private readonly securityValidation: SecurityValidationService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly biometricClient: FaceBiometricClientService,
    @InjectModel(DatasecPerson.name) private readonly datasecPersonModel: Model<DatasecPersonDocument>,
    @InjectConnection() private readonly mongoConnection: Connection,
  ) {}

  async addSubjectView(searchId: string, input: { imageBase64?: string; imageUrl?: string; acceptMismatch?: boolean }) {
    const subject = await this.subjectModel.findOne({ searchId }).select('+biometricTemplates').exec();
    if (!subject) throw new NotFoundException('Target subject not found');
    const bytes = input.imageBase64
      ? this.decodeImageBase64(input.imageBase64)
      : await this.securityValidation.fetchPublicUrl(String(input.imageUrl || ''), {
          field: 'identitySubject.imageUrl', accept: 'image/*,*/*;q=0.8',
        });
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const templates = subject.biometricTemplates || [];
    if (templates.some((template) => template.assetSha256 === sha256)) {
      return { subjectId: subject._id, added: false, duplicate: true, sha256 };
    }
    const extraction = await this.biometricClient.extract(bytes, 1);
    const face = extraction.faces?.[0];
    if (!face?.embedding?.length) throw new BadRequestException('No usable face detected in image');
    const comparisons = await Promise.all(templates.map((template) =>
      this.biometricClient.compare(template.embedding, face.embedding!),
    ));
    const bestComparison = comparisons.sort((a, b) => b.cosineSimilarity - a.cosineSimilarity)[0];
    if (bestComparison?.classification === 'unlikely' && !input.acceptMismatch) {
      return { subjectId: subject._id, added: false, requiresReview: true, sha256, bestComparison };
    }
    const uploaded = await this.cloudinaryService.uploadBase64(
      `data:image/jpeg;base64,${bytes.toString('base64')}`,
      `subject-view-${sha256.slice(0, 12)}.jpg`,
      { folder: `osint/identity-memory/${searchId}/subject`, tags: ['osint', 'subject-view', 'biometric'] },
    );
    subject.sourceImageUrls = Array.from(new Set([...(subject.sourceImageUrls || []), uploaded.secureUrl]));
    subject.biometricTemplates = [...templates, {
      assetSha256: sha256,
      embedding: face.embedding,
      dimensions: face.embeddingDimensions || face.embedding.length,
      model: face.model,
      modelVersion: face.modelVersion,
      qualityScore: face.qualityScore,
      sourceImageUrl: uploaded.secureUrl,
      createdAt: new Date(),
    }];
    await subject.save();
    return { subjectId: subject._id, added: true, sha256, imageUrl: uploaded.secureUrl, face: {
      boundingBox: face.boundingBox, detectionScore: face.detectionScore, qualityScore: face.qualityScore,
      model: face.model, modelVersion: face.modelVersion,
    }, bestComparison };
  }

  private decodeImageBase64(value: string) {
    const normalized = String(value || '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
    if (!/^[a-zA-Z0-9+/]+={0,2}$/.test(normalized)) throw new BadRequestException('Invalid imageBase64');
    const bytes = Buffer.from(normalized, 'base64');
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new BadRequestException('Image size is invalid');
    return bytes;
  }

  async ensureUnknownSubject(searchId: string, imageUrl?: string) {
    const subjectKey = `face-${searchId}`;
    return this.subjectModel.findOneAndUpdate(
      { subjectKey },
      {
        $setOnInsert: { subjectKey, searchId, identityStatus: 'unknown' },
        ...(imageUrl ? { $addToSet: { sourceImageUrls: imageUrl } } : {}),
      },
      { new: true, upsert: true },
    ).exec();
  }

  async addVisualCandidates(searchId: string, matches: any[], checkpoint?: () => Promise<void>) {
    await this.ensureUnknownSubject(searchId);
    const subject = await this.subjectModel.findOne({ searchId }).select('+biometricTemplates').exec();
    if (!subject) throw new NotFoundException('Target subject not found');
    const candidates: IdentityCandidateDocument[] = [];
    for (const [index, match] of (matches || []).entries()) {
      await checkpoint?.();
      const sourceUrl = String(match.url || '').trim();
      const externalImageUrl = String(match.thumbnailUrl || match.imageUrl || '').trim();
      const preserved = index < 12
        ? await this.preserveCandidateImage(searchId, externalImageUrl, index)
        : { status: 'not_attempted' as const };
      const imageUrl = preserved.storedImageUrl || externalImageUrl;
      if (!sourceUrl && !imageUrl) continue;
      const platform = String(match.socialPlatform || match.source || 'public-web');
      const duplicateByHash = preserved.sha256
        ? await this.candidateModel.findOne({ subjectId: subject._id, 'metadata.sha256': preserved.sha256 }).exec()
        : null;
      if (duplicateByHash) {
        if (sourceUrl && !duplicateByHash.profiles.some((profile) => profile.url === sourceUrl)) {
          duplicateByHash.profiles.push({ platform, url: sourceUrl, verificationStatus: 'candidate' });
          await duplicateByHash.save();
        }
        candidates.push(duplicateByHash);
        continue;
      }
      const existing = sourceUrl
        ? await this.candidateModel.findOne({ subjectId: subject._id, 'profiles.url': sourceUrl }).exec()
        : null;
      if (existing) {
        candidates.push(existing);
        continue;
      }
      const biometric: {
        status: 'not_evaluated' | 'unavailable' | 'no_face' | 'unlikely' | 'candidate' | 'probable';
        facesDetected?: number;
        cosineSimilarity?: number;
        model?: string;
        modelVersion?: string;
        comparedTemplates?: number;
      } = preserved.buffer
        ? await this.evaluateCandidateImage(subject.biometricTemplates || [], preserved.buffer)
        : { status: 'unavailable' as const };
      await checkpoint?.();
      candidates.push(await this.candidateModel.create({
        subjectId: subject._id,
        searchId,
        displayName: match.title || undefined,
        profiles: sourceUrl ? [{ platform, url: sourceUrl, verificationStatus: 'candidate' }] : [],
        imageUrls: imageUrl ? [imageUrl] : [],
        scores: {
          discovery: Number(match.similarity || 0),
          face: biometric.cosineSimilarity,
          overall: Number(match.similarity || 0),
        },
        biometricStatus: biometric.status,
        signals: [
          { type: 'visual_discovery', value: sourceUrl || imageUrl, score: Number(match.similarity || 0), source: match.source },
          ...(typeof biometric.cosineSimilarity === 'number'
            ? [{ type: 'biometric_comparison', value: biometric.status, score: biometric.cosineSimilarity, source: biometric.model }]
            : []),
        ],
        status: biometric.status === 'probable' ? 'probable' : 'candidate',
        metadata: {
          identityVerified: false,
          scoreType: 'visual_candidate',
          domain: match.domain,
          custodyStatus: preserved.status,
          originalImageUrl: externalImageUrl || undefined,
          storedImageUrl: preserved.storedImageUrl,
          sha256: preserved.sha256,
          bytes: preserved.bytes,
          biometric: {
            status: biometric.status,
            facesDetected: biometric.facesDetected,
            cosineSimilarity: biometric.cosineSimilarity,
            model: biometric.model,
            modelVersion: biometric.modelVersion,
            comparedTemplates: biometric.comparedTemplates,
          },
        },
      }));
    }
    return { subject, candidates };
  }

  private async preserveCandidateImage(searchId: string, imageUrl: string, index: number): Promise<{
    status: 'preserved' | 'unavailable' | 'not_attempted';
    storedImageUrl?: string;
    sha256?: string;
    bytes?: number;
    buffer?: Buffer;
  }> {
    if (!/^https?:\/\//i.test(imageUrl)) return { status: 'unavailable' };
    try {
      const bytes = await this.securityValidation.fetchPublicUrl(imageUrl, {
        field: 'identityCandidate.imageUrl',
        accept: 'image/*,*/*;q=0.8',
      });
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const uploaded = await this.cloudinaryService.uploadBase64(
        `data:${this.imageMime(imageUrl)};base64,${bytes.toString('base64')}`,
        `candidate-${String(index + 1).padStart(2, '0')}-${sha256.slice(0, 12)}.jpg`,
        {
          folder: `osint/identity-memory/${searchId}/candidates`,
          tags: ['osint', 'identity-candidate', 'unverified'],
          context: { searchId, originalImageUrl: imageUrl, sha256 },
        },
      );
      return { status: 'preserved', storedImageUrl: uploaded.secureUrl, sha256, bytes: bytes.length, buffer: bytes };
    } catch {
      return { status: 'unavailable' };
    }
  }

  private async evaluateCandidateImage(templates: TargetSubject['biometricTemplates'], bytes: Buffer): Promise<{
    status: 'not_evaluated' | 'no_face' | 'unlikely' | 'candidate' | 'probable';
    facesDetected?: number;
    cosineSimilarity?: number;
    model?: string;
    modelVersion?: string;
    comparedTemplates?: number;
  }> {
    if (!templates.length) return { status: 'not_evaluated', comparedTemplates: 0 };
    try {
      const extraction = await this.biometricClient.extract(bytes, 5);
      if (!extraction.facesDetected || !extraction.faces?.length) {
        return { status: 'no_face', facesDetected: 0, comparedTemplates: templates.length };
      }
      let best: any;
      let bestFace: any;
      for (const face of extraction.faces) {
        if (!face.embedding?.length) continue;
        for (const template of templates) {
          const comparison = await this.biometricClient.compare(template.embedding, face.embedding);
          if (!best || comparison.cosineSimilarity > best.cosineSimilarity) {
            best = comparison;
            bestFace = face;
          }
        }
      }
      if (!best) return { status: 'no_face', facesDetected: extraction.facesDetected, comparedTemplates: templates.length };
      return {
        status: best.classification,
        facesDetected: extraction.facesDetected,
        cosineSimilarity: best.cosineSimilarity,
        model: best.model,
        modelVersion: bestFace?.modelVersion,
        comparedTemplates: templates.length,
      };
    } catch {
      return { status: 'not_evaluated', comparedTemplates: templates.length };
    }
  }

  private imageMime(value: string) {
    const path = value.toLowerCase().split('?')[0];
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.webp')) return 'image/webp';
    return 'image/jpeg';
  }

  async getSubject(searchId: string) {
    const subject = await this.subjectModel.findOne({ searchId }).exec();
    if (!subject) throw new NotFoundException('Target subject not found');
    const candidates = await this.candidateModel.find({ subjectId: subject._id })
      .sort({ 'scores.face': -1, 'scores.discovery': -1, createdAt: -1 })
      .exec();
    return { subject, candidates };
  }

  async preserveSubjectCandidates(searchId: string) {
    const subject = await this.subjectModel.findOne({ searchId }).select('+biometricTemplates').exec();
    if (!subject) throw new NotFoundException('Target subject not found');
    const candidates = await this.candidateModel.find({ subjectId: subject._id, status: 'candidate' })
      .sort({ 'scores.overall': -1 })
      .limit(12)
      .exec();
    let preservedCount = 0;
    let unavailableCount = 0;
    for (const [index, candidate] of candidates.entries()) {
      const originalImageUrl = String(candidate.metadata?.originalImageUrl || candidate.imageUrls?.[0] || '');
      const result = await this.preserveCandidateImage(searchId, originalImageUrl, index);
      const biometric = result.buffer
        ? await this.evaluateCandidateImage(subject.biometricTemplates || [], result.buffer)
        : {
            status: 'unavailable' as const,
            comparedTemplates: subject.biometricTemplates?.length || 0,
            facesDetected: undefined,
            cosineSimilarity: undefined,
            model: undefined,
            modelVersion: undefined,
          };
      candidate.metadata = {
        ...(candidate.metadata || {}),
        custodyStatus: result.status,
        originalImageUrl,
        storedImageUrl: result.storedImageUrl,
        sha256: result.sha256,
        bytes: result.bytes,
        biometric: {
          status: biometric.status,
          facesDetected: biometric.facesDetected,
          cosineSimilarity: biometric.cosineSimilarity,
          model: biometric.model,
          modelVersion: biometric.modelVersion,
          comparedTemplates: biometric.comparedTemplates,
        },
      };
      candidate.biometricStatus = biometric.status;
      candidate.scores = { ...(candidate.scores || {}), face: biometric.cosineSimilarity };
      if (biometric.status === 'probable' && candidate.status === 'candidate') candidate.status = 'probable';
      if (result.storedImageUrl) {
        candidate.imageUrls = Array.from(new Set([result.storedImageUrl, ...candidate.imageUrls]));
        preservedCount += 1;
      } else {
        unavailableCount += 1;
      }
      await candidate.save();
    }
    return { searchId, attempted: candidates.length, preserved: preservedCount, unavailable: unavailableCount };
  }

  async reviewCandidate(
    candidateId: string,
    status: 'probable' | 'confirmed' | 'rejected',
    actorId: string,
    reason: string,
    personId?: string,
  ) {
    if (!Types.ObjectId.isValid(candidateId)) throw new BadRequestException('Invalid candidateId');
    if (status === 'confirmed' && !personId) throw new BadRequestException('personId is required to confirm identity');
    if (!actorId?.trim()) throw new BadRequestException('Authenticated reviewer is required');
    if (!reason?.trim()) throw new BadRequestException('Review reason is required');
    if (personId && !Types.ObjectId.isValid(personId)) throw new BadRequestException('Invalid personId');

    const current = await this.candidateModel.findById(candidateId).exec();
    if (!current) throw new NotFoundException('Identity candidate not found');
    if (current.status === 'confirmed' && status !== 'confirmed') {
      throw new BadRequestException('Confirmed identity cannot be changed through candidate review');
    }
    const personObjectId = personId ? new Types.ObjectId(personId) : undefined;
    if (status === 'confirmed') {
      const exists = await this.datasecPersonModel.exists({ _id: personObjectId }).exec();
      if (!exists) throw new NotFoundException('Datasec person not found');
    }
    const reviewedAt = new Date();
    const reviewEntry = {
      previousStatus: current.status,
      nextStatus: status,
      actorId: actorId.trim(),
      reason: reason.trim().slice(0, 500),
      reviewedAt,
      ...(personId ? { personId } : {}),
    };
    const candidateUpdate = {
      $set: { status, ...(personObjectId ? { personId: personObjectId } : {}) },
      $push: { reviewHistory: reviewEntry },
    };

    if (status !== 'confirmed' || !personObjectId) {
      return this.candidateModel.findByIdAndUpdate(candidateId, candidateUpdate, { new: true }).exec();
    }

    const session = await this.mongoConnection.startSession();
    try {
      session.startTransaction();
      const candidate = await this.candidateModel.findByIdAndUpdate(candidateId, candidateUpdate, { new: true, session }).exec();
      if (!candidate) throw new NotFoundException('Identity candidate not found');
      const subjectUpdate = await this.subjectModel.updateOne(
        { _id: candidate.subjectId },
        { $set: { identityStatus: 'identified', confirmedPersonId: personObjectId } },
        { session },
      ).exec();
      if (!subjectUpdate.matchedCount) throw new NotFoundException('Target subject not found');
      await session.commitTransaction();
      return candidate;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }
}
