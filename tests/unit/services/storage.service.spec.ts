import { vi } from 'vitest';

const sendMock = vi.fn();
const getSignedUrlMock = vi.fn();

const mockEnv = {
  S3_BUCKET: 'test-bucket',
  S3_REGION: 'us-east-1',
  S3_ENDPOINT: undefined as string | undefined,
  S3_ACCESS_KEY_ID: undefined as string | undefined,
  S3_SECRET_ACCESS_KEY: undefined as string | undefined,
  S3_FORCE_PATH_STYLE: false,
};

vi.mock('@config/env', () => ({ env: mockEnv }));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(function S3ClientMock() {
    return { send: sendMock };
  }),
  PutObjectCommand: vi.fn().mockImplementation(function PutObjectCommandMock(input) {
    return { input };
  }),
  GetObjectCommand: vi.fn().mockImplementation(function GetObjectCommandMock(input) {
    return { input };
  }),
  DeleteObjectCommand: vi.fn().mockImplementation(function DeleteObjectCommandMock(input) {
    return { input };
  }),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: getSignedUrlMock,
}));

vi.mock('uuid', () => ({ v4: () => 'fixed-uuid' }));

const { S3Client } = await import('@aws-sdk/client-s3');
const { S3StorageService } = await import('@shared/services/storage.service');
const { S3_PRESIGNED_URL_TTL_SECONDS } = await import('@config/constants');

describe('S3StorageService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.S3_ENDPOINT = undefined;
    mockEnv.S3_ACCESS_KEY_ID = undefined;
    mockEnv.S3_SECRET_ACCESS_KEY = undefined;
    mockEnv.S3_FORCE_PATH_STYLE = false;
  });

  it('presigns an upload URL under <keyPrefix>/<uuid> and returns the key + ttl', async () => {
    getSignedUrlMock.mockResolvedValue('https://s3.example.com/upload');
    const service = new S3StorageService('test-bucket');

    const result = await service.getUploadUrl('kyc-aadhar/u1', 'image/jpeg');

    expect(result).toEqual({
      uploadUrl: 'https://s3.example.com/upload',
      key: 'kyc-aadhar/u1/fixed-uuid',
      expiresIn: S3_PRESIGNED_URL_TTL_SECONDS,
    });
    expect(getSignedUrlMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        input: expect.objectContaining({
          Bucket: 'test-bucket',
          Key: 'kyc-aadhar/u1/fixed-uuid',
          ContentType: 'image/jpeg',
        }),
      }),
      { expiresIn: S3_PRESIGNED_URL_TTL_SECONDS }
    );
  });

  it('presigns a view (GET) URL for an existing key', async () => {
    getSignedUrlMock.mockResolvedValue('https://s3.example.com/view');
    const service = new S3StorageService('test-bucket');

    const url = await service.getViewUrl('kyc-aadhar/u1/fixed-uuid');

    expect(url).toBe('https://s3.example.com/view');
    expect(getSignedUrlMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        input: { Bucket: 'test-bucket', Key: 'kyc-aadhar/u1/fixed-uuid' },
      }),
      { expiresIn: S3_PRESIGNED_URL_TTL_SECONDS }
    );
  });

  it('deletes an object by key', async () => {
    sendMock.mockResolvedValue(undefined);
    const service = new S3StorageService('test-bucket');

    await service.deleteObject('kyc-aadhar/u1/fixed-uuid');

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { Bucket: 'test-bucket', Key: 'kyc-aadhar/u1/fixed-uuid' },
      })
    );
  });

  it('omits credentials from the client config when none are set (real AWS via the default provider chain)', () => {
    new S3StorageService('test-bucket');

    const config = (S3Client as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(config).not.toHaveProperty('credentials');
  });

  it('passes static credentials to the client when S3_ACCESS_KEY_ID/SECRET are set (e.g. MinIO)', () => {
    mockEnv.S3_ENDPOINT = 'http://localhost:9000';
    mockEnv.S3_ACCESS_KEY_ID = 'minioadmin';
    mockEnv.S3_SECRET_ACCESS_KEY = 'minioadmin';

    new S3StorageService('test-bucket');

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
      })
    );
  });
});
