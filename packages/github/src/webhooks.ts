import { WebhookPayloadError } from "./errors.js";
import { normalizeIsoTimestamp } from "./timestamps.js";
import type {
  GitHubAccount,
  GitHubRepository,
  GitHubRepositorySelection,
  GitHubSelectedRepository,
  GitHubWorkflowConclusion,
} from "./types.js";
import type { RawWebhookBody } from "./webhook-signature.js";

export const SETUP_WORKFLOW_PATH = ".github/workflows/copilot-setup-steps.yml";
export const SETUP_WORKFLOW_FILENAME = "copilot-setup-steps.yml";
export const SETUP_POLICY_PATH = ".github/agent-setup-policy.yml";

export const RELEVANT_MANIFEST_AND_LOCKFILE_PATHS = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "pyproject.toml",
  "uv.lock",
  "poetry.lock",
  "requirements.txt",
] as const;

const relevantManifestAndLockfilePaths = new Set<string>(RELEVANT_MANIFEST_AND_LOCKFILE_PATHS);
const relevantRepositoryPaths = new Set<string>([
  SETUP_WORKFLOW_PATH,
  SETUP_POLICY_PATH,
  ...RELEVANT_MANIFEST_AND_LOCKFILE_PATHS,
]);
const installationActions = [
  "created",
  "deleted",
  "new_permissions_accepted",
  "suspend",
  "unsuspend",
] as const;
const installationRepositoryActions = ["added", "removed"] as const;
const workflowRunActions = ["completed", "in_progress", "requested"] as const;
const workflowConclusions = [
  "action_required",
  "cancelled",
  "failure",
  "neutral",
  "skipped",
  "stale",
  "startup_failure",
  "success",
  "timed_out",
] as const satisfies readonly GitHubWorkflowConclusion[];

export type InstallationAction = (typeof installationActions)[number];
export type InstallationRepositoriesAction = (typeof installationRepositoryActions)[number];
export type WorkflowRunAction = (typeof workflowRunActions)[number];
export type SupportedWebhookEventName =
  | "installation"
  | "installation_repositories"
  | "push"
  | "workflow_run";

export interface InstallationWebhookEvent {
  readonly type: "installation";
  readonly action: InstallationAction;
  readonly installationId: string;
  readonly installerUserId: string | null;
  readonly account: GitHubAccount;
  readonly repositorySelection: GitHubRepositorySelection;
  readonly repositories: readonly GitHubSelectedRepository[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface InstallationRepositoriesWebhookEvent {
  readonly type: "installation_repositories";
  readonly action: InstallationRepositoriesAction;
  readonly installationId: string;
  readonly account: GitHubAccount;
  readonly repositorySelection: GitHubRepositorySelection;
  readonly addedRepositories: readonly GitHubSelectedRepository[];
  readonly removedRepositories: readonly GitHubSelectedRepository[];
  readonly updatedAt: string;
}

export interface PushWebhookEvent {
  readonly type: "push";
  readonly installationId: string;
  readonly repository: GitHubRepository;
  readonly branch: string | null;
  readonly headSha: string;
  readonly deleted: boolean;
  readonly relevantPaths: readonly string[];
  readonly pushedAt: string | null;
}

export interface WorkflowRunWebhookEvent {
  readonly type: "workflow_run";
  readonly action: WorkflowRunAction;
  readonly installationId: string;
  readonly repository: GitHubRepository;
  readonly runId: string;
  readonly workflowId: string;
  readonly workflowName: string | null;
  readonly workflowPath: string;
  readonly headSha: string;
  readonly headBranch: string | null;
  readonly conclusion: GitHubWorkflowConclusion | null;
  readonly runAttempt: number;
  readonly runNumber: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly runStartedAt: string;
}

export type NormalizedWebhookEvent =
  | InstallationWebhookEvent
  | InstallationRepositoriesWebhookEvent
  | PushWebhookEvent
  | WorkflowRunWebhookEvent;

type JsonObject = Record<string, unknown>;

function fail(eventName: string, path: string, detail: string): never {
  throw new WebhookPayloadError(eventName, path, detail);
}

function expectObject(value: unknown, eventName: string, path: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail(eventName, path, "expected an object");
  }
  return value as JsonObject;
}

function expectString(value: unknown, eventName: string, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    return fail(eventName, path, "expected a non-empty string");
  }
  return value;
}

function expectNullableString(value: unknown, eventName: string, path: string): string | null {
  if (value === null) {
    return null;
  }
  return expectString(value, eventName, path);
}

