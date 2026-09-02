import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ImageProcessorModule } from './modules/image-processor/image-processor.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), ImageProcessorModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
