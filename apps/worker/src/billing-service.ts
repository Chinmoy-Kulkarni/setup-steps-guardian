import {
  type SetPaddleSubscriptionEntitlementInput,
  type SubscriptionUpsertResult,
  setSubscriptionEntitlement,
} from "@setup-fleet/data";
import { asDataDatabase } from "./data-adapter.js";
import type { BillingPlan, SubscriptionUpdate } from "./paddle.js";

const REPOSITORY_LIMITS = {
  team: 25,
  fleet: 100,
} as const satisfies Record<BillingPlan, number>;

export function priceIdForPlan(
  plan: BillingPlan,
  prices: { readonly team: string; readonly fleet: string },
): string {
  return prices[plan];
}

export function subscriptionInputForPaddle(
  update: SubscriptionUpdate,
): SetPaddleSubscriptionEntitlementInput {
  const status =
    update.status === "active" ? "active" : update.status === "past_due" ? "grace" : "inactive";

  return {
    accountId: update.githubAccountId,
    planKey: update.plan,
    status,
    repositoryLimit: REPOSITORY_LIMITS[update.plan],
    source: "paddle",
    providerCustomerId: update.providerCustomerId,
    providerSubscriptionId: update.providerSubscriptionId,
    lastProviderEventId: update.eventId,
    lastProviderEventAt: update.occurredAt,
    effectiveAt: update.occurredAt,
    expiresAt: null,
    updatedAt: update.occurredAt,
  };
}

export async function applyPaddleSubscriptionUpdate(
  database: D1Database,
  update: SubscriptionUpdate,
): Promise<SubscriptionUpsertResult> {
  return setSubscriptionEntitlement(asDataDatabase(database), subscriptionInputForPaddle(update));
}
