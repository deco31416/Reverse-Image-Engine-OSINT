import { BadRequestException } from '@nestjs/common';
import { VisualFaceSelectionService } from './visual-face-selection.service';

function createService(localFaces: any[] = []) {
  const cloudinary = {
    uploadImage: jest.fn().mockResolvedValue({ secureUrl: 'http://localhost:7105/uploads/crop.jpg', publicId: 'crop-1' }),
    getThumbnailUrl: jest.fn().mockReturnValue('http://localhost:7105/uploads/thumb.jpg'),
  };
  const google = { detectFaceBoxes: jest.fn().mockResolvedValue([]), isAvailable: jest.fn().mockReturnValue(false) };
  const biometric = { extract: jest.fn().mockResolvedValue({ facesDetected: localFaces.length, faces: localFaces }) };
  const config = { get: jest.fn((key: string) => key === 'FACE_SELECTION_SECRET' ? 'test-selection-secret' : undefined) };
  const service = new VisualFaceSelectionService(
    cloudinary as any,
    {} as any,
    google as any,
    {} as any,
    { safeSegment: jest.fn().mockReturnValue('qa') } as any,
    biometric as any,
    config as any,
  );
  jest.spyOn(service as any, 'resolveAndStoreOriginal').mockResolvedValue({
    buffer: Buffer.from('not-used-before-a-valid-box'),
    imageUrl: 'http://localhost:7105/uploads/original.jpg',
    publicId: 'original-1',
    width: 100,
    height: 100,
    source: 'upload',
  });
  return { service, google, biometric };
}

describe('VisualFaceSelectionService secure selection', () => {
  it('uses YuNet as fallback and returns a signed selectable crop', async () => {
    const { service, biometric } = createService([{
      index: 0,
      boundingBox: { x: 0, y: 0, width: 1, height: 1 },
      detectionScore: 0.91,
      qualityScore: 0.8,
      model: 'opencv-sface',
      modelVersion: 'test',
    }]);
    (service as any).resolveAndStoreOriginal.mockResolvedValue({
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
      imageUrl: 'http://localhost:7105/uploads/original.png',
      publicId: 'original-1',
      width: 1,
      height: 1,
      source: 'upload',
    });

    const result = await service.detectFaces({ imageBase64: 'ignored' });

    expect(result.detector).toBe('opencv_yunet');
    expect(result.status).toBe('faces_detected');
    expect(result.faces).toHaveLength(1);
    expect(result.faces[0].fallback).toBe(false);
    expect(service.verifySelection(result.faces[0].faceId, result.faces[0].imageUrl, result.faces[0].selectionToken)).toBe(true);
    expect(biometric.extract).toHaveBeenCalledWith(expect.any(Buffer), 12, false);
  });

  it('rejects the image when neither Google nor YuNet detects a face', async () => {
    const { service, biometric } = createService([]);

    await expect(service.detectFaces({ imageBase64: 'ignored' })).rejects.toBeInstanceOf(BadRequestException);
    expect(biometric.extract).toHaveBeenCalledWith(expect.any(Buffer), 12, false);
  });

  it('signs selected face crops and rejects a modified crop URL', () => {
    const { service } = createService();
    const token = (service as any).selectionToken('face-1', 'https://storage.example/face-1.jpg');

    expect(service.verifySelection('face-1', 'https://storage.example/face-1.jpg', token)).toBe(true);
    expect(service.verifySelection('face-1', 'https://storage.example/other.jpg', token)).toBe(false);
    expect(service.verifySelection('face-2', 'https://storage.example/face-1.jpg', token)).toBe(false);
  });
});