function expectBoolean(value: unknown, eventName: string, path: string): boolean {
  if (typeof value !== "boolean") {
    return fail(eventName, path, "expected a boolean");
  }
  return value;
}

function expectPositiveInteger(value: unknown, eventName: string, path: string): number {
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value <= 0) {
    return fail(eventName, path, "expected a positive safe integer");
  }
  return value;
}

function expectNonNegativeInteger(value: unknown, eventName: string, path: string): number {
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < 0) {
    return fail(eventName, path, "expected a non-negative safe integer");
  }
  return value;
}

function expectArray(value: unknown, eventName: string, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    return fail(eventName, path, "expected an array");
  }
  return value;
}

function expectTimestamp(value: unknown, eventName: string, path: string): string {
  const timestamp = expectString(value, eventName, path);
  const normalized = normalizeIsoTimestamp(timestamp);
  if (normalized === null) {
    return fail(eventName, path, "expected an ISO 8601 timestamp");
  }
  return normalized;
}

function expectSha(value: unknown, eventName: string, path: string): string {
  const sha = expectString(value, eventName, path);
  if (!/^[a-f0-9]{40}$/i.test(sha)) {
    return fail(eventName, path, "expected a 40-character Git commit SHA");
  }
  return sha.toLowerCase();
}

function expectEnum<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  eventName: string,
  path: string,
): Values[number] {
  const candidate = expectString(value, eventName, path);
  if (!values.includes(candidate)) {
    return fail(eventName, path, "expected one of the supported values");
  }
  return candidate as Values[number];
}

function expectRepositorySelection(
  value: unknown,
  eventName: string,
  path: string,
): GitHubRepositorySelection {
  return expectEnum(value, ["all", "selected"] as const, eventName, path);
}

function parseAccount(value: unknown, eventName: string, path: string): GitHubAccount {
  const account = expectObject(value, eventName, path);
  const id = String(expectPositiveInteger(account.id, eventName, `${path}.id`));
  const name =
    typeof account.login === "string" && account.login.length > 0
      ? account.login
      : typeof account.slug === "string" && account.slug.length > 0
        ? account.slug
        : fail(eventName, path, "expected account.login or account.slug");
  return {
    id,
    name,
    type: expectEnum(account.type, ["Organization", "User"] as const, eventName, `${path}.type`),
  };
}

function parseInstallation(
  value: unknown,
  eventName: string,
  path: string,
): {
  readonly id: string;
  readonly account: GitHubAccount;
  readonly repositorySelection: GitHubRepositorySelection;
  readonly createdAt: string;
  readonly updatedAt: string;
} {
  const installation = expectObject(value, eventName, path);
  return {
    id: String(expectPositiveInteger(installation.id, eventName, `${path}.id`)),
    account: parseAccount(installation.account, eventName, `${path}.account`),
    repositorySelection: expectRepositorySelection(
      installation.repository_selection,
      eventName,
      `${path}.repository_selection`,
    ),
    createdAt: expectTimestamp(installation.created_at, eventName, `${path}.created_at`),
    updatedAt: expectTimestamp(installation.updated_at, eventName, `${path}.updated_at`),
  };
}

function parseInstallationReference(value: unknown, eventName: string, path: string): string {
  const installation = expectObject(value, eventName, path);
  return String(expectPositiveInteger(installation.id, eventName, `${path}.id`));
}

function parseRepository(value: unknown, eventName: string, path: string): GitHubRepository {
  const repository = expectObject(value, eventName, path);
  const owner = expectObject(repository.owner, eventName, `${path}.owner`);
  return {
    id: String(expectPositiveInteger(repository.id, eventName, `${path}.id`)),
    owner: expectString(owner.login, eventName, `${path}.owner.login`),
    name: expectString(repository.name, eventName, `${path}.name`),
    defaultBranch: expectString(repository.default_branch, eventName, `${path}.default_branch`),
    isPrivate: expectBoolean(repository.private, eventName, `${path}.private`),
    isArchived: expectBoolean(repository.archived, eventName, `${path}.archived`),
  };
}

function parseSelectedRepository(
  value: unknown,
  eventName: string,
  path: string,
): GitHubSelectedRepository {
  const repository = expectObject(value, eventName, path);
  const name = expectString(repository.name, eventName, `${path}.name`);
  const fullName = expectString(repository.full_name, eventName, `${path}.full_name`);
  const separator = fullName.indexOf("/");
  if (
    separator <= 0 ||
    separator !== fullName.lastIndexOf("/") ||
    fullName.slice(separator + 1) !== name
  ) {
    return fail(eventName, `${path}.full_name`, "expected the form owner/name");
  }

  return {
    id: String(expectPositiveInteger(repository.id, eventName, `${path}.id`)),
    owner: fullName.slice(0, separator),
    name,
    defaultBranch: null,
    isPrivate: expectBoolean(repository.private, eventName, `${path}.private`),
  };
}

