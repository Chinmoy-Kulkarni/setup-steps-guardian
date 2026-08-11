import { createWebCryptoAppJwt, type GitHubAppJwtCreator } from "./app-auth.js";
import {
  GitHubApiError,
  GitHubAuthorizationError,
  GitHubNotFoundError,
  type GitHubResource,
  MalformedGitHubResponseError,
} from "./errors.js";
import {
  classifyGitHubRetry,
  extractGitHubRateLimitMetadata,
  type GitHubHttpMethod,
  type GitHubRateLimitMetadata,
} from "./rate-limit.js";
import { normalizeIsoTimestamp } from "./timestamps.js";
import {
  type GitHubRequestTransport,
  type GitHubRoute,
  type GitHubTransportResponse,
  OctokitRequestTransport,
} from "./transport.js";
import type {
  GitHubAccount,
  GitHubRepository,
  GitHubRepositorySelection,
  GitHubWorkflowConclusion,
  GitHubWorkflowRun,
  GitHubWorkflowRunDiagnostics,
} from "./types.js";

const installationAuthorizationBrand = Symbol("GitHubInstallationAuthorization");
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
const workflowJobConclusions = [
  "action_required",
  "cancelled",
  "failure",
  "neutral",
  "skipped",
  "success",
  "timed_out",
] as const;

type JsonObject = Record<string, unknown>;

export interface GitHubApiResult<Value> {
  readonly value: Value;
  readonly rateLimit: GitHubRateLimitMetadata;
}

export interface GitHubInstallationAuthorization {
  readonly installationId: string;
  readonly expiresAt: string;
  readonly permissions: Readonly<Record<string, "read">>;
  readonly [installationAuthorizationBrand]: true;
}

export interface GitHubFileContent {
  readonly path: string;
  readonly sha: string;
  readonly size: number;
  readonly content: string;
}

export interface GitHubWorkflowRunPage {
  readonly totalCount: number;
  readonly page: number;
  readonly perPage: number;
  readonly runs: readonly GitHubWorkflowRun[];
}

export interface GitHubAuthenticatedUser {
  readonly id: string;
  readonly login: string;
  readonly name: string | null;
  readonly avatarUrl: string;
}

export interface GitHubUserInstallation {
  readonly id: string;
  readonly account: GitHubAccount;
  readonly repositorySelection: GitHubRepositorySelection;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly suspendedAt: string | null;
}

export interface GitHubFileRequest {
  readonly owner: string;
  readonly repository: string;
  readonly path: string;
  readonly ref?: string;
}

export interface GitHubWorkflowRunsRequest {
  readonly owner: string;
  readonly repository: string;
  readonly workflowFilename: string;
  readonly defaultBranch: string;
  readonly page?: number;
  readonly perPage?: number;
}

export interface GitHubWorkflowRunRequest {
  readonly owner: string;
  readonly repository: string;
  readonly runId: string | number;
}

export interface GitHubClient {
  createInstallationToken(
    installationId: string | number,
  ): Promise<GitHubApiResult<GitHubInstallationAuthorization>>;
  getInstallationRepositories(
    authorization: GitHubInstallationAuthorization,
  ): Promise<GitHubApiResult<readonly GitHubRepository[]>>;
  getRepository(
    authorization: GitHubInstallationAuthorization,
    repositoryId: string | number,
  ): Promise<GitHubApiResult<GitHubRepository>>;
  getFileContent(
    authorization: GitHubInstallationAuthorization,
    request: GitHubFileRequest,
  ): Promise<GitHubApiResult<GitHubFileContent>>;
  listWorkflowRuns(
    authorization: GitHubInstallationAuthorization,
    request: GitHubWorkflowRunsRequest,
  ): Promise<GitHubApiResult<GitHubWorkflowRunPage>>;
  getWorkflowRun(
    authorization: GitHubInstallationAuthorization,
    request: GitHubWorkflowRunRequest,
  ): Promise<GitHubApiResult<GitHubWorkflowRun>>;
  getWorkflowRunDiagnostics(
    authorization: GitHubInstallationAuthorization,
    request: GitHubWorkflowRunRequest,
  ): Promise<GitHubApiResult<GitHubWorkflowRunDiagnostics>>;
  getAuthenticatedUser(userAccessToken: string): Promise<GitHubApiResult<GitHubAuthenticatedUser>>;
  getAuthenticatedUserInstallations(
    userAccessToken: string,
  ): Promise<GitHubApiResult<readonly GitHubUserInstallation[]>>;
  getAuthenticatedUserInstallationRepositories(
    userAccessToken: string,
    installationId: string | number,
  ): Promise<GitHubApiResult<readonly GitHubRepository[]>>;
}

