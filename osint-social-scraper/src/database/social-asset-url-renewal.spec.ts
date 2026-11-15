import { SocialAssetRepository } from './social-asset.repository';
import { verifyUploadUrl } from '../common/upload-access';

describe('Stored asset URL renewal', () => {
  const originalBase = process.env.UPLOAD_PUBLIC_BASE_URL;
  beforeEach(() => { process.env.UPLOAD_PUBLIC_BASE_URL = 'http://localhost:7110'; });
  afterAll(() => { if (originalBase === undefined) delete process.env.UPLOAD_PUBLIC_BASE_URL; else process.env.UPLOAD_PUBLIC_BASE_URL = originalBase; });
  it('renews expired image grants when an internal caller retrieves an asset', async () => {
    const asset = { publicUrl: 'http://localhost:7110/uploads/social/photo.webp?expires=1000000000&signature=expired' };
    const repository = new SocialAssetRepository({ assetModel: async () => ({ findById: () => ({ lean: async () => asset }) }) } as any);
    const result = await repository.findAsset('abcdefabcdefabcdefabcdef');
    expect(verifyUploadUrl(result.publicUrl)).toBe(true);
    expect(asset.publicUrl).toContain('expires=1000000000');
  });
  it('preserves external sources and arbitrary metadata without signing them', async () => {
    const asset = { publicUrl: 'https://external.example/uploads/photo.webp', metadata: { url: 'http://localhost:7110/uploads/private.webp' } };
    const repository = new SocialAssetRepository({ assetModel: async () => ({ findById: () => ({ lean: async () => asset }) }) } as any);
    expect(await repository.findAsset('abcdefabcdefabcdefabcdef')).toEqual(asset);
  });
});
