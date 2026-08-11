import { describe, expect, it } from "vitest";
import type { GitHubAppJwtCreator } from "../src/app-auth.js";
import {
  type GitHubClient,
  type GitHubInstallationAuthorization,
  OctokitGitHubClient,
} from "../src/client.js";
import { GitHubNotFoundError } from "../src/errors.js";
import type {
  GitHubRequestTransport,
  GitHubRoute,
  GitHubTransportRequest,
  GitHubTransportResponse,
} from "../src/transport.js";
import { OctokitRequestTransport } from "../src/transport.js";
import { classifyGitHubWorkflowConclusion } from "../src/types.js";
import { SETUP_WORKFLOW_PATH } from "../src/webhooks.js";

const NOW = Date.parse("2026-08-10T23:27:02.000Z");
const createJwt: GitHubAppJwtCreator = async () => ({
  jwt: "test.jwt.signature",
  expiresAt: "2026-08-10T23:36:32.000Z",
});

interface RedactedCall {
  readonly route: GitHubRoute;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly authorizationScheme: string;
}

class QueueTransport implements GitHubRequestTransport {
  readonly calls: RedactedCall[] = [];
  readonly #responses: GitHubTransportResponse[];

  constructor(responses: readonly GitHubTransportResponse[]) {
    this.#responses = [...responses];
  }

  async request(request: GitHubTransportRequest): Promise<GitHubTransportResponse> {
    const separator = request.authorization.indexOf(" ");
    const scheme =
      separator === -1 ? request.authorization : request.authorization.slice(0, separator);
    expect(scheme).toBe("Bearer");
    expect(request.authorization.slice(separator + 1)).not.toHaveLength(0);
    this.calls.push({
      route: request.route,
      parameters: request.parameters,
      authorizationScheme: scheme,
    });

    const response = this.#responses.shift();
    if (response === undefined) {
      throw new Error("Mock GitHub transport has no queued response.");
    }
    return response;
  }
}

function response(
  data: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): GitHubTransportResponse {
  return { status, headers, data };
}

function tokenResponse(): GitHubTransportResponse {
  return response(
    {
      token: "installation-token-test-only",
      expires_at: "2026-08-11T00:27:02Z",
      permissions: {
        actions: "read",
        contents: "read",
        metadata: "read",
      },
    },
    201,
    {
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "4999",
      "x-ratelimit-reset": String(Math.floor(NOW / 1_000) + 60),
    },
  );
}

function createClient(transport: GitHubRequestTransport): GitHubClient {
  return new OctokitGitHubClient({
    appId: 12_345,
    createJwt,
    transport,
    now: () => NOW,
  });
}

async function authorize(client: GitHubClient): Promise<GitHubInstallationAuthorization> {
  return (await client.createInstallationToken(101)).value;
}

const workflowRun = {
  id: 404,
  workflow_id: 505,
  name: "Copilot setup",
  path: SETUP_WORKFLOW_PATH,
  head_sha: "b".repeat(40),
  head_branch: "main",
  conclusion: "success",
  run_attempt: 1,
  run_number: 12,
  created_at: "2026-08-10T23:10:00Z",
  updated_at: "2026-08-10T23:20:00Z",
  run_started_at: "2026-08-10T23:11:00Z",
};

