import { z } from "zod";
import { decodeBase64Url, encodeBase64Url } from "./encoding.js";
import { isSafeReturnPath } from "./return-path.js";

const SESSION_AAD = new TextEncoder().encode("setup-steps-guardian:session:v1");
const OAUTH_STATE_AAD = new TextEncoder().encode("setup-steps-guardian:oauth-state:v1");

export const SessionClaimsSchema = z.object({
  githubUserId: z.string().min(1),
  login: z.string().min(1),
  avatarUrl: z.string().url(),
  accessToken: z.string().min(1),
  csrfToken: z.string().min(16),
  expiresAt: z.number().int().positive(),
});
export type SessionClaims = z.infer<typeof SessionClaimsSchema>;

export const OAuthStateSchema = z.object({
  nonce: z.string().min(16),
  codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  returnTo: z.string().startsWith("/").refine(isSafeReturnPath),
  expiresAt: z.number().int().positive(),
});
export type OAuthState = z.infer<typeof OAuthStateSchema>;

export class SealedTokenError extends Error {
  constructor(
    message: string,
    readonly reason: "malformed" | "invalid" | "expired",
  ) {
    super(message);
    this.name = "SealedTokenError";
  }
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function seal(
  value: unknown,
  secret: string,
  additionalData: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const key = await deriveKey(secret);
  const initializationVector = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: initializationVector,
      additionalData,
      tagLength: 128,
    },
    key,
    plaintext,
  );

  return `v1.${encodeBase64Url(initializationVector)}.${encodeBase64Url(new Uint8Array(ciphertext))}`;
}

async function open(
  token: string,
  secret: string,
  additionalData: Uint8Array<ArrayBuffer>,
): Promise<unknown> {
  const segments = token.split(".");
  if (segments.length !== 3 || segments[0] !== "v1") {
    throw new SealedTokenError("Sealed token format is invalid.", "malformed");
  }

  try {
    const initializationVector = decodeBase64Url(segments[1] ?? "");
    const ciphertext = decodeBase64Url(segments[2] ?? "");
    if (initializationVector.length !== 12 || ciphertext.length < 17) {
      throw new SealedTokenError("Sealed token payload is invalid.", "malformed");
    }

    const key = await deriveKey(secret);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: initializationVector,
        additionalData,
        tagLength: 128,
      },
      key,
      ciphertext,
    );

    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch (error) {
    if (error instanceof SealedTokenError) {
      throw error;
    }
    throw new SealedTokenError("Sealed token authentication failed.", "invalid");
  }
}

function assertNotExpired(expiresAt: number, now: number): void {
  if (expiresAt <= now) {
    throw new SealedTokenError("Sealed token has expired.", "expired");
  }
}

export async function sealSession(claims: SessionClaims, secret: string): Promise<string> {
  return seal(SessionClaimsSchema.parse(claims), secret, SESSION_AAD);
}

export async function openSession(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<SessionClaims> {
  const claims = SessionClaimsSchema.parse(await open(token, secret, SESSION_AAD));
  assertNotExpired(claims.expiresAt, now);
  return claims;
}

export async function sealOAuthState(state: OAuthState, secret: string): Promise<string> {
  return seal(OAuthStateSchema.parse(state), secret, OAUTH_STATE_AAD);
}

export async function openOAuthState(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<OAuthState> {
  const state = OAuthStateSchema.parse(await open(token, secret, OAUTH_STATE_AAD));
  assertNotExpired(state.expiresAt, now);
  return state;
}

export function serializeSessionCookie(
  token: string,
  options: { secure: boolean; maxAgeSeconds: number },
): string {
  const parts = [
    `setup_steps_guardian_session=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${options.maxAgeSeconds}`,
  ];
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  return serializeSessionCookie("", { secure, maxAgeSeconds: 0 });
}

function readCookie(cookieHeader: string | null, cookieName: string): string | undefined {
  if (cookieHeader === null) {
    return undefined;
  }

  for (const part of cookieHeader.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name === cookieName) {
      const value = valueParts.join("=");
      return value.length === 0 ? undefined : value;
    }
  }

  return undefined;
}

export function readSessionCookie(cookieHeader: string | null): string | undefined {
  return readCookie(cookieHeader, "setup_steps_guardian_session");
}

export function serializeOAuthStateCookie(
  token: string,
  options: { secure: boolean; maxAgeSeconds: number },
): string {
  const parts = [
    `setup_steps_guardian_oauth_state=${token}`,
    "Path=/api/auth/github/callback",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${options.maxAgeSeconds}`,
  ];
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function clearOAuthStateCookie(secure: boolean): string {
  return serializeOAuthStateCookie("", { secure, maxAgeSeconds: 0 });
}

export function readOAuthStateCookie(cookieHeader: string | null): string | undefined {
  return readCookie(cookieHeader, "setup_steps_guardian_oauth_state");
}
