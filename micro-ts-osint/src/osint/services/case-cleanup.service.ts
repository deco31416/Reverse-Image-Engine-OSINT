import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { CloudinaryService } from './cloudinary.service';
import { Evidence, EvidenceDocument } from '../schemas/evidence.schema';
import { IdentityCandidate, IdentityCandidateDocument } from '../schemas/identity-candidate.schema';
import { OsintSearch, OsintSearchDocument } from '../schemas/osint-search.schema';
import { TargetSubject, TargetSubjectDocument } from '../schemas/target-subject.schema';
import { SocialScraperClientService } from './social-scraper-client.service';

@Injectable()
export class CaseCleanupService {
  constructor(
    @InjectModel(OsintSearch.name) private readonly searchModel: Model<OsintSearchDocument>,
    @InjectModel(Evidence.name) private readonly evidenceModel: Model<EvidenceDocument>,
    @InjectModel(TargetSubject.name) private readonly subjectModel: Model<TargetSubjectDocument>,
    @InjectModel(IdentityCandidate.name) private readonly candidateModel: Model<IdentityCandidateDocument>,
    private readonly socialScraper: SocialScraperClientService,
    private readonly cloudinary: CloudinaryService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async preview(searchId: string) {
    const search = await this.searchModel.findById(searchId).select('_id imageUrl metadata').lean().exec();
    if (!search) throw new NotFoundException('Case not found');
    const [evidences, candidates, subjects] = await Promise.all([
      this.evidenceModel.countDocuments({ searchId }).exec(),
      this.candidateModel.countDocuments({ searchId }).exec(),
      this.subjectModel.countDocuments({ searchId }).exec(),
    ]);
    return {
      searchId,
      searches: 1,
      evidences,
      identityCandidates: candidates,
      targetSubjects: subjects,
      biometricTemplates: subjects ? 'all_for_subject' : 'none',
      custodyPublicIds: Array.from(new Set<string>(
        (Array.isArray((search as any).metadata?.custodyPublicIds) ? (search as any).metadata.custodyPublicIds : [])
          .map((value: unknown) => String(value || '').trim())
          .filter(Boolean),
      )),
      custodyFolders: this.folders(searchId),
      datasecMemory: 'preserved_shared_memory',
    };
  }

  async execute(searchId: string) {
    const inventory = await this.preview(searchId);
    const socialCleanup = await this.socialScraper.deleteAssetsBySearch(searchId);
    if (socialCleanup?.success === false) {
      return { completed: false, retryable: true, inventory, socialCleanup, storageFailures: [], databaseDeleted: false };
    }
    const storageTargets: Array<{ type: 'folder' | 'publicId'; value: string }> = [
      ...inventory.custodyFolders.map((value) => ({ type: 'folder' as const, value })),
      ...inventory.custodyPublicIds.map((value) => ({ type: 'publicId' as const, value })),
    ];
    const storageResults = await Promise.allSettled(storageTargets.map((target) =>
      target.type === 'folder' ? this.cloudinary.deleteFolder(target.value) : this.cloudinary.deleteImage(target.value),
    ));
    const storageFailures = storageResults.flatMap((result, index) =>
      result.status === 'rejected'
        ? [{ ...storageTargets[index], error: String(result.reason?.message || result.reason) }]
        : [],
    );
    if (storageFailures.length) {
      return { completed: false, retryable: true, inventory, socialCleanup, storageFailures, databaseDeleted: false };
    }

    const session = await this.connection.startSession();
    try {
      session.startTransaction();
      const [evidences, candidates, subjects, searches] = await Promise.all([
        this.evidenceModel.deleteMany({ searchId }, { session }).exec(),
        this.candidateModel.deleteMany({ searchId }, { session }).exec(),
        this.subjectModel.deleteMany({ searchId }, { session }).exec(),
        this.searchModel.deleteOne({ _id: searchId }, { session }).exec(),
      ]);
      await session.commitTransaction();
      return {
        completed: true,
        retryable: false,
        inventory,
        storageFailures: [],
        socialCleanup,
        databaseDeleted: true,
        deleted: {
          searches: searches.deletedCount,
          evidences: evidences.deletedCount,
          identityCandidates: candidates.deletedCount,
          targetSubjects: subjects.deletedCount,
        },
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }

  private folders(searchId: string) {
    return [
      `osint/identity-memory/${searchId}`,
      `osint/evidence-profiles/${searchId}`,
      `face-jobs/${searchId}`,
    ];
  }
}
