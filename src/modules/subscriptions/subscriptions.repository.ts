import { SubscriptionModel, type RazorpaySubscriptionStatus, type SubscriptionRow } from './subscriptions.model';
import { BaseRepository } from '@shared/repositories/base.repository';
import { Subscription, toSubscription } from './subscriptions.types';

export interface CreateSubscriptionInput {
  userId: string;
  razorpaySubscriptionId: string;
  razorpayStatus: RazorpaySubscriptionStatus;
}

export interface ApplyWebhookUpdate {
  razorpayStatus: RazorpaySubscriptionStatus;
  startedAt?: Date;
  renewsAt?: Date;
  cancelledAt?: Date;
}

export interface ISubscriptionsRepository {
  findByUserId(userId: string): Promise<Subscription | null>;
  /** Row (not domain) lookup — only the row carries `razorpaySubscriptionId`, which `toSubscription` omits. */
  findRowByUserId(userId: string): Promise<SubscriptionRow | null>;
  create(input: CreateSubscriptionInput): Promise<Subscription>;
  applyWebhookUpdate(
    razorpaySubscriptionId: string,
    update: ApplyWebhookUpdate
  ): Promise<Subscription | null>;
}

/**
 * MongoDB-backed subscription store. Inherits generic CRUD from
 * `BaseRepository` but every domain-specific query here is keyed by `userId`
 * or `razorpaySubscriptionId`, not the document's own `_id` — callers never
 * have the Mongo id, only one of those two.
 */
export class SubscriptionsRepository
  extends BaseRepository<SubscriptionRow, Subscription, CreateSubscriptionInput>
  implements ISubscriptionsRepository
{
  constructor() {
    super(SubscriptionModel, toSubscription, {
      duplicateKeyMessage: 'A subscription already exists for this user',
    });
  }

  async findByUserId(userId: string): Promise<Subscription | null> {
    return this.findOne({ userId });
  }

  async findRowByUserId(userId: string): Promise<SubscriptionRow | null> {
    return SubscriptionModel.findOne({ userId }).lean<SubscriptionRow>();
  }

  async applyWebhookUpdate(
    razorpaySubscriptionId: string,
    update: ApplyWebhookUpdate
  ): Promise<Subscription | null> {
    const row = await SubscriptionModel.findOneAndUpdate({ razorpaySubscriptionId }, update, {
      new: true,
    }).lean<SubscriptionRow>();
    return row ? toSubscription(row) : null;
  }
}
