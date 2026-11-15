import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CloudinaryService } from './cloudinary.service';

const ONE_PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function createConfig(values: Record<string, string>) {
  return {
    get: jest.fn((key: string) => values[key]),
  };
}

describe('CloudinaryService local storage mode', () => {
  let uploadDir: string;

  beforeEach(() => {
    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-cloudinary-local-'));
  });

  afterEach(() => {
    fs.rmSync(uploadDir, { recursive: true, force: true });
  });

  function createService() {
    return new CloudinaryService(
      createConfig({
        CLOUDINARY_ENABLED: 'false',
        UPLOAD_DIR: uploadDir,
        UPLOAD_PUBLIC_BASE_URL: 'https://backend.example.com',
        PORT: '7105',
      }) as any,
      {} as any,
    );
  }

  it('saves base64 images locally with safe folder and filename', async () => {
    const service = createService();

    const result = await service.uploadBase64(ONE_PIXEL_PNG, 'Usuario Demo Frente.png', {
      folder: 'datasec/Usuario Demo/face original',
    });

    expect(result.secureUrl).toMatch(/^https:\/\/backend\.example\.com\/uploads\/datasec\/usuario-demo\/face-original\/\d+-usuario-demo-frente\.png\?expires=\d+&signature=[a-f0-9]{64}$/);
    expect(result.publicId).toMatch(/^datasec\/usuario-demo\/face-original\/\d+-usuario-demo-frente\.png$/);
    expect(result.format).toBe('png');
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
    expect(fs.existsSync(path.join(uploadDir, result.publicId))).toBe(true);
  });

  it('resolves thumbnails and local paths without escaping uploadDir', async () => {
    const service = createService();
    const result = await service.uploadBase64(ONE_PIXEL_PNG, 'perfil.png', {
      folder: 'datasec/A/persona',
    });

    expect(service.getThumbnailUrl(result.publicId, 'medium')).toBe(result.secureUrl);
    expect(service.getLocalPath(result.secureUrl)).toBe(path.join(uploadDir, result.publicId));
    expect(service.getLocalPath('/uploads/../secret.png')).toBeNull();
  });

  it('deletes only files inside uploadDir in local mode', async () => {
    const service = createService();
    const result = await service.uploadBase64(ONE_PIXEL_PNG, 'delete-me.png', {
      folder: 'face-jobs/job-1/source',
    });
    const localPath = path.join(uploadDir, result.publicId);
    expect(fs.existsSync(localPath)).toBe(true);

    await service.deleteImage(result.publicId);

    expect(fs.existsSync(localPath)).toBe(false);
  });
});