interface CommonClientOptions {
  readonly appId: string | number;
  readonly transport?: GitHubRequestTransport;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

export type GitHubClientOptions = CommonClientOptions &
  (
    | {
        readonly privateKeyPkcs8: string;
        readonly createJwt?: never;
        readonly crypto?: Pick<Crypto, "subtle">;
      }
    | {
        readonly privateKeyPkcs8?: never;
        readonly createJwt: GitHubAppJwtCreator;
        readonly crypto?: never;
      }
  );

interface ParsedInstallationToken {
  readonly token: string;
  readonly expiresAt: string;
  readonly permissions: Readonly<Record<string, "read">>;
}

interface ParsedRepositoryPage {
  readonly totalCount: number;
  readonly repositories: readonly GitHubRepository[];
}

interface ParsedInstallationPage {
  readonly totalCount: number;
  readonly installations: readonly GitHubUserInstallation[];
}

interface ParsedWorkflowJobDiagnostics {
  readonly runnerLabel: string | null;
  readonly failed: boolean;
  readonly failedStep: string | null;
}

interface ParsedWorkflowJobPage {
  readonly totalCount: number;
  readonly jobs: readonly ParsedWorkflowJobDiagnostics[];
}

function malformed(path: string, detail: string): never {
  throw new MalformedGitHubResponseError(path, detail);
}

function expectObject(value: unknown, path: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return malformed(path, "expected an object");
  }
  return value as JsonObject;
}

function expectArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    return malformed(path, "expected an array");
  }
  return value;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    return malformed(path, "expected a non-empty string");
  }
  return value;
}

function expectText(value: unknown, path: string): string {
  if (typeof value !== "string") {
    return malformed(path, "expected a string");
  }
  return value;
}

function expectHttpsUrl(value: unknown, path: string): string {
  const candidate = expectString(value, path);
  let url: URL;
  try {
    url = new URL(candidate);
  } catch (error: unknown) {
    if (error instanceof TypeError) {
      return malformed(path, "expected an absolute HTTPS URL");
    }
    throw error;
  }
  if (url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0) {
    return malformed(path, "expected an absolute HTTPS URL");
  }
  return candidate;
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    return malformed(path, "expected a boolean");
  }
  return value;
}

function expectNullableString(value: unknown, path: string): string | null {
  if (value === null) {
    return null;
  }
  return expectString(value, path);
}

function expectPositiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return malformed(path, "expected a positive safe integer");
  }
  return value;
}

function expectNonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return malformed(path, "expected a non-negative safe integer");
  }
  return value;
}

function expectTimestamp(value: unknown, path: string): string {
  const timestamp = expectString(value, path);
  const normalized = normalizeIsoTimestamp(timestamp);
  if (normalized === null) {
    return malformed(path, "expected an ISO 8601 timestamp");
  }
  return normalized;
}

function expectNullableTimestamp(value: unknown, path: string): string | null {
  if (value === null) {
    return null;
  }
  return expectTimestamp(value, path);
}

function expectSha(value: unknown, path: string): string {
  const sha = expectString(value, path);
  if (!/^[a-f0-9]{40}$/i.test(sha)) {
    return malformed(path, "expected a 40-character Git commit SHA");
  }
  return sha.toLowerCase();
}

function expectEnum<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  path: string,
): Values[number] {
  const candidate = expectString(value, path);
  if (!values.includes(candidate)) {
    return malformed(path, "expected one of the supported values");
  }
  return candidate as Values[number];
}

function parseAccount(value: unknown, path: string): GitHubAccount {
  const account = expectObject(value, path);
  const id = String(expectPositiveInteger(account.id, `${path}.id`));
  const name =
    typeof account.login === "string" && account.login.length > 0
      ? account.login
      : typeof account.slug === "string" && account.slug.length > 0
        ? account.slug
        : malformed(path, "expected account.login or account.slug");
  return {
    id,
    name,
    type: expectEnum(account.type, ["Organization", "User"] as const, `${path}.type`),
  };
}

