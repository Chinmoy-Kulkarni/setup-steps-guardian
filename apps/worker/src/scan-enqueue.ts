import { type D1DatabaseLike, enqueueScanJob, listAccountRepositories } from "@setup-fleet/data";

export async function enqueueEligibleAccountScans(input: {
  readonly db: D1DatabaseLike;
  readonly accountId: string;
  readonly dedupePrefix: string;
  readonly reason: "webhook" | "manual";
  readonly priority: number;
  readonly now: string;
  readonly randomUuid?: () => string;
}): Promise<number> {
  const repositories = await listAccountRepositories(input.db, input.accountId);
  const randomUuid = input.randomUuid ?? (() => crypto.randomUUID());
  let enqueued = 0;

  for (const repository of repositories) {
    if (!repository.isSelected || !repository.scanEnabled || repository.isArchived) {
      continue;
    }

    const result = await enqueueScanJob(input.db, {
      accountId: input.accountId,
      jobId: randomUuid(),
      repositoryId: repository.repositoryId,
      reason: input.reason,
      dedupeKey: `${input.dedupePrefix}:${repository.repositoryId}`,
      priority: input.priority,
      availableAt: input.now,
      createdAt: input.now,
    });
    if (result.created) {
      enqueued += 1;
    }
  }

  return enqueued;
}
