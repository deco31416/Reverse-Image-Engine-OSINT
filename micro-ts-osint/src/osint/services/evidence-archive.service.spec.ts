import { EvidenceService } from './evidence.service';

describe('EvidenceService reversible archive', () => {
  it('archives evidence without deleting its record or custody fields', async () => {
    const archived = {
      evidenceId: 'ev-1', searchId: 'search-1', isArchived: true,
      imageUrl: 'https://custody.local/image.jpg', archivedBy: 'analyst-1', archiveReason: 'Ruido confirmado',
    };
    const findOneAndUpdate = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(archived) });
    const service = new EvidenceService({ findOneAndUpdate } as any, {} as any, {} as any, {} as any);

    await expect(service.archiveEvidence('ev-1', 'analyst-1', 'Ruido confirmado')).resolves.toBe(archived);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { evidenceId: 'ev-1', isArchived: { $ne: true } },
      { $set: expect.objectContaining({ isArchived: true, archivedBy: 'analyst-1', archiveReason: 'Ruido confirmado' }) },
      { new: true },
    );
  });

  it('restores archived evidence and records the restoring analyst', async () => {
    const restored = { evidenceId: 'ev-1', searchId: 'search-1', isArchived: false, restoredBy: 'analyst-2' };
    const findOneAndUpdate = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(restored) });
    const service = new EvidenceService({ findOneAndUpdate } as any, {} as any, {} as any, {} as any);

    await expect(service.restoreEvidence('ev-1', 'analyst-2')).resolves.toBe(restored);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { evidenceId: 'ev-1', isArchived: true },
      expect.objectContaining({
        $set: expect.objectContaining({ isArchived: false, restoredBy: 'analyst-2' }),
        $unset: { archivedAt: 1, archivedBy: 1, archiveReason: 1 },
      }),
      { new: true },
    );
  });

  it('excludes archived evidence from normal case reads', async () => {
    const exec = jest.fn().mockResolvedValue([]);
    const sort = jest.fn().mockReturnValue({ exec });
    const find = jest.fn().mockReturnValue({ sort });
    const service = new EvidenceService({ find } as any, {} as any, {} as any, {} as any);

    await service.getEvidenceBySearch('search-1');
    expect(find).toHaveBeenCalledWith({ searchId: 'search-1', isArchived: { $ne: true } });
  });
});
