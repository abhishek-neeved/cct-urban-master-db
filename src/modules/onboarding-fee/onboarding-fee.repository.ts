import {
  OnboardingFeeModel,
  type RazorpayPaymentLinkStatus,
  type OnboardingFeeRow,
} from './onboarding-fee.model';
import { BaseRepository } from '@shared/repositories/base.repository';
import { OnboardingFee, toOnboardingFee } from './onboarding-fee.types';

export interface CreateOnboardingFeeInput {
  userId: string;
  razorpayPaymentLinkId: string;
  status: RazorpayPaymentLinkStatus;
}

export interface ApplyPaymentUpdate {
  status: RazorpayPaymentLinkStatus;
  paidAt?: Date;
}

export interface IOnboardingFeeRepository {
  findByUserId(userId: string): Promise<OnboardingFee | null>;
  /** Row (not domain) lookup — only the row carries `razorpayPaymentLinkId`, which `toOnboardingFee` omits. */
  findRowByUserId(userId: string): Promise<OnboardingFeeRow | null>;
  findRowByPaymentLinkId(razorpayPaymentLinkId: string): Promise<OnboardingFeeRow | null>;
  create(input: CreateOnboardingFeeInput): Promise<OnboardingFee>;
  deleteByUserId(userId: string): Promise<void>;
  applyPaymentUpdate(
    razorpayPaymentLinkId: string,
    update: ApplyPaymentUpdate
  ): Promise<OnboardingFee | null>;
}

/**
 * MongoDB-backed onboarding-fee store. Inherits generic CRUD from
 * `BaseRepository` but every domain-specific query here is keyed by `userId`
 * or `razorpayPaymentLinkId`, not the document's own `_id` — callers never
 * have the Mongo id, only one of those two.
 */
export class OnboardingFeeRepository
  extends BaseRepository<OnboardingFeeRow, OnboardingFee, CreateOnboardingFeeInput>
  implements IOnboardingFeeRepository
{
  constructor() {
    super(OnboardingFeeModel, toOnboardingFee, {
      duplicateKeyMessage: 'An onboarding-fee record already exists for this user',
    });
  }

  async findByUserId(userId: string): Promise<OnboardingFee | null> {
    return this.findOne({ userId });
  }

  async findRowByUserId(userId: string): Promise<OnboardingFeeRow | null> {
    return OnboardingFeeModel.findOne({ userId }).lean<OnboardingFeeRow>();
  }

  async findRowByPaymentLinkId(razorpayPaymentLinkId: string): Promise<OnboardingFeeRow | null> {
    return OnboardingFeeModel.findOne({ razorpayPaymentLinkId }).lean<OnboardingFeeRow>();
  }

  /**
   * Lets a user start a fresh checkout after an expired/cancelled payment
   * link — `razorpayPaymentLinkId` is unique, so a stale row must be cleared
   * before `create()` can insert the new link's row.
   */
  async deleteByUserId(userId: string): Promise<void> {
    await OnboardingFeeModel.deleteOne({ userId });
  }

  async applyPaymentUpdate(
    razorpayPaymentLinkId: string,
    update: ApplyPaymentUpdate
  ): Promise<OnboardingFee | null> {
    const row = await OnboardingFeeModel.findOneAndUpdate({ razorpayPaymentLinkId }, update, {
      new: true,
    }).lean<OnboardingFeeRow>();
    return row ? toOnboardingFee(row) : null;
  }
}
