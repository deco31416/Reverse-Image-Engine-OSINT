import { ForbiddenException } from '@nestjs/common';
import { CaseAccessService } from './case-access.service';

function queryResult(value: any) {
  return { select: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(value) }) }) };
}

describe('CaseAccessService', () => {
  function create(owner = 'owner-1') {
    const searchModel = { findById: jest.fn().mockReturnValue(queryResult({ userId: owner })) };
    const evidenceModel = { findOne: jest.fn().mockReturnValue(queryResult({ searchId: 'search-1' })) };
    const candidateModel = { findById: jest.fn().mockReturnValue(queryResult({ searchId: 'search-1' })) };
    const auditLog = { log: jest.fn().mockResolvedValue({}) };
    return {
      service: new CaseAccessService(searchModel as any, evidenceModel as any, candidateModel as any, auditLog as any),
      searchModel, evidenceModel, candidateModel, auditLog,
    };
  }

  it('allows the authenticated owner', async () => {
    const { service, auditLog } = create('owner-1');
    await expect(service.assertSearch('search-1', { userId: 'owner-1', role: 'analyst' })).resolves.toBeUndefined();
    expect(auditLog.log).not.toHaveBeenCalled();
  });

  it('allows administrators and internal API gateway', async () => {
    const admin = create('another-user');
    await expect(admin.service.assertSearch('search-1', { userId: 'admin-1', role: 'admin' })).resolves.toBeUndefined();
    const gateway = create('another-user');
    await expect(gateway.service.assertSearch('search-1', { userId: 'service-gateway', authType: 'api-key' })).resolves.toBeUndefined();
  });

  it('denies a different operator and audits the attempt', async () => {
    const { service, auditLog } = create('owner-1');
    await expect(service.assertSearch('search-1', { userId: 'operator-2', role: 'analyst' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(auditLog.log).toHaveBeenCalledWith(
      'case_access_denied', 'search', 'search-1', 'operator-2',
      expect.objectContaining({ reason: 'owner_mismatch', role: 'analyst' }),
    );
  });

  it('denies legacy cases without owner to non-admin users', async () => {
    const { service, auditLog } = create('');
    await expect(service.assertSearch('legacy-1', { userId: 'operator-1', role: 'analyst' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(auditLog.log).toHaveBeenCalledWith(
      'case_access_denied', 'search', 'legacy-1', 'operator-1',
      expect.objectContaining({ reason: 'legacy_case_without_owner' }),
    );
  });

  it('resolves evidence and candidate ownership through their searchId', async () => {
    const { service, evidenceModel, candidateModel } = create('owner-1');
    await expect(service.assertEvidence('evidence-1', { userId: 'owner-1' })).resolves.toBeUndefined();
    await expect(service.assertCandidate('candidate-1', { userId: 'owner-1' })).resolves.toBeUndefined();
    expect(evidenceModel.findOne).toHaveBeenCalledWith({ evidenceId: 'evidence-1' });
    expect(candidateModel.findById).toHaveBeenCalledWith('candidate-1');
  });
});
