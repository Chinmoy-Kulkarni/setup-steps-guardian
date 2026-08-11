import { describe, expect, it } from "vitest";
import { createApiApp } from "../src/app.js";
import { HttpError } from "../src/http-error.js";
import { createPaddleSubscriptionBinding } from "../src/paddle.js";

function createEnv(): Env {
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
    ASSETS: {} as Fetcher,
  };
}

async function signPaddleWebhook(body: string, timestamp: number, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}:${body}`)),
  );
  const signature = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `ts=${timestamp};h1=${signature}`;
}

describe("API application", () => {
  it("returns a validated health response and security headers", async () => {
    const response = await createApiApp().request("/api/health", undefined, createEnv());

    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      version: "0.0.0-test",
    });
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("returns a structured API 404", async () => {
    const response = await createApiApp().request("/api/missing", undefined, createEnv());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "NOT_FOUND",
      },
    });
  });

  it("reports degraded health without exposing invalid configuration", async () => {
    const env = createEnv();
    env.SESSION_SECRET = "short";

    const response = await createApiApp().request("/api/health", undefined, env);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "degraded",
      version: "0.0.0-test",
      timestamp: expect.any(String),
    });
  });

  it("surfaces explicit public errors without logging internal details", async () => {
    const app = createApiApp();
    app.get("/api/conflict", () => {
      throw new HttpError(409, "CONFLICT", "The requested operation conflicts with current state.");
    });

    const response = await app.request("/api/conflict", undefined, createEnv());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CONFLICT",
        message: "The requested operation conflicts with current state.",
      },
    });
  });

  it("starts GitHub authorization with PKCE and a sealed state cookie", async () => {
    const env = createEnv();
    env.PRODUCT_BASE_URL = "https://guardian.example.com";
    const response = await createApiApp().request(
      "/api/auth/github?return_to=/fleet",
      undefined,
      env,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("https://github.com/login/oauth/authorize");
    expect(response.headers.get("set-cookie")).toContain("setup_steps_guardian_oauth_state=");
  });

  it("rejects unsigned webhooks before parsing or persistence", async () => {
    const response = await createApiApp().request(
      "/api/webhooks/github",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GitHub-Delivery": "delivery-1",
          "X-GitHub-Event": "push",
        },
        body: "{}",
      },
      createEnv(),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "GITHUB_SIGNATURE_INVALID" },
    });
  });

  it("rejects a signed Fleet entitlement paired with the Team price", async () => {
    const env = createEnv();
    const binding = await createPaddleSubscriptionBinding({
      githubAccountId: "42",
      plan: "fleet",
      priceId: env.PADDLE_FLEET_PRICE_ID,
      secret: env.PADDLE_BINDING_SECRET,
    });
    const body = JSON.stringify({
      event_id: "evt_1",
      event_type: "subscription.updated",
      occurred_at: new Date().toISOString(),
      data: {
        id: "sub_1",
        customer_id: "ctm_1",
        status: "active",
        items: [
          {
            quantity: 1,
            price: { id: env.PADDLE_TEAM_PRICE_ID },
          },
        ],
        custom_data: {
          github_account_id: "42",
          plan: "fleet",
          binding,
        },
      },
    });
    const timestamp = Math.floor(Date.now() / 1_000);

    const response = await createApiApp().request(
      "/api/webhooks/paddle",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Paddle-Signature": await signPaddleWebhook(body, timestamp, env.PADDLE_WEBHOOK_SECRET),
        },
        body,
      },
      env,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PADDLE_BINDING_INVALID" },
    });
  });

  it("requires an authenticated session for browser mutations", async () => {
    const response = await createApiApp().request(
      "/api/auth/logout",
      { method: "POST" },
      createEnv(),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  });
});
