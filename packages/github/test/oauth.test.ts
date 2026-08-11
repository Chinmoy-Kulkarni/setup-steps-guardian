import { describe, expect, it } from "vitest";
import type { GitHubOAuthError } from "../src/errors.js";
import {
  buildGitHubAppUserAuthorizationUrl,
  createGitHubPkceChallenge,
  exchangeGitHubAppUserCode,
  GITHUB_APP_USER_AUTHORIZATION_ENDPOINT,
  GITHUB_APP_USER_TOKEN_ENDPOINT,
  parseGitHubAppUserAuthorizationCallback,
} from "../src/oauth.js";

const NOW = Date.parse("2026-08-10T23:27:02.000Z");
const REDIRECT_URI = "https://guardian.example.com/auth/github/callback";
const STATE = "s".repeat(32);
const PKCE_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const PKCE_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

describe("GitHub App user OAuth", () => {
  it("builds a state-bound PKCE authorization URL", async () => {
    await expect(createGitHubPkceChallenge(PKCE_VERIFIER)).resolves.toBe(PKCE_CHALLENGE);

    const authorizationUrl = new URL(
      buildGitHubAppUserAuthorizationUrl({
        clientId: "Iv1.example",
        redirectUri: REDIRECT_URI,
        state: STATE,
        codeChallenge: PKCE_CHALLENGE,
        login: "octocat",
        allowSignup: false,
        prompt: "select_account",
      }),
    );

    expect(`${authorizationUrl.origin}${authorizationUrl.pathname}`).toBe(
      GITHUB_APP_USER_AUTHORIZATION_ENDPOINT,
    );
    expect(Object.fromEntries(authorizationUrl.searchParams)).toEqual({
      client_id: "Iv1.example",
      redirect_uri: REDIRECT_URI,
      state: STATE,
      code_challenge: PKCE_CHALLENGE,
      code_challenge_method: "S256",
      login: "octocat",
      allow_signup: "false",
      prompt: "select_account",
    });
    expect(authorizationUrl.searchParams.has("scope")).toBe(false);
  });

  it("validates callback state and maps authorization errors", () => {
    expect(
      parseGitHubAppUserAuthorizationCallback(
        `${REDIRECT_URI}?code=temporary-code&state=${STATE}`,
        { expectedState: STATE, redirectUri: REDIRECT_URI },
      ),
    ).toEqual({ code: "temporary-code" });

    expect(() =>
      parseGitHubAppUserAuthorizationCallback(
        `${REDIRECT_URI}?code=temporary-code&state=${"x".repeat(32)}`,
        { expectedState: STATE, redirectUri: REDIRECT_URI },
      ),
    ).toThrow(
      expect.objectContaining<Partial<GitHubOAuthError>>({
        code: "state_mismatch",
      }),
    );
    expect(() =>
      parseGitHubAppUserAuthorizationCallback(
        `${REDIRECT_URI}?error=access_denied&state=${STATE}`,
        { expectedState: STATE, redirectUri: REDIRECT_URI },
      ),
    ).toThrow(
      expect.objectContaining<Partial<GitHubOAuthError>>({
        code: "access_denied",
      }),
    );
    expect(() =>
      parseGitHubAppUserAuthorizationCallback(
        `https://attacker.example.com/callback?code=temporary-code&state=${STATE}`,
        { expectedState: STATE, redirectUri: REDIRECT_URI },
      ),
    ).toThrow(
      expect.objectContaining<Partial<GitHubOAuthError>>({
        code: "malformed_callback",
      }),
    );
  });

  it("exchanges a code with official headers and normalizes expiring tokens", async () => {
    const clientSecret = "client-secret-test-only";
    const fetchMock: typeof fetch = async (input, init) => {
      expect(String(input)).toBe(GITHUB_APP_USER_TOKEN_ENDPOINT);
      expect(String(input)).not.toContain(clientSecret);
      expect(init?.method).toBe("POST");
      expect(init?.cache).toBe("no-store");
      expect(init?.redirect).toBe("error");
      const headers = new Headers(init?.headers);
      expect(headers.get("accept")).toBe("application/json");
      expect(headers.get("content-type")).toBe("application/x-www-form-urlencoded;charset=UTF-8");
      if (typeof init?.body !== "string") {
        throw new TypeError("OAuth request body must be form encoded.");
      }
      expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
        client_id: "Iv1.example",
        client_secret: clientSecret,
        code: "temporary-code",
        redirect_uri: REDIRECT_URI,
        code_verifier: PKCE_VERIFIER,
      });

      return new Response(
        JSON.stringify({
          access_token: "ghu_access_token",
          expires_in: 28_800,
          refresh_token: "ghr_refresh_token",
          refresh_token_expires_in: 15_897_600,
          scope: "",
          token_type: "bearer",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };

    const token = await exchangeGitHubAppUserCode({
      clientId: "Iv1.example",
      clientSecret,
      code: "temporary-code",
      redirectUri: REDIRECT_URI,
      codeVerifier: PKCE_VERIFIER,
      fetch: fetchMock,
      now: () => NOW,
    });

    expect(token).toEqual({
      accessToken: "ghu_access_token",
      expiresAt: new Date(NOW + 28_800_000).toISOString(),
      tokenType: "bearer",
      refreshToken: "ghr_refresh_token",
      refreshTokenExpiresAt: new Date(NOW + 15_897_600_000).toISOString(),
    });
    expect(JSON.stringify(token)).not.toContain(clientSecret);
  });

  it("maps provider token errors without returning provider descriptions", async () => {
    const clientSecret = "client-secret-test-only";
    const fetchMock: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: "bad_verification_code",
          error_description: "The supplied code and secret were rejected.",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );

    const exchange = exchangeGitHubAppUserCode({
      clientId: "Iv1.example",
      clientSecret,
      code: "expired-code",
      redirectUri: REDIRECT_URI,
      codeVerifier: PKCE_VERIFIER,
      fetch: fetchMock,
      now: () => NOW,
    });

    await expect(exchange).rejects.toMatchObject({
      code: "bad_verification_code",
      status: 200,
    });
    await expect(exchange).rejects.not.toThrow("supplied code and secret");
    await expect(exchange).rejects.not.toThrow(clientSecret);
  });

  it("normalizes expiring access tokens when refresh tokens are omitted", async () => {
    const fetchMock: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          access_token: "ghu_access_token",
          expires_in: 28_800,
          scope: "",
          token_type: "bearer",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );

    await expect(
      exchangeGitHubAppUserCode({
        clientId: "Iv1.example",
        clientSecret: "client-secret-test-only",
        code: "temporary-code",
        redirectUri: REDIRECT_URI,
        codeVerifier: PKCE_VERIFIER,
        fetch: fetchMock,
        now: () => NOW,
      }),
    ).resolves.toMatchObject({
      refreshToken: null,
      refreshTokenExpiresAt: null,
    });
  });
});
