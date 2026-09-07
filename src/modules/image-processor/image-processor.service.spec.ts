import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ImageProcessorService } from './image-processor.service';
import { S3Service } from '@modules/s3/s3.service';

// Minimal valid 1x1 PNG.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('ImageProcessorService', () => {
  let service: ImageProcessorService;
  let s3: {
    downloadObject: jest.Mock;
    uploadBuffer: jest.Mock;
  };
  let rabbitClient: { emit: jest.Mock };

  beforeEach(async () => {
    s3 = {
      downloadObject: jest.fn().mockResolvedValue(PNG_1X1),
      uploadBuffer: jest.fn().mockResolvedValue(undefined),
    };
    rabbitClient = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImageProcessorService,
        { provide: S3Service, useValue: s3 },
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn().mockReturnValue('avatars') },
        },
        { provide: 'MEDIA_PROCESSING_SERVICE', useValue: rabbitClient },
      ],
    }).compile();

    service = module.get(ImageProcessorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('rejects a negative crop offset without touching S3', async () => {
    await service.processAvatar({
      mediaId: 'm1',
      objectKey: 'user1/m1.png',
      crop: { x: -1, y: 0, size: 100 },
    });

    // runProcessingJob swallows the error (RMQ handlers must not throw) —
    // the meaningful assertion is that it never got to work with real data.
    expect(s3.downloadObject).not.toHaveBeenCalled();
    expect(rabbitClient.emit).not.toHaveBeenCalled();
  });

  it('rejects a non-integer crop size without touching S3', async () => {
    await service.processAvatar({
      mediaId: 'm1',
      objectKey: 'user1/m1.png',
      crop: { x: 0, y: 0, size: 10.5 },
    });

    expect(s3.downloadObject).not.toHaveBeenCalled();
    expect(rabbitClient.emit).not.toHaveBeenCalled();
  });

  it('does not throw even when the S3 download fails', async () => {
    s3.downloadObject.mockRejectedValue(new Error('boom'));

    await expect(
      service.processImage({
        mediaId: 'm1',
        objectKey: 'user1/m1.png',
        mimeType: 'image/png',
      }),
    ).resolves.toBeUndefined();
  });
});
