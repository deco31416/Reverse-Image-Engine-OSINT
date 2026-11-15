import { Types } from 'mongoose';
import { SocialAssetRepository } from './social-asset.repository';

describe('SocialAssetRepository', () => {
  let repository: SocialAssetRepository;
  let socialSearchRepository: any;
  let model: any;

  beforeEach(() => {
    model = {
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
    };
    socialSearchRepository = {
      configured: jest.fn(() => true),
      assetModel: jest.fn().mockResolvedValue(model),
    };
    repository = new SocialAssetRepository(socialSearchRepository);
  });

  describe('findAsset', () => {
    it('returns null for invalid ObjectId without calling Mongo', async () => {
      await expect(repository.findAsset('bad-id')).resolves.toBeNull();
      expect(model.findById).not.toHaveBeenCalled();
    });

    it('loads an asset by id when ObjectId is valid', async () => {
      const id = new Types.ObjectId().toString();
      const asset = { _id: id, platform: 'instagram' };
      model.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(asset) });

      await expect(repository.findAsset(id)).resolves.toBe(asset);
      expect(model.findById).toHaveBeenCalledWith(id);
    });
  });

  describe('markStatus', () => {
    it('preserves metadata while storing status note fields', async () => {
      const id = new Types.ObjectId().toString();
      model.findByIdAndUpdate.mockResolvedValue({
        _id: id,
        status: 'positive',
      });

      const result = await repository.markStatus(id, 'positive', { note: 'Validado' });

      expect(result).toEqual({ updated: true, id, status: 'positive' });
      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
        id,
        {
          $set: expect.objectContaining({
            status: 'positive',
            'metadata.lastStatusNote': 'Validado',
            'metadata.statusUpdatedAt': expect.any(Date),
          }),
        },
        { new: true },
      );
    });

    it('returns a controlled response when Mongo is not configured', async () => {
      socialSearchRepository.assetModel.mockResolvedValue(undefined);

      await expect(repository.markStatus(new Types.ObjectId().toString(), 'archived')).resolves.toEqual({
        updated: false,
        reason: 'mongo_not_configured',
      });
    });
  });
});
