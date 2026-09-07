import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { ImageProcessorService } from './image-processor.service';
import { MAX_IMAGE_BYTES } from './processing-limits';

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

    if (event.sizeBytes > MAX_IMAGE_BYTES) {
      this.logger.warn(
        `Пропускаем ${event.mediaId} — размер ${event.sizeBytes} превышает лимит ${MAX_IMAGE_BYTES}`,
      );
      return;
    }

    if (!isSafeObjectKey(event.objectKey)) {
      this.logger.warn(
        `Пропускаем ${event.mediaId} — недопустимый objectKey: ${event.objectKey}`,
      );
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

function isSafeObjectKey(objectKey: string): boolean {
  return (
    objectKey.length > 0 &&
    !objectKey.startsWith('/') &&
    !objectKey.includes('..')
  );
}
