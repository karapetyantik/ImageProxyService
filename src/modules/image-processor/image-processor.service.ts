import { Injectable, Inject, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import sharp from 'sharp';
import { S3Service } from '../s3/s3.service';
import { ConfigService } from '@nestjs/config';

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
    try {
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

      const thumbnailKey = event.objectKey.replace(/(\.\w+)$/, '_thumb.jpg');
      const mediumKey = event.objectKey.replace(/(\.\w+)$/, '_medium.jpg');

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
    } catch (error) {
      this.logger.error(`Ошибка обработки ${event.mediaId}: ${error.message}`);
    }
  }

  async processAvatar(event: {
    mediaId: string;
    objectKey: string;
    crop: { x: number; y: number; size: number };
  }) {
    try {
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

      const avatarKey = event.objectKey.replace(/(\.\w+)$/, '_avatar.png');
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
    } catch (error) {
      this.logger.error(
        `Ошибка обработки аватара ${event.mediaId}: ${error.message}`,
      );
    }
  }

  async generatePlaceholder(original: Buffer): Promise<string> {
    const buffer = await sharp(original)
      .resize(20)
      .blur(2)
      .jpeg({ quality: 30 })
      .toBuffer();

    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
  }
}
