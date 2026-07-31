import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { env } from '@config/env';
import { S3_PRESIGNED_URL_TTL_SECONDS } from '@config/constants';

export interface PresignedUpload {
  /** Short-lived URL the client PUTs the file bytes to directly (bypasses this server). */
  uploadUrl: string;
  /** Object key to persist and later pass to `getViewUrl`/`deleteObject`. */
  key: string;
  /** Seconds until `uploadUrl` expires. */
  expiresIn: number;
}

export interface IStorageService {
  /** Issue a presigned PUT URL for a new object under `keyPrefix`. */
  getUploadUrl(keyPrefix: string, contentType: string): Promise<PresignedUpload>;
  /** Issue a short-lived presigned GET URL — objects are private by default. */
  getViewUrl(key: string): Promise<string>;
  deleteObject(key: string): Promise<void>;
}

/**
 * S3-compatible object storage (real AWS S3 in production; a local MinIO
 * instance in dev — see docker-compose.yml). Files never transit this
 * process: the client uploads directly to the presigned URL, and reads go
 * through a presigned GET rather than a public bucket URL, so documents
 * (KYC images, etc.) stay private by default.
 */
export class S3StorageService implements IStorageService {
  private readonly client: S3Client;

  constructor(private readonly bucket: string = env.S3_BUCKET) {
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      ...(env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: env.S3_ACCESS_KEY_ID,
              secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            },
          }
        : {}),
    });
  }

  async getUploadUrl(keyPrefix: string, contentType: string): Promise<PresignedUpload> {
    const key = `${keyPrefix}/${uuidv4()}`;
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType });
    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: S3_PRESIGNED_URL_TTL_SECONDS,
    });
    return { uploadUrl, key, expiresIn: S3_PRESIGNED_URL_TTL_SECONDS };
  }

  async getViewUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: S3_PRESIGNED_URL_TTL_SECONDS });
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
