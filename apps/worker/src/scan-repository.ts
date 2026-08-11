import type {
  RepositorySetupStatus,
  ValidationResult,
  WorkflowConclusion,
  WorkflowEvidence,
} from "@setup-fleet/contracts";
import type { AccountPolicy, RepositoryRecord } from "@setup-fleet/data";
import {
  DEFAULT_POLICY,
  type Policy,
  REPOSITORY_INPUT_PATHS,
  sha256,
  stableStringify,
  validateSetupWorkflow,
} from "@setup-fleet/policy-engine";
import { deriveRepositoryStatus } from "./scan-status.js";

const WORKFLOW_PATH = ".github/workflows/copilot-setup-steps.yml";
const LOCKFILE_PATHS = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "uv.lock",
  "poetry.lock",
  "requirements.txt",
]);

export interface SetupWorkflowRun {
  readonly runId: string;
  readonly runAttempt: number;
  readonly headSha: string;
  readonly conclusion: WorkflowConclusion;
  readonly startedAt: string;
  readonly completedAt: string;
}

export interface RunDiagnostics {
  readonly runnerLabel: string;
  readonly failedStep?: string;
}

export interface RepositoryReader {
  getFileContent(input: {
    readonly owner: string;
    readonly repository: string;
    readonly path: string;
    readonly ref?: string;
  }): Promise<string | null>;
  getLatestCompletedSetupRun(input: {
    readonly owner: string;
    readonly repository: string;
    readonly defaultBranch: string;
  }): Promise<SetupWorkflowRun | null>;
  getRunDiagnostics(input: {
    readonly owner: string;
    readonly repository: string;
    readonly runId: string;
  }): Promise<RunDiagnostics>;
}

export interface RepositoryScanInput {
  readonly repository: RepositoryRecord;
  readonly accountPolicy: AccountPolicy | null;
  readonly policyContent?: string;
  readonly existingEvidence: WorkflowEvidence | null;
  readonly reader: RepositoryReader;
}

export interface RepositoryScanResult {
  readonly status: RepositorySetupStatus;
  readonly validation: ValidationResult;
  readonly evidence: WorkflowEvidence | null;
  readonly lockfileHashes: Readonly<Record<string, string>>;
}

export class ScanInvariantError extends Error {
  override readonly name = "ScanInvariantError";
}

function policyFromRecord(record: AccountPolicy | null): Policy {
  if (record === null) {
    return DEFAULT_POLICY;
  }

  return {
    schemaVersion: 1,
    allowedRunners: [...record.allowedRunners],
    maxTimeoutMinutes: record.maxTimeoutMinutes,
    requireTimeout: record.requireTimeout,
    requireExplicitPermissions: record.requireExplicitPermissions,
    requireWorkflowDispatch: record.requireWorkflowDispatch,
    actionPinning: record.actionPinning,
    secretUsage: record.secretUsage,
    unsupportedJobKeys: record.unsupportedJobKeys,
  };
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

async function readSnapshot(
  reader: RepositoryReader,
  repository: RepositoryRecord,
  ref: string,
): Promise<{ workflowContent: string | null; files: Record<string, string> }> {
  const paths = [WORKFLOW_PATH, ...REPOSITORY_INPUT_PATHS];
  const values = await mapWithConcurrency(paths, 4, async (path) => ({
    path,
    content: await reader.getFileContent({
      owner: repository.owner,
      repository: repository.name,
      path,
      ref,
    }),
  }));

  const files: Record<string, string> = {};
  let workflowContent: string | null = null;
  for (const value of values) {
    if (value.path === WORKFLOW_PATH) {
      workflowContent = value.content;
    } else if (value.content !== null) {
      files[value.path] = value.content;
    }
  }

  return { workflowContent, files };
}

async function lockfileHashes(
  files: Readonly<Record<string, string>>,
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    Object.entries(files)
      .filter(([path]) => LOCKFILE_PATHS.has(path))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(async ([path, content]) => [path, await sha256(content)] as const),
  );
  return Object.fromEntries(entries);
}

function durationMilliseconds(startedAt: string, completedAt: string): number {
  const started = Date.parse(startedAt);
  const completed = Date.parse(completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) {
    throw new ScanInvariantError("Workflow run timestamps are invalid.");
  }
  return completed - started;
}

async function buildEvidence(
  input: RepositoryScanInput,
  policyHash: string,
  run: SetupWorkflowRun,
): Promise<WorkflowEvidence> {
  if (
    input.existingEvidence?.runId === run.runId &&
    input.existingEvidence.runAttempt === run.runAttempt
  ) {
    return input.existingEvidence;
  }

  const [snapshot, diagnostics] = await Promise.all([
    readSnapshot(input.reader, input.repository, run.headSha),
    input.reader.getRunDiagnostics({
      owner: input.repository.owner,
      repository: input.repository.name,
      runId: run.runId,
    }),
  ]);
  if (snapshot.workflowContent === null) {
    throw new ScanInvariantError("Completed workflow run has no workflow file at its head SHA.");
  }

  return {
    repositoryId: input.repository.repositoryId,
    commitSha: run.headSha,
    workflowHash: await sha256(snapshot.workflowContent),
    policyHash,
    lockfileHashes: await lockfileHashes(snapshot.files),
    runnerLabel: diagnostics.runnerLabel,
    conclusion: run.conclusion,
    durationMs: durationMilliseconds(run.startedAt, run.completedAt),
    ...(diagnostics.failedStep === undefined ? {} : { failedStep: diagnostics.failedStep }),
    runId: run.runId,
    runAttempt: run.runAttempt,
    completedAt: run.completedAt,
  };
}

export async function scanRepository(input: RepositoryScanInput): Promise<RepositoryScanResult> {
  const policy = policyFromRecord(input.accountPolicy);
  const effectivePolicyHash = await sha256(stableStringify(policy));
  if (
    input.policyContent === undefined &&
    input.accountPolicy !== null &&
    input.accountPolicy.policyHash !== effectivePolicyHash
  ) {
    throw new ScanInvariantError("Persisted account policy hash does not match its fields.");
  }

  const [currentSnapshot, latestRun] = await Promise.all([
    readSnapshot(input.reader, input.repository, input.repository.defaultBranch),
    input.reader.getLatestCompletedSetupRun({
      owner: input.repository.owner,
      repository: input.repository.name,
      defaultBranch: input.repository.defaultBranch,
    }),
  ]);
  const currentLockfileHashes = await lockfileHashes(currentSnapshot.files);
  const validation = await validateSetupWorkflow({
    files: currentSnapshot.files,
    policyContent: input.policyContent ?? JSON.stringify(policy),
    ...(currentSnapshot.workflowContent === null
      ? {}
      : { workflowContent: currentSnapshot.workflowContent }),
  });
  const evidence =
    latestRun === null || validation.status === "invalid"
      ? input.existingEvidence
      : await buildEvidence(input, validation.policyHash, latestRun);

  return {
    status: deriveRepositoryStatus({
      validation,
      evidence,
      lockfileHashes: currentLockfileHashes,
    }),
    validation,
    evidence,
    lockfileHashes: currentLockfileHashes,
  };
}