function parseRepository(value: unknown, path: string): GitHubRepository {
  const repository = expectObject(value, path);
  const owner = expectObject(repository.owner, `${path}.owner`);
  return {
    id: String(expectPositiveInteger(repository.id, `${path}.id`)),
    owner: expectString(owner.login, `${path}.owner.login`),
    name: expectString(repository.name, `${path}.name`),
    defaultBranch: expectString(repository.default_branch, `${path}.default_branch`),
    isPrivate: expectBoolean(repository.private, `${path}.private`),
    isArchived: expectBoolean(repository.archived, `${path}.archived`),
  };
}

function parseRepositoryPage(value: unknown): ParsedRepositoryPage {
  const root = expectObject(value, "$");
  const repositories = expectArray(root.repositories, "repositories").map((repository, index) =>
    parseRepository(repository, `repositories[${index}]`),
  );
  const totalCount = expectNonNegativeInteger(root.total_count, "total_count");
  if (repositories.length > totalCount) {
    return malformed("repositories", "page contains more repositories than total_count");
  }
  return { totalCount, repositories };
}

function parsePermissions(value: unknown): Readonly<Record<string, "read">> {
  const rawPermissions = expectObject(value, "permissions");
  const permissions: Record<string, "read"> = {};
  for (const [permission, level] of Object.entries(rawPermissions)) {
    if (level !== "read") {
      throw new GitHubAuthorizationError(
        "Installation token contains a permission that is not read-only.",
      );
    }
    permissions[permission] = level;
  }
  if (permissions.actions !== "read" || permissions.contents !== "read") {
    throw new GitHubAuthorizationError(
      "Installation token is missing required Actions or Contents read permission.",
    );
  }
  return Object.freeze(permissions);
}

function parseInstallationToken(value: unknown): ParsedInstallationToken {
  const root = expectObject(value, "$");
  return {
    token: expectString(root.token, "token"),
    expiresAt: expectTimestamp(root.expires_at, "expires_at"),
    permissions: parsePermissions(root.permissions),
  };
}

function parseBase64(value: string, path: string): Uint8Array {
  const normalized = value.replace(/\s/g, "");
  if (normalized.length === 0) {
    return new Uint8Array();
  }
  if (
    normalized.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)
  ) {
    return malformed(path, "expected valid base64 content");
  }

  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function parseFileContent(value: unknown): GitHubFileContent {
  const root = expectObject(value, "$");
  if (root.type !== "file") {
    return malformed("type", 'expected "file"');
  }
  if (root.encoding !== "base64") {
    return malformed("encoding", 'expected "base64"');
  }

  const contentBytes = parseBase64(expectText(root.content, "content"), "content");
  const size = expectNonNegativeInteger(root.size, "size");
  if (contentBytes.byteLength !== size) {
    return malformed("content", "decoded byte length does not match size");
  }
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(contentBytes);
  } catch (error: unknown) {
    if (error instanceof TypeError) {
      return malformed("content", "expected valid UTF-8 text");
    }
    throw error;
  }

  return {
    path: expectString(root.path, "path"),
    sha: expectSha(root.sha, "sha"),
    size,
    content,
  };
}

function parseWorkflowRun(value: unknown, path = "$"): GitHubWorkflowRun {
  const run = expectObject(value, path);
  const conclusion =
    run.conclusion === null
      ? null
      : expectEnum(run.conclusion, workflowConclusions, `${path}.conclusion`);
  return {
    id: String(expectPositiveInteger(run.id, `${path}.id`)),
    workflowId: String(expectPositiveInteger(run.workflow_id, `${path}.workflow_id`)),
    name: expectNullableString(run.name, `${path}.name`),
    path: expectString(run.path, `${path}.path`),
    headSha: expectSha(run.head_sha, `${path}.head_sha`),
    headBranch: expectNullableString(run.head_branch, `${path}.head_branch`),
    conclusion,
    runAttempt: expectPositiveInteger(run.run_attempt, `${path}.run_attempt`),
    runNumber: expectNonNegativeInteger(run.run_number, `${path}.run_number`),
    createdAt: expectTimestamp(run.created_at, `${path}.created_at`),
    updatedAt: expectTimestamp(run.updated_at, `${path}.updated_at`),
    runStartedAt: expectTimestamp(run.run_started_at, `${path}.run_started_at`),
  };
}

