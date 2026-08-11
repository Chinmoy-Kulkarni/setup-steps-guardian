import { describe, expect, it } from "vitest";
import { WebhookPayloadError } from "../src/errors.js";
import {
  filterRelevantRepositoryPaths,
  isDefaultBranchPush,
  isRelevantManifestOrLockfilePath,
  isSetupWorkflowPath,
  isSetupWorkflowRun,
  parseInstallationRepositoriesWebhook,
  parseInstallationWebhook,
  parsePushWebhook,
  parseWebhookEvent,
  parseWebhookJson,
  parseWorkflowRunWebhook,
  pushTouchesRelevantPaths,
  SETUP_POLICY_PATH,
  SETUP_WORKFLOW_PATH,
} from "../src/webhooks.js";

const installation = {
  id: 101,
  account: {
    id: 202,
    login: "example-owner",
    type: "Organization",
  },
  repository_selection: "selected",
  created_at: "2026-08-10T22:00:00Z",
  updated_at: "2026-08-10T23:00:00Z",
};

const selectedRepository = {
  id: 303,
  name: "web",
  full_name: "example-owner/web",
  private: true,
};

const repository = {
  id: 303,
  name: "web",
  default_branch: "main",
  private: true,
  archived: false,
  owner: {
    login: "example-owner",
  },
};

function pushPayload(): Record<string, unknown> {
  return {
    installation: { id: 101 },
    repository,
    ref: "refs/heads/main",
    after: "a".repeat(40),
    deleted: false,
    commits: [
      {
        added: [SETUP_WORKFLOW_PATH, "src/private-name.ts"],
        modified: ["package.json", "packages/app/package.json"],
        removed: ["pnpm-lock.yaml"],
      },
    ],
    head_commit: {
      timestamp: "2026-08-10T23:20:00-00:00",
      modified: [SETUP_POLICY_PATH],
    },
  };
}

function workflowRunPayload(): Record<string, unknown> {
  return {
    action: "completed",
    installation: { id: 101 },
    repository,
    workflow_run: {
      id: 404,
      workflow_id: 505,
      name: "Copilot setup",
      path: SETUP_WORKFLOW_PATH,
      head_sha: "b".repeat(40),
      head_branch: "main",
      conclusion: "success",
      run_attempt: 2,
      run_number: 12,
      created_at: "2026-08-10T23:10:00Z",
      updated_at: "2026-08-10T23:20:00Z",
      run_started_at: "2026-08-10T23:11:00Z",
    },
  };
}

