import { IdentityMemoryService } from './identity-memory.service';

describe('IdentityMemoryService biometric privacy', () => {
  it('does not explicitly select biometric templates for dashboard reads', async () => {
    const subject = { _id: 'subject-1', searchId: 'search-1', identityStatus: 'unknown' };
    const subjectExec = jest.fn().mockResolvedValue(subject);
    const subjectQuery = { exec: subjectExec, select: jest.fn() };
    const candidateExec = jest.fn().mockResolvedValue([]);
    const candidateSort = jest.fn().mockReturnValue({ exec: candidateExec });
    const service = new IdentityMemoryService(
      { findOne: jest.fn().mockReturnValue(subjectQuery) } as any,
      { find: jest.fn().mockReturnValue({ sort: candidateSort }) } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.getSubject('search-1')).resolves.toEqual({ subject, candidates: [] });
    expect(subjectQuery.select).not.toHaveBeenCalled();
  });

  it('loads hidden biometric templates when reprocessing historical candidates', async () => {
    const subject = { _id: 'subject-1', biometricTemplates: [] };
    const subjectExec = jest.fn().mockResolvedValue(subject);
    const select = jest.fn().mockReturnValue({ exec: subjectExec });
    const candidateExec = jest.fn().mockResolvedValue([]);
    const service = new IdentityMemoryService(
      { findOne: jest.fn().mockReturnValue({ select }) } as any,
      { find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ exec: candidateExec }) }) }) } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.preserveSubjectCandidates('search-1')).resolves.toEqual({
      searchId: 'search-1', attempted: 0, preserved: 0, unavailable: 0,
    });
    expect(select).toHaveBeenCalledWith('+biometricTemplates');
  });

  it('records reviewer, reason and status transition for a probable candidate', async () => {
    const current = { _id: 'candidate-1', status: 'candidate', subjectId: 'subject-1' };
    const updated = { ...current, status: 'probable' };
    const findByIdAndUpdate = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(updated) });
    const service = new IdentityMemoryService(
      {} as any,
      {
        findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(current) }),
        findByIdAndUpdate,
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.reviewCandidate(
      '507f1f77bcf86cd799439011', 'probable', 'analyst-7', 'Rostro compatible en dos fuentes',
    )).resolves.toBe(updated);

    expect(findByIdAndUpdate).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
      expect.objectContaining({
        $set: { status: 'probable' },
        $push: { reviewHistory: expect.objectContaining({
          previousStatus: 'candidate', nextStatus: 'probable', actorId: 'analyst-7', reason: 'Rostro compatible en dos fuentes',
        }) },
      }),
      { new: true },
    );
  });

  it('rejects confirmation when the Datasec person does not exist', async () => {
    const service = new IdentityMemoryService(
      {} as any,
      { findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ status: 'probable' }) }) } as any,
      {} as any,
      {} as any,
      {} as any,
      { exists: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }) } as any,
      {} as any,
    );

    await expect(service.reviewCandidate(
      '507f1f77bcf86cd799439011', 'confirmed', 'supervisor-1', 'Confirmación supervisada', '507f191e810c19729de860ea',
    )).rejects.toThrow('Datasec person not found');
  });

  it('confirms candidate and subject inside one Mongo transaction', async () => {
    const candidate = { _id: 'candidate-1', status: 'confirmed', subjectId: '507f1f77bcf86cd799439012' };
    const session = {
      startTransaction: jest.fn(), commitTransaction: jest.fn(), abortTransaction: jest.fn(), endSession: jest.fn(),
    };
    const candidateModel = {
      findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ status: 'probable', subjectId: candidate.subjectId }) }),
      findByIdAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(candidate) }),
    };
    const subjectModel = {
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ matchedCount: 1 }) }),
    };
    const service = new IdentityMemoryService(
      subjectModel as any,
      candidateModel as any,
      {} as any,
      {} as any,
      {} as any,
      { exists: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: '507f191e810c19729de860ea' }) }) } as any,
      { startSession: jest.fn().mockResolvedValue(session) } as any,
    );

    await expect(service.reviewCandidate(
      '507f1f77bcf86cd799439011', 'confirmed', 'supervisor-1', 'Fuentes y rostro verificados', '507f191e810c19729de860ea',
    )).resolves.toBe(candidate);
    expect(session.startTransaction).toHaveBeenCalled();
    expect(session.commitTransaction).toHaveBeenCalled();
    expect(session.abortTransaction).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalled();
    expect(subjectModel.updateOne).toHaveBeenCalledWith(
      { _id: candidate.subjectId },
      { $set: expect.objectContaining({ identityStatus: 'identified' }) },
      { session },
    );
  });
});
