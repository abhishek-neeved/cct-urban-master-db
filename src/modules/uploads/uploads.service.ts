import type { IStorageService, PresignedUpload } from '@shared/services/storage.service';
import { ForbiddenError } from '@utils/errors';
import type { UploadPurpose } from './uploads.validator';

/** Second path segment of every key — see `getUploadUrl`'s `keyPrefix`. */
const KEY_OWNER_SEGMENT_INDEX = 1;

/**
 * Presigned-upload/view flow over `IStorageService`. Object keys are always
 * `<purpose>/<userId>/<uuid>` — embedding the owner in the key (not just
 * relying on the UUID being unguessable) is what lets `assertOwnership` reject
 * one user reading or deleting another user's document without needing a
 * separate database record just to track ownership.
 */
export class UploadsService {
  constructor(private readonly storage: IStorageService) {}

  async createUploadUrl(
    userId: string,
    purpose: UploadPurpose,
    contentType: string
  ): Promise<PresignedUpload> {
    return this.storage.getUploadUrl(`${purpose}/${userId}`, contentType);
  }

  async getViewUrl(userId: string, key: string): Promise<string> {
    this.assertOwnership(userId, key);
    return this.storage.getViewUrl(key);
  }

  async deleteObject(userId: string, key: string): Promise<void> {
    this.assertOwnership(userId, key);
    await this.storage.deleteObject(key);
  }

  private assertOwnership(userId: string, key: string): void {
    const owner = key.split('/')[KEY_OWNER_SEGMENT_INDEX];
    if (owner !== userId) {
      throw new ForbiddenError('You do not have permission to access this file');
    }
  }
}
