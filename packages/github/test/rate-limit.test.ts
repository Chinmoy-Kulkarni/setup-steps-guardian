import { describe, expect, it } from "vitest";
import { classifyGitHubRetry, extractGitHubRateLimitMetadata } from "../src/rate-limit.js";

const NOW = Date.parse("2026-08-10T23:27:02.000Z");

describe("GitHub rate-limit metadata", () => {
  it("normalizes primary rate-limit and retry headers", () => {
    const metadata = extractGitHubRateLimitMetadata(
      {
        "X-RateLimit-Limit": "5,000".replace(",", ""),
        "x-ratelimit-remaining": "0",
        "x-ratelimit-used": "5000",
        "x-ratelimit-resource": "core",
        "x-ratelimit-reset": String(Math.floor(NOW / 1_000) + 60),
        "retry-after": "15",
        "x-github-request-id": "request-123",
      },
      NOW,
    );

    expect(metadata).toEqual({
      limit: 5_000,
      remaining: 0,
      used: 5_000,
      resource: "core",
      resetAt: "2026-08-10T23:28:02.000Z",
      retryAfterSeconds: 15,
      retryAt: "2026-08-10T23:27:17.000Z",
      requestId: "request-123",
    });
    expect(classifyGitHubRetry("GET", 403, metadata)).toEqual({
      retryable: true,
      reason: "primary-rate-limit",
      retryAt: "2026-08-10T23:28:02.000Z",
    });
  });

  it("parses HTTP-date retry-after values", () => {
    const metadata = extractGitHubRateLimitMetadata(
      { "retry-after": "Mon, 10 Aug 2026 23:27:32 GMT" },
      NOW,
    );

    expect(metadata.retryAfterSeconds).toBe(30);
    expect(classifyGitHubRetry("GET", 429, metadata)).toEqual({
      retryable: true,
      reason: "secondary-rate-limit",
      retryAt: "2026-08-10T23:27:32.000Z",
    });
  });

  it("classifies transient reads but never retries non-idempotent requests", () => {
    const metadata = extractGitHubRateLimitMetadata({}, NOW);

    expect(classifyGitHubRetry("GET", 503, metadata)).toEqual({
      retryable: true,
      reason: "transient-server-error",
      retryAt: null,
    });
    expect(classifyGitHubRetry("POST", 429, metadata)).toEqual({
      retryable: false,
      reason: "non-idempotent",
    });
  });

  it("rejects malformed rate-limit headers explicitly", () => {
    expect(() => extractGitHubRateLimitMetadata({ "x-ratelimit-remaining": "many" }, NOW)).toThrow(
      "must be a non-negative integer",
    );
    expect(() => extractGitHubRateLimitMetadata({ "retry-after": "eventually" }, NOW)).toThrow(
      "seconds or an HTTP date",
    );
  });
});
