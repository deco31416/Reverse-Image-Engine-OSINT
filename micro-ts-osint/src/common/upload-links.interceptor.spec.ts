import { UploadLinksInterceptor } from './upload-links.interceptor';
import { verifyUploadUrl } from './upload-access';

describe('Upload link ownership', () => {
  const originalBase = process.env.UPLOAD_PUBLIC_BASE_URL;
  beforeEach(() => { process.env.UPLOAD_PUBLIC_BASE_URL = 'http://localhost:7105'; });
  afterAll(() => { if (originalBase === undefined) delete process.env.UPLOAD_PUBLIC_BASE_URL; else process.env.UPLOAD_PUBLIC_BASE_URL = originalBase; });
  const actor = { userId: 'local-analyst', role: 'analyst' } as any;
  const caseId = 'abcdefabcdefabcdefabcdef';
  const url = `http://localhost:7105/uploads/cases/${caseId}/photo.webp`;
  function setup(owned: boolean) {
    const access = { isPrivileged: () => false, actorId: () => actor.userId, assertSearch: jest.fn().mockImplementation(() => owned ? Promise.resolve({}) : Promise.reject(new Error('Forbidden'))) };
    return { access, interceptor: new UploadLinksInterceptor(access as any) as any };
  }
  it('renews authorized image links and checks ownership once per case', async () => {
    const { access, interceptor } = setup(true);
    const value = await interceptor.refresh({ imageUrl: url, thumbnailUrl: url }, actor, new Map());
    expect(verifyUploadUrl(value.imageUrl)).toBe(true);
    expect(verifyUploadUrl(value.thumbnailUrl)).toBe(true);
    expect(access.assertSearch).toHaveBeenCalledTimes(1);
  });
  it('never grants access to another account case', async () => {
    const { interceptor } = setup(false);
    const value = await interceptor.refresh({ imageUrl: url }, actor, new Map());
    expect(value.imageUrl).toBe(url);
    expect(verifyUploadUrl(value.imageUrl)).toBe(false);
  });
  it('does not turn arbitrary metadata or query strings into download grants', async () => {
    const { access, interceptor } = setup(true);
    const value = await interceptor.refresh({ metadata: { imageUrl: url }, inputData: { url }, text: url }, actor, new Map());
    expect(value.metadata.imageUrl).toBe(url);
    expect(value.inputData.url).toBe(url);
    expect(value.text).toBe(url);
    expect(access.assertSearch).not.toHaveBeenCalled();
  });
  it('does not sign links from unconfigured upload origins', async () => {
    const { access, interceptor } = setup(true);
    const external = url.replace('localhost:7105', 'elsewhere.example');
    expect((await interceptor.refresh({ imageUrl: external }, actor, new Map())).imageUrl).toBe(external);
    expect(access.assertSearch).not.toHaveBeenCalled();
  });
});
