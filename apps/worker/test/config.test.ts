import { describe, expect, it } from "vitest";
import { parseWorkerConfig, requiresSecureCookies } from "../src/config.js";

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    APP_ENV: "local",
    APP_VERSION: "0.0.0",
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
    ...overrides,
  };
}

describe("Worker configuration", () => {
  it("validates required non-secret and secret bindings", () => {
    const config = parseWorkerConfig(createEnv());

    expect(config.github.appId).toBe("123");
    expect(requiresSecureCookies(config)).toBe(false);
  });

  it("uses secure cookies for HTTPS deployments", () => {
    const config = parseWorkerConfig(
      createEnv({
        APP_ENV: "production",
        PRODUCT_BASE_URL: "https://setup-steps-guardian.example",
      }),
    );

    expect(requiresSecureCookies(config)).toBe(true);
  });

  it("rejects weak session secrets", () => {
    expect(() => parseWorkerConfig(createEnv({ SESSION_SECRET: "short" }))).toThrow();
  });

  it("rejects weak Paddle binding secrets", () => {
    expect(() => parseWorkerConfig(createEnv({ PADDLE_BINDING_SECRET: "short" }))).toThrow();
  });

  it("requires distinct Paddle price IDs for paid plans", () => {
    expect(() =>
      parseWorkerConfig(
        createEnv({
          PADDLE_TEAM_PRICE_ID: "pri_same",
          PADDLE_FLEET_PRICE_ID: "pri_same",
        }),
      ),
    ).toThrow();
  });
});
