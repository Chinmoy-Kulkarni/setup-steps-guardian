import {
  completeWebhookDelivery,
  type D1DatabaseLike,
  enqueueScanJob,
  failWebhookDelivery,
  getInstallationById,
  grantAccountAdministrator,
  listAccountRepositories,
  recordWebhookDelivery,
  removeInstallation,
  removeRepository,
  revokeAccountAdministrators,
  setRepositoryScanEnabled,
  upsertInstallation,
  upsertRepository,
} from "@setup-fleet/data";
import {
  type GitHubRepository,
  isDefaultBranchPush,
  isSetupWorkflowRun,
  type NormalizedWebhookEvent,
  SETUP_POLICY_PATH,
} from "@setup-fleet/github";
import { reconcileRepositoryEntitlements } from "./repository-entitlements.js";

export interface GitHubRepositoryHydrator {
  listInstallationRepositories(installationId: string): Promise<readonly GitHubRepository[]>;
  getRepository(installationId: string, repositoryId: string): Promise<GitHubRepository>;
}

export interface ProcessGitHubWebhookInput {
  readonly db: D1DatabaseLike;
  readonly eventName: string;
  readonly deliveryId: string;
  readonly event: NormalizedWebhookEvent;
  readonly repositoryHydrator: GitHubRepositoryHydrator;
  readonly now: Date;
  readonly randomUuid?: () => string;
}

export type GitHubWebhookOutcome = "processed" | "duplicate";

export class UnknownInstallationError extends Error {
  override readonly name = "UnknownInstallationError";

  constructor(readonly installationId: string) {
    super("The signed webhook references an installation that is not registered.");
  }
}

async function resolveAccountId(
  db: D1DatabaseLike,
  event: NormalizedWebhookEvent,
): Promise<string> {
  if (event.type === "installation" || event.type === "installation_repositories") {
    return event.account.id;
  }

  const installation = await getInstallationById(db, event.installationId);
  if (installation === null) {
    throw new UnknownInstallationError(event.installationId);
  }
  return installation.accountId;
}

async function saveRepository(
  db: D1DatabaseLike,
  accountId: string,
  installationId: string,
  repository: GitHubRepository,
  observedAt: string,
): Promise<void> {
  await upsertRepository(db, {
    accountId,
    installationId,
    repositoryId: repository.id,
    owner: repository.owner,
    name: repository.name,
    isPrivate: repository.isPrivate,
    defaultBranch: repository.defaultBranch,
    isArchived: repository.isArchived,
    isSelected: true,
    observedAt,
  });
}

async function enqueueRepositories(
  db: D1DatabaseLike,
  accountId: string,
  repositoryIds: ReadonlySet<string> | null,
  deliveryId: string,
  reason: "installation" | "webhook",
  priority: number,
  now: string,
  randomUuid: () => string,
): Promise<void> {
  const repositories = await listAccountRepositories(db, accountId);
  for (const repository of repositories) {
    if (
      !repository.isSelected ||
      !repository.scanEnabled ||
      repository.isArchived ||
      (repositoryIds !== null && !repositoryIds.has(repository.repositoryId))
    ) {
      continue;
    }

    await enqueueScanJob(db, {
      accountId,
      jobId: randomUuid(),
      repositoryId: repository.repositoryId,
      reason,
      dedupeKey: `${deliveryId}:${repository.repositoryId}`,
      priority,
      availableAt: now,
      createdAt: now,
    });
  }
}

async function disableAccountScans(
  db: D1DatabaseLike,
  accountId: string,
  updatedAt: string,
): Promise<void> {
  const repositories = await listAccountRepositories(db, accountId);
  for (const repository of repositories) {
    if (repository.scanEnabled) {
      await setRepositoryScanEnabled(db, {
        accountId,
        repositoryId: repository.repositoryId,
        scanEnabled: false,
        updatedAt,
      });
    }
  }
}

async function processInstallationEvent(
  input: ProcessGitHubWebhookInput,
  accountId: string,
  now: string,
  randomUuid: () => string,
): Promise<void> {
  const { db, event, repositoryHydrator } = input;
  if (event.type !== "installation") {
    throw new TypeError("Expected an installation event.");
  }

  if (event.action === "deleted") {
    await revokeAccountAdministrators(db, accountId);
    await removeInstallation(db, {
      accountId,
      installationId: event.installationId,
    });
    return;
  }

  if (event.action === "suspend") {
    await disableAccountScans(db, accountId, now);
    return;
  }

  if (event.action === "created") {
    if (event.installerUserId === null) {
      throw new TypeError("An installation-created event must include the installer user ID.");
    }
    await grantAccountAdministrator(db, {
      accountId,
      githubUserId: event.installerUserId,
      createdAt: event.createdAt,
    });
  }

  const repositories = await repositoryHydrator.listInstallationRepositories(event.installationId);
  for (const repository of repositories) {
    await saveRepository(db, accountId, event.installationId, repository, event.updatedAt);
  }

  await reconcileRepositoryEntitlements(db, accountId, now);
  await enqueueRepositories(
    db,
    accountId,
    new Set(repositories.map((repository) => repository.id)),
    input.deliveryId,
    "installation",
    60,
    now,
    randomUuid,
  );
}

