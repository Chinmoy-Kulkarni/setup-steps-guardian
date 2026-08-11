import {
  claimScanJob,
  cleanupExpiredOperationalData,
  completeScanJob,
  failScanJob,
  getAccountPolicy,
  getRepositoryDetails,
  listAccountsWithQueuedScanJobs,
  type OperationalCleanupResult,
  replaceEvidenceAndFindings,
  requeueExpiredScanJobs,
  retryScanJob,
  type ScanJob,
  upsertAccountPolicy,
} from "@setup-fleet/data";
import { asDataDatabase } from "./data-adapter.js";
import { loadAccountPolicy } from "./policy-loader.js";
import { type RepositoryReader, scanRepository } from "./scan-repository.js";

export interface ScanStore {
  requeueExpired(now: string, retryAt: string): Promise<number>;
  listQueuedAccounts(limit: number): Promise<readonly string[]>;
  claim(
    accountId: string,
    workerId: string,
    now: string,
    leaseExpiresAt: string,
  ): Promise<ScanJob | null>;
  getDetails(accountId: string, repositoryId: string): ReturnType<typeof getRepositoryDetails>;
  getPolicy(accountId: string): ReturnType<typeof getAccountPolicy>;
  savePolicy(input: Parameters<typeof upsertAccountPolicy>[1]): Promise<void>;
  saveResult(input: Parameters<typeof replaceEvidenceAndFindings>[1]): Promise<void>;
  complete(
    accountId: string,
    jobId: string,
    workerId: string,
    completedAt: string,
  ): Promise<boolean>;
  fail(
    accountId: string,
    jobId: string,
    workerId: string,
    errorCode: string,
    failedAt: string,
  ): Promise<boolean>;
  retry(
    accountId: string,
    jobId: string,
    workerId: string,
    errorCode: string,
    retryAt: string,
    updatedAt: string,
  ): Promise<ScanJob | null>;
  cleanup(cutoff: string, limitPerTable: number): Promise<OperationalCleanupResult>;
}

export interface RepositoryReaderFactory {
  create(installationId: string): Promise<RepositoryReader>;
}

export interface ScanFailure {
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
}

export interface ScanFailureClassifier {
  classify(error: unknown): ScanFailure;
}

export type ScanJobOutcome = "idle" | "completed" | "skipped" | "retrying" | "failed";

export interface ScanBatchResult {
  readonly recoveredLeases: number;
  readonly completed: number;
  readonly skipped: number;
  readonly retrying: number;
  readonly failed: number;
  readonly cleanup: OperationalCleanupResult;
}

export function createD1ScanStore(database: D1Database): ScanStore {
  const db = asDataDatabase(database);

  return {
    requeueExpired: (now, retryAt) => requeueExpiredScanJobs(db, now, retryAt),
    listQueuedAccounts: (limit) => listAccountsWithQueuedScanJobs(db, limit),
    claim: (accountId, workerId, now, leaseExpiresAt) =>
      claimScanJob(db, {
        accountId,
        workerId,
        claimedAt: now,
        leaseExpiresAt,
      }),
    getDetails: (accountId, repositoryId) => getRepositoryDetails(db, accountId, repositoryId),
    getPolicy: (accountId) => getAccountPolicy(db, accountId),
    savePolicy: (input) => upsertAccountPolicy(db, input),
    saveResult: (input) => replaceEvidenceAndFindings(db, input),
    complete: (accountId, jobId, workerId, completedAt) =>
      completeScanJob(db, {
        accountId,
        jobId,
        workerId,
        completedAt,
      }),
    fail: (accountId, jobId, workerId, errorCode, failedAt) =>
      failScanJob(db, {
        accountId,
        jobId,
        workerId,
        errorCode,
        failedAt,
      }),
    retry: (accountId, jobId, workerId, errorCode, retryAt, updatedAt) =>
      retryScanJob(db, {
        accountId,
        jobId,
        workerId,
        errorCode,
        retryAt,
        updatedAt,
      }),
    cleanup: (cutoff, limitPerTable) => cleanupExpiredOperationalData(db, cutoff, limitPerTable),
  };
}

