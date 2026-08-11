import { generateKeyPairSync } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deleteAccount,
  getFleetSummary,
  getGitHubAccount,
  getRepositoryDetails,
  getSubscriptionEntitlement,
  isAccountAdministrator,
  listAccountRepositories,
  listInstallations,
} from "@setup-fleet/data";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPlatformProxy, type PlatformProxy, unstable_splitSqlQuery } from "wrangler";
import { asDataDatabase } from "../src/data-adapter.js";
import { handleRequest } from "../src/index.js";
import { createPaddleSubscriptionBinding } from "../src/paddle.js";
import {
  createD1ScanStore,
  processScanBatch,
  type ScanFailureClassifier,
} from "../src/scan-processor.js";
import type { RepositoryReader } from "../src/scan-repository.js";
import { sealSession, serializeSessionCookie } from "../src/session.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const workerDirectory = resolve(testDirectory, "..");
const accountId = "42";
const installerUserId = "7";
const installationId = "900";
const teamPriceId = "pri_team";
const fleetPriceId = "pri_fleet";
const githubWebhookSecret = "github-webhook-secret";
const paddleWebhookSecret = "paddle-webhook-secret";
const paddleBindingSecret = "paddle-binding-secret-with-at-least-thirty-two-characters";

let platform: PlatformProxy<Env>;
let env: Env;

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function postGitHubWebhook(
  eventName: string,
  deliveryId: string,
  payload: unknown,
): Promise<Response> {
  const body = JSON.stringify(payload);
  return handleRequest(
    new Request("http://localhost/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Delivery": deliveryId,
        "X-GitHub-Event": eventName,
        "X-Hub-Signature-256": `sha256=${await hmacHex(githubWebhookSecret, body)}`,
      },
      body,
    }),
    env,
  );
}

async function postPaddleWebhook(payload: unknown): Promise<Response> {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1_000);
  return handleRequest(
    new Request("http://localhost/api/webhooks/paddle", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Paddle-Signature": `ts=${timestamp};h1=${await hmacHex(
          paddleWebhookSecret,
          `${timestamp}:${body}`,
        )}`,
      },
      body,
    }),
    env,
  );
}

async function requestAsUser(
  githubUserId: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const csrfToken = `csrf-token-for-user-${githubUserId}`;
  const session = await sealSession(
    {
      githubUserId,
      login: `user-${githubUserId}`,
      avatarUrl: `https://avatars.githubusercontent.com/u/${githubUserId}`,
      accessToken: `user-token-${githubUserId}`,
      csrfToken,
      expiresAt: Date.now() + 60 * 60_000,
    },
    env.SESSION_SECRET,
  );
  const headers = new Headers(init.headers);
  headers.set(
    "Cookie",
    serializeSessionCookie(session, {
      secure: false,
      maxAgeSeconds: 3_600,
    }).split(";")[0] ?? "",
  );
  if (init.method !== undefined && init.method !== "GET") {
    headers.set("X-CSRF-Token", csrfToken);
  }

  return handleRequest(
    new Request(`http://localhost${path}`, {
      ...init,
      headers,
    }),
    env,
  );
}

function repositories(): readonly Record<string, unknown>[] {
  return Array.from({ length: 6 }, (_, index) => ({
    id: 1_001 + index,
    owner: { login: "octo-org" },
    name: `service-${index + 1}`,
    default_branch: "main",
    private: true,
    archived: false,
  }));
}

function installationPayload(action: "created" | "deleted", observedAt: string): unknown {
  return {
    action,
    installation: {
      id: Number(installationId),
      account: {
        id: Number(accountId),
        login: "octo-org",
        type: "Organization",
      },
      repository_selection: "selected",
      created_at: observedAt,
      updated_at: observedAt,
    },
    sender: {
      id: Number(installerUserId),
    },
    repositories: [],
  };
}

