import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { StorageService } from './storage.service';
import sharp from 'sharp';

const ONE_PIXEL_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABCf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=';

function createConfig(values: Record<string, string>) {
  return {
    get: jest.fn((key: string) => values[key]),
  };
}

describe('StorageService', () => {
  let uploadDir: string;

  beforeEach(async () => {
    uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osint-social-storage-'));
  });

  afterEach(async () => {
    await fs.rm(uploadDir, { recursive: true, force: true });
  });

  function createService(publicBaseUrl = 'https://scraper.example.com/') {
    return new StorageService(
      createConfig({
        UPLOAD_DIR: uploadDir,
        UPLOAD_PUBLIC_BASE_URL: publicBaseUrl,
      }) as any,
    );
  }

  it('saves base64 images in organized social folders', async () => {
    const service = createService();
    const today = new Date().toISOString().slice(0, 10);

    const saved = await service.saveBase64Image({
      base64: (await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer()).toString('base64'),
      scope: 'face search',
      platform: 'Instagram',
      owner: 'Operador Demo',
      filename: 'Foto Perfil.JPG',
      osintSearchId: 'search-1',
    } as any);

    expect(saved.provider).toBe('local-volume');
    expect(saved.filename).toMatch(/^foto-perfil-[a-f0-9-]+\.webp$/);
    expect(saved.relativePath).toBe(`/uploads/face-search/instagram/${today}/operador-demo/${saved.filename}`);
    expect(saved.publicUrl).toContain(`https://scraper.example.com${saved.relativePath}?expires=`);
    expect(saved.mimeType).toBe('image/webp');
    await expect(fs.stat(saved.absolutePath)).resolves.toEqual(expect.objectContaining({ size: saved.size }));
  });

  it('falls back to relative public URLs when no public base URL exists', () => {
    const service = createService('');

    expect(service.publicUrl('social/instagram/file.jpg')).toMatch(/^\/uploads\/social\/instagram\/file.jpg\?expires=/);
    expect(service.publicUrl('/uploads/social/instagram/file.jpg')).toMatch(/^\/uploads\/social\/instagram\/file.jpg\?expires=/);
  });

  it('reports Railway volume readiness from upload path', () => {
    const service = new StorageService(
      createConfig({
        UPLOAD_DIR: '/app/uploads',
        UPLOAD_PUBLIC_BASE_URL: 'https://railway.example.com',
      }) as any,
    );

    expect(service.info()).toEqual(expect.objectContaining({
      provider: 'local-volume',
      staticPath: '/uploads',
      railwayVolumeReady: true,
      publicBaseUrl: 'https://railway.example.com',
    }));
  });

  it('sanitizes path segments and filenames', () => {
    const service = createService();

    expect(service.safeSegment('José / ../../ Perfil !!')).toBe('jose-..-..-perfil');
    expect((service as any).safeFilename('../../Mi Foto.PNG')).toBe('mi-foto.png');
  });

  it('rejects dot traversal segments before writing', () => {
    const service = createService();
    expect(() => service.safeSegment('..')).toThrow('Invalid image path segment');
    expect(() => service.safeSegment('.')).toThrow('Invalid image path segment');
  });

  it('rejects HTML disguised as image base64', async () => {
    const service = createService();
    await expect(service.saveBase64Image({ base64: Buffer.from('<script>fixture</script>').toString('base64'), filename: 'page.html' })).rejects.toThrow('valid JPEG');
  });

  it('discards a client HTML extension for a real image', async () => {
    const service = createService();
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer();
    const saved = await service.saveBase64Image({ base64: bytes.toString('base64'), filename: 'page.html' });
    expect(saved.filename).toMatch(/\.webp$/);
    expect(saved.mimeType).toBe('image/webp');
  });
});
