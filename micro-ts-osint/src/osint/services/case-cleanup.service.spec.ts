import { CaseCleanupService } from './case-cleanup.service';

function countModel(count: number) {
  return { countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(count) }) };
}

function createModels() {
  const search = {
    findById: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({
      _id: 'search-1', metadata: { custodyPublicIds: ['face-selections/request/face.png', 'face-selections/request/original.png'] },
    }) }) }) }),
    deleteOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ deletedCount: 1 }) }),
  };
  const evidence = { ...countModel(7), deleteMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ deletedCount: 7 }) }) };
  const candidate = { ...countModel(3), deleteMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ deletedCount: 3 }) }) };
  const subject = { ...countModel(1), deleteMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ deletedCount: 1 }) }) };
  return { search, evidence, candidate, subject };
}

describe('CaseCleanupService', () => {
  it('returns an exact cleanup inventory', async () => {
    const models = createModels();
    const service = new CaseCleanupService(
      models.search as any, models.evidence as any, models.subject as any, models.candidate as any, {} as any, {} as any, {} as any,
    );
    await expect(service.preview('search-1')).resolves.toEqual(expect.objectContaining({
      searches: 1, evidences: 7, identityCandidates: 3, targetSubjects: 1,
      custodyFolders: [
        'osint/identity-memory/search-1', 'osint/evidence-profiles/search-1', 'face-jobs/search-1',
      ],
      custodyPublicIds: ['face-selections/request/face.png', 'face-selections/request/original.png'],
      datasecMemory: 'preserved_shared_memory',
    }));
  });

  it('keeps Mongo untouched when any custody folder cannot be removed', async () => {
    const models = createModels();
    const cloudinary = {
      deleteFolder: jest.fn().mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValue(undefined),
      deleteImage: jest.fn().mockResolvedValue(undefined),
    };
    const connection = { startSession: jest.fn() };
    const service = new CaseCleanupService(
      models.search as any, models.evidence as any, models.subject as any, models.candidate as any,
      { deleteAssetsBySearch: jest.fn().mockResolvedValue({ success: true, skipped: true }) } as any,
      cloudinary as any, connection as any,
    );

    const result = await service.execute('search-1');
    expect(result).toEqual(expect.objectContaining({ completed: false, retryable: true, databaseDeleted: false }));
    expect(result.storageFailures).toHaveLength(1);
    expect(connection.startSession).not.toHaveBeenCalled();
    expect(models.evidence.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes all case collections in one transaction after custody cleanup', async () => {
    const models = createModels();
    const cloudinary = { deleteFolder: jest.fn().mockResolvedValue(undefined), deleteImage: jest.fn().mockResolvedValue(undefined) };
    const session = { startTransaction: jest.fn(), commitTransaction: jest.fn(), abortTransaction: jest.fn(), endSession: jest.fn() };
    const service = new CaseCleanupService(
      models.search as any, models.evidence as any, models.subject as any, models.candidate as any,
      { deleteAssetsBySearch: jest.fn().mockResolvedValue({ success: true, assetsDeleted: 2, filesDeleted: 2 }) } as any,
      cloudinary as any, { startSession: jest.fn().mockResolvedValue(session) } as any,
    );

    const result = await service.execute('search-1');
    expect(result).toEqual(expect.objectContaining({
      completed: true, databaseDeleted: true,
      deleted: { searches: 1, evidences: 7, identityCandidates: 3, targetSubjects: 1 },
    }));
    expect(cloudinary.deleteFolder).toHaveBeenCalledTimes(3);
    expect(cloudinary.deleteImage).toHaveBeenCalledTimes(2);
    expect(session.startTransaction).toHaveBeenCalled();
    expect(session.commitTransaction).toHaveBeenCalled();
    expect(session.abortTransaction).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalled();
  });
});