function subscriptionPayload(input: {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly status: "active" | "canceled";
  readonly plan: "team" | "fleet";
  readonly priceId: string;
  readonly binding: string;
}): unknown {
  return {
    event_id: input.eventId,
    event_type: input.status === "active" ? "subscription.created" : "subscription.canceled",
    occurred_at: input.occurredAt,
    data: {
      id: "sub_1",
      customer_id: "ctm_1",
      status: input.status,
      items: [
        {
          quantity: 1,
          price: { id: input.priceId },
        },
      ],
      custom_data: {
        github_account_id: accountId,
        plan: input.plan,
        binding: input.binding,
      },
    },
  };
}

function validReader(): RepositoryReader {
  const workflow = `
on:
  workflow_dispatch:
jobs:
  copilot-setup-steps:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: read
    steps:
      - uses: actions/setup-node@1234567890123456789012345678901234567890
      - run: npm ci
`;
  return {
    async getFileContent(input) {
      if (input.path === ".github/workflows/copilot-setup-steps.yml") {
        return workflow;
      }
      if (input.path === "package.json" || input.path === "package-lock.json") {
        return "{}";
      }
      return null;
    },
    async getLatestCompletedSetupRun() {
      return {
        runId: "7001",
        runAttempt: 1,
        headSha: "a".repeat(40),
        conclusion: "success",
        startedAt: "2026-08-10T21:59:00.000Z",
        completedAt: "2026-08-10T22:00:00.000Z",
      };
    },
    async getRunDiagnostics() {
      return { runnerLabel: "ubuntu-latest" };
    },
  };
}

const failureClassifier: ScanFailureClassifier = {
  classify: () => ({ code: "INTEGRATION_SCAN_FAILED", retryable: false }),
};

beforeAll(async () => {
  platform = await getPlatformProxy<Env>({
    configPath: resolve(workerDirectory, "wrangler.test.jsonc"),
    envFiles: [],
    persist: false,
    remoteBindings: false,
  });

  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const testAssets: Fetcher = {
    fetch: async () => new Response("Not found", { status: 404 }),
    connect: () => {
      throw new Error("Asset socket connections are unavailable in integration tests.");
    },
  };
  env = Object.assign(platform.env, {
    GITHUB_APP_ID: "123",
    GITHUB_APP_SLUG: "setup-steps-guardian",
    GITHUB_CLIENT_ID: "Iv1.client",
    GITHUB_CLIENT_SECRET: "client-secret",
    GITHUB_PRIVATE_KEY_PKCS8: privateKey,
    GITHUB_WEBHOOK_SECRET: githubWebhookSecret,
    SESSION_SECRET: "session-secret-with-at-least-thirty-two-characters",
    PADDLE_API_KEY: "paddle-api-key",
    PADDLE_WEBHOOK_SECRET: paddleWebhookSecret,
    PADDLE_BINDING_SECRET: paddleBindingSecret,
    PADDLE_TEAM_PRICE_ID: teamPriceId,
    PADDLE_FLEET_PRICE_ID: fleetPriceId,
    ASSETS: testAssets,
  });

  const migrationsDirectory = resolve(workerDirectory, "../../packages/data/migrations");
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const migrationFile of migrationFiles) {
    const statements = unstable_splitSqlQuery(
      await readFile(resolve(migrationsDirectory, migrationFile), "utf8"),
    );
    for (const statement of statements) {
      if (!statement.trimStart().startsWith("PRAGMA")) {
        await env.DB.prepare(statement).run();
      }
    }
  }
}, 30_000);

afterAll(async () => {
  await platform.dispose();
});

