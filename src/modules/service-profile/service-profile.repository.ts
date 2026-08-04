import { ServiceProfileModel, type ServiceProfileRow } from './service-profile.model';
import { BaseRepository } from '@shared/repositories/base.repository';
import {
  ServiceProfile,
  UpsertServiceProfileInput,
  toServiceProfile,
} from './service-profile.types';

export interface IServiceProfileRepository {
  findByUserId(userId: string): Promise<ServiceProfile | null>;
  /** Create the provider's first profile, or overwrite an existing one on edit. */
  upsert(userId: string, input: UpsertServiceProfileInput): Promise<ServiceProfile>;
}

/**
 * MongoDB-backed service-profile store. Every query is keyed by `userId`
 * (the collection's unique index), not by the document's own `_id` — there
 * is exactly one service profile per user.
 */
export class ServiceProfileRepository
  extends BaseRepository<ServiceProfileRow, ServiceProfile, UpsertServiceProfileInput>
  implements IServiceProfileRepository
{
  constructor() {
    super(ServiceProfileModel, toServiceProfile, {
      duplicateKeyMessage: 'A service profile already exists for this user',
    });
  }

  async findByUserId(userId: string): Promise<ServiceProfile | null> {
    return this.findOne({ userId });
  }

  async upsert(userId: string, input: UpsertServiceProfileInput): Promise<ServiceProfile> {
    const row = await ServiceProfileModel.findOneAndUpdate(
      { userId },
      {
        ...input,
        description: input.description ?? null,
        yearsOfExperience: input.yearsOfExperience ?? null,
      },
      { new: true, upsert: true }
    ).lean<ServiceProfileRow>();
    return toServiceProfile(row);
  }
}
