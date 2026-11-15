import { OsintJobQueueService } from './osint-job-queue.service';

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
    zadd: jest.fn((...args: any[]) => {
      calls.push(['zadd', ...args]);
      return chain;
    }),
    zrem: jest.fn((...args: any[]) => {
      calls.push(['zrem', ...args]);
      return chain;
    }),
    srem: jest.fn((...args: any[]) => {
      calls.push(['srem', ...args]);
      return chain;
    }),
    exec: jest.fn().mockResolvedValue([]),
  };

  return {
    calls,
    multi: jest.fn(() => chain),
    hgetall: jest.fn().mockResolvedValue({}),
    hget: jest.fn().mockResolvedValue(null),
    llen: jest.fn().mockResolvedValue(0),
    scard: jest.fn().mockResolvedValue(0),
    zcard: jest.fn().mockResolvedValue(0),
    zrangebyscore: jest.fn().mockResolvedValue([]),
    smembers: jest.fn().mockResolvedValue([]),
    rpoplpush: jest.fn().mockResolvedValue(null),
    hset: jest.fn().mockResolvedValue(1),
    sadd: jest.fn().mockResolvedValue(1),
  };
}

function createService(redis: any = null, configValues: Record<string, string> = {}) {
  const orchestrator = {
    executeSearch: jest.fn().mockResolvedValue(undefined),
  };

  const service = new OsintJobQueueService(
    redis,
    createConfig(configValues) as any,
    orchestrator as any,
  );

  return { service, orchestrator };
}

