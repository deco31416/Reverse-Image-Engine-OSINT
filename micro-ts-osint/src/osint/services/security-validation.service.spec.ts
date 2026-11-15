import { BadRequestException } from '@nestjs/common';
import { lookup } from 'dns/promises';
import { SecurityValidationService } from './security-validation.service';
import { signUploadUrl } from '../../common/upload-access';

jest.mock('dns/promises', () => ({
  lookup: jest.fn(),
}));

const mockedLookup = lookup as jest.MockedFunction<typeof lookup>;

function createConfig(values: Record<string, string> = {}) {
  return {
    get: jest.fn((key: string) => values[key]),
  };
}

function createService(values: Record<string, string> = {}) {
  return new SecurityValidationService(createConfig(values) as any);
}

describe('SecurityValidationService', () => {
  beforeEach(() => {
    mockedLookup.mockReset();
    jest.restoreAllMocks();
  });

  describe('validatePublicUrl', () => {
    it('accepts public http/https URLs after DNS validation', async () => {
      mockedLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);
      const service = createService();

      await expect(service.validatePublicUrl('https://example.com/image.jpg', { field: 'imageUrl' })).resolves.toBe(
        'https://example.com/image.jpg',
      );
      expect(mockedLookup).toHaveBeenCalledWith('example.com', { all: true, verbatim: true });
    });

    it('rejects credentials and non-http protocols', async () => {
      const service = createService();

      await expect(service.validatePublicUrl('file:///etc/passwd')).rejects.toThrow(BadRequestException);
      await expect(service.validatePublicUrl('https://user:pass@example.com/image.jpg')).rejects.toThrow(BadRequestException);
    });

    it('blocks local hosts and private IP ranges', async () => {
      const service = createService();

      await expect(service.validatePublicUrl('http://localhost:7105/uploads/a.jpg')).rejects.toThrow('private or local host');
      await expect(service.validatePublicUrl('http://127.0.0.1/a.jpg')).rejects.toThrow('private IP');
      await expect(service.validatePublicUrl('http://10.0.0.5/a.jpg')).rejects.toThrow('private IP');
      await expect(service.validatePublicUrl('http://172.16.0.5/a.jpg')).rejects.toThrow('private IP');
      await expect(service.validatePublicUrl('http://192.168.1.2/a.jpg')).rejects.toThrow('private IP');
      await expect(service.validatePublicUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow('private IP');
      await expect(service.validatePublicUrl('http://100.64.1.1/a.jpg')).rejects.toThrow('private IP');
      await expect(service.validatePublicUrl('http://198.18.0.1/a.jpg')).rejects.toThrow('private IP');
      await expect(service.validatePublicUrl('http://[::1]/a.jpg')).rejects.toThrow('private IP');
    });

    it('blocks hostnames that resolve to any private IP', async () => {
      mockedLookup.mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.10', family: 4 },
      ] as any);
      const service = createService();

      await expect(service.validatePublicUrl('https://mixed.example/image.jpg')).rejects.toThrow('resolves to a private IP');
    });

    it('allows configured upload URLs only when explicitly requested outside production', async () => {
      const service = createService({
        NODE_ENV: 'development',
        UPLOAD_PUBLIC_BASE_URL: 'http://localhost:7105',
      });

      await expect(service.validatePublicUrl('http://localhost:7105/uploads/a.jpg')).rejects.toThrow('private or local host');
      const url = signUploadUrl('http://localhost:7105/uploads/a.jpg', 'http://localhost:7105');
      await expect(service.validatePublicUrl(url, { allowLocalUploads: true })).resolves.toBe(url);
      await expect(service.validatePublicUrl('http://localhost:7105/uploads/a.jpg', { allowLocalUploads: true })).rejects.toThrow('temporary image URL');
    });

    it('does not allow localhost upload base in production', async () => {
      const service = createService({
        NODE_ENV: 'production',
        UPLOAD_PUBLIC_BASE_URL: 'http://localhost:7105',
      });

      await expect(service.validatePublicUrl('http://localhost:7105/uploads/a.jpg', { allowLocalUploads: true })).rejects.toThrow(
        'private or local host',
      );
    });
  });

  describe('validateImageBase64', () => {
    it('accepts supported image data URIs and reports size', () => {
      const service = createService({ OSINT_MAX_IMAGE_UPLOAD_MB: '1' });
      const result = service.validateImageBase64('data:image/png;base64,AAAA', { field: 'imageBase64' });

      expect(result).toEqual({
        mimeType: 'image/png',
        payload: 'AAAA',
        bytes: 3,
      });
    });

    it('rejects unsupported mime types, invalid payloads and oversized data', () => {
      const service = createService({ OSINT_MAX_IMAGE_UPLOAD_MB: '1' });

      expect(() => service.validateImageBase64('data:text/html;base64,AAAA')).toThrow('jpeg, png, webp or gif');
      expect(() => service.validateImageBase64('data:image/png;base64,@@@')).toThrow('not valid base64');
      expect(() => service.validateImageBase64('A'.repeat(2 * 1024 * 1024), { maxMb: 1 })).toThrow('exceeds 1MB');
    });
  });

  describe('fetchPublicUrl', () => {
    it('uses local fetch for configured uploads and enforces max size', async () => {
      const service = createService({
        NODE_ENV: 'development',
        UPLOAD_PUBLIC_BASE_URL: 'http://localhost:7105',
      });
      const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue(new Response('image-bytes'));

      const url = signUploadUrl('http://localhost:7105/uploads/a.jpg', 'http://localhost:7105');
      const buffer = await service.fetchPublicUrl(url, {
        allowLocalUploads: true,
        maxMb: 1,
      });

      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.toString()).toBe('image-bytes');
      expect(fetchMock).toHaveBeenCalledWith(url, { redirect: 'error', signal: expect.any(AbortSignal) });
    });

    it('rejects failed local upload downloads', async () => {
      const service = createService({
        NODE_ENV: 'development',
        UPLOAD_PUBLIC_BASE_URL: 'http://localhost:7105',
      });
      jest.spyOn(global, 'fetch' as any).mockResolvedValue({
        ok: false,
        status: 404,
      } as any);

      const url = signUploadUrl('http://localhost:7105/uploads/missing.jpg', 'http://localhost:7105');
      await expect(service.fetchPublicUrl(url, { allowLocalUploads: true })).rejects.toThrow(
        'download failed with status 404',
      );
    });
  });
});
