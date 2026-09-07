import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import sharp from 'sharp';
import { S3Service } from '@modules/s3/s3.service';
import { ConfigService } from '@nestjs/config';

interface Crop {
  x: number;
  y: number;
  size: number;
}

@Injectable()
export class ImageProcessorService {
  private readonly logger = new Logger(ImageProcessorService.name);

  constructor(
    private readonly s3Service: S3Service,
    private readonly config: ConfigService,
    @Inject('MEDIA_PROCESSING_SERVICE')
    private readonly rabbitClient: ClientProxy,
  ) {}

  async processImage(event: {
    mediaId: string;
    objectKey: string;
    mimeType: string;
  }) {
    await this.runProcessingJob(event.mediaId, async () => {
      const original = await this.s3Service.downloadObject(event.objectKey);
      const placeholder = await this.generatePlaceholder(original);

      const thumbnailBuffer = await sharp(original)
        .resize(200, 200, { fit: 'cover' })
        .jpeg({ quality: 80 })
        .toBuffer();

      const mediumBuffer = await sharp(original)
        .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();

      const thumbnailKey = deriveVariantKey(event.objectKey, '_thumb.jpg');
      const mediumKey = deriveVariantKey(event.objectKey, '_medium.jpg');

      await this.s3Service.uploadBuffer(
        thumbnailKey,
        thumbnailBuffer,
        'image/jpeg',
      );
      await this.s3Service.uploadBuffer(mediumKey, mediumBuffer, 'image/jpeg');

      this.rabbitClient.emit('image.processed', {
        mediaId: event.mediaId,
        variants: { thumbnail: thumbnailKey, medium: mediumKey, placeholder },
      });

      this.logger.log(`Обработано изображение ${event.mediaId}`);
    });
  }

  async processAvatar(event: {
    mediaId: string;
    objectKey: string;
    crop: Crop;
  }) {
    await this.runProcessingJob(event.mediaId, async () => {
      assertValidCrop(event.crop);

      const original = await this.s3Service.downloadObject(event.objectKey);
      const placeholder = await this.generatePlaceholder(original);
      const { x, y, size } = event.crop;

      const squareBuffer = await sharp(original)
        .extract({ left: x, top: y, width: size, height: size })
        .resize(512, 512)
        .toBuffer();

      const circleMask = Buffer.from(
        `<svg width="512" height="512"><circle cx="256" cy="256" r="256" fill="white"/></svg>`,
      );

      const avatarBuffer = await sharp(squareBuffer)
        .composite([{ input: circleMask, blend: 'dest-in' }])
        .png()
        .toBuffer();

      const avatarKey = deriveVariantKey(event.objectKey, '_avatar.png');
      const avatarBucket = this.config.getOrThrow<string>('AVATAR_BUCKET');
      await this.s3Service.uploadBuffer(
        avatarKey,
        avatarBuffer,
        'image/png',
        avatarBucket,
      );

      this.rabbitClient.emit('image.processed', {
        mediaId: event.mediaId,
        variants: { avatar: avatarKey, placeholder },
      });

      this.logger.log(`Аватар обработан: ${event.mediaId}`);
    });
  }

  async generatePlaceholder(original: Buffer): Promise<string> {
    const buffer = await sharp(original)
      .resize(20)
      .blur(2)
      .jpeg({ quality: 30 })
      .toBuffer();

    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
  }

  /**
   * Shared error boundary: RMQ event handlers must never throw (an
   * unhandled rejection here would crash the process), but a swallowed
   * error still needs to be loud in the logs so failures aren't silently
   * invisible.
   */
  private async runProcessingJob(mediaId: string, job: () => Promise<void>) {
    try {
      await job();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Ошибка обработки ${mediaId}: ${message}`);
    }
  }
}

function deriveVariantKey(objectKey: string, suffix: string): string {
  return objectKey.replace(/(\.\w+)$/, suffix);
}

function assertValidCrop(crop: Crop) {
  const { x, y, size } = crop;
  const isValid =
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    Number.isInteger(size) &&
    x >= 0 &&
    y >= 0 &&
    size > 0;

  if (!isValid) {
    throw new BadRequestException(
      `Некорректные параметры обрезки: ${JSON.stringify(crop)}`,
    );
  }
}
