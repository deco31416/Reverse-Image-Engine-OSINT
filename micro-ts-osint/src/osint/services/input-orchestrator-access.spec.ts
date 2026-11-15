import { InputOrchestratorService } from './input-orchestrator.service';

describe('Dashboard statistics isolation', () => {
  function setup() {
    const model = {
      countDocuments: jest.fn().mockImplementation(() => ({ lean: () => Promise.resolve(0) })),
      aggregate: jest.fn().mockResolvedValue([]),
    };
    const service = Object.create(InputOrchestratorService.prototype);
    service.osintSearchModel = model;
    service.logger = { log: jest.fn(), warn: jest.fn() };
    return { service: service as InputOrchestratorService, model };
  }
  it('scopes every statistics query to the authenticated owner', async () => {
    const { service, model } = setup();
    await service.getStats('analyst-a');
    const scope = { $or: [{ userId: 'analyst-a' }, { createdBy: 'analyst-a' }] };
    for (const [filter] of model.countDocuments.mock.calls) expect(filter).toMatchObject(scope);
    for (const [pipeline] of model.aggregate.mock.calls) expect(pipeline[0]).toEqual({ $match: scope });
  });
  it('allows explicit privileged calls to obtain aggregate statistics', async () => {
    const { service, model } = setup();
    await service.getStats();
    expect(model.countDocuments.mock.calls[0][0]).toEqual({});
    for (const [pipeline] of model.aggregate.mock.calls) expect(pipeline[0].$match).toBeUndefined();
  });
});
