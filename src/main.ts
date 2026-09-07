import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [configService.getOrThrow<string>('RABBITMQ_URL')],
      queue: 'media_events',
      queueOptions: { durable: true },
      // Bound concurrent image decodes — unbounded prefetch let unlimited
      // in-flight sharp() jobs pile up under load, each holding a full
      // decoded image in memory.
      prefetchCount: configService.get<number>('RMQ_PREFETCH_COUNT', 5),
    },
  });

  await app.startAllMicroservices();
  await app.listen(configService.get<number>('PORT', 3005));
}
void bootstrap();
