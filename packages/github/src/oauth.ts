import { GitHubOAuthError, type GitHubOAuthErrorCode } from "./errors.js";

export const GITHUB_APP_USER_AUTHORIZATION_ENDPOINT = "https://github.com/login/oauth/authorize";
export const GITHUB_APP_USER_TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";

const textEncoder = new TextEncoder();
const pkceVerifierPattern = /^[A-Za-z0-9._~-]{43,128}$/;
const pkceChallengePattern = /^[A-Za-z0-9_-]{43}$/;
const statePattern = /^[A-Za-z0-9._~-]{32,512}$/;
const knownProviderErrorCodes = new Set<GitHubOAuthErrorCode>([
  "access_denied",
  "bad_verification_code",
  "incorrect_client_credentials",
  "redirect_uri_mismatch",
  "unverified_user_email",
]);

export interface GitHubAppUserAuthorizationUrlOptions {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
  readonly login?: string;
  readonly allowSignup?: boolean;
  readonly prompt?: "select_account";
}

export interface GitHubAppUserAuthorizationCallback {
  readonly code: string;
}

export interface GitHubAppUserAuthorizationCallbackOptions {
  readonly expectedState: string;
  readonly redirectUri: string;
}

export interface GitHubAppUserCodeExchangeOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly code: string;
  readonly redirectUri: string;
  readonly codeVerifier: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

export interface GitHubUserAccessToken {
  readonly accessToken: string;
  readonly expiresAt: string;
  readonly tokenType: "bearer";
  readonly refreshToken: string | null;
  readonly refreshTokenExpiresAt: string | null;
}

type JsonObject = Record<string, unknown>;

function validateNonWhitespace(value: string, name: string): string {
  if (value.length === 0 || /\s/.test(value)) {
    throw new TypeError(`${name} must not be empty or contain whitespace.`);
  }
  return value;
}

function validateRedirectUri(value: string): string {
  let redirectUri: URL;
  try {
    redirectUri = new URL(value);
  } catch (error: unknown) {
    if (error instanceof TypeError) {
      throw new TypeError("redirectUri must be an absolute HTTPS URL.");
    }
    throw error;
  }
  if (
    redirectUri.protocol !== "https:" ||
    redirectUri.username.length > 0 ||
    redirectUri.password.length > 0 ||
    redirectUri.search.length > 0 ||
    redirectUri.hash.length > 0
  ) {
    throw new TypeError(
      "redirectUri must be HTTPS and must not contain credentials, query, or fragment.",
    );
  }
  return value;
}

function validateState(value: string): string {
  if (!statePattern.test(value)) {
    throw new TypeError(
      "state must contain 32 to 512 URL-safe, cryptographically random characters.",
    );
  }
  return value;
}

function validateCodeChallenge(value: string): string {
  if (!pkceChallengePattern.test(value)) {
    throw new TypeError("codeChallenge must be a 43-character SHA-256 base64url value.");
  }
  return value;
}

function validateCodeVerifier(value: string): string {
  if (!pkceVerifierPattern.test(value)) {
    throw new TypeError("codeVerifier must contain 43 to 128 RFC 7636 characters.");
  }
  return value;
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function mapProviderError(value: string, status: number | null): GitHubOAuthError {
  const code: GitHubOAuthErrorCode = knownProviderErrorCodes.has(value as GitHubOAuthErrorCode)
    ? (value as GitHubOAuthErrorCode)
    : "provider_error";
  return new GitHubOAuthError(code, status);
}

function parseJsonObject(value: unknown): JsonObject | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function expectTokenString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || /\s/.test(value)) {
    throw new GitHubOAuthError("malformed_response");
  }
  return value;
}

function expectPositiveSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new GitHubOAuthError("malformed_response");
  }
  return value;
}

function expirationFromNow(nowMilliseconds: number, seconds: number): string {
  const expiration = new Date(nowMilliseconds + seconds * 1_000);
  if (Number.isNaN(expiration.getTime())) {
    throw new GitHubOAuthError("malformed_response");
  }
  return expiration.toISOString();
}

export async function createGitHubPkceChallenge(
  codeVerifier: string,
  webCrypto: Pick<Crypto, "subtle"> = globalThis.crypto,
): Promise<string> {
  const verifier = validateCodeVerifier(codeVerifier);
  const digest = new Uint8Array(
    await webCrypto.subtle.digest("SHA-256", toArrayBuffer(textEncoder.encode(verifier))),
  );
  return encodeBase64Url(digest);
}

