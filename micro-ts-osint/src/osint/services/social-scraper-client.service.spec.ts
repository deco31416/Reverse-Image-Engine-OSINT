import { of, throwError } from 'rxjs';
import { SocialScraperClientService } from './social-scraper-client.service';

function createConfig(values: Record<string, string> = {}) {
  return {
    get: jest.fn((key: string) => values[key]),
  };
}

function createHttp() {
  return {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
  };
}

describe('SocialScraperClientService', () => {
  it('reports unavailable when SOCIAL_SCRAPER_BASE_URL is not configured', async () => {
    const service = new SocialScraperClientService(createConfig() as any, createHttp() as any);

    expect(service.isAvailable()).toBe(false);
    await expect(service.healthCheck()).resolves.toEqual({
      available: false,
      reason: 'SOCIAL_SCRAPER_BASE_URL not configured',
    });
    await expect(service.searchByUsername('operador-demo')).resolves.toBeNull();
    await expect(service.listAssets({ limit: 10 })).resolves.toEqual([]);
    await expect(service.markAssetStatus('asset-1', { status: 'positive' })).resolves.toEqual({
      updated: false,
      reason: 'social_scraper_not_configured',
    });
  });

  it('uses configured base URL, timeout and x-api-key header', async () => {
    const http = createHttp();
    http.get.mockReturnValue(of({ data: { status: 'ok' } }));
    const service = new SocialScraperClientService(
      createConfig({
        SOCIAL_SCRAPER_BASE_URL: 'http://localhost:7110/api/v1/',
        SOCIAL_SCRAPER_API_KEY: 'internal-key',
        SOCIAL_SCRAPER_TIMEOUT_MS: '1234',
      }) as any,
      http as any,
    );

    await expect(service.healthCheck()).resolves.toEqual({
      available: true,
      service: { status: 'ok' },
    });

    expect(http.get).toHaveBeenCalledWith(
      'http://localhost:7110/api/v1/health',
      expect.objectContaining({
        timeout: 1234,
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-api-key': 'internal-key',
        }),
      }),
    );
  });

  it('builds listAssets query string with only non-empty params', async () => {
    const http = createHttp();
    http.get.mockReturnValue(of({ data: [{ id: 'asset-1' }] }));
    const service = new SocialScraperClientService(
      createConfig({ SOCIAL_SCRAPER_BASE_URL: 'http://scraper/api/v1' }) as any,
      http as any,
    );

    await expect(service.listAssets({
      platform: 'instagram',
      owner: '',
      status: 'positive',
      limit: 25,
    })).resolves.toEqual([{ id: 'asset-1' }]);

    expect(http.get).toHaveBeenCalledWith(
      'http://scraper/api/v1/assets?platform=instagram&status=positive&limit=25',
      expect.any(Object),
    );
  });

  it('returns controlled responses for HTTP failures', async () => {
    const http = createHttp();
    http.get.mockReturnValue(throwError(() => ({ response: { data: { message: 'down' } } })));
    http.patch.mockReturnValue(throwError(() => new Error('patch failed')));
    const service = new SocialScraperClientService(
      createConfig({ SOCIAL_SCRAPER_BASE_URL: 'http://scraper/api/v1' }) as any,
      http as any,
    );

    await expect(service.healthCheck()).resolves.toEqual({ available: false, error: 'down' });
    await expect(service.getAsset('asset-1')).resolves.toBeNull();
    await expect(service.listAssets({ limit: 10 })).resolves.toEqual([]);
    await expect(service.markAssetStatus('asset-1', { status: 'archived' })).resolves.toEqual({
      updated: false,
      error: 'patch failed',
    });
  });

  it('posts username, name, image and profile URL payloads to the scraper', async () => {
    const http = createHttp();
    http.post.mockReturnValue(of({ data: { total: 1 } }));
    const service = new SocialScraperClientService(
      createConfig({ SOCIAL_SCRAPER_BASE_URL: 'http://scraper/api/v1' }) as any,
      http as any,
    );

    await service.searchByUsername('operador-demo', ['instagram'] as any, 5);
    await service.searchByName('Usuario Demo', ['facebook'] as any, 6);
    await service.searchByImage('base64-data', ['x'] as any, 7);
    await service.resolveProfileUrl('https://instagram.com/operador-demo');

    expect(http.post).toHaveBeenNthCalledWith(
      1,
      'http://scraper/api/v1/social/search/username',
      { username: 'operador-demo', platforms: ['instagram'], limit: 5 },
      expect.any(Object),
    );
    expect(http.post).toHaveBeenNthCalledWith(
      2,
      'http://scraper/api/v1/social/search/name',
      { query: 'Usuario Demo', platforms: ['facebook'], limit: 6 },
      expect.any(Object),
    );
    expect(http.post).toHaveBeenNthCalledWith(
      3,
      'http://scraper/api/v1/social/search/image',
      {
        base64: 'base64-data',
        platforms: ['x'],
        limit: 7,
        enrichProfiles: true,
        ownerHint: 'micro-ts-osint',
      },
      expect.any(Object),
    );
    expect(http.post).toHaveBeenNthCalledWith(
      4,
      'http://scraper/api/v1/social/profile/resolve',
      { url: 'https://instagram.com/operador-demo' },
      expect.any(Object),
    );
  });
});
