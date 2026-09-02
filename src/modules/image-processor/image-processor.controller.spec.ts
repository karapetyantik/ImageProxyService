import { Test, TestingModule } from '@nestjs/testing';
import { ImageProcessorController } from './image-processor.controller';

describe('ImageProcessorController', () => {
  let controller: ImageProcessorController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ImageProcessorController],
    }).compile();

    controller = module.get<ImageProcessorController>(ImageProcessorController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