function parseWorkflowRunPage(
  value: unknown,
  page: number,
  perPage: number,
): GitHubWorkflowRunPage {
  const root = expectObject(value, "$");
  return {
    totalCount: expectNonNegativeInteger(root.total_count, "total_count"),
    page,
    perPage,
    runs: expectArray(root.workflow_runs, "workflow_runs").map((run, index) =>
      parseWorkflowRun(run, `workflow_runs[${index}]`),
    ),
  };
}

function parseWorkflowJobPage(value: unknown): ParsedWorkflowJobPage {
  const root = expectObject(value, "$");
  const jobs = expectArray(root.jobs, "jobs").map((jobValue, jobIndex) => {
    const jobPath = `jobs[${jobIndex}]`;
    const job = expectObject(jobValue, jobPath);
    const labels = expectArray(job.labels, `${jobPath}.labels`).map((label, labelIndex) =>
      expectString(label, `${jobPath}.labels[${labelIndex}]`),
    );
    const conclusion =
      job.conclusion === null
        ? null
        : expectEnum(job.conclusion, workflowJobConclusions, `${jobPath}.conclusion`);
    const steps = job.steps === undefined ? [] : expectArray(job.steps, `${jobPath}.steps`);
    let failedStep: string | null = null;
    for (const [stepIndex, stepValue] of steps.entries()) {
      const stepPath = `${jobPath}.steps[${stepIndex}]`;
      const step = expectObject(stepValue, stepPath);
      const stepConclusion =
        step.conclusion === null
          ? null
          : expectEnum(step.conclusion, workflowJobConclusions, `${stepPath}.conclusion`);
      const stepName = expectString(step.name, `${stepPath}.name`);
      expectPositiveInteger(step.number, `${stepPath}.number`);
      if (failedStep === null && stepConclusion === "failure") {
        failedStep = stepName;
      }
    }
    return {
      runnerLabel: labels.length === 0 ? null : labels.join(", "),
      failed:
        conclusion === "failure" || conclusion === "timed_out" || conclusion === "action_required",
      failedStep,
    };
  });
  const totalCount = expectNonNegativeInteger(root.total_count, "total_count");
  if (jobs.length > totalCount) {
    return malformed("jobs", "page contains more jobs than total_count");
  }
  return { totalCount, jobs };
}

function parseAuthenticatedUser(value: unknown): GitHubAuthenticatedUser {
  const root = expectObject(value, "$");
  return {
    id: String(expectPositiveInteger(root.id, "id")),
    login: expectString(root.login, "login"),
    name: expectNullableString(root.name, "name"),
    avatarUrl: expectHttpsUrl(root.avatar_url, "avatar_url"),
  };
}

function parseUserInstallation(value: unknown, path: string): GitHubUserInstallation {
  const installation = expectObject(value, path);
  return {
    id: String(expectPositiveInteger(installation.id, `${path}.id`)),
    account: parseAccount(installation.account, `${path}.account`),
    repositorySelection: expectEnum(
      installation.repository_selection,
      ["all", "selected"] as const,
      `${path}.repository_selection`,
    ),
    createdAt: expectTimestamp(installation.created_at, `${path}.created_at`),
    updatedAt: expectTimestamp(installation.updated_at, `${path}.updated_at`),
    suspendedAt: expectNullableTimestamp(installation.suspended_at, `${path}.suspended_at`),
  };
}

function parseInstallationPage(value: unknown): ParsedInstallationPage {
  const root = expectObject(value, "$");
  const installations = expectArray(root.installations, "installations").map(
    (installation, index) => parseUserInstallation(installation, `installations[${index}]`),
  );
  const totalCount = expectNonNegativeInteger(root.total_count, "total_count");
  if (installations.length > totalCount) {
    return malformed("installations", "page contains more installations than total_count");
  }
  return { totalCount, installations };
}

