import type { GitHubClient, GitHubRateLimitMetadata } from "@setup-fleet/github";
import { describe, expect, it } from "vitest";
import { authorizeAccount, requireCsrf, requireRepositoryAccess } from "../src/request-auth.js";

const session = {
  githubUserId: "123",
  login: "octocat",
  avatarUrl: "https://avatars.githubusercontent.com/u/123",
  accessToken: "ghu_secret",
  csrfToken: "1234567890123456",
  expiresAt: Date.now() + 60_000,
};
const rateLimit: GitHubRateLimitMetadata = {
  limit: null,
  remaining: null,
  used: null,
  resource: null,
  resetAt: null,
  retryAfterSeconds: null,
  retryAt: null,
  requestId: null,
};

describe("request authorization", () => {
  it("requires the session CSRF token for mutations", () => {
    expect(() =>
      requireCsrf(
        new Request("https://example.com", {
          headers: { "X-CSRF-Token": session.csrfToken },
        }),
        session,
      ),
    ).not.toThrow();
    expect(() => requireCsrf(new Request("https://example.com"), session)).toThrow(
      "could not be verified",
    );
  });

  it("intersects account access with repositories visible to the GitHub user", async () => {
    const client: Pick<
      GitHubClient,
      "getAuthenticatedUserInstallations" | "getAuthenticatedUserInstallationRepositories"
    > = {
      getAuthenticatedUserInstallations: async () => ({
        value: [
          {
            id: "900",
            account: { id: "42", name: "octo-org", type: "Organization" },
            repositorySelection: "selected",
            createdAt: "2026-08-10T22:00:00.000Z",
            updatedAt: "2026-08-10T22:00:00.000Z",
            suspendedAt: null,
          },
        ],
        rateLimit,
      }),
      getAuthenticatedUserInstallationRepositories: async () => ({
        value: [
          {
            id: "1001",
            owner: "octo-org",
            name: "web",
            defaultBranch: "main",
            isPrivate: true,
            isArchived: false,
          },
        ],
        rateLimit,
      }),
    };

    const authorization = await authorizeAccount(client, session, "42");

    expect(() => requireRepositoryAccess(authorization, "1001")).not.toThrow();
    expect(() => requireRepositoryAccess(authorization, "1002")).toThrow(
      "cannot access this repository",
    );
  });
});