export function buildGitHubAppUserAuthorizationUrl(
  options: GitHubAppUserAuthorizationUrlOptions,
): string {
  const url = new URL(GITHUB_APP_USER_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", validateNonWhitespace(options.clientId, "clientId"));
  url.searchParams.set("redirect_uri", validateRedirectUri(options.redirectUri));
  url.searchParams.set("state", validateState(options.state));
  url.searchParams.set("code_challenge", validateCodeChallenge(options.codeChallenge));
  url.searchParams.set("code_challenge_method", "S256");
  if (options.login !== undefined) {
    url.searchParams.set("login", validateNonWhitespace(options.login, "login"));
  }
  if (options.allowSignup !== undefined) {
    url.searchParams.set("allow_signup", String(options.allowSignup));
  }
  if (options.prompt !== undefined) {
    url.searchParams.set("prompt", options.prompt);
  }
  return url.toString();
}

export function parseGitHubAppUserAuthorizationCallback(
  callbackUrl: string | URL,
  options: GitHubAppUserAuthorizationCallbackOptions,
): GitHubAppUserAuthorizationCallback {
  let url: URL;
  try {
    url = callbackUrl instanceof URL ? callbackUrl : new URL(callbackUrl);
  } catch (error: unknown) {
    if (error instanceof TypeError) {
      throw new GitHubOAuthError("malformed_callback");
    }
    throw error;
  }
  const expectedRedirect = new URL(validateRedirectUri(options.redirectUri));
  const callbackBase = new URL(url);
  callbackBase.search = "";
  if (callbackBase.hash.length > 0 || callbackBase.toString() !== expectedRedirect.toString()) {
    throw new GitHubOAuthError("malformed_callback");
  }

  const expected = validateState(options.expectedState);
  const states = url.searchParams.getAll("state");
  if (states.length !== 1 || states[0] === undefined || !constantTimeEqual(states[0], expected)) {
    throw new GitHubOAuthError("state_mismatch");
  }

  const providerErrors = url.searchParams.getAll("error");
  if (providerErrors.length > 0) {
    const providerError = providerErrors.length === 1 ? providerErrors[0] : undefined;
    throw mapProviderError(providerError ?? "", null);
  }

  const codes = url.searchParams.getAll("code");
  if (
    codes.length !== 1 ||
    codes[0] === undefined ||
    codes[0].length === 0 ||
    /\s/.test(codes[0])
  ) {
    throw new GitHubOAuthError("malformed_callback");
  }
  return { code: codes[0] };
}

export async function exchangeGitHubAppUserCode(
  options: GitHubAppUserCodeExchangeOptions,
): Promise<GitHubUserAccessToken> {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const nowMilliseconds = now();
  if (!Number.isFinite(nowMilliseconds)) {
    throw new TypeError("The current time must be a finite millisecond timestamp.");
  }

  const body = new URLSearchParams();
  body.set("client_id", validateNonWhitespace(options.clientId, "clientId"));
  body.set("client_secret", validateNonWhitespace(options.clientSecret, "clientSecret"));
  body.set("code", validateNonWhitespace(options.code, "code"));
  body.set("redirect_uri", validateRedirectUri(options.redirectUri));
  body.set("code_verifier", validateCodeVerifier(options.codeVerifier));

  const response = await fetchImplementation(GITHUB_APP_USER_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: body.toString(),
    cache: "no-store",
    redirect: "error",
  });

  const responseText = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText) as unknown;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      throw new GitHubOAuthError("malformed_response", response.status);
    }
    throw error;
  }
  const data = parseJsonObject(parsed);
  if (data === null) {
    throw new GitHubOAuthError("malformed_response", response.status);
  }
  if (typeof data.error === "string") {
    throw mapProviderError(data.error, response.status);
  }
  if (!response.ok) {
    throw new GitHubOAuthError("http_error", response.status);
  }

  const tokenType = typeof data.token_type === "string" ? data.token_type.toLowerCase() : "";
  if (tokenType !== "bearer") {
    throw new GitHubOAuthError("malformed_response", response.status);
  }
  const accessToken = expectTokenString(data.access_token);
  const expiresAt = expirationFromNow(nowMilliseconds, expectPositiveSeconds(data.expires_in));

  const hasRefreshToken = data.refresh_token !== undefined;
  const hasRefreshExpiration = data.refresh_token_expires_in !== undefined;
  if (hasRefreshToken !== hasRefreshExpiration) {
    throw new GitHubOAuthError("malformed_response", response.status);
  }
  const refreshToken = hasRefreshToken ? expectTokenString(data.refresh_token) : null;
  const refreshTokenExpiresAt = hasRefreshExpiration
    ? expirationFromNow(nowMilliseconds, expectPositiveSeconds(data.refresh_token_expires_in))
    : null;

  return {
    accessToken,
    expiresAt,
    tokenType: "bearer",
    refreshToken,
    refreshTokenExpiresAt,
  };
}
