import {
  buildGitHubAppUserAuthorizationUrl,
  createGitHubPkceChallenge,
  exchangeGitHubAppUserCode,
  type GitHubAuthenticatedUser,
  type GitHubClient,
  parseGitHubAppUserAuthorizationCallback,
} from "@setup-fleet/github";
import { encodeBase64Url } from "./encoding.js";
import { canonicalizeReturnPath } from "./return-path.js";
import {
  openOAuthState,
  type SessionClaims,
  sealOAuthState,
  sealSession,
  serializeOAuthStateCookie,
  serializeSessionCookie,
} from "./session.js";

const OAUTH_STATE_LIFETIME_MS = 10 * 60_000;
const MAX_SESSION_LIFETIME_MS = 12 * 60 * 60_000;

export interface GitHubAuthConfig {
  readonly appUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly callbackUrl: string;
  readonly sessionSecret: string;
}

export interface BeginGitHubAuthorizationResult {
  readonly authorizationUrl: string;
  readonly stateCookie: string;
}

export interface CompleteGitHubAuthorizationInput {
  readonly config: GitHubAuthConfig;
  readonly callbackUrl: string;
  readonly sealedState: string;
  readonly client: Pick<GitHubClient, "getAuthenticatedUser">;
  readonly now?: Date;
  readonly fetch?: typeof fetch;
}

export interface CompleteGitHubAuthorizationResult {
  readonly redirectTo: string;
  readonly sessionCookie: string;
  readonly session: SessionClaims;
  readonly user: GitHubAuthenticatedUser;
}

function randomUrlSafe(bytes: number): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function isSecure(config: GitHubAuthConfig): boolean {
  return new URL(config.appUrl).protocol === "https:";
}

export function normalizeReturnTo(value: string | null, appUrl: string): string {
  return canonicalizeReturnPath(value, appUrl);
}

export async function beginGitHubAuthorization(
  config: GitHubAuthConfig,
  returnTo: string | null,
  now = new Date(),
): Promise<BeginGitHubAuthorizationResult> {
  const nonce = randomUrlSafe(32);
  const codeVerifier = randomUrlSafe(32);
  const codeChallenge = await createGitHubPkceChallenge(codeVerifier);
  const expiresAt = now.getTime() + OAUTH_STATE_LIFETIME_MS;
  const state = await sealOAuthState(
    {
      nonce,
      codeVerifier,
      returnTo: normalizeReturnTo(returnTo, config.appUrl),
      expiresAt,
    },
    config.sessionSecret,
  );

  return {
    authorizationUrl: buildGitHubAppUserAuthorizationUrl({
      clientId: config.clientId,
      redirectUri: config.callbackUrl,
      state: nonce,
      codeChallenge,
      allowSignup: true,
      prompt: "select_account",
    }),
    stateCookie: serializeOAuthStateCookie(state, {
      secure: isSecure(config),
      maxAgeSeconds: Math.floor(OAUTH_STATE_LIFETIME_MS / 1_000),
    }),
  };
}

export async function completeGitHubAuthorization(
  input: CompleteGitHubAuthorizationInput,
): Promise<CompleteGitHubAuthorizationResult> {
  const now = input.now ?? new Date();
  const oauthState = await openOAuthState(
    input.sealedState,
    input.config.sessionSecret,
    now.getTime(),
  );
  const callback = parseGitHubAppUserAuthorizationCallback(input.callbackUrl, {
    expectedState: oauthState.nonce,
    redirectUri: input.config.callbackUrl,
  });
  const token = await exchangeGitHubAppUserCode({
    clientId: input.config.clientId,
    clientSecret: input.config.clientSecret,
    code: callback.code,
    redirectUri: input.config.callbackUrl,
    codeVerifier: oauthState.codeVerifier,
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
    now: () => now.getTime(),
  });
  const user = (await input.client.getAuthenticatedUser(token.accessToken)).value;
  const expiresAt = Math.min(Date.parse(token.expiresAt), now.getTime() + MAX_SESSION_LIFETIME_MS);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    throw new Error("GitHub returned an unusable user access-token expiration.");
  }

  const session: SessionClaims = {
    githubUserId: user.id,
    login: user.login,
    avatarUrl: user.avatarUrl,
    accessToken: token.accessToken,
    csrfToken: randomUrlSafe(24),
    expiresAt,
  };
  const sealedSession = await sealSession(session, input.config.sessionSecret);

  return {
    redirectTo: oauthState.returnTo,
    sessionCookie: serializeSessionCookie(sealedSession, {
      secure: isSecure(input.config),
      maxAgeSeconds: Math.max(1, Math.floor((expiresAt - now.getTime()) / 1_000)),
    }),
    session,
    user,
  };
}
