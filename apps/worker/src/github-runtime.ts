import type { WorkflowConclusion } from "@setup-fleet/contracts";
import {
  GitHubApiError,
  GitHubAuthorizationError,
  type GitHubClient,
  type GitHubInstallationAuthorization,
  GitHubNotFoundError,
  type GitHubWorkflowConclusion,
  type GitHubWorkflowRun,
  MalformedGitHubResponseError,
  OctokitGitHubClient,
} from "@setup-fleet/github";
import type { WorkerConfig } from "./config.js";
import type { GitHubRepositoryHydrator } from "./github-webhook-service.js";
import type { RepositoryReaderFactory, ScanFailureClassifier } from "./scan-processor.js";
import type { RepositoryReader } from "./scan-repository.js";

const GITHUB_REQUEST_TIMEOUT_MS = 10_000;

function timeoutFetch(timeoutMs: number): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const upstreamSignal = init?.signal;
    const abortFromUpstream = (): void => controller.abort(upstreamSignal?.reason);
    if (upstreamSignal?.aborted) {
      abortFromUpstream();
    } else {
      upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
    }
    const timer = setTimeout(() => controller.abort("GitHub request timed out."), timeoutMs);

    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
      upstreamSignal?.removeEventListener("abort", abortFromUpstream);
    }
  };
}

export function createGitHubClient(config: WorkerConfig): OctokitGitHubClient {
  return new OctokitGitHubClient({
    appId: config.github.appId,
    privateKeyPkcs8: config.github.privateKeyPkcs8,
    fetch: timeoutFetch(GITHUB_REQUEST_TIMEOUT_MS),
  });
}

class InstallationAuthorizationProvider {
  readonly #authorizations = new Map<string, Promise<GitHubInstallationAuthorization>>();

  constructor(private readonly client: GitHubClient) {}

  get(installationId: string): Promise<GitHubInstallationAuthorization> {
    const cached = this.#authorizations.get(installationId);
    if (cached !== undefined) {
      return cached;
    }

    const authorization = this.client
      .createInstallationToken(installationId)
      .then((result) => result.value)
      .catch((error: unknown) => {
        this.#authorizations.delete(installationId);
        throw error;
      });
    this.#authorizations.set(installationId, authorization);
    return authorization;
  }
}

export function mapGitHubWorkflowConclusion(
  conclusion: GitHubWorkflowConclusion | null,
): WorkflowConclusion | null {
  return conclusion === "stale" ? "cancelled" : conclusion;
}

class GitHubRepositoryReader implements RepositoryReader {
  constructor(
    private readonly client: GitHubClient,
    private readonly authorization: GitHubInstallationAuthorization,
  ) {}

  async getFileContent(input: {
    readonly owner: string;
    readonly repository: string;
    readonly path: string;
    readonly ref?: string;
  }): Promise<string | null> {
    try {
      return (
        await this.client.getFileContent(this.authorization, {
          owner: input.owner,
          repository: input.repository,
          path: input.path,
          ...(input.ref === undefined ? {} : { ref: input.ref }),
        })
      ).value.content;
    } catch (error) {
      if (error instanceof GitHubNotFoundError && error.resource === "file") {
        return null;
      }
      throw error;
    }
  }

  async getLatestCompletedSetupRun(input: {
    readonly owner: string;
    readonly repository: string;
    readonly defaultBranch: string;
  }) {
    let runs: readonly GitHubWorkflowRun[];
    try {
      runs = (
        await this.client.listWorkflowRuns(this.authorization, {
          owner: input.owner,
          repository: input.repository,
          workflowFilename: "copilot-setup-steps.yml",
          defaultBranch: input.defaultBranch,
          page: 1,
          perPage: 20,
        })
      ).value.runs;
    } catch (error) {
      if (error instanceof GitHubNotFoundError && error.resource === "workflow") {
        return null;
      }
      throw error;
    }

    for (const run of runs) {
      const conclusion = mapGitHubWorkflowConclusion(run.conclusion);
      if (conclusion !== null) {
        return {
          runId: run.id,
          runAttempt: run.runAttempt,
          headSha: run.headSha,
          conclusion,
          startedAt: run.runStartedAt,
          completedAt: run.updatedAt,
        };
      }
    }
    return null;
  }

