import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { OsintControllerV2 } from './osint-v2.controller';

function createController() {
  const evidenceService = {
    validateEvidence: jest.fn(),
  };
  const socialScraperClient = {
    listAssets: jest.fn(),
    markAssetStatus: jest.fn(),
    getAsset: jest.fn(),
  };
  const datasecCuration = {
    promoteSocialAsset: jest.fn(),
    promoteEvidence: jest.fn(),
  };
  const caseAccess = {
    actorId: jest.fn((user: any) => user?.userId || user?.username || ''),
    assertSearch: jest.fn(),
    assertEvidence: jest.fn(),
    assertCandidate: jest.fn(),
    isPrivileged: jest.fn((user: any) => user?.role === 'admin'),
    ownedSearchIds: jest.fn().mockResolvedValue([]),
  };

  const noop = {};
  const controller = new OsintControllerV2(
    noop as any,
    noop as any,
    evidenceService as any,
    noop as any,
    noop as any,
    noop as any,
    noop as any,
    noop as any,
    noop as any,
    noop as any,
    noop as any,
    noop as any,
    noop as any,
    noop as any,
    noop as any,
    noop as any,
    noop as any,
    noop as any,
    noop as any,
    noop as any,
    noop as any,
    noop as any,
    noop as any,
    datasecCuration as any,
    noop as any,
    noop as any,
    socialScraperClient as any,
    noop as any,
    noop as any,
    noop as any,
    noop as any,
    noop as any,
    noop as any,
    caseAccess as any,
    noop as any,
  );

  return { controller, socialScraperClient, datasecCuration, evidenceService, caseAccess };
}

