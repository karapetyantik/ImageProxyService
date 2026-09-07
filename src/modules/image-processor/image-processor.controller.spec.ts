import { Test, TestingModule } from '@nestjs/testing';
import { ImageProcessorController } from './image-processor.controller';
import { ImageProcessorService } from './image-processor.service';
import { MAX_IMAGE_BYTES } from './processing-limits';

describe('ImageProcessorController', () => {
  let controller: ImageProcessorController;
  let service: { processImage: jest.Mock; processAvatar: jest.Mock };

  const baseEvent = {
    mediaId: 'm1',
    uploaderId: 'u1',
    url: 'https://example.com/f.png',
    mimeType: 'image/png',
    fileName: 'f.png',
    sizeBytes: 1000,
    objectKey: 'u1/m1.png',
  };

  beforeEach(async () => {
    service = { processImage: jest.fn(), processAvatar: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ImageProcessorController],
      providers: [{ provide: ImageProcessorService, useValue: service }],
    }).compile();

    controller = module.get<ImageProcessorController>(ImageProcessorController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('skips non-image events', async () => {
    await controller.handleFileUploaded({
      ...baseEvent,
      mimeType: 'application/pdf',
    });
    expect(service.processImage).not.toHaveBeenCalled();
  });

  it('skips oversized events', async () => {
    await controller.handleFileUploaded({
      ...baseEvent,
      sizeBytes: MAX_IMAGE_BYTES + 1,
    });
    expect(service.processImage).not.toHaveBeenCalled();
  });

  it('skips events with a path-traversal objectKey', async () => {
    await controller.handleFileUploaded({
      ...baseEvent,
      objectKey: '../../etc/passwd',
    });
    expect(service.processImage).not.toHaveBeenCalled();
  });

  it('processes a well-formed attachment image event', async () => {
    await controller.handleFileUploaded(baseEvent);
    expect(service.processImage).toHaveBeenCalledWith(baseEvent);
  });

  it('routes avatar events with crop to processAvatar', async () => {
    const crop = { x: 0, y: 0, size: 100 };
    await controller.handleFileUploaded({
      ...baseEvent,
      purpose: 'avatar',
      crop,
    });
    expect(service.processAvatar).toHaveBeenCalledWith({
      mediaId: baseEvent.mediaId,
      objectKey: baseEvent.objectKey,
      crop,
    });
  });

  it('skips avatar events with no crop', async () => {
    await controller.handleFileUploaded({ ...baseEvent, purpose: 'avatar' });
    expect(service.processAvatar).not.toHaveBeenCalled();
  });
});
