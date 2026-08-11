import {
  type D1DatabaseLike,
  getSubscriptionEntitlement,
  listAccountRepositories,
  setRepositoryScanEnabled,
} from "@setup-fleet/data";
import { resolvePersistedEntitlement } from "./entitlements.js";

export interface RepositoryEntitlementResult {
  readonly enabled: number;
  readonly blocked: number;
}

export async function reconcileRepositoryEntitlements(
  db: D1DatabaseLike,
  accountId: string,
  updatedAt: string,
): Promise<RepositoryEntitlementResult> {
  const [repositories, subscription] = await Promise.all([
    listAccountRepositories(db, accountId),
    getSubscriptionEntitlement(db, accountId),
  ]);
  const entitlement = resolvePersistedEntitlement(subscription);

  let privateRepositoriesUsed = 0;
  let enabled = 0;
  let blocked = 0;

  for (const repository of repositories) {
    const eligibleForScan =
      repository.isSelected &&
      !repository.isArchived &&
      (!repository.isPrivate || ++privateRepositoriesUsed <= entitlement.privateRepositoryLimit);

    if (eligibleForScan) {
      enabled += 1;
    } else if (repository.isSelected && !repository.isArchived) {
      blocked += 1;
    }

    if (repository.scanEnabled !== eligibleForScan) {
      await setRepositoryScanEnabled(db, {
        accountId,
        repositoryId: repository.repositoryId,
        scanEnabled: eligibleForScan,
        updatedAt,
      });
    }
  }

  return { enabled, blocked };
}