describe('OsintControllerV2 social asset bridge', () => {
  it('does not promote evidence from a forbidden case', async () => {
    const { controller, caseAccess, datasecCuration } = createController();
    caseAccess.assertEvidence.mockRejectedValue(new ForbiddenException('foreign case'));
    await expect(controller.promoteEvidenceToDatasec({ evidenceId: 'foreign-evidence' }, { userId: 'operator' })).rejects.toThrow(ForbiddenException);
    expect(datasecCuration.promoteEvidence).not.toHaveBeenCalled();
  });

  it('does not mutate assets from a forbidden case', async () => {
    const { controller, caseAccess, socialScraperClient } = createController();
    socialScraperClient.getAsset.mockResolvedValue({ _id: 'foreign-asset', osintSearchId: 'foreign-case' });
    caseAccess.assertSearch.mockRejectedValue(new ForbiddenException('foreign case'));
    await expect(controller.markSocialAssetStatus('foreign-asset', { status: 'positive' }, { userId: 'operator' })).rejects.toThrow(ForbiddenException);
    expect(socialScraperClient.markAssetStatus).not.toHaveBeenCalled();
  });

  it('scopes cluster queries to the authenticated owner', async () => {
    const { controller } = createController();
    const query = jest.fn().mockResolvedValue([]);
    (controller as any).inputOrchestrator = { getClustersSummary: query };
    await controller.getClusters({ userId: 'operator-1', role: 'analyst' });
    expect(query).toHaveBeenCalledWith('operator-1');
  });

  it('derives synchronous face search owners from the authenticated identity', async () => {
    const { controller } = createController();
    jest.spyOn(controller as any, 'resolveVisualInput').mockResolvedValue({ imageBase64: 'fixture' });
    const processInput = jest.fn().mockRejectedValue(new Error('fixture pipeline stops here'));
    (controller as any).inputOrchestrator = { processInput };
    await controller.searchByFace({ imageBase64: 'fixture', userId: 'impersonated' }, { userId: 'operator-1', role: 'analyst' });
    expect(processInput).toHaveBeenCalledWith(expect.objectContaining({ userId: 'operator-1' }));
  });
  it('takes the evidence validator identity from JWT context and ignores client impersonation', async () => {
    const { controller, evidenceService, caseAccess } = createController();
    evidenceService.validateEvidence.mockResolvedValue({
      validationStatus: 'valid',
      validatedAt: new Date('2026-07-10T00:00:00.000Z'),
    });

    await controller.validateEvidence('evidence-1', { status: 'valid' }, { userId: 'jwt-user-7' });

    expect(evidenceService.validateEvidence).toHaveBeenCalledWith('evidence-1', 'valid', 'jwt-user-7');
    expect(caseAccess.assertEvidence).toHaveBeenCalledWith('evidence-1', { userId: 'jwt-user-7' });
  });
  it('lists social assets through the scraper client', async () => {
    const { controller, socialScraperClient } = createController();
    socialScraperClient.listAssets.mockResolvedValue([{ id: 'asset-1' }]);

    await expect(controller.listSocialAssets('instagram', 'operador-demo', 'positive', 'search-1', '25', { userId: 'jwt-user-7', role: 'analyst' })).resolves.toEqual([
      { id: 'asset-1' },
    ]);

    expect(socialScraperClient.listAssets).toHaveBeenCalledWith({
      platform: 'instagram',
      owner: 'operador-demo',
      status: 'positive',
      osintSearchId: 'search-1',
      limit: '25',
    });
  });

  it('marks social asset status through the scraper client', async () => {
    const { controller, socialScraperClient } = createController();
    socialScraperClient.markAssetStatus.mockResolvedValue({ updated: true, status: 'positive' });
    socialScraperClient.getAsset.mockResolvedValue({ _id: 'asset-1', osintSearchId: 'search-1' });

    await expect(controller.markSocialAssetStatus('asset-1', {
      status: 'positive',
      note: 'Validado desde test',
    }, { userId: 'jwt-user-7', role: 'analyst' })).resolves.toEqual({ updated: true, status: 'positive' });

    expect(socialScraperClient.markAssetStatus).toHaveBeenCalledWith('asset-1', {
      status: 'positive',
      note: 'Validado desde test',
    });
  });

  it('promotes a social asset to Datasec and marks it positive', async () => {
    const { controller, socialScraperClient, datasecCuration } = createController();
    const socialAsset = { _id: 'asset-1', platform: 'instagram', owner: 'operador-demo', osintSearchId: 'search-1' };
    const promoted = { asset: { _id: 'datasec-asset-1' }, reused: false };

    socialScraperClient.getAsset.mockResolvedValue(socialAsset);
    datasecCuration.promoteSocialAsset.mockResolvedValue(promoted);
    socialScraperClient.markAssetStatus.mockResolvedValue({ updated: true });

    await expect(controller.promoteSocialAssetToDatasec('asset-1', {
      personId: 'person-1',
      curationStatus: 'validated',
      tags: ['qa'],
    }, { userId: 'jwt-user-7', role: 'analyst' })).resolves.toBe(promoted);

    expect(datasecCuration.promoteSocialAsset).toHaveBeenCalledWith(socialAsset, {
      personId: 'person-1',
      curationStatus: 'validated',
      tags: ['qa'],
    });
    expect(socialScraperClient.markAssetStatus).toHaveBeenCalledWith('asset-1', {
      status: 'positive',
      note: 'Promovido a Datasec: datasec-asset-1',
    });
  });

  it('throws NotFoundException when scraper cannot return the asset', async () => {
    const { controller, socialScraperClient, datasecCuration } = createController();
    socialScraperClient.getAsset.mockResolvedValue(null);

    await expect(controller.promoteSocialAssetToDatasec('missing-asset', {}, { userId: 'jwt-user-7', role: 'analyst' })).rejects.toBeInstanceOf(NotFoundException);
    expect(datasecCuration.promoteSocialAsset).not.toHaveBeenCalled();
    expect(socialScraperClient.markAssetStatus).not.toHaveBeenCalled();
  });

  it('does not mark social asset positive when Datasec promotion fails', async () => {
    const { controller, socialScraperClient, datasecCuration } = createController();
    socialScraperClient.getAsset.mockResolvedValue({ _id: 'asset-1', osintSearchId: 'search-1' });
    datasecCuration.promoteSocialAsset.mockRejectedValue(new Error('datasec failed'));

    await expect(controller.promoteSocialAssetToDatasec('asset-1', {}, { userId: 'jwt-user-7', role: 'analyst' })).rejects.toThrow('datasec failed');
    expect(socialScraperClient.markAssetStatus).not.toHaveBeenCalled();
  });
});
