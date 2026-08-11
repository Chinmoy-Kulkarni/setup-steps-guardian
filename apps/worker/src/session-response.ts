import { type SessionResponse, SessionResponseSchema } from "@setup-fleet/contracts";
import { type D1DatabaseLike, listAdministeredAccountIds } from "@setup-fleet/data";
import type { GitHubAuthenticatedUser, GitHubUserInstallation } from "@setup-fleet/github";
import type { SessionClaims } from "./session.js";

export async function buildSessionResponse(input: {
  readonly db: D1DatabaseLike;
  readonly session: SessionClaims;
  readonly user: GitHubAuthenticatedUser;
  readonly installations: readonly GitHubUserInstallation[];
}): Promise<SessionResponse> {
  const administeredAccountIds = new Set(
    await listAdministeredAccountIds(input.db, input.session.githubUserId),
  );
  const accounts = input.installations.map((installation) => ({
    accountId: installation.account.id,
    login: installation.account.name,
    accountType: installation.account.type,
    canManage: administeredAccountIds.has(installation.account.id),
  }));

  return SessionResponseSchema.parse({
    user: {
      id: input.user.id,
      login: input.user.login,
      avatarUrl: input.user.avatarUrl,
    },
    accounts,
    csrfToken: input.session.csrfToken,
  });
}