function parseSelectedRepositories(
  value: unknown,
  eventName: string,
  path: string,
  optional: boolean,
): readonly GitHubSelectedRepository[] {
  if (value === undefined && optional) {
    return [];
  }
  return expectArray(value, eventName, path).map((repository, index) =>
    parseSelectedRepository(repository, eventName, `${path}[${index}]`),
  );
}

function parseChangedPathArray(value: unknown, eventName: string, path: string): readonly string[] {
  if (value === undefined) {
    return [];
  }
  return expectArray(value, eventName, path).map((entry, index) =>
    expectString(entry, eventName, `${path}[${index}]`),
  );
}

function collectRelevantChangedPaths(
  commitsValue: unknown,
  headCommitValue: unknown,
  eventName: string,
): readonly string[] {
  const changedPaths: string[] = [];
  const commits = expectArray(commitsValue, eventName, "commits");

  const addCommitPaths = (value: unknown, path: string): void => {
    const commit = expectObject(value, eventName, path);
    changedPaths.push(
      ...parseChangedPathArray(commit.added, eventName, `${path}.added`),
      ...parseChangedPathArray(commit.modified, eventName, `${path}.modified`),
      ...parseChangedPathArray(commit.removed, eventName, `${path}.removed`),
    );
  };

  commits.forEach((commit, index) => {
    addCommitPaths(commit, `commits[${index}]`);
  });
  if (headCommitValue !== null) {
    addCommitPaths(headCommitValue, "head_commit");
  }
  return filterRelevantRepositoryPaths(changedPaths);
}

export function isSetupWorkflowPath(path: string): boolean {
  return path === SETUP_WORKFLOW_PATH;
}

export function isRelevantManifestOrLockfilePath(path: string): boolean {
  return relevantManifestAndLockfilePaths.has(path);
}

export function isRelevantRepositoryPath(path: string): boolean {
  return relevantRepositoryPaths.has(path);
}

export function filterRelevantRepositoryPaths(paths: Iterable<string>): readonly string[] {
  return [...new Set([...paths].filter(isRelevantRepositoryPath))].sort();
}

export function parseInstallationWebhook(payload: unknown): InstallationWebhookEvent {
  const eventName = "installation";
  const root = expectObject(payload, eventName, "$");
  const action = expectEnum(root.action, installationActions, eventName, "action");
  const installation = parseInstallation(root.installation, eventName, "installation");
  const installerUserId =
    action === "created"
      ? String(
          expectPositiveInteger(
            expectObject(root.sender, eventName, "sender").id,
            eventName,
            "sender.id",
          ),
        )
      : null;

  return {
    type: eventName,
    action,
    installationId: installation.id,
    installerUserId,
    account: installation.account,
    repositorySelection: installation.repositorySelection,
    repositories: parseSelectedRepositories(root.repositories, eventName, "repositories", true),
    createdAt: installation.createdAt,
    updatedAt: installation.updatedAt,
  };
}

export function parseInstallationRepositoriesWebhook(
  payload: unknown,
): InstallationRepositoriesWebhookEvent {
  const eventName = "installation_repositories";
  const root = expectObject(payload, eventName, "$");
  const action = expectEnum(root.action, installationRepositoryActions, eventName, "action");
  const installation = parseInstallation(root.installation, eventName, "installation");
  const repositorySelection = expectRepositorySelection(
    root.repository_selection,
    eventName,
    "repository_selection",
  );
  if (repositorySelection !== installation.repositorySelection) {
    return fail(eventName, "repository_selection", "must match installation.repository_selection");
  }

  return {
    type: eventName,
    action,
    installationId: installation.id,
    account: installation.account,
    repositorySelection,
    addedRepositories: parseSelectedRepositories(
      root.repositories_added,
      eventName,
      "repositories_added",
      false,
    ),
    removedRepositories: parseSelectedRepositories(
      root.repositories_removed,
      eventName,
      "repositories_removed",
      false,
    ),
    updatedAt: installation.updatedAt,
  };
}

