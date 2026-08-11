import { describe, expect, it, vi } from "vitest";
import { handleRequest } from "../src/index.js";

function createEnv(assetResponse: Response): Env {
  return {
    APP_ENV: "local",
    APP_VERSION: "0.0.0-test",
    PRODUCT_BASE_URL: "http://localhost:8787",
    GITHUB_APP_ID: "123",
    GITHUB_APP_SLUG: "setup-steps-guardian",
    GITHUB_CLIENT_ID: "Iv1.client",
    GITHUB_CLIENT_SECRET: "client-secret",
    GITHUB_PRIVATE_KEY_PKCS8: "-----BEGIN PRIVATE KEY-----\nprivate-key\n-----END PRIVATE KEY-----",
    GITHUB_WEBHOOK_SECRET: "github-webhook-secret",
    SESSION_SECRET: "session-secret-with-at-least-thirty-two-characters",
    PADDLE_API_BASE_URL: "https://sandbox-api.paddle.com",
    PADDLE_API_KEY: "paddle-api-key",
    PADDLE_WEBHOOK_SECRET: "paddle-webhook-secret",
    PADDLE_BINDING_SECRET: "paddle-binding-secret-with-at-least-thirty-two-characters",
    PADDLE_TEAM_PRICE_ID: "pri_team",
    PADDLE_FLEET_PRICE_ID: "pri_fleet",
    DB: {} as D1Database,
    ASSETS: {
      fetch: vi.fn(() => Promise.resolve(assetResponse)),
      connect: vi.fn(),
    } satisfies Fetcher,
  };
}

describe("Worker entrypoint", () => {
  it("routes API requests through Hono", async () => {
    const response = await handleRequest(
      new Request("https://example.test/api/health"),
      createEnv(new Response("asset")),
    );

    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("adds restrictive headers to static assets", async () => {
    const response = await handleRequest(
      new Request("https://example.test/"),
      createEnv(new Response("<html></html>", { headers: { "Content-Type": "text/html" } })),
    );

    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });
});
