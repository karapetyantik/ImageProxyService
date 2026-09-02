import { Module } from '@nestjs/common';
import { ImageProcessorService } from './image-processor.service';
import { ImageProcessorController } from './image-processor.controller';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { S3Module } from '../s3/s3.module';

@Module({
  imports: [
    S3Module,
    ClientsModule.registerAsync([
      {
        name: 'MEDIA_PROCESSING_SERVICE',
        useFactory: (config: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [config.getOrThrow<string>('RABBITMQ_URL')],
            queue: 'media_processing_events',
            queueOptions: { durable: true },
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  providers: [ImageProcessorService],
  controllers: [ImageProcessorController],
})
export class ImageProcessorModule {}
