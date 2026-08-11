import { describe, expect, it } from "vitest";
import {
  clearOAuthStateCookie,
  clearSessionCookie,
  openOAuthState,
  openSession,
  readOAuthStateCookie,
  readSessionCookie,
  SealedTokenError,
  sealOAuthState,
  sealSession,
  serializeOAuthStateCookie,
  serializeSessionCookie,
} from "../src/session.js";

const secret = "a-secure-session-secret-with-more-than-32-characters";

describe("sealed sessions", () => {
  it("round-trips encrypted session claims", async () => {
    const token = await sealSession(
      {
        githubUserId: "123",
        login: "octocat",
        avatarUrl: "https://avatars.githubusercontent.com/u/123",
        accessToken: "ghu_secret",
        csrfToken: "1234567890123456",
        expiresAt: 2_000,
      },
      secret,
    );

    await expect(openSession(token, secret, 1_000)).resolves.toMatchObject({
      githubUserId: "123",
      login: "octocat",
      avatarUrl: "https://avatars.githubusercontent.com/u/123",
      accessToken: "ghu_secret",
    });
    expect(token).not.toContain("ghu_secret");
  });

  it("rejects tampered and expired sessions", async () => {
    const token = await sealSession(
      {
        githubUserId: "123",
        login: "octocat",
        avatarUrl: "https://avatars.githubusercontent.com/u/123",
        accessToken: "ghu_secret",
        csrfToken: "1234567890123456",
        expiresAt: 2_000,
      },
      secret,
    );

    await expect(openSession(`${token}x`, secret, 1_000)).rejects.toBeInstanceOf(SealedTokenError);
    await expect(openSession(token, secret, 2_000)).rejects.toMatchObject({
      reason: "expired",
    });
  });

  it("separates OAuth state from session tokens", async () => {
    const state = await sealOAuthState(
      {
        nonce: "1234567890123456",
        codeVerifier: "a".repeat(43),
        returnTo: "/fleet",
        expiresAt: 2_000,
      },
      secret,
    );

    await expect(openOAuthState(state, secret, 1_000)).resolves.toMatchObject({
      returnTo: "/fleet",
    });
    await expect(openSession(state, secret, 1_000)).rejects.toMatchObject({
      reason: "invalid",
    });
  });

  it.each([
    "//attacker.example",
    "/\t/attacker.example",
    "/%09//attacker.example",
    "/%252f%252fattacker.example",
    "/\\attacker.example",
    "/a/..//attacker.example",
    "/%2e%2e//attacker.example",
    "/%252e%252e//attacker.example",
  ])("rejects unsafe OAuth return paths before sealing: %s", async (returnTo) => {
    await expect(
      sealOAuthState(
        {
          nonce: "1234567890123456",
          codeVerifier: "a".repeat(43),
          returnTo,
          expiresAt: 2_000,
        },
        secret,
      ),
    ).rejects.toThrow();
  });
});

describe("session cookies", () => {
  it("serializes secure session cookies", () => {
    const cookie = serializeSessionCookie("token", {
      secure: true,
      maxAgeSeconds: 3_600,
    });

    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(readSessionCookie(cookie)).toBe("token");
    expect(clearSessionCookie(true)).toContain("Max-Age=0");

    const stateCookie = serializeOAuthStateCookie("state", {
      secure: true,
      maxAgeSeconds: 600,
    });
    expect(stateCookie).toContain("Path=/api/auth/github/callback");
    expect(readOAuthStateCookie(stateCookie)).toBe("state");
    expect(clearOAuthStateCookie(true)).toContain("Max-Age=0");
  });
});
