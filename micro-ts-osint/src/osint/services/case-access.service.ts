import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditLogService } from './audit-log.service';
import { Evidence, EvidenceDocument } from '../schemas/evidence.schema';
import { IdentityCandidate, IdentityCandidateDocument } from '../schemas/identity-candidate.schema';
import { OsintSearch, OsintSearchDocument } from '../schemas/osint-search.schema';

export type CaseActor = { userId?: string; username?: string; role?: string; authType?: string };

@Injectable()
export class CaseAccessService {
  constructor(
    @InjectModel(OsintSearch.name) private readonly searchModel: Model<OsintSearchDocument>,
    @InjectModel(Evidence.name) private readonly evidenceModel: Model<EvidenceDocument>,
    @InjectModel(IdentityCandidate.name) private readonly candidateModel: Model<IdentityCandidateDocument>,
    private readonly auditLog: AuditLogService,
  ) {}

  actorId(actor?: CaseActor) {
    return String(actor?.userId || actor?.username || '').trim();
  }

  isPrivileged(actor?: CaseActor) {
    return actor?.role === 'admin' || actor?.authType === 'api-key';
  }

  async ownedSearchIds(actor?: CaseActor) {
    const ownerId = this.actorId(actor);
    if (!ownerId) return [];
    const searches = await this.searchModel.find({ $or: [{ userId: ownerId }, { createdBy: ownerId }] })
      .select('_id').sort({ _id: -1 }).limit(500).lean().exec();
    return searches.map((search) => String(search._id));
  }

  async assertSearch(searchId: string, actor?: CaseActor) {
    const search = await this.searchModel.findById(searchId).select('userId createdBy').lean().exec();
    if (!search) throw new NotFoundException('Case not found');
    await this.assertOwner(searchId, String(search.userId || search.createdBy || ''), actor);
  }

  async assertEvidence(evidenceId: string, actor?: CaseActor) {
    const evidence = await this.evidenceModel.findOne({ evidenceId }).select('searchId').lean().exec();
    if (!evidence) throw new NotFoundException('Evidence not found');
    await this.assertSearch(String(evidence.searchId), actor);
  }

  async assertCandidate(candidateId: string, actor?: CaseActor) {
    const candidate = await this.candidateModel.findById(candidateId).select('searchId').lean().exec();
    if (!candidate) throw new NotFoundException('Identity candidate not found');
    await this.assertSearch(String(candidate.searchId), actor);
  }

  private async assertOwner(searchId: string, ownerId: string, actor?: CaseActor) {
    const actorId = this.actorId(actor);
    const privileged = this.isPrivileged(actor);
    if (privileged || (ownerId && actorId && ownerId === actorId)) return;
    await this.auditLog.log('case_access_denied', 'search', searchId, actorId || 'unknown', {
      reason: ownerId ? 'owner_mismatch' : 'legacy_case_without_owner',
      role: actor?.role || 'unknown',
    }).catch(() => undefined);
    throw new ForbiddenException('You do not have access to this case');
  }
}