describe("webhook normalization", () => {
  it("normalizes installation and repository-selection events", () => {
    expect(
      parseInstallationWebhook({
        action: "created",
        installation,
        sender: { id: 404 },
        repositories: [selectedRepository],
      }),
    ).toEqual({
      type: "installation",
      action: "created",
      installationId: "101",
      installerUserId: "404",
      account: { id: "202", name: "example-owner", type: "Organization" },
      repositorySelection: "selected",
      repositories: [
        {
          id: "303",
          owner: "example-owner",
          name: "web",
          defaultBranch: null,
          isPrivate: true,
        },
      ],
      createdAt: "2026-08-10T22:00:00.000Z",
      updatedAt: "2026-08-10T23:00:00.000Z",
    });

    expect(
      parseInstallationRepositoriesWebhook({
        action: "added",
        installation,
        repository_selection: "selected",
        repositories_added: [selectedRepository],
        repositories_removed: [],
      }),
    ).toMatchObject({
      type: "installation_repositories",
      action: "added",
      installationId: "101",
      addedRepositories: [{ id: "303", name: "web" }],
      removedRepositories: [],
      updatedAt: "2026-08-10T23:00:00.000Z",
    });
  });

  it("returns only relevant paths from a default-branch push", () => {
    const event = parsePushWebhook(pushPayload());

    expect(event).toMatchObject({
      type: "push",
      installationId: "101",
      branch: "main",
      headSha: "a".repeat(40),
      pushedAt: "2026-08-10T23:20:00.000Z",
    });
    expect(event.relevantPaths).toEqual([
      SETUP_POLICY_PATH,
      SETUP_WORKFLOW_PATH,
      "package.json",
      "pnpm-lock.yaml",
    ]);
    expect(event.relevantPaths).not.toContain("src/private-name.ts");
    expect(event.relevantPaths).not.toContain("packages/app/package.json");
    expect(isDefaultBranchPush(event)).toBe(true);
    expect(pushTouchesRelevantPaths(event)).toBe(true);
  });

  it("normalizes workflow runs without sender, logs, or artifact data", () => {
    const event = parseWorkflowRunWebhook(workflowRunPayload());

    expect(event).toEqual({
      type: "workflow_run",
      action: "completed",
      installationId: "101",
      repository: {
        id: "303",
        owner: "example-owner",
        name: "web",
        defaultBranch: "main",
        isPrivate: true,
        isArchived: false,
      },
      runId: "404",
      workflowId: "505",
      workflowName: "Copilot setup",
      workflowPath: SETUP_WORKFLOW_PATH,
      headSha: "b".repeat(40),
      headBranch: "main",
      conclusion: "success",
      runAttempt: 2,
      runNumber: 12,
      createdAt: "2026-08-10T23:10:00.000Z",
      updatedAt: "2026-08-10T23:20:00.000Z",
      runStartedAt: "2026-08-10T23:11:00.000Z",
    });
    expect(isSetupWorkflowRun(event)).toBe(true);
  });

  it("dispatches supported JSON events and rejects unsupported events", () => {
    expect(parseWebhookJson("push", JSON.stringify(pushPayload()))).toMatchObject({ type: "push" });
    expect(() => parseWebhookEvent("issues", {})).toThrow(WebhookPayloadError);
    expect(() => parseWebhookJson("push", new Uint8Array([0xc3, 0x28]))).toThrow(
      "body is not valid UTF-8",
    );
  });

  it.each([
    ["installation", () => parseInstallationWebhook({ action: "created" })],
    [
      "installation sender",
      () =>
        parseInstallationWebhook({
          action: "created",
          installation,
          repositories: [],
        }),
    ],
    [
      "installation_repositories",
      () =>
        parseInstallationRepositoriesWebhook({
          action: "added",
          installation,
          repository_selection: "selected",
          repositories_added: "not-an-array",
          repositories_removed: [],
        }),
    ],
    [
      "push",
      () =>
        parsePushWebhook({
          ...pushPayload(),
          after: "not-a-sha",
        }),
    ],
    [
      "workflow_run",
      () =>
        parseWorkflowRunWebhook({
          ...workflowRunPayload(),
          action: "completed",
          workflow_run: {
            ...(workflowRunPayload().workflow_run as Record<string, unknown>),
            conclusion: null,
          },
        }),
    ],
    [
      "non-ISO timestamp",
      () =>
        parseInstallationWebhook({
          action: "created",
          sender: { id: 404 },
          installation: {
            ...installation,
            updated_at: "August 10, 2026",
          },
          repositories: [],
        }),
    ],
    [
      "impossible timestamp",
      () =>
        parseInstallationWebhook({
          action: "created",
          sender: { id: 404 },
          installation: {
            ...installation,
            updated_at: "2026-02-30T12:00:00Z",
          },
          repositories: [],
        }),
    ],
  ])("rejects malformed %s payloads explicitly", (_eventName, parse) => {
    expect(parse).toThrow(WebhookPayloadError);
  });
});

describe("relevant repository path filters", () => {
  it("matches only exact root workflow, policy, manifest, and lockfile paths", () => {
    expect(isSetupWorkflowPath(SETUP_WORKFLOW_PATH)).toBe(true);
    expect(isSetupWorkflowPath(`${SETUP_WORKFLOW_PATH}.bak`)).toBe(false);
    expect(isRelevantManifestOrLockfilePath("package-lock.json")).toBe(true);
    expect(isRelevantManifestOrLockfilePath("packages/app/package-lock.json")).toBe(false);
    expect(
      filterRelevantRepositoryPaths(["README.md", "uv.lock", "uv.lock", SETUP_WORKFLOW_PATH]),
    ).toEqual([SETUP_WORKFLOW_PATH, "uv.lock"]);
  });
});
