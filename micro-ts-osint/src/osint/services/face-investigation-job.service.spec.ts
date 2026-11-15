import { Types } from 'mongoose';
import { FaceInvestigationJobService } from './face-investigation-job.service';

function createConfig(values: Record<string, string> = {}) {
  return {
    get: jest.fn((key: string) => values[key]),
  };
}

function createRedisMock() {
  const calls: any[] = [];
  const chain: any = {
    lrem: jest.fn((...args: any[]) => {
      calls.push(['lrem', ...args]);
      return chain;
    }),
    hset: jest.fn((...args: any[]) => {
      calls.push(['hset', ...args]);
      return chain;
    }),
    rpush: jest.fn((...args: any[]) => {
      calls.push(['rpush', ...args]);
      return chain;
    }),
    zrem: jest.fn((...args: any[]) => {
      calls.push(['zrem', ...args]);
      return chain;
    }),
    exec: jest.fn().mockResolvedValue([]),
  };

  return {
    calls,
    multi: jest.fn(() => chain),
    hgetall: jest.fn().mockResolvedValue({}),
    hget: jest.fn(),
    hset: jest.fn(),
    lrem: jest.fn(),
    zrem: jest.fn(),
    rpush: jest.fn(),
    llen: jest.fn(),
    scard: jest.fn(),
    zcard: jest.fn(),
  };
}

function createService(redis: any = null, configValues: Record<string, string> = {}) {
  const inputOrchestrator = {
    processInput: jest.fn().mockResolvedValue({
      _id: new Types.ObjectId(),
      imageUrl: 'https://uploads.example.com/source.jpg',
      metadata: {},
      save: jest.fn().mockResolvedValue(undefined),
    }),
  };

  const service = new FaceInvestigationJobService(
    redis,
    createConfig(configValues) as any,
    inputOrchestrator as any,
    { executeFaceSearch: jest.fn() } as any,
    { executeSearch: jest.fn() } as any,
    { deleteImage: jest.fn() } as any,
    { fetchPublicUrl: jest.fn() } as any,
    { isAvailable: jest.fn(() => false) } as any,
    { ensureUnknownSubject: jest.fn(), addVisualCandidates: jest.fn() } as any,
  );

  return { service, inputOrchestrator };
}

