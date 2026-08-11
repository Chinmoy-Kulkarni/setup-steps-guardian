import { describe, expect, it, vi } from "vitest";
import {
  beginGitHubAuthorization,
  completeGitHubAuthorization,
  normalizeReturnTo,
} from "../src/github-auth-service.js";
import { readOAuthStateCookie } from "../src/session.js";

const config = {
  appUrl: "https://guardian.example.com",
  clientId: "client-id",
  clientSecret: "client-secret",
  callbackUrl: "https://guardian.example.com/api/auth/github/callback",
  sessionSecret: "a-secure-session-secret-with-more-than-32-characters",
};
const now = new Date("2026-08-10T22:00:00.000Z");

describe("GitHub App user authorization", () => {
  it("creates PKCE authorization state and an encrypted callback cookie", async () => {
    const result = await beginGitHubAuthorization(config, "/fleet", now);
    const url = new URL(result.authorizationUrl);

    expect(url.origin).toBe("https://github.com");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toHaveLength(43);
    expect(readOAuthStateCookie(result.stateCookie)).toBeDefined();
    expect(result.stateCookie).toContain("HttpOnly");
    expect(result.stateCookie).toContain("Secure");
  });

  it("exchanges the callback and seals the expiring user token into a session", async () => {
    const start = await beginGitHubAuthorization(config, "/fleet", now);
    const state = new URL(start.authorizationUrl).searchParams.get("state");
    const sealedState = readOAuthStateCookie(start.stateCookie);
    if (state === null || sealedState === undefined) {
      throw new Error("Test authorization state was not generated.");
    }
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "ghu_secret",
          expires_in: 28_800,
          token_type: "bearer",
          refresh_token: "ghr_secret",
          refresh_token_expires_in: 158_976_000,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    const getAuthenticatedUser = vi.fn().mockResolvedValue({
      value: {
        id: "123",
        login: "octocat",
        name: "The Octocat",
        avatarUrl: "https://avatars.githubusercontent.com/u/123",
      },
      rateLimit: {
        limit: 5_000,
        remaining: 4_999,
        resetAt: "2026-08-10T23:00:00.000Z",
        retryAfterSeconds: null,
      },
    });

    const result = await completeGitHubAuthorization({
      config,
      callbackUrl: `${config.callbackUrl}?code=authorization-code&state=${state}`,
      sealedState,
      client: { getAuthenticatedUser },
      now,
      fetch,
    });

    expect(result.redirectTo).toBe("/fleet");
    expect(result.sessionCookie).toContain("setup_steps_guardian_session=");
    expect(result.sessionCookie).not.toContain("ghu_secret");
    expect(result.session.expiresAt).toBe(now.getTime() + 28_800_000);
    expect(getAuthenticatedUser).toHaveBeenCalledWith("ghu_secret");
  });

  it("canonicalizes same-origin return targets and rejects redirect parser tricks", () => {
    const appUrl = "https://guardian.example";

    expect(normalizeReturnTo("/fleet/../settings?tab=billing#plan", appUrl)).toBe(
      "/settings?tab=billing#plan",
    );
    expect(normalizeReturnTo("/fleet", appUrl)).toBe("/fleet");
    expect(normalizeReturnTo("//attacker.example", appUrl)).toBe("/");
    expect(normalizeReturnTo("/\t/attacker.example", appUrl)).toBe("/");
    expect(normalizeReturnTo("/%09//attacker.example", appUrl)).toBe("/");
    expect(normalizeReturnTo("/%252f%252fattacker.example", appUrl)).toBe("/");
    expect(normalizeReturnTo("/\\attacker.example", appUrl)).toBe("/");
    expect(normalizeReturnTo("/a/..//attacker.example", appUrl)).toBe("/");
    expect(normalizeReturnTo("/%2e%2e//attacker.example", appUrl)).toBe("/");
    expect(normalizeReturnTo("/%252e%252e//attacker.example", appUrl)).toBe("/");
    expect(normalizeReturnTo("https://guardian.example/fleet", appUrl)).toBe("/");
  });
});
