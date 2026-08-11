import { type D1DatabaseLike, isAccountAdministrator } from "@setup-fleet/data";
import type { GitHubClient, GitHubUserInstallation } from "@setup-fleet/github";
import { ZodError } from "zod";
import type { WorkerConfig } from "./config.js";
import { HttpError } from "./http-error.js";
import { openSession, readSessionCookie, SealedTokenError, type SessionClaims } from "./session.js";

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export async function requireSession(
  request: Request,
  config: WorkerConfig,
): Promise<SessionClaims> {
  const token = readSessionCookie(request.headers.get("Cookie"));
  if (token === undefined) {
    throw new HttpError(401, "AUTHENTICATION_REQUIRED", "Sign in with GitHub to continue.");
  }

  try {
    return await openSession(token, config.sessionSecret);
  } catch (error) {
    if (error instanceof SealedTokenError || error instanceof ZodError) {
      throw new HttpError(
        401,
        "SESSION_INVALID",
        "The session is invalid or expired. Sign in again.",
      );
    }
    throw error;
  }
}

export function requireCsrf(request: Request, session: SessionClaims): void {
  const candidate = request.headers.get("X-CSRF-Token");
  if (candidate === null || !constantTimeEqual(candidate, session.csrfToken)) {
    throw new HttpError(403, "CSRF_INVALID", "The request could not be verified.");
  }
}

export interface AuthorizedAccount {
  readonly installation: GitHubUserInstallation;
  readonly repositoryIds: ReadonlySet<string>;
}

export async function authorizeAccount(
  client: Pick<
    GitHubClient,
    "getAuthenticatedUserInstallations" | "getAuthenticatedUserInstallationRepositories"
  >,
  session: SessionClaims,
  accountId: string,
): Promise<AuthorizedAccount> {
  const installations = (await client.getAuthenticatedUserInstallations(session.accessToken)).value;
  const installation = installations.find((candidate) => candidate.account.id === accountId);
  if (installation === undefined) {
    throw new HttpError(
      403,
      "ACCOUNT_ACCESS_DENIED",
      "The GitHub account is not available to this session.",
    );
  }
  if (installation.suspendedAt !== null) {
    throw new HttpError(409, "INSTALLATION_SUSPENDED", "The GitHub App installation is suspended.");
  }

  const repositories = (
    await client.getAuthenticatedUserInstallationRepositories(session.accessToken, installation.id)
  ).value;

  return {
    installation,
    repositoryIds: new Set(repositories.map((repository) => repository.id)),
  };
}

export function requireRepositoryAccess(
  authorization: AuthorizedAccount,
  repositoryId: string,
): void {
  if (!authorization.repositoryIds.has(repositoryId)) {
    throw new HttpError(
      403,
      "REPOSITORY_ACCESS_DENIED",
      "Your GitHub user cannot access this repository through the installation.",
    );
  }
}

export async function requireAccountAdministrator(
  db: D1DatabaseLike,
  session: SessionClaims,
  accountId: string,
): Promise<void> {
  if (!(await isAccountAdministrator(db, accountId, session.githubUserId))) {
    throw new HttpError(
      403,
      "ACCOUNT_ADMIN_REQUIRED",
      "Only the GitHub user who installed the App can manage billing or retained account data.",
    );
  }
}
