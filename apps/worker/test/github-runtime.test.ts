import {
  GitHubApiError,
  GitHubAuthorizationError,
  type GitHubRateLimitMetadata,
} from "@setup-fleet/github";
import { describe, expect, it } from "vitest";
import { githubScanFailureClassifier, mapGitHubWorkflowConclusion } from "../src/github-runtime.js";

const rateLimit: GitHubRateLimitMetadata = {
  limit: 5_000,
  remaining: 0,
  used: 5_000,
  resource: "core",
  resetAt: "2026-08-10T23:00:00.000Z",
  retryAfterSeconds: null,
  retryAt: null,
  requestId: "request",
};

describe("GitHub Worker runtime", () => {
  it("maps GitHub's stale conclusion to a contract failure conclusion", () => {
    expect(mapGitHubWorkflowConclusion("stale")).toBe("cancelled");
    expect(mapGitHubWorkflowConclusion("success")).toBe("success");
  });

  it("retries rate limits but fails revoked authorization immediately", () => {
    expect(
      githubScanFailureClassifier.classify(
        new GitHubApiError(403, rateLimit, {
          retryable: true,
          reason: "primary-rate-limit",
          retryAt: rateLimit.resetAt,
        }),
      ),
    ).toMatchObject({
      code: "GITHUB_RATE_LIMITED",
      retryable: true,
    });
    expect(
      githubScanFailureClassifier.classify(
        new GitHubAuthorizationError("Installation was revoked."),
      ),
    ).toEqual({
      code: "GITHUB_AUTHORIZATION",
      retryable: false,
    });
  });
});