describe('FaceInvestigationJobService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('normalizes controls with safe limits and allowed platforms only', () => {
    const { service } = createService();

    const controls = (service as any).normalizeControls({
      mode: 'deep',
      maxRuntimeMs: 999999999,
      maxCandidates: 999,
      minCandidateScore: -2,
      platforms: ['instagram', 'bad-platform', 'facebook', 'x'],
    });

    expect(controls).toEqual({
      mode: 'deep',
      maxRuntimeMs: 3_600_000,
      maxCandidates: 200,
      minCandidateScore: 0,
      platforms: ['instagram', 'facebook', 'x'],
    });
  });

  it('enqueues a Redis job without storing imageBase64 in payload', async () => {
    jest.useFakeTimers();
    const redis = createRedisMock();
    const { service, inputOrchestrator } = createService(redis, {
      FACE_JOB_QUEUE_PREFIX: 'test:face',
    });

    const result = await service.enqueue({
      imageUrl: 'https://public.example.com/person.jpg',
      imageBase64: 'base64-sensitive-payload',
      userId: 'qa-user',
      username: 'operador-demo',
      mode: 'standard',
      platforms: ['instagram', 'facebook'],
    });

    const hsetCall = redis.calls.find((call) => call[0] === 'hset');
    const statusPayload = hsetCall?.[2];
    const storedPayload = JSON.parse(statusPayload.payload);

    expect(result.status).toBe('queued');
    expect(inputOrchestrator.processInput).toHaveBeenCalledWith(
      expect.objectContaining({
        image: expect.objectContaining({
          base64: 'base64-sensitive-payload',
        }),
      }),
    );
    expect(storedPayload.imageBase64).toBeUndefined();
    expect(storedPayload.imageUrl).toBe('https://uploads.example.com/source.jpg');
    expect(statusPayload.events).toContain('Investigación facial recibida');
    expect(redis.calls.some((call) => call[0] === 'rpush' && call[1] === 'test:face:queue')).toBe(true);

    service.onModuleDestroy();
  });

  it('creates image-only searches without textual engines when identity is unknown', async () => {
    jest.useFakeTimers();
    const redis = createRedisMock();
    const { service, inputOrchestrator } = createService(redis);

    await service.enqueue({
      imageUrl: 'https://public.example.com/alpha2.png',
      userId: 'qa-user',
    });

    expect(inputOrchestrator.processInput).toHaveBeenCalledWith(
      expect.objectContaining({
        personalInfo: undefined,
        options: expect.objectContaining({
          searchEngines: [],
          deepSearch: false,
          youtubeSearch: false,
          reverseImageSearch: true,
        }),
      }),
    );

    const hsetCall = redis.calls.find((call) => call[0] === 'hset');
    expect(JSON.parse(hsetCall?.[2]?.payload || '{}').identityMode).toBe('unknown');
    service.onModuleDestroy();
  });

  it('enables textual engines only for explicit identity hints', async () => {
    jest.useFakeTimers();
    const redis = createRedisMock();
    const { service, inputOrchestrator } = createService(redis);

    await service.enqueue({
      imageUrl: 'https://public.example.com/person.png',
      profileUrls: ['https://instagram.com/real-profile'],
    });

    expect(inputOrchestrator.processInput).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          searchEngines: ['serper', 'tavily', 'duckduckgo', 'youtube'],
          deepSearch: true,
        }),
      }),
    );
    service.onModuleDestroy();
  });

  it('cleans stored jobs before returning them to the dashboard', () => {
    const { service } = createService();

    const cleaned = (service as any).cleanJob({
      jobId: 'job-1',
      payload: '{"imageBase64":"secret"}',
      progress: '42',
      attempts: '2',
      platforms: '["instagram"]',
      events: '[{"stage":"queued"}]',
      faceResult: '{"matches":[]}',
    });

    expect(cleaned.payload).toBeUndefined();
    expect(cleaned.progress).toBe(42);
    expect(cleaned.attempts).toBe(2);
    expect(cleaned.platforms).toEqual(['instagram']);
    expect(cleaned.events).toEqual([{ stage: 'queued' }]);
    expect(cleaned.faceResult).toEqual({ matches: [] });
  });

  it('marks Redis jobs as cancelled and removes queued/delayed entries', async () => {
    const redis = createRedisMock();
    redis.hgetall.mockResolvedValue({
      jobId: 'job-1',
      searchId: 'job-1',
      status: 'cancelled',
      progress: '100',
    });
    const { service } = createService(redis, {
      FACE_JOB_QUEUE_PREFIX: 'test:face',
    });

    const result = await service.cancel('job-1');

    expect(result.status).toBe('cancelled');
    expect(redis.calls).toEqual(
      expect.arrayContaining([
        ['lrem', 'test:face:queue', 0, 'job-1'],
        ['zrem', 'test:face:delayed', 'job-1'],
        ['hset', 'test:face:job:job-1', expect.objectContaining({
          status: 'cancelled',
          stage: 'cancelled',
          progress: 100,
        })],
      ]),
    );
  });

  it('aborts an active local operation even when Redis is unavailable', async () => {
    const { service } = createService(null);
    const controller = new AbortController();
    (service as any).active.add('job-local');
    (service as any).abortControllers.set('job-local', controller);
    const pending = (service as any).awaitCancellable(
      'job-local',
      new Promise(() => undefined),
      Date.now() + 60_000,
    );
    await Promise.resolve();

    const result = await service.cancel('job-local');

    await expect(pending).rejects.toThrow('face_job_cancelled');
    expect(result).toEqual(expect.objectContaining({ status: 'cancelled', stage: 'cancelled', progress: 100 }));
    expect(controller.signal.aborted).toBe(true);
  });

  it('never overwrites a cancelled Redis job with a late completion update', async () => {
    const redis = createRedisMock();
    redis.hget.mockResolvedValue('cancelled');
    const { service } = createService(redis);

    await (service as any).updateJob('job-1', { status: 'completed', stage: 'completed_with_candidates' });

    expect(redis.hset).not.toHaveBeenCalled();
  });

  it('enforces the global deadline while an operation is still pending', async () => {
    jest.useFakeTimers();
    const { service } = createService(null);
    (service as any).abortControllers.set('job-timeout', new AbortController());
    const pending = (service as any).awaitCancellable(
      'job-timeout',
      new Promise(() => undefined),
      Date.now() + 1_000,
    );
    await Promise.resolve();

    jest.advanceTimersByTime(1_001);

    await expect(pending).rejects.toThrow('face_job_timeout');
  });
});
