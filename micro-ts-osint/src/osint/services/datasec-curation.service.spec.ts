import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DatasecCurationService } from './datasec-curation.service';

describe('DatasecCurationService.promoteSocialAsset', () => {
  const personId = new Types.ObjectId().toString();
  let service: DatasecCurationService;
  let personModel: any;
  let assetModel: any;
  let securityValidation: any;

  beforeEach(() => {
    personModel = {
      create: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    assetModel = {
      create: jest.fn(),
      findOne: jest.fn(),
    };
    securityValidation = {
      validatePublicUrl: jest.fn(async (value: string) => value),
    };

    service = new DatasecCurationService(
      personModel,
      assetModel,
      {} as any,
      {} as any,
      securityValidation,
    );
  });

  it('creates a validated Datasec asset from a social scraper asset', async () => {
    assetModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    const createdAsset = {
      _id: new Types.ObjectId(),
      imageUrl: 'https://cdn.example.com/avatar.jpg',
    };
    assetModel.create.mockResolvedValue(createdAsset);

    const result = await service.promoteSocialAsset(
      {
        _id: new Types.ObjectId().toString(),
        platform: 'instagram',
        owner: 'operador-demo',
        type: 'image',
        status: 'positive',
        publicUrl: 'https://cdn.example.com/avatar.jpg',
        sourceUrl: 'https://instagram.com/operador-demo',
        osintSearchId: 'search-1',
        metadata: {
          username: 'operador-demo',
          similarity: 0.91,
          bio: 'public profile',
        },
      },
      {
        personId,
        tags: ['cliente'],
      },
    );

    expect(result.reused).toBe(false);
    expect(assetModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'image',
        origin: 'osint',
        title: 'operador-demo',
        url: 'https://instagram.com/operador-demo',
        imageUrl: 'https://cdn.example.com/avatar.jpg',
        source: 'social-scraper:instagram',
        searchId: 'search-1',
        confidence: 0.91,
        curationStatus: 'validated',
        tags: expect.arrayContaining(['social-scraper', 'instagram', 'operador-demo', 'positive', 'cliente']),
        metadata: expect.objectContaining({
          socialStatus: 'positive',
          socialAssetId: expect.any(String),
          platform: 'instagram',
          owner: 'operador-demo',
        }),
      }),
    );
    expect(personModel.updateOne).toHaveBeenCalled();
  });

  it('reuses an existing Datasec asset instead of duplicating it', async () => {
    const existing = {
      personId: undefined,
      curationStatus: 'candidate',
      tags: ['old'],
      save: jest.fn().mockResolvedValue(undefined),
    };
    assetModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(existing) });

    const result = await service.promoteSocialAsset(
      {
        _id: new Types.ObjectId().toString(),
        platform: 'facebook',
        owner: 'persona',
      },
      {
        personId,
        curationStatus: 'validated',
        tags: ['nuevo'],
      },
    );

    expect(result.reused).toBe(true);
    expect(assetModel.create).not.toHaveBeenCalled();
    expect(existing.curationStatus).toBe('validated');
    expect(existing.personId?.toString()).toBe(personId);
    expect(existing.tags).toEqual(expect.arrayContaining(['old', 'nuevo', 'social-scraper']));
    expect(existing.save).toHaveBeenCalled();
  });

  it('creates a basic Datasec person when requested', async () => {
    const newPersonId = new Types.ObjectId();
    personModel.create.mockResolvedValue({ _id: newPersonId, firstName: 'Jose' });
    assetModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    assetModel.create.mockResolvedValue({ _id: new Types.ObjectId() });

    await service.promoteSocialAsset(
      {
        _id: new Types.ObjectId().toString(),
        platform: 'x',
        owner: 'deco',
        sourceUrl: 'https://x.com/deco',
      },
      {
        createPerson: {
          firstName: 'Jose',
          lastName: 'Cordero',
        },
      },
    );

    expect(personModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Jose',
        lastName: 'Cordero',
        status: 'active',
      }),
    );
    expect(assetModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        personId: newPersonId,
      }),
    );
  });

  it('rejects missing social asset identifiers', async () => {
    await expect(service.promoteSocialAsset({}, {})).rejects.toBeInstanceOf(BadRequestException);
  });
});