  async getRunDiagnostics(input: {
    readonly owner: string;
    readonly repository: string;
    readonly runId: string;
  }) {
    try {
      const diagnostics = (await this.client.getWorkflowRunDiagnostics(this.authorization, input))
        .value;
      return {
        runnerLabel: diagnostics.runnerLabel ?? "unknown",
        ...(diagnostics.failedStep === null ? {} : { failedStep: diagnostics.failedStep }),
      };
    } catch (error) {
      if (error instanceof GitHubNotFoundError && error.resource === "workflow run diagnostics") {
        return { runnerLabel: "unknown" };
      }
      throw error;
    }
  }
}

class GitHubReaderFactory implements RepositoryReaderFactory {
  constructor(
    private readonly client: GitHubClient,
    private readonly authorizations: InstallationAuthorizationProvider,
  ) {}

  async create(installationId: string): Promise<RepositoryReader> {
    return new GitHubRepositoryReader(this.client, await this.authorizations.get(installationId));
  }
}

class GitHubHydrator implements GitHubRepositoryHydrator {
  constructor(
    private readonly client: GitHubClient,
    private readonly authorizations: InstallationAuthorizationProvider,
  ) {}

  async listInstallationRepositories(installationId: string) {
    const authorization = await this.authorizations.get(installationId);
    return (await this.client.getInstallationRepositories(authorization)).value;
  }

  async getRepository(installationId: string, repositoryId: string) {
    const authorization = await this.authorizations.get(installationId);
    return (await this.client.getRepository(authorization, repositoryId)).value;
  }
}

function retryAfterMilliseconds(error: GitHubApiError): number | undefined {
  const retryAt = error.retry.retryable ? error.retry.retryAt : null;
  if (retryAt === null) {
    return undefined;
  }
  const retryAtMilliseconds = Date.parse(retryAt);
  return Number.isFinite(retryAtMilliseconds)
    ? Math.max(0, retryAtMilliseconds - Date.now())
    : undefined;
}

export const githubScanFailureClassifier: ScanFailureClassifier = {
  classify(error: unknown) {
    if (error instanceof GitHubAuthorizationError) {
      return { code: "GITHUB_AUTHORIZATION", retryable: false };
    }
    if (error instanceof GitHubNotFoundError) {
      return { code: "GITHUB_NOT_FOUND", retryable: false };
    }
    if (error instanceof MalformedGitHubResponseError) {
      return { code: "GITHUB_MALFORMED_RESPONSE", retryable: false };
    }
    if (error instanceof GitHubApiError) {
      const retryable =
        error.retry.retryable ||
        error.status === 408 ||
        error.status === 429 ||
        error.status >= 500;
      const retryAfterMs = retryable ? retryAfterMilliseconds(error) : undefined;
      return {
        code:
          error.status === 403 || error.status === 429 ? "GITHUB_RATE_LIMITED" : "GITHUB_API_ERROR",
        retryable,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      };
    }
    if (error instanceof Error && error.name === "AbortError") {
      return { code: "GITHUB_TIMEOUT", retryable: true };
    }
    return { code: "SCAN_FAILED", retryable: false };
  },
};

export interface GitHubRuntime {
  readonly client: OctokitGitHubClient;
  readonly readerFactory: RepositoryReaderFactory;
  readonly repositoryHydrator: GitHubRepositoryHydrator;
  readonly failureClassifier: ScanFailureClassifier;
}

export function createGitHubRuntime(config: WorkerConfig): GitHubRuntime {
  const client = createGitHubClient(config);
  const authorizations = new InstallationAuthorizationProvider(client);
  return {
    client,
    readerFactory: new GitHubReaderFactory(client, authorizations),
    repositoryHydrator: new GitHubHydrator(client, authorizations),
    failureClassifier: githubScanFailureClassifier,
  };
}