async function processInstallationRepositoriesEvent(
  input: ProcessGitHubWebhookInput,
  accountId: string,
  now: string,
  randomUuid: () => string,
): Promise<void> {
  const { db, event, repositoryHydrator } = input;
  if (event.type !== "installation_repositories") {
    throw new TypeError("Expected an installation repositories event.");
  }

  for (const removed of event.removedRepositories) {
    await removeRepository(db, {
      accountId,
      repositoryId: removed.id,
    });
  }

  const addedIds = new Set<string>();
  for (const added of event.addedRepositories) {
    const repository = await repositoryHydrator.getRepository(event.installationId, added.id);
    await saveRepository(db, accountId, event.installationId, repository, event.updatedAt);
    addedIds.add(repository.id);
  }

  await reconcileRepositoryEntitlements(db, accountId, now);
  await enqueueRepositories(
    db,
    accountId,
    addedIds,
    input.deliveryId,
    "webhook",
    70,
    now,
    randomUuid,
  );
}

async function processPushEvent(
  input: ProcessGitHubWebhookInput,
  accountId: string,
  now: string,
  randomUuid: () => string,
): Promise<void> {
  const { db, event } = input;
  if (event.type !== "push") {
    throw new TypeError("Expected a push event.");
  }

  await saveRepository(
    db,
    accountId,
    event.installationId,
    event.repository,
    event.pushedAt ?? now,
  );
  await reconcileRepositoryEntitlements(db, accountId, now);

  if (event.deleted || !isDefaultBranchPush(event) || event.relevantPaths.length === 0) {
    return;
  }

  const policyChanged =
    event.repository.name === ".github" && event.relevantPaths.includes(SETUP_POLICY_PATH);
  await enqueueRepositories(
    db,
    accountId,
    policyChanged ? null : new Set([event.repository.id]),
    input.deliveryId,
    "webhook",
    policyChanged ? 90 : 80,
    now,
    randomUuid,
  );
}

async function processWorkflowRunEvent(
  input: ProcessGitHubWebhookInput,
  accountId: string,
  now: string,
  randomUuid: () => string,
): Promise<void> {
  const { db, event } = input;
  if (event.type !== "workflow_run") {
    throw new TypeError("Expected a workflow run event.");
  }

  await saveRepository(db, accountId, event.installationId, event.repository, event.updatedAt);
  await reconcileRepositoryEntitlements(db, accountId, now);

  if (
    event.action !== "completed" ||
    !isSetupWorkflowRun(event) ||
    event.headBranch !== event.repository.defaultBranch
  ) {
    return;
  }

  await enqueueRepositories(
    db,
    accountId,
    new Set([event.repository.id]),
    input.deliveryId,
    "webhook",
    100,
    now,
    randomUuid,
  );
}

async function processEvent(
  input: ProcessGitHubWebhookInput,
  accountId: string,
  now: string,
  randomUuid: () => string,
): Promise<void> {
  switch (input.event.type) {
    case "installation":
      await processInstallationEvent(input, accountId, now, randomUuid);
      break;
    case "installation_repositories":
      await processInstallationRepositoriesEvent(input, accountId, now, randomUuid);
      break;
    case "push":
      await processPushEvent(input, accountId, now, randomUuid);
      break;
    case "workflow_run":
      await processWorkflowRunEvent(input, accountId, now, randomUuid);
      break;
  }
}

export async function processGitHubWebhook(
  input: ProcessGitHubWebhookInput,
): Promise<GitHubWebhookOutcome> {
  const now = input.now.toISOString();
  const randomUuid = input.randomUuid ?? crypto.randomUUID.bind(crypto);

  if (input.event.type === "installation" && input.event.action !== "deleted") {
    await upsertInstallation(input.db, {
      accountId: input.event.account.id,
      accountLogin: input.event.account.name,
      accountType: input.event.account.type,
      installationId: input.event.installationId,
      repositorySelection: input.event.repositorySelection,
      suspendedAt: input.event.action === "suspend" ? input.event.updatedAt : null,
      observedAt: input.event.updatedAt,
    });
  } else if (input.event.type === "installation_repositories") {
    await upsertInstallation(input.db, {
      accountId: input.event.account.id,
      accountLogin: input.event.account.name,
      accountType: input.event.account.type,
      installationId: input.event.installationId,
      repositorySelection: input.event.repositorySelection,
      suspendedAt: null,
      observedAt: input.event.updatedAt,
    });
  }

  const accountId = await resolveAccountId(input.db, input.event);
  const accepted = await recordWebhookDelivery(input.db, {
    accountId,
    deliveryId: input.deliveryId,
    eventName: input.eventName,
    receivedAt: now,
  });
  if (!accepted) {
    return "duplicate";
  }

  try {
    await processEvent(input, accountId, now, randomUuid);
    await completeWebhookDelivery(input.db, {
      accountId,
      deliveryId: input.deliveryId,
      finishedAt: now,
    });
    return "processed";
  } catch (error) {
    await failWebhookDelivery(input.db, {
      accountId,
      deliveryId: input.deliveryId,
      errorCode: "WEBHOOK_PROCESSING_FAILED",
      finishedAt: now,
    });
    throw error;
  }
}