describe("OctokitGitHubClient", () => {
  it("rejects API base URLs that could disclose authorization headers", () => {
    expect(() => new OctokitRequestTransport({ baseUrl: "http://github.example/api/v3" })).toThrow(
      "must be HTTPS",
    );
    expect(
      () =>
        new OctokitRequestTransport({
          baseUrl: "https://user:password@github.example/api/v3",
        }),
    ).toThrow("must not contain credentials");
  });

  it("creates an opaque read-only authorization and lists repositories", async () => {
    const transport = new QueueTransport([
      tokenResponse(),
      response({
        total_count: 1,
        repositories: [
          {
            id: 303,
            owner: { login: "example-owner" },
            name: "web",
            default_branch: "main",
            private: true,
            archived: true,
          },
        ],
      }),
    ]);
    const client = createClient(transport);

    const authorizationResult = await client.createInstallationToken(101);
    expect(authorizationResult.value).toMatchObject({
      installationId: "101",
      expiresAt: "2026-08-11T00:27:02.000Z",
      permissions: {
        actions: "read",
        contents: "read",
        metadata: "read",
      },
    });
    expect(JSON.stringify(authorizationResult.value)).not.toContain("installation-token-test-only");
    expect(authorizationResult.rateLimit.remaining).toBe(4_999);

    const repositories = await client.getInstallationRepositories(authorizationResult.value);
    expect(repositories.value).toEqual([
      {
        id: "303",
        owner: "example-owner",
        name: "web",
        defaultBranch: "main",
        isPrivate: true,
        isArchived: true,
      },
    ]);
    expect(transport.calls).toEqual([
      {
        route: "POST /app/installations/{installation_id}/access_tokens",
        parameters: {
          installation_id: "101",
          permissions: { actions: "read", contents: "read" },
        },
        authorizationScheme: "Bearer",
      },
      {
        route: "GET /installation/repositories",
        parameters: { page: 1, per_page: 100 },
        authorizationScheme: "Bearer",
      },
    ]);
  });

  it("hydrates one selected repository by numeric ID", async () => {
    const transport = new QueueTransport([
      tokenResponse(),
      response({
        id: 303,
        owner: { login: "example-owner" },
        name: "web",
        default_branch: "main",
        private: true,
        archived: false,
      }),
    ]);
    const client = createClient(transport);
    const authorization = await authorize(client);

    await expect(client.getRepository(authorization, 303)).resolves.toMatchObject({
      value: {
        id: "303",
        owner: "example-owner",
        name: "web",
        defaultBranch: "main",
        isPrivate: true,
        isArchived: false,
      },
    });
    expect(transport.calls[1]).toEqual({
      route: "GET /repositories/{repository_id}",
      parameters: { repository_id: "303" },
      authorizationScheme: "Bearer",
    });
  });

  it("decodes file content and maps 404 without exposing response bodies", async () => {
    const content = "name: Setup\n";
    const successTransport = new QueueTransport([
      tokenResponse(),
      response({
        type: "file",
        path: SETUP_WORKFLOW_PATH,
        sha: "c".repeat(40),
        size: content.length,
        encoding: "base64",
        content: btoa(content),
      }),
    ]);
    const successClient = createClient(successTransport);
    const successAuthorization = await authorize(successClient);

    await expect(
      successClient.getFileContent(successAuthorization, {
        owner: "example-owner",
        repository: "web",
        path: SETUP_WORKFLOW_PATH,
        ref: "main",
      }),
    ).resolves.toMatchObject({
      value: {
        path: SETUP_WORKFLOW_PATH,
        sha: "c".repeat(40),
        content,
      },
    });

    const missingTransport = new QueueTransport([
      tokenResponse(),
      response({ message: "fixture body must not escape" }, 404),
    ]);
    const missingClient = createClient(missingTransport);
    const missingAuthorization = await authorize(missingClient);
    const missing = missingClient.getFileContent(missingAuthorization, {
      owner: "example-owner",
      repository: "web",
      path: SETUP_WORKFLOW_PATH,
      ref: "main",
    });

    await expect(missing).rejects.toBeInstanceOf(GitHubNotFoundError);
    await expect(missing).rejects.not.toThrow("fixture body must not escape");
  });

  it("accepts an empty text file without treating empty content as missing", async () => {
    const transport = new QueueTransport([
      tokenResponse(),
      response({
        type: "file",
        path: "package.json",
        sha: "d".repeat(40),
        size: 0,
        encoding: "base64",
        content: "",
      }),
    ]);
    const client = createClient(transport);
    const authorization = await authorize(client);

    await expect(
      client.getFileContent(authorization, {
        owner: "example-owner",
        repository: "web",
        path: "package.json",
      }),
    ).resolves.toMatchObject({
      value: {
        size: 0,
        content: "",
      },
    });
    expect(transport.calls[1]?.parameters).toEqual({
      owner: "example-owner",
      repo: "web",
      path: "package.json",
    });
  });

  it("normalizes workflow run list and detail responses", async () => {
    const transport = new QueueTransport([
      tokenResponse(),
      response({ total_count: 1, workflow_runs: [workflowRun] }),
      response(workflowRun),
    ]);
    const client = createClient(transport);
    const authorization = await authorize(client);

    const list = await client.listWorkflowRuns(authorization, {
      owner: "example-owner",
      repository: "web",
      workflowFilename: "copilot-setup-steps.yml",
      defaultBranch: "main",
      perPage: 25,
    });
    expect(list.value).toMatchObject({
      totalCount: 1,
      page: 1,
      perPage: 25,
      runs: [
        {
          id: "404",
          workflowId: "505",
          path: SETUP_WORKFLOW_PATH,
          conclusion: "success",
        },
      ],
    });

    const detail = await client.getWorkflowRun(authorization, {
      owner: "example-owner",
      repository: "web",
      runId: 404,
    });
    expect(detail.value).toMatchObject({
      id: "404",
      headSha: "b".repeat(40),
      createdAt: "2026-08-10T23:10:00.000Z",
    });
  });

  it("normalizes runner labels and the first failed step without logs", async () => {
    const transport = new QueueTransport([
      tokenResponse(),
      response({
        total_count: 2,
        jobs: [
          {
            conclusion: "success",
            labels: ["ubuntu-latest"],
            runner_name: "hosted-runner-name",
            steps: [
              {
                name: "Checkout",
                number: 1,
                conclusion: "success",
              },
            ],
          },
          {
            conclusion: "failure",
            labels: ["self-hosted", "linux", "x64"],
            runner_name: "private-machine-name",
            logs_url: "https://example.invalid/private-log",
            steps: [
              {
                name: "Install dependencies",
                number: 1,
                conclusion: "failure",
              },
              {
                name: "Later failure",
                number: 2,
                conclusion: "failure",
              },
            ],
          },
        ],
      }),
    ]);
    const client = createClient(transport);
    const authorization = await authorize(client);

    const diagnostics = await client.getWorkflowRunDiagnostics(authorization, {
      owner: "example-owner",
      repository: "web",
      runId: 404,
    });

    expect(diagnostics.value).toEqual({
      runnerLabel: "self-hosted, linux, x64",
      failedStep: "Install dependencies",
    });
    expect(JSON.stringify(diagnostics.value)).not.toContain("private-machine-name");
    expect(JSON.stringify(diagnostics.value)).not.toContain("private-log");
    expect(transport.calls[1]).toEqual({
      route: "GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs",
      parameters: {
        owner: "example-owner",
        repo: "web",
        run_id: "404",
        filter: "latest",
        page: 1,
        per_page: 100,
      },
      authorizationScheme: "Bearer",
    });
  });

  it("normalizes dashboard user and installation authorization data", async () => {
    const transport = new QueueTransport([
      response({
        id: 606,
        login: "dashboard-user",
        name: "Dashboard User",
        avatar_url: "https://avatars.githubusercontent.com/u/606?v=4",
      }),
      response({
        total_count: 1,
        installations: [
          {
            id: 101,
            account: {
              id: 202,
              login: "example-owner",
              type: "Organization",
            },
            repository_selection: "selected",
            created_at: "2026-08-10T22:00:00Z",
            updated_at: "2026-08-10T23:00:00Z",
            suspended_at: null,
          },
        ],
      }),
      response({
        total_count: 1,
        repositories: [
          {
            id: 303,
            owner: { login: "example-owner" },
            name: "web",
            default_branch: "main",
            private: true,
            archived: false,
          },
        ],
      }),
    ]);
    const client = createClient(transport);

    await expect(client.getAuthenticatedUser("user-token-test-only")).resolves.toMatchObject({
      value: {
        id: "606",
        login: "dashboard-user",
        name: "Dashboard User",
        avatarUrl: "https://avatars.githubusercontent.com/u/606?v=4",
      },
    });
    await expect(
      client.getAuthenticatedUserInstallations("user-token-test-only"),
    ).resolves.toMatchObject({
      value: [
        {
          id: "101",
          account: {
            id: "202",
            name: "example-owner",
            type: "Organization",
          },
          repositorySelection: "selected",
          suspendedAt: null,
        },
      ],
    });
    await expect(
      client.getAuthenticatedUserInstallationRepositories("user-token-test-only", "101"),
    ).resolves.toMatchObject({
      value: [
        {
          id: "303",
          owner: "example-owner",
          name: "web",
          defaultBranch: "main",
          isPrivate: true,
          isArchived: false,
        },
      ],
    });
    expect(transport.calls.map((call) => call.route)).toEqual([
      "GET /user",
      "GET /user/installations",
      "GET /user/installations/{installation_id}/repositories",
    ]);
  });

  it("paginates repositories accessible to the authenticated user", async () => {
    const rawRepository = (id: number) => ({
      id,
      owner: { login: "example-owner" },
      name: `repository-${id}`,
      default_branch: "main",
      private: true,
      archived: false,
    });
    const transport = new QueueTransport([
      response({
        total_count: 101,
        repositories: Array.from({ length: 100 }, (_, index) => rawRepository(index + 1)),
      }),
      response({
        total_count: 101,
        repositories: [rawRepository(101)],
      }),
    ]);
    const client = createClient(transport);

    await expect(
      client.getAuthenticatedUserInstallationRepositories("user-token-test-only", "101"),
    ).resolves.toMatchObject({
      value: expect.arrayContaining([
        expect.objectContaining({ id: "1" }),
        expect.objectContaining({ id: "101" }),
      ]),
    });
    expect(transport.calls.map((call) => call.parameters.page)).toEqual([1, 2]);
  });

  it("rejects duplicate repositories across authenticated-user pages", async () => {
    const repository = {
      id: 303,
      owner: { login: "example-owner" },
      name: "web",
      default_branch: "main",
      private: true,
      archived: false,
    };
    const transport = new QueueTransport([
      response({ total_count: 2, repositories: [repository] }),
      response({ total_count: 2, repositories: [repository] }),
    ]);
    const client = createClient(transport);

    await expect(
      client.getAuthenticatedUserInstallationRepositories("user-token-test-only", "101"),
    ).rejects.toThrow("duplicate repository ID");
  });

  it("rejects installation tokens with write permissions", async () => {
    const transport = new QueueTransport([
      response(
        {
          token: "installation-token-test-only",
          expires_at: "2026-08-11T00:27:02Z",
          permissions: {
            actions: "write",
            contents: "read",
          },
        },
        201,
      ),
    ]);
    const client = createClient(transport);

    await expect(client.createInstallationToken(101)).rejects.toThrow("not read-only");
  });

  it("keeps stale workflow conclusions distinct from the shared contract", () => {
    expect(classifyGitHubWorkflowConclusion("success")).toEqual({
      kind: "contract",
      conclusion: "success",
    });
    expect(classifyGitHubWorkflowConclusion("stale")).toEqual({
      kind: "stale",
      conclusion: "stale",
    });
    expect(classifyGitHubWorkflowConclusion(null)).toEqual({
      kind: "pending",
      conclusion: null,
    });
  });
});
