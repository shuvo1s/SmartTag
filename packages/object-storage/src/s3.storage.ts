import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import {
  assertValidObjectKey,
  ObjectNotFoundError,
  type ObjectStorage,
  type PutObjectOptions,
  type StoredObject,
} from './object-storage';

export interface S3StorageOptions {
  readonly bucket: string;
  readonly region: string;
  /** Custom endpoint for S3-compatible services (MinIO, Cloudflare R2, …). */
  readonly endpoint: string | null;
  readonly forcePathStyle: boolean;
  readonly accessKeyId: string | null;
  readonly secretAccessKey: string | null;
}

/** AWS S3 and S3-compatible object storage. */
export class S3Storage implements ObjectStorage {
  readonly driver = 's3';
  private readonly client: S3Client;

  constructor(
    private readonly options: S3StorageOptions,
    client?: S3Client,
  ) {
    this.client =
      client ??
      new S3Client({
        region: options.region,
        endpoint: options.endpoint ?? undefined,
        forcePathStyle: options.forcePathStyle,
        credentials:
          options.accessKeyId && options.secretAccessKey
            ? { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey }
            : undefined,
      });
  }

  async putObject(key: string, body: Buffer, options: PutObjectOptions): Promise<void> {
    assertValidObjectKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: body,
        ContentType: options.contentType,
        // The service verifies the payload against this checksum and rejects mismatches.
        ChecksumSHA256: Buffer.from(options.checksumSha256, 'hex').toString('base64'),
      }),
    );
  }

  async getObject(key: string): Promise<StoredObject> {
    assertValidObjectKey(key);
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
      );
      if (!(result.Body instanceof Readable)) {
        throw new Error('Unexpected S3 response body type');
      }
      return { body: result.Body, contentLength: result.ContentLength ?? null };
    } catch (error) {
      if (error instanceof NoSuchKey) {
        throw new ObjectNotFoundError(key);
      }
      throw error;
    }
  }

  async objectExists(key: string): Promise<boolean> {
    assertValidObjectKey(key);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }));
      return true;
    } catch (error) {
      if (error instanceof NotFound || error instanceof NoSuchKey) {
        return false;
      }
      throw error;
    }
  }

  async deleteObject(key: string): Promise<void> {
    assertValidObjectKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }
}
