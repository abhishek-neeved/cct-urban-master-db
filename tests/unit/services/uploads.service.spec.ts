import { vi, type Mocked } from 'vitest';
import { UploadsService } from '@modules/uploads/uploads.service';
import type { IStorageService } from '@shared/services/storage.service';
import { ForbiddenError } from '@utils/errors';

describe('UploadsService', () => {
  let storage: Mocked<IStorageService>;
  let service: UploadsService;

  beforeEach(() => {
    storage = {
      getUploadUrl: vi.fn(),
      getViewUrl: vi.fn(),
      deleteObject: vi.fn(),
    };
    service = new UploadsService(storage);
  });

  describe('createUploadUrl', () => {
    it('prefixes the storage key with purpose/userId', async () => {
      storage.getUploadUrl.mockResolvedValue({
        uploadUrl: 'https://s3/upload',
        key: 'kyc-aadhar/u1/some-uuid',
        expiresIn: 300,
      });

      const result = await service.createUploadUrl('u1', 'kyc-aadhar', 'image/jpeg');

      expect(storage.getUploadUrl).toHaveBeenCalledWith('kyc-aadhar/u1', 'image/jpeg');
      expect(result.key).toBe('kyc-aadhar/u1/some-uuid');
    });
  });

  describe('getViewUrl', () => {
    it("returns a view URL for a key owned by the caller", async () => {
      storage.getViewUrl.mockResolvedValue('https://s3/view');

      const url = await service.getViewUrl('u1', 'kyc-aadhar/u1/some-uuid');

      expect(storage.getViewUrl).toHaveBeenCalledWith('kyc-aadhar/u1/some-uuid');
      expect(url).toBe('https://s3/view');
    });

    it("rejects with ForbiddenError for a key owned by a different user", async () => {
      await expect(service.getViewUrl('u1', 'kyc-aadhar/someone-else/some-uuid')).rejects.toThrow(
        ForbiddenError
      );
      expect(storage.getViewUrl).not.toHaveBeenCalled();
    });
  });

  describe('deleteObject', () => {
    it('deletes a key owned by the caller', async () => {
      await service.deleteObject('u1', 'kyc-aadhar/u1/some-uuid');
      expect(storage.deleteObject).toHaveBeenCalledWith('kyc-aadhar/u1/some-uuid');
    });

    it('rejects with ForbiddenError for a key owned by a different user', async () => {
      await expect(
        service.deleteObject('u1', 'kyc-aadhar/someone-else/some-uuid')
      ).rejects.toThrow(ForbiddenError);
      expect(storage.deleteObject).not.toHaveBeenCalled();
    });
  });
});
