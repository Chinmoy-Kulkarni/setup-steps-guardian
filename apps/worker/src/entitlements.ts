import type { SubscriptionEntitlement as PersistedSubscriptionEntitlement } from "@setup-fleet/data";
import type { BillingPlan, SubscriptionStatus } from "./paddle.js";

export type EntitlementPlan = "free" | BillingPlan;

export interface SubscriptionEntitlement {
  readonly plan: BillingPlan;
  readonly status: SubscriptionStatus;
}

export interface Entitlement {
  readonly plan: EntitlementPlan;
  readonly privateRepositoryLimit: number;
  readonly canScanPrivateRepositories: boolean;
}

const PRIVATE_REPOSITORY_LIMITS = {
  free: 5,
  team: 25,
  fleet: 100,
} as const satisfies Record<EntitlementPlan, number>;

export function resolveEntitlement(subscription: SubscriptionEntitlement | undefined): Entitlement {
  const paidIsActive =
    subscription !== undefined &&
    (subscription.status === "active" || subscription.status === "past_due");
  const plan: EntitlementPlan = paidIsActive ? subscription.plan : "free";

  return {
    plan,
    privateRepositoryLimit: PRIVATE_REPOSITORY_LIMITS[plan],
    canScanPrivateRepositories: true,
  };
}

export function resolvePersistedEntitlement(
  subscription: PersistedSubscriptionEntitlement | null,
): Entitlement {
  if (
    subscription === null ||
    (subscription.planKey !== "team" && subscription.planKey !== "fleet")
  ) {
    return resolveEntitlement(undefined);
  }

  const status: SubscriptionStatus =
    subscription.status === "active"
      ? "active"
      : subscription.status === "grace"
        ? "past_due"
        : "canceled";

  return resolveEntitlement({
    plan: subscription.planKey,
    status,
  });
}

export function partitionRepositoriesByEntitlement<T extends { readonly isPrivate: boolean }>(
  repositories: readonly T[],
  entitlement: Entitlement,
): { allowed: readonly T[]; blocked: readonly T[] } {
  let privateRepositoriesUsed = 0;
  const allowed: T[] = [];
  const blocked: T[] = [];

  for (const repository of repositories) {
    if (!repository.isPrivate) {
      allowed.push(repository);
      continue;
    }

    privateRepositoriesUsed += 1;
    if (privateRepositoriesUsed <= entitlement.privateRepositoryLimit) {
      allowed.push(repository);
    } else {
      blocked.push(repository);
    }
  }

  return { allowed, blocked };
}