export function parsePushWebhook(payload: unknown): PushWebhookEvent {
  const eventName = "push";
  const root = expectObject(payload, eventName, "$");
  const repository = parseRepository(root.repository, eventName, "repository");
  const ref = expectString(root.ref, eventName, "ref");
  const branchPrefix = "refs/heads/";
  const branch = ref.startsWith(branchPrefix) ? ref.slice(branchPrefix.length) : null;
  if (branch !== null && branch.length === 0) {
    return fail(eventName, "ref", "branch name must not be empty");
  }
  const deleted = expectBoolean(root.deleted, eventName, "deleted");
  const headCommit =
    root.head_commit === null ? null : expectObject(root.head_commit, eventName, "head_commit");
  if (!deleted && headCommit === null) {
    return fail(eventName, "head_commit", "must be present for a non-deletion push");
  }

  return {
    type: eventName,
    installationId: parseInstallationReference(root.installation, eventName, "installation"),
    repository,
    branch,
    headSha: expectSha(root.after, eventName, "after"),
    deleted,
    relevantPaths: collectRelevantChangedPaths(root.commits, root.head_commit, eventName),
    pushedAt:
      headCommit === null
        ? null
        : expectTimestamp(headCommit.timestamp, eventName, "head_commit.timestamp"),
  };
}

export function parseWorkflowRunWebhook(payload: unknown): WorkflowRunWebhookEvent {
  const eventName = "workflow_run";
  const root = expectObject(payload, eventName, "$");
  const action = expectEnum(root.action, workflowRunActions, eventName, "action");
  const run = expectObject(root.workflow_run, eventName, "workflow_run");
  const conclusion =
    run.conclusion === null
      ? null
      : expectEnum(run.conclusion, workflowConclusions, eventName, "workflow_run.conclusion");
  if (action === "completed" && conclusion === null) {
    return fail(
      eventName,
      "workflow_run.conclusion",
      "must be present for a completed workflow run",
    );
  }

  return {
    type: eventName,
    action,
    installationId: parseInstallationReference(root.installation, eventName, "installation"),
    repository: parseRepository(root.repository, eventName, "repository"),
    runId: String(expectPositiveInteger(run.id, eventName, "workflow_run.id")),
    workflowId: String(
      expectPositiveInteger(run.workflow_id, eventName, "workflow_run.workflow_id"),
    ),
    workflowName: expectNullableString(run.name, eventName, "workflow_run.name"),
    workflowPath: expectString(run.path, eventName, "workflow_run.path"),
    headSha: expectSha(run.head_sha, eventName, "workflow_run.head_sha"),
    headBranch: expectNullableString(run.head_branch, eventName, "workflow_run.head_branch"),
    conclusion,
    runAttempt: expectPositiveInteger(run.run_attempt, eventName, "workflow_run.run_attempt"),
    runNumber: expectNonNegativeInteger(run.run_number, eventName, "workflow_run.run_number"),
    createdAt: expectTimestamp(run.created_at, eventName, "workflow_run.created_at"),
    updatedAt: expectTimestamp(run.updated_at, eventName, "workflow_run.updated_at"),
    runStartedAt: expectTimestamp(run.run_started_at, eventName, "workflow_run.run_started_at"),
  };
}

export function parseWebhookEvent(eventName: string, payload: unknown): NormalizedWebhookEvent {
  switch (eventName) {
    case "installation":
      return parseInstallationWebhook(payload);
    case "installation_repositories":
      return parseInstallationRepositoriesWebhook(payload);
    case "push":
      return parsePushWebhook(payload);
    case "workflow_run":
      return parseWorkflowRunWebhook(payload);
    default:
      return fail(eventName, "$", "unsupported webhook event");
  }
}

export function parseWebhookJson(
  eventName: string,
  rawBody: RawWebhookBody,
): NormalizedWebhookEvent {
  let text: string;
  if (typeof rawBody === "string") {
    text = rawBody;
  } else {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
    } catch (error: unknown) {
      if (error instanceof TypeError) {
        return fail(eventName, "$", "body is not valid UTF-8");
      }
      throw error;
    }
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      return fail(eventName, "$", "body is not valid JSON");
    }
    throw error;
  }
  return parseWebhookEvent(eventName, payload);
}

export function isDefaultBranchPush(event: PushWebhookEvent): boolean {
  return event.branch === event.repository.defaultBranch;
}

export function pushTouchesRelevantPaths(event: PushWebhookEvent): boolean {
  return event.relevantPaths.length > 0;
}

export function isSetupWorkflowRun(event: WorkflowRunWebhookEvent): boolean {
  return isSetupWorkflowPath(event.workflowPath);
}
