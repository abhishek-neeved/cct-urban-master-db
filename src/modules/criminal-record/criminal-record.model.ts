import { Schema, model, type Types } from 'mongoose';

export type CriminalRecordStatus = 'pending' | 'clear' | 'flagged';

/**
 * Mongoose schema for the criminal-record module, owned by this module (not a
 * shared schema package) — mirrors auth's `auth.model.ts` convention. One
 * document per user (`userId` unique); "pending" is the domain default when
 * no document exists yet (see `criminal-record.types.ts`'s
 * `PENDING_CRIMINAL_RECORD_CHECK`) — there's no user-facing submission for
 * this check today, only an admin-settable result (see CLAUDE.md decision
 * log: minimal read-only module, real vendor integration deferred).
 */
export interface CriminalRecordRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  status: CriminalRecordStatus;
  checkedAt: Date | null;
  checkedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const criminalRecordSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User', unique: true },
    status: { type: String, enum: ['pending', 'clear', 'flagged'], required: true, default: 'pending' },
    checkedAt: { type: Date, default: null },
    checkedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

export const CriminalRecordModel = model<CriminalRecordRow>('CriminalRecord', criminalRecordSchema);