describe.sequential("Worker lifecycle with local D1", () => {
  it("installs, inventories, scans, bills, downgrades, uninstalls, and ignores deleted accounts", async () => {
    const observedAt = new Date().toISOString();
    const githubFetch = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (
        request.method === "POST" &&
        url.pathname === `/app/installations/${installationId}/access_tokens`
      ) {
        return new Response(
          JSON.stringify({
            token: "ghs_integration_test",
            expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
            permissions: {
              actions: "read",
              contents: "read",
            },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }
      if (request.method === "GET" && url.pathname === "/installation/repositories") {
        return new Response(
          JSON.stringify({
            total_count: 6,
            repositories: repositories(),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected GitHub API request: ${request.method} ${url.pathname}`);
    });
    vi.stubGlobal("fetch", githubFetch);

    try {
      const installationResponse = await postGitHubWebhook(
        "installation",
        "delivery-install",
        installationPayload("created", observedAt),
      );
      const installationResult = await installationResponse.json();
      const githubCalls = githubFetch.mock.calls.map(([input]) =>
        input instanceof Request ? `${input.method} ${input.url}` : String(input),
      );
      expect(installationResponse.status, JSON.stringify({ installationResult, githubCalls })).toBe(
        202,
      );
      expect(installationResult).toEqual({
        accepted: true,
        duplicate: false,
      });
    } finally {
      vi.unstubAllGlobals();
    }

    const db = asDataDatabase(env.DB);
    expect(await listInstallations(db, accountId)).toHaveLength(1);
    await expect(isAccountAdministrator(db, accountId, installerUserId)).resolves.toBe(true);
    await expect(isAccountAdministrator(db, accountId, "77")).resolves.toBe(false);
    const installedRepositories = await listAccountRepositories(db, accountId);
    expect(installedRepositories).toHaveLength(6);
    expect(installedRepositories.filter((repository) => repository.scanEnabled)).toHaveLength(5);

    const duplicateResponse = await postGitHubWebhook(
      "installation",
      "delivery-install",
      installationPayload("created", observedAt),
    );
    expect(duplicateResponse.status).toBe(202);
    await expect(duplicateResponse.json()).resolves.toEqual({
      accepted: true,
      duplicate: true,
    });

    for (let index = 0; index < 5; index += 1) {
      const scanResult = await processScanBatch({
        store: createD1ScanStore(env.DB),
        readerFactory: { create: async () => validReader() },
        failureClassifier,
        now: new Date(Date.now() + 1_000 + index),
        workerId: `integration-worker-${index}`,
      });
      expect(scanResult.completed).toBe(1);
    }

    const fleet = await getFleetSummary(db, accountId);
    expect(fleet.totals).toEqual({
      selected: 6,
      passing: 5,
      attention: 1,
    });
    await expect(getRepositoryDetails(db, accountId, "1001")).resolves.toMatchObject({
      repository: { status: "passing" },
      evidence: { conclusion: "success" },
    });

    const userApiFetch = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const authorization = request.headers.get("Authorization") ?? "";
      const githubUserId = authorization.endsWith(`user-token-${installerUserId}`)
        ? installerUserId
        : "77";

      if (request.method === "GET" && url.pathname === "/user") {
        return Response.json({
          id: Number(githubUserId),
          login: `user-${githubUserId}`,
          name: null,
          avatar_url: `https://avatars.githubusercontent.com/u/${githubUserId}`,
        });
      }
      if (request.method === "GET" && url.pathname === "/user/installations") {
        return Response.json({
          total_count: 1,
          installations: [
            {
              id: Number(installationId),
              account: {
                id: Number(accountId),
                login: "octo-org",
                type: "Organization",
              },
              repository_selection: "selected",
              created_at: observedAt,
              updated_at: observedAt,
              suspended_at: null,
            },
          ],
        });
      }
      if (
        request.method === "GET" &&
        url.pathname === `/user/installations/${installationId}/repositories`
      ) {
        const accessibleRepositories =
          githubUserId === installerUserId ? repositories() : repositories().slice(0, 1);
        return Response.json({
          total_count: accessibleRepositories.length,
          repositories: accessibleRepositories,
        });
      }
      if (
        request.method === "POST" &&
        url.origin === "https://sandbox-api.paddle.com" &&
        url.pathname === "/transactions"
      ) {
        return Response.json(
          {
            data: {
              id: "txn_authorized",
              checkout: { url: "https://pay.paddle.test/txn_authorized" },
            },
            meta: { request_id: "req_authorized" },
          },
          { status: 201 },
        );
      }
      throw new Error(`Unexpected authenticated API request: ${request.method} ${request.url}`);
    });
    vi.stubGlobal("fetch", userApiFetch);

    try {
      const collaboratorSession = await requestAsUser("77", "/api/session");
      expect(collaboratorSession.status).toBe(200);
      await expect(collaboratorSession.json()).resolves.toMatchObject({
        accounts: [{ accountId, canManage: false }],
      });

      const installerSession = await requestAsUser(installerUserId, "/api/session");
      expect(installerSession.status).toBe(200);
      await expect(installerSession.json()).resolves.toMatchObject({
        accounts: [{ accountId, canManage: true }],
      });

      const collaboratorFleet = await requestAsUser("77", `/api/accounts/${accountId}/fleet`);
      expect(collaboratorFleet.status).toBe(200);
      await expect(collaboratorFleet.json()).resolves.toMatchObject({
        totals: { selected: 1, passing: 1, attention: 0 },
        repositories: [{ repositoryId: "1001" }],
      });

      const inaccessibleDetails = await requestAsUser(
        "77",
        `/api/accounts/${accountId}/repositories/1002`,
      );
      expect(inaccessibleDetails.status).toBe(403);
      await expect(inaccessibleDetails.json()).resolves.toMatchObject({
        error: { code: "REPOSITORY_ACCESS_DENIED" },
      });

      const inaccessibleScan = await requestAsUser(
        "77",
        `/api/accounts/${accountId}/repositories/1002/scan`,
        { method: "POST" },
      );
      expect(inaccessibleScan.status).toBe(403);
      await expect(inaccessibleScan.json()).resolves.toMatchObject({
        error: { code: "REPOSITORY_ACCESS_DENIED" },
      });

      const collaboratorCheckout = await requestAsUser(
        "77",
        `/api/accounts/${accountId}/checkout`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId, plan: "team" }),
        },
      );
      expect(collaboratorCheckout.status).toBe(403);
      await expect(collaboratorCheckout.json()).resolves.toMatchObject({
        error: { code: "ACCOUNT_ADMIN_REQUIRED" },
      });

      const collaboratorDeletion = await requestAsUser("77", `/api/accounts/${accountId}`, {
        method: "DELETE",
      });
      expect(collaboratorDeletion.status).toBe(403);
      await expect(collaboratorDeletion.json()).resolves.toMatchObject({
        error: { code: "ACCOUNT_ADMIN_REQUIRED" },
      });

      const installerCheckout = await requestAsUser(
        installerUserId,
        `/api/accounts/${accountId}/checkout`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId, plan: "team" }),
        },
      );
      expect(installerCheckout.status).toBe(200);
      await expect(installerCheckout.json()).resolves.toEqual({
        transactionId: "txn_authorized",
        checkoutUrl: "https://pay.paddle.test/txn_authorized",
      });
    } finally {
      vi.unstubAllGlobals();
    }

    const pushPayload = {
      ref: "refs/heads/main",
      after: "b".repeat(40),
      deleted: false,
      installation: { id: Number(installationId) },
      repository: repositories()[0],
      commits: [
        {
          added: [],
          modified: ["package-lock.json"],
          removed: [],
        },
      ],
      head_commit: {
        timestamp: new Date(Date.now() + 2_000).toISOString(),
        added: [],
        modified: ["package-lock.json"],
        removed: [],
      },
    };
    const pushResponse = await postGitHubWebhook("push", "delivery-push", pushPayload);
    expect(pushResponse.status).toBe(202);
    await expect(pushResponse.json()).resolves.toEqual({
      accepted: true,
      duplicate: false,
    });
    const queuedAfterPush = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM scan_jobs WHERE account_id = ? AND status = 'queued'",
    )
      .bind(accountId)
      .first<{ count: number }>();
    expect(queuedAfterPush?.count).toBe(1);

    const teamBinding = await createPaddleSubscriptionBinding({
      githubAccountId: accountId,
      plan: "team",
      priceId: teamPriceId,
      secret: paddleBindingSecret,
    });
    const activatedAt = new Date(Date.now() + 3_000).toISOString();
    const activationResponse = await postPaddleWebhook(
      subscriptionPayload({
        eventId: "evt_activate",
        occurredAt: activatedAt,
        status: "active",
        plan: "team",
        priceId: teamPriceId,
        binding: teamBinding,
      }),
    );
    expect(activationResponse.status).toBe(202);
    await expect(activationResponse.json()).resolves.toMatchObject({
      accepted: true,
      outcome: "applied",
    });
    await expect(getSubscriptionEntitlement(db, accountId)).resolves.toMatchObject({
      planKey: "team",
      status: "active",
      repositoryLimit: 25,
    });
    expect(
      (await listAccountRepositories(db, accountId)).filter((repository) => repository.scanEnabled),
    ).toHaveLength(6);

    const fleetBinding = await createPaddleSubscriptionBinding({
      githubAccountId: accountId,
      plan: "fleet",
      priceId: fleetPriceId,
      secret: paddleBindingSecret,
    });
    const tamperedResponse = await postPaddleWebhook(
      subscriptionPayload({
        eventId: "evt_tampered",
        occurredAt: new Date(Date.now() + 4_000).toISOString(),
        status: "active",
        plan: "fleet",
        priceId: teamPriceId,
        binding: fleetBinding,
      }),
    );
    expect(tamperedResponse.status).toBe(401);
    await expect(tamperedResponse.json()).resolves.toMatchObject({
      error: { code: "PADDLE_BINDING_INVALID" },
    });
    await expect(getSubscriptionEntitlement(db, accountId)).resolves.toMatchObject({
      planKey: "team",
      status: "active",
    });

    const cancellationResponse = await postPaddleWebhook(
      subscriptionPayload({
        eventId: "evt_cancel",
        occurredAt: new Date(Date.now() + 5_000).toISOString(),
        status: "canceled",
        plan: "team",
        priceId: teamPriceId,
        binding: teamBinding,
      }),
    );
    expect(cancellationResponse.status).toBe(202);
    await expect(cancellationResponse.json()).resolves.toMatchObject({
      accepted: true,
      outcome: "applied",
    });
    await expect(getSubscriptionEntitlement(db, accountId)).resolves.toMatchObject({
      planKey: "team",
      status: "inactive",
    });
    expect(
      (await listAccountRepositories(db, accountId)).filter((repository) => repository.scanEnabled),
    ).toHaveLength(5);

    const uninstallResponse = await postGitHubWebhook(
      "installation",
      "delivery-uninstall",
      installationPayload("deleted", new Date(Date.now() + 6_000).toISOString()),
    );
    expect(uninstallResponse.status).toBe(202);
    expect(await listInstallations(db, accountId)).toHaveLength(0);
    expect(await listAccountRepositories(db, accountId)).toHaveLength(0);
    await expect(isAccountAdministrator(db, accountId, installerUserId)).resolves.toBe(false);

    await expect(deleteAccount(db, accountId)).resolves.toBe(true);
    await expect(getGitHubAccount(db, accountId)).resolves.toBeNull();

    const deletedAccountResponse = await postPaddleWebhook(
      subscriptionPayload({
        eventId: "evt_after_delete",
        occurredAt: new Date(Date.now() + 7_000).toISOString(),
        status: "canceled",
        plan: "team",
        priceId: teamPriceId,
        binding: teamBinding,
      }),
    );
    expect(deletedAccountResponse.status).toBe(202);
    await expect(deletedAccountResponse.json()).resolves.toEqual({
      accepted: true,
      accountDeleted: true,
    });
    await expect(getSubscriptionEntitlement(db, accountId)).resolves.toBeNull();
  }, 30_000);
});
