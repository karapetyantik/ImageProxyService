import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { ImageProcessorService } from './image-processor.service';

interface FileUploadedEvent {
  mediaId: string;
  uploaderId: string;
  url: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  objectKey: string;
  purpose?: 'attachment' | 'avatar';
  crop?: { x: number; y: number; size: number } | null;
}

@Controller()
export class ImageProcessorController {
  private readonly logger = new Logger(ImageProcessorController.name);

  constructor(private readonly imageProcessorService: ImageProcessorService) {}

  @EventPattern('file.uploaded')
  async handleFileUploaded(@Payload() event: FileUploadedEvent) {
    if (!event.mimeType.startsWith('image/')) {
      this.logger.log(`Пропускаем ${event.mediaId} — не изображение`);
      return;
    }

    if (event.purpose === 'avatar') {
      if (!event.crop) {
        this.logger.warn(
          `Событие для аватара ${event.mediaId} пришло без crop — пропускаем`,
        );
        return;
      }
      await this.imageProcessorService.processAvatar({
        mediaId: event.mediaId,
        objectKey: event.objectKey,
        crop: event.crop,
      });
    } else {
      await this.imageProcessorService.processImage(event);
    }
  }
}