function normalizeIdInput(value: string | number, name: string): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive safe integer.`);
    }
    return String(value);
  }
  if (!/^[1-9]\d*$/.test(value)) {
    throw new TypeError(`${name} must contain a positive decimal integer.`);
  }
  return value;
}

function validateHeaderToken(token: string, name: string): string {
  if (token.length === 0 || /\s/.test(token)) {
    throw new GitHubAuthorizationError(`${name} is empty or contains invalid characters.`);
  }
  return token;
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) {
      return true;
    }
  }
  return false;
}

function validatePathSegment(value: string, name: string): string {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    hasControlCharacters(value)
  ) {
    throw new TypeError(`${name} must be a non-empty GitHub path segment.`);
  }
  return value;
}

function validateRepositoryPath(value: string): string {
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    hasControlCharacters(value) ||
    value.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new TypeError("Repository path must be a safe relative path.");
  }
  return value;
}

function validateRef(value: string, name: string): string {
  if (value.length === 0 || hasControlCharacters(value)) {
    throw new TypeError(`${name} must not be empty or contain control characters.`);
  }
  return value;
}

function normalizePagination(
  pageValue: number | undefined,
  perPageValue: number | undefined,
): { readonly page: number; readonly perPage: number } {
  const page = pageValue ?? 1;
  const perPage = perPageValue ?? 100;
  if (!Number.isSafeInteger(page) || page <= 0) {
    throw new TypeError("page must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(perPage) || perPage <= 0 || perPage > 100) {
    throw new TypeError("perPage must be an integer between 1 and 100.");
  }
  return { page, perPage };
}

export class OctokitGitHubClient implements GitHubClient {
  readonly #appId: string | number;
  readonly #createJwt: GitHubAppJwtCreator;
  readonly #transport: GitHubRequestTransport;
  readonly #now: () => number;
  readonly #installationTokens = new WeakMap<GitHubInstallationAuthorization, string>();

  constructor(options: GitHubClientOptions) {
    if (
      (typeof options.appId === "number" &&
        (!Number.isSafeInteger(options.appId) || options.appId <= 0)) ||
      (typeof options.appId === "string" &&
        (options.appId.length === 0 || /\s/.test(options.appId)))
    ) {
      throw new TypeError("appId must be a positive integer or non-empty client ID.");
    }
    const hasPrivateKeyProperty =
      "privateKeyPkcs8" in options && options.privateKeyPkcs8 !== undefined;
    const hasCreateJwtProperty = "createJwt" in options && options.createJwt !== undefined;
    if (hasPrivateKeyProperty && typeof options.privateKeyPkcs8 !== "string") {
      throw new TypeError("privateKeyPkcs8 must be a string.");
    }
    if (hasCreateJwtProperty && typeof options.createJwt !== "function") {
      throw new TypeError("createJwt must be a function.");
    }
    const hasPrivateKey = hasPrivateKeyProperty;
    const hasCreateJwt = hasCreateJwtProperty;
    if (hasPrivateKey === hasCreateJwt) {
      throw new TypeError("Provide exactly one of privateKeyPkcs8 or createJwt.");
    }
    if (hasCreateJwt && "crypto" in options && options.crypto !== undefined) {
      throw new TypeError("crypto cannot be combined with a custom createJwt function.");
    }
    this.#appId = options.appId;
    this.#now = options.now ?? Date.now;
    if (hasCreateJwt) {
      this.#createJwt = options.createJwt;
    } else {
      this.#createJwt = createWebCryptoAppJwt(options.privateKeyPkcs8, {
        ...(options.crypto === undefined ? {} : { crypto: options.crypto }),
        now: this.#now,
      });
    }

    if (
      options.transport !== undefined &&
      (options.baseUrl !== undefined || options.fetch !== undefined)
    ) {
      throw new TypeError(
        "baseUrl and fetch cannot be combined with a custom GitHub request transport.",
      );
    }
    this.#transport =
      options.transport ??
      new OctokitRequestTransport({
        ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      });
  }

  async #send(
    method: GitHubHttpMethod,
    route: GitHubRoute,
    parameters: Readonly<Record<string, unknown>>,
    authorization: string,
    resource: GitHubResource,
  ): Promise<GitHubTransportResponse & { readonly rateLimit: GitHubRateLimitMetadata }> {
    const response = await this.#transport.request({
      route,
      parameters,
      authorization,
    });
    if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
      throw new TypeError("GitHub request transport returned an invalid HTTP status.");
    }
    const rateLimit = extractGitHubRateLimitMetadata(response.headers, this.#currentTime());

    if (response.status === 404) {
      throw new GitHubNotFoundError(resource, rateLimit);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new GitHubApiError(
        response.status,
        rateLimit,
        classifyGitHubRetry(method, response.status, rateLimit),
      );
    }
    return { ...response, rateLimit };
  }

  #currentTime(): number {
    const currentTime = this.#now();
    if (!Number.isFinite(currentTime)) {
      throw new TypeError("The current time must be a finite millisecond timestamp.");
    }
    return currentTime;
  }

  #readInstallationToken(authorization: GitHubInstallationAuthorization): string {
    const token = this.#installationTokens.get(authorization);
    if (token === undefined) {
      throw new GitHubAuthorizationError(
        "Installation authorization was not created by this GitHub client.",
      );
    }
    if (Date.parse(authorization.expiresAt) <= this.#currentTime()) {
      this.#installationTokens.delete(authorization);
      throw new GitHubAuthorizationError("Installation authorization has expired.");
    }
    return token;
  }

  async createInstallationToken(
    installationIdValue: string | number,
  ): Promise<GitHubApiResult<GitHubInstallationAuthorization>> {
    const installationId = normalizeIdInput(installationIdValue, "installationId");
    const appAuthentication = await this.#createJwt(this.#appId);
    validateHeaderToken(appAuthentication.jwt, "GitHub App JWT");
    const appJwtExpiresAt = expectTimestamp(appAuthentication.expiresAt, "app JWT expiresAt");
    if (Date.parse(appJwtExpiresAt) <= this.#currentTime()) {
      throw new GitHubAuthorizationError("GitHub App JWT has already expired.");
    }

    const response = await this.#send(
      "POST",
      "POST /app/installations/{installation_id}/access_tokens",
      {
        installation_id: installationId,
        permissions: {
          actions: "read",
          contents: "read",
        },
      },
      `Bearer ${appAuthentication.jwt}`,
      "installation",
    );
    const parsed = parseInstallationToken(response.data);
    if (Date.parse(parsed.expiresAt) <= this.#currentTime()) {
      throw new GitHubAuthorizationError("GitHub returned an already-expired installation token.");
    }

    const authorization: GitHubInstallationAuthorization = Object.freeze({
      installationId,
      expiresAt: parsed.expiresAt,
      permissions: parsed.permissions,
      [installationAuthorizationBrand]: true as const,
    });
    this.#installationTokens.set(authorization, parsed.token);
    return { value: authorization, rateLimit: response.rateLimit };
  }

  async getInstallationRepositories(
    authorization: GitHubInstallationAuthorization,
  ): Promise<GitHubApiResult<readonly GitHubRepository[]>> {
    const token = this.#readInstallationToken(authorization);
    const repositories: GitHubRepository[] = [];
    const repositoryIds = new Set<string>();
    let page = 1;
    let expectedTotal: number | null = null;
    let finalRateLimit: GitHubRateLimitMetadata | null = null;

    while (expectedTotal === null || repositories.length < expectedTotal) {
      const response = await this.#send(
        "GET",
        "GET /installation/repositories",
        { page, per_page: 100 },
        `Bearer ${token}`,
        "installation repositories",
      );
      finalRateLimit = response.rateLimit;
      const parsed = parseRepositoryPage(response.data);
      if (expectedTotal !== null && parsed.totalCount !== expectedTotal) {
        return malformed(
          "total_count",
          "changed while installation repositories were being paginated",
        );
      }
      expectedTotal ??= parsed.totalCount;
      if (parsed.repositories.length === 0 && repositories.length < expectedTotal) {
        return malformed("repositories", "pagination ended before total_count was reached");
      }
      for (const repository of parsed.repositories) {
        if (repositoryIds.has(repository.id)) {
          return malformed("repositories", "contained a duplicate repository ID");
        }
        repositoryIds.add(repository.id);
        repositories.push(repository);
      }
      if (repositories.length > expectedTotal) {
        return malformed("repositories", "pagination exceeded total_count");
      }
      page += 1;
    }

    if (finalRateLimit === null) {
      throw new Error("Installation repository pagination did not make a request.");
    }
    return { value: repositories, rateLimit: finalRateLimit };
  }

  async getRepository(
    authorization: GitHubInstallationAuthorization,
    repositoryId: string | number,
  ): Promise<GitHubApiResult<GitHubRepository>> {
    const response = await this.#send(
      "GET",
      "GET /repositories/{repository_id}",
      {
        repository_id: normalizeIdInput(repositoryId, "repositoryId"),
      },
      `Bearer ${this.#readInstallationToken(authorization)}`,
      "repository",
    );
    return {
      value: parseRepository(response.data, "$"),
      rateLimit: response.rateLimit,
    };
  }

  async getFileContent(
    authorization: GitHubInstallationAuthorization,
    request: GitHubFileRequest,
  ): Promise<GitHubApiResult<GitHubFileContent>> {
    const response = await this.#send(
      "GET",
      "GET /repos/{owner}/{repo}/contents/{path}",
      {
        owner: validatePathSegment(request.owner, "owner"),
        repo: validatePathSegment(request.repository, "repository"),
        path: validateRepositoryPath(request.path),
        ...(request.ref === undefined ? {} : { ref: validateRef(request.ref, "ref") }),
      },
      `Bearer ${this.#readInstallationToken(authorization)}`,
      "file",
    );
    return {
      value: parseFileContent(response.data),
      rateLimit: response.rateLimit,
    };
  }

  async listWorkflowRuns(
    authorization: GitHubInstallationAuthorization,
    request: GitHubWorkflowRunsRequest,
  ): Promise<GitHubApiResult<GitHubWorkflowRunPage>> {
    const pagination = normalizePagination(request.page, request.perPage);
    const response = await this.#send(
      "GET",
      "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs",
      {
        owner: validatePathSegment(request.owner, "owner"),
        repo: validatePathSegment(request.repository, "repository"),
        workflow_id: validatePathSegment(request.workflowFilename, "workflowFilename"),
        branch: validateRef(request.defaultBranch, "defaultBranch"),
        page: pagination.page,
        per_page: pagination.perPage,
      },
      `Bearer ${this.#readInstallationToken(authorization)}`,
      "workflow",
    );
    return {
      value: parseWorkflowRunPage(response.data, pagination.page, pagination.perPage),
      rateLimit: response.rateLimit,
    };
  }

  async getWorkflowRun(
    authorization: GitHubInstallationAuthorization,
    request: GitHubWorkflowRunRequest,
  ): Promise<GitHubApiResult<GitHubWorkflowRun>> {
    const response = await this.#send(
      "GET",
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}",
      {
        owner: validatePathSegment(request.owner, "owner"),
        repo: validatePathSegment(request.repository, "repository"),
        run_id: normalizeIdInput(request.runId, "runId"),
      },
      `Bearer ${this.#readInstallationToken(authorization)}`,
      "workflow run",
    );
    return {
      value: parseWorkflowRun(response.data),
      rateLimit: response.rateLimit,
    };
  }

  async getWorkflowRunDiagnostics(
    authorization: GitHubInstallationAuthorization,
    request: GitHubWorkflowRunRequest,
  ): Promise<GitHubApiResult<GitHubWorkflowRunDiagnostics>> {
    const token = this.#readInstallationToken(authorization);
    const owner = validatePathSegment(request.owner, "owner");
    const repository = validatePathSegment(request.repository, "repository");
    const runId = normalizeIdInput(request.runId, "runId");
    let page = 1;
    let expectedTotal: number | null = null;
    let processedJobs = 0;
    let firstRunnerLabel: string | null = null;
    let failedJobRunnerLabel: string | null = null;
    let finalRateLimit: GitHubRateLimitMetadata | null = null;

    while (expectedTotal === null || processedJobs < expectedTotal) {
      const response = await this.#send(
        "GET",
        "GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs",
        {
          owner,
          repo: repository,
          run_id: runId,
          filter: "latest",
          page,
          per_page: 100,
        },
        `Bearer ${token}`,
        "workflow run diagnostics",
      );
      finalRateLimit = response.rateLimit;
      const parsed = parseWorkflowJobPage(response.data);
      if (expectedTotal !== null && parsed.totalCount !== expectedTotal) {
        return malformed("total_count", "changed while workflow jobs were being paginated");
      }
      expectedTotal ??= parsed.totalCount;
      if (parsed.jobs.length === 0 && processedJobs < expectedTotal) {
        return malformed("jobs", "pagination ended before total_count was reached");
      }
      if (processedJobs + parsed.jobs.length > expectedTotal) {
        return malformed("jobs", "pagination exceeded total_count");
      }

      for (const job of parsed.jobs) {
        firstRunnerLabel ??= job.runnerLabel;
        if (job.failed && failedJobRunnerLabel === null) {
          failedJobRunnerLabel = job.runnerLabel;
        }
        processedJobs += 1;
        if (job.failedStep !== null) {
          return {
            value: {
              runnerLabel: job.runnerLabel ?? failedJobRunnerLabel ?? firstRunnerLabel,
              failedStep: job.failedStep,
            },
            rateLimit: response.rateLimit,
          };
        }
      }
      page += 1;
    }

    if (finalRateLimit === null) {
      throw new Error("Workflow job pagination did not make a request.");
    }
    return {
      value: {
        runnerLabel: failedJobRunnerLabel ?? firstRunnerLabel,
        failedStep: null,
      },
      rateLimit: finalRateLimit,
    };
  }

  async getAuthenticatedUser(
    userAccessToken: string,
  ): Promise<GitHubApiResult<GitHubAuthenticatedUser>> {
    const response = await this.#send(
      "GET",
      "GET /user",
      {},
      `Bearer ${validateHeaderToken(userAccessToken, "GitHub user access token")}`,
      "user",
    );
    return {
      value: parseAuthenticatedUser(response.data),
      rateLimit: response.rateLimit,
    };
  }

  async getAuthenticatedUserInstallations(
    userAccessToken: string,
  ): Promise<GitHubApiResult<readonly GitHubUserInstallation[]>> {
    const token = validateHeaderToken(userAccessToken, "GitHub user access token");
    const installations: GitHubUserInstallation[] = [];
    const installationIds = new Set<string>();
    let page = 1;
    let expectedTotal: number | null = null;
    let finalRateLimit: GitHubRateLimitMetadata | null = null;

    while (expectedTotal === null || installations.length < expectedTotal) {
      const response = await this.#send(
        "GET",
        "GET /user/installations",
        { page, per_page: 100 },
        `Bearer ${token}`,
        "user installations",
      );
      finalRateLimit = response.rateLimit;
      const parsed = parseInstallationPage(response.data);
      if (expectedTotal !== null && parsed.totalCount !== expectedTotal) {
        return malformed("total_count", "changed while user installations were being paginated");
      }
      expectedTotal ??= parsed.totalCount;
      if (parsed.installations.length === 0 && installations.length < expectedTotal) {
        return malformed("installations", "pagination ended before total_count was reached");
      }
      for (const installation of parsed.installations) {
        if (installationIds.has(installation.id)) {
          return malformed("installations", "contained a duplicate installation ID");
        }
        installationIds.add(installation.id);
        installations.push(installation);
      }
      if (installations.length > expectedTotal) {
        return malformed("installations", "pagination exceeded total_count");
      }
      page += 1;
    }

    if (finalRateLimit === null) {
      throw new Error("User installation pagination did not make a request.");
    }
    return { value: installations, rateLimit: finalRateLimit };
  }

  async getAuthenticatedUserInstallationRepositories(
    userAccessToken: string,
    installationIdValue: string | number,
  ): Promise<GitHubApiResult<readonly GitHubRepository[]>> {
    const token = validateHeaderToken(userAccessToken, "GitHub user access token");
    const installationId = normalizeIdInput(installationIdValue, "installationId");
    const repositories: GitHubRepository[] = [];
    const repositoryIds = new Set<string>();
    let page = 1;
    let expectedTotal: number | null = null;
    let finalRateLimit: GitHubRateLimitMetadata | null = null;

    while (expectedTotal === null || repositories.length < expectedTotal) {
      const response = await this.#send(
        "GET",
        "GET /user/installations/{installation_id}/repositories",
        {
          installation_id: installationId,
          page,
          per_page: 100,
        },
        ["Bearer", token].join(" "),
        "user installation repositories",
      );
      finalRateLimit = response.rateLimit;
      const parsed = parseRepositoryPage(response.data);
      if (expectedTotal !== null && parsed.totalCount !== expectedTotal) {
        return malformed(
          "total_count",
          "changed while user installation repositories were being paginated",
        );
      }
      expectedTotal ??= parsed.totalCount;
      if (parsed.repositories.length === 0 && repositories.length < expectedTotal) {
        return malformed("repositories", "pagination ended before total_count was reached");
      }
      for (const repository of parsed.repositories) {
        if (repositoryIds.has(repository.id)) {
          return malformed("repositories", "contained a duplicate repository ID");
        }
        repositoryIds.add(repository.id);
        repositories.push(repository);
      }
      if (repositories.length > expectedTotal) {
        return malformed("repositories", "pagination exceeded total_count");
      }
      page += 1;
    }

    if (finalRateLimit === null) {
      throw new Error("User installation repository pagination did not make a request.");
    }
    return { value: repositories, rateLimit: finalRateLimit };
  }
}