describe('OsintJobQueueService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('enqueues Redis searches idempotently with status metadata', async () => {
    const redis = createRedisMock();
    const { service } = createService(redis, {
      OSINT_JOB_QUEUE_PREFIX: 'test:osint',
    });

    const result = await service.enqueueSearch('search-1', 'manual');

    expect(result).toEqual(expect.objectContaining({
      searchId: 'search-1',
      status: 'queued',
      reason: 'manual',
      mode: 'redis',
    }));
    expect(redis.calls).toEqual(expect.arrayContaining([
      ['lrem', 'test:osint:search:queue', 0, 'search-1'],
      ['rpush', 'test:osint:search:queue', 'search-1'],
      ['hset', 'test:osint:search:search-1', expect.objectContaining({
        searchId: 'search-1',
        status: 'queued',
        reason: 'manual',
        attempts: 0,
      })],
    ]));

    service.onModuleDestroy();
  });

  it('returns unknown Redis jobs when no status hash exists', async () => {
    const redis = createRedisMock();
    const { service } = createService(redis, {
      OSINT_JOB_QUEUE_PREFIX: 'test:osint',
    });

    await expect(service.getJob('missing')).resolves.toEqual({
      searchId: 'missing',
      status: 'unknown',
      mode: 'redis',
    });
  });

  it('reports Redis queue stats for dashboard operations', async () => {
    const redis = createRedisMock();
    redis.llen.mockResolvedValue(4);
    redis.scard.mockResolvedValue(2);
    redis.zcard.mockResolvedValue(3);
    const { service } = createService(redis, {
      OSINT_JOB_QUEUE_PREFIX: 'test:osint',
      OSINT_JOB_CONCURRENCY: '6',
      OSINT_JOB_MAX_ATTEMPTS: '5',
      OSINT_JOB_PROCESSING_TIMEOUT_MS: '120000',
    });

    await expect(service.getStats()).resolves.toEqual(expect.objectContaining({
      mode: 'redis',
      queued: 4,
      processing: 2,
      delayed: 3,
      concurrency: 6,
      maxAttempts: 5,
      processingTimeoutMs: 120000,
      prefix: 'test:osint',
    }));
  });

  it('schedules failed jobs for retry while attempts remain', async () => {
    const redis = createRedisMock();
    redis.hget.mockResolvedValue('1');
    const { service } = createService(redis, {
      OSINT_JOB_QUEUE_PREFIX: 'test:osint',
      OSINT_JOB_MAX_ATTEMPTS: '3',
      OSINT_JOB_RETRY_BACKOFF_MS: '1000',
    });

    await (service as any).handleJobFailure('search-1', new Error('provider timeout'));

    expect(redis.calls).toEqual(expect.arrayContaining([
      ['zadd', 'test:osint:search:delayed', 1_700_000_001_000, 'search-1'],
      ['lrem', 'test:osint:search:processing', 0, 'search-1'],
      ['srem', 'test:osint:search:processing:set', 'search-1'],
      ['hset', 'test:osint:search:search-1', expect.objectContaining({
        status: 'queued',
        error: 'provider timeout',
      })],
    ]));
  });

  it('marks failed jobs permanently when max attempts is reached', async () => {
    const redis = createRedisMock();
    redis.hget.mockResolvedValue('3');
    const { service } = createService(redis, {
      OSINT_JOB_QUEUE_PREFIX: 'test:osint',
      OSINT_JOB_MAX_ATTEMPTS: '3',
    });

    await (service as any).handleJobFailure('search-1', new Error('bad response'));

    expect(redis.calls).toEqual(expect.arrayContaining([
      ['lrem', 'test:osint:search:processing', 0, 'search-1'],
      ['srem', 'test:osint:search:processing:set', 'search-1'],
      ['hset', 'test:osint:search:search-1', expect.objectContaining({
        status: 'failed',
        error: 'bad response',
      })],
    ]));
    expect(redis.calls.some((call) => call[0] === 'zadd')).toBe(false);
  });

  it('moves due delayed jobs back to the queue', async () => {
    const redis = createRedisMock();
    redis.zrangebyscore.mockResolvedValue(['search-1', 'search-2']);
    const { service } = createService(redis, {
      OSINT_JOB_QUEUE_PREFIX: 'test:osint',
    });

    await (service as any).releaseDelayedJobs();

    expect(redis.zrangebyscore).toHaveBeenCalledWith(
      'test:osint:search:delayed',
      0,
      1_700_000_000_000,
      'LIMIT',
      0,
      20,
    );
    expect(redis.calls).toEqual(expect.arrayContaining([
      ['zrem', 'test:osint:search:delayed', 'search-1'],
      ['rpush', 'test:osint:search:queue', 'search-1'],
      ['hset', 'test:osint:search:search-1', expect.objectContaining({ status: 'queued' })],
      ['zrem', 'test:osint:search:delayed', 'search-2'],
      ['rpush', 'test:osint:search:queue', 'search-2'],
    ]));
  });

  it('recovers stale processing jobs after timeout', async () => {
    const redis = createRedisMock();
    redis.smembers.mockResolvedValue(['search-1', 'search-active']);
    redis.hgetall.mockImplementation((key: string) => {
      if (key.endsWith('search-1')) {
        return Promise.resolve({
          status: 'processing',
          startedAt: new Date(1_699_999_000_000).toISOString(),
        });
      }
      return Promise.resolve({
        status: 'processing',
        startedAt: new Date(1_699_999_990_000).toISOString(),
      });
    });
    const { service } = createService(redis, {
      OSINT_JOB_QUEUE_PREFIX: 'test:osint',
      OSINT_JOB_PROCESSING_TIMEOUT_MS: '60000',
    });

    await (service as any).recoverStaleProcessing();

    expect(redis.calls).toEqual(expect.arrayContaining([
      ['hset', 'test:osint:search:search-1', expect.objectContaining({
        status: 'queued',
        error: 'Recovered stale processing job',
      })],
      ['lrem', 'test:osint:search:processing', 0, 'search-1'],
      ['srem', 'test:osint:search:processing:set', 'search-1'],
      ['rpush', 'test:osint:search:queue', 'search-1'],
    ]));
    expect(redis.calls.some((call) => call.includes('search-active'))).toBe(false);
  });
});