function defaultRetryDelay(attemptCount: number): number {
  return Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, attemptCount - 1));
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      const value = values[index];
      if (value !== undefined) {
        results[index] = await mapper(value);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

async function processClaimedJob(
  store: ScanStore,
  readerFactory: RepositoryReaderFactory,
  failureClassifier: ScanFailureClassifier,
  job: ScanJob,
  workerId: string,
  now: Date,
): Promise<ScanJobOutcome> {
  try {
    const details = await store.getDetails(job.accountId, job.repositoryId);
    if (details === null) {
      const completed = await store.complete(job.accountId, job.id, workerId, now.toISOString());
      return completed ? "skipped" : "failed";
    }
    if (!details.repository.scanEnabled) {
      const completed = await store.complete(job.accountId, job.id, workerId, now.toISOString());
      return completed ? "skipped" : "failed";
    }

    const [persistedPolicy, reader] = await Promise.all([
      store.getPolicy(job.accountId),
      readerFactory.create(details.repository.installationId),
    ]);
    const loadedPolicy = await loadAccountPolicy({
      reader,
      owner: details.repository.owner,
      persisted: persistedPolicy,
    });
    if (
      loadedPolicy.source === "versioned" &&
      loadedPolicy.policy !== null &&
      loadedPolicy.policyHash !== persistedPolicy?.policyHash
    ) {
      await store.savePolicy({
        accountId: job.accountId,
        schemaVersion: loadedPolicy.policy.schemaVersion,
        policyHash: loadedPolicy.policyHash,
        allowedRunners: loadedPolicy.policy.allowedRunners,
        maxTimeoutMinutes: loadedPolicy.policy.maxTimeoutMinutes,
        requireTimeout: loadedPolicy.policy.requireTimeout,
        requireExplicitPermissions: loadedPolicy.policy.requireExplicitPermissions,
        requireWorkflowDispatch: loadedPolicy.policy.requireWorkflowDispatch,
        actionPinning: loadedPolicy.policy.actionPinning,
        secretUsage: loadedPolicy.policy.secretUsage,
        unsupportedJobKeys: loadedPolicy.policy.unsupportedJobKeys,
        updatedAt: now.toISOString(),
      });
    }
    const result = await scanRepository({
      repository: details.repository,
      accountPolicy: persistedPolicy,
      policyContent: loadedPolicy.validationContent,
      existingEvidence: details.evidence,
      reader,
    });
    const evidence =
      result.evidence === null
        ? null
        : {
            commitSha: result.evidence.commitSha,
            workflowHash: result.evidence.workflowHash,
            policyHash: result.evidence.policyHash,
            lockfileHashes: result.evidence.lockfileHashes,
            runnerLabel: result.evidence.runnerLabel,
            conclusion: result.evidence.conclusion,
            durationMs: result.evidence.durationMs,
            ...(result.evidence.failedStep === undefined
              ? {}
              : { failedStep: result.evidence.failedStep }),
            runId: result.evidence.runId,
            runAttempt: result.evidence.runAttempt,
            completedAt: result.evidence.completedAt,
          };

    await store.saveResult({
      accountId: job.accountId,
      repositoryId: job.repositoryId,
      status: result.status,
      evidence,
      findings: result.validation.findings,
      scannedAt: now.toISOString(),
    });
    const completed = await store.complete(job.accountId, job.id, workerId, now.toISOString());
    return completed ? "completed" : "failed";
  } catch (error) {
    const failure = failureClassifier.classify(error);
    if (!failure.retryable) {
      await store.fail(job.accountId, job.id, workerId, failure.code, now.toISOString());
      return "failed";
    }

    const retryAt = new Date(
      now.getTime() + (failure.retryAfterMs ?? defaultRetryDelay(job.attemptCount)),
    ).toISOString();
    const retried = await store.retry(
      job.accountId,
      job.id,
      workerId,
      failure.code,
      retryAt,
      now.toISOString(),
    );

    return retried?.status === "queued" ? "retrying" : "failed";
  }
}

export async function processScanBatch(input: {
  readonly store: ScanStore;
  readonly readerFactory: RepositoryReaderFactory;
  readonly failureClassifier: ScanFailureClassifier;
  readonly now?: Date;
  readonly workerId?: string;
  readonly maxAccounts?: number;
  readonly maxConcurrency?: number;
  readonly cleanupLimit?: number;
}): Promise<ScanBatchResult> {
  const now = input.now ?? new Date();
  const workerId = input.workerId ?? crypto.randomUUID();
  const maxAccounts = input.maxAccounts ?? 20;
  const maxConcurrency = input.maxConcurrency ?? 4;
  const cleanupLimit = input.cleanupLimit ?? 100;
  if (!Number.isInteger(maxAccounts) || maxAccounts < 1) {
    throw new RangeError("maxAccounts must be a positive integer.");
  }
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new RangeError("maxConcurrency must be a positive integer.");
  }
  if (!Number.isInteger(cleanupLimit) || cleanupLimit < 1) {
    throw new RangeError("cleanupLimit must be a positive integer.");
  }
  const leaseExpiresAt = new Date(now.getTime() + 2 * 60_000).toISOString();
  const recoveredLeases = await input.store.requeueExpired(now.toISOString(), now.toISOString());
  const accounts = await input.store.listQueuedAccounts(maxAccounts);
  const outcomes = await mapWithConcurrency(accounts, maxConcurrency, async (accountId) => {
    const job = await input.store.claim(accountId, workerId, now.toISOString(), leaseExpiresAt);
    return job === null
      ? "idle"
      : processClaimedJob(
          input.store,
          input.readerFactory,
          input.failureClassifier,
          job,
          workerId,
          now,
        );
  });
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60_000).toISOString();
  const cleanup = await input.store.cleanup(cutoff, cleanupLimit);

  return {
    recoveredLeases,
    completed: outcomes.filter((outcome) => outcome === "completed").length,
    skipped: outcomes.filter((outcome) => outcome === "skipped").length,
    retrying: outcomes.filter((outcome) => outcome === "retrying").length,
    failed: outcomes.filter((outcome) => outcome === "failed").length,
    cleanup,
  };
}
