import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

@Injectable()
export class S3Service {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.getOrThrow<string>('MINIO_BUCKET');
    this.client = new S3Client({
      endpoint: `http://${this.config.getOrThrow<string>('MINIO_ENDPOINT')}:${this.config.getOrThrow<string>('MINIO_PORT')}`,
      region: 'us-east-1',
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('MINIO_ACCESS_KEY'),
        secretAccessKey: this.config.getOrThrow<string>('MINIO_SECRET_KEY'),
      },
      forcePathStyle: true,
    });
  }

  async getUploadUrl(objectKey: string, mimeType: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: mimeType,
    });
    return getSignedUrl(this.client, command, { expiresIn: 300 });
  }

  async checkObjectExists(
    objectKey: string,
  ): Promise<{ exists: boolean; sizeBytes?: number }> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );
      return { exists: true, sizeBytes: result.ContentLength };
    } catch {
      return { exists: false };
    }
  }

  async downloadObject(objectKey: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    const stream = result.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  async uploadBuffer(
    objectKey: string,
    buffer: Buffer,
    mimeType: string,
    bucket?: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket ?? this.bucket,
        Key: objectKey,
        Body: buffer,
        ContentType: mimeType,
      }),
    );
  }

  async getDownloadUrl(objectKey: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
    });
    return getSignedUrl(this.client, command, { expiresIn: 3600 });
  }
}
