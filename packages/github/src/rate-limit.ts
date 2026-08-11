export type GitHubHeaderSource = Headers | Readonly<Record<string, string | number | undefined>>;

export interface GitHubRateLimitMetadata {
  readonly limit: number | null;
  readonly remaining: number | null;
  readonly used: number | null;
  readonly resource: string | null;
  readonly resetAt: string | null;
  readonly retryAfterSeconds: number | null;
  readonly retryAt: string | null;
  readonly requestId: string | null;
}

export type GitHubRetryReason =
  | "primary-rate-limit"
  | "secondary-rate-limit"
  | "transient-server-error";

export type GitHubRetryClassification =
  | {
      readonly retryable: true;
      readonly reason: GitHubRetryReason;
      readonly retryAt: string | null;
    }
  | {
      readonly retryable: false;
      readonly reason: "non-idempotent" | "not-retryable";
    };

export type GitHubHttpMethod = "DELETE" | "GET" | "HEAD" | "OPTIONS" | "PATCH" | "POST" | "PUT";

const httpDatePattern =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

function readHeader(headers: GitHubHeaderSource, name: string): string | null {
  if (headers instanceof Headers) {
    return headers.get(name);
  }

  const normalizedName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedName && value !== undefined) {
      return String(value);
    }
  }
  return null;
}

function parseOptionalIntegerHeader(headers: GitHubHeaderSource, name: string): number | null {
  const value = readHeader(headers, name);
  if (value === null) {
    return null;
  }
  if (!/^\d+$/.test(value)) {
    throw new TypeError(`GitHub response header ${name} must be a non-negative integer.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new TypeError(`GitHub response header ${name} exceeds the safe integer range.`);
  }
  return parsed;
}

function toIsoTimestamp(milliseconds: number, headerName: string): string {
  const date = new Date(milliseconds);
  if (!Number.isFinite(milliseconds) || Number.isNaN(date.getTime())) {
    throw new TypeError(`GitHub response header ${headerName} is not a valid timestamp.`);
  }
  return date.toISOString();
}

function parseRetryAfter(
  headers: GitHubHeaderSource,
  nowMilliseconds: number,
): Pick<GitHubRateLimitMetadata, "retryAfterSeconds" | "retryAt"> {
  const value = readHeader(headers, "retry-after");
  if (value === null) {
    return { retryAfterSeconds: null, retryAt: null };
  }

  if (/^\d+$/.test(value)) {
    const retryAfterSeconds = Number(value);
    if (!Number.isSafeInteger(retryAfterSeconds)) {
      throw new TypeError("GitHub response header retry-after exceeds the safe integer range.");
    }
    return {
      retryAfterSeconds,
      retryAt: toIsoTimestamp(nowMilliseconds + retryAfterSeconds * 1_000, "retry-after"),
    };
  }

  const retryAtMilliseconds = Date.parse(value);
  if (!httpDatePattern.test(value) || !Number.isFinite(retryAtMilliseconds)) {
    throw new TypeError("GitHub response header retry-after must contain seconds or an HTTP date.");
  }

  return {
    retryAfterSeconds: Math.max(0, Math.ceil((retryAtMilliseconds - nowMilliseconds) / 1_000)),
    retryAt: toIsoTimestamp(retryAtMilliseconds, "retry-after"),
  };
}

export function extractGitHubRateLimitMetadata(
  headers: GitHubHeaderSource,
  nowMilliseconds = Date.now(),
): GitHubRateLimitMetadata {
  if (!Number.isFinite(nowMilliseconds)) {
    throw new TypeError("The current time must be a finite millisecond timestamp.");
  }

  const resetEpochSeconds = parseOptionalIntegerHeader(headers, "x-ratelimit-reset");
  const resource = readHeader(headers, "x-ratelimit-resource");
  if (resource !== null && resource.length === 0) {
    throw new TypeError("GitHub response header x-ratelimit-resource must not be empty.");
  }

  const retry = parseRetryAfter(headers, nowMilliseconds);
  return {
    limit: parseOptionalIntegerHeader(headers, "x-ratelimit-limit"),
    remaining: parseOptionalIntegerHeader(headers, "x-ratelimit-remaining"),
    used: parseOptionalIntegerHeader(headers, "x-ratelimit-used"),
    resource,
    resetAt:
      resetEpochSeconds === null
        ? null
        : toIsoTimestamp(resetEpochSeconds * 1_000, "x-ratelimit-reset"),
    retryAfterSeconds: retry.retryAfterSeconds,
    retryAt: retry.retryAt,
    requestId: readHeader(headers, "x-github-request-id"),
  };
}

function isIdempotent(method: GitHubHttpMethod): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

export function classifyGitHubRetry(
  method: GitHubHttpMethod,
  status: number,
  rateLimit: GitHubRateLimitMetadata,
): GitHubRetryClassification {
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new TypeError("HTTP status must be an integer between 100 and 599.");
  }
  if (!isIdempotent(method)) {
    return { retryable: false, reason: "non-idempotent" };
  }

  if (status === 403 && rateLimit.remaining === 0) {
    return {
      retryable: true,
      reason: "primary-rate-limit",
      retryAt: rateLimit.resetAt,
    };
  }
  if (status === 429 || (status === 403 && rateLimit.retryAt !== null)) {
    return {
      retryable: true,
      reason: "secondary-rate-limit",
      retryAt: rateLimit.retryAt ?? rateLimit.resetAt,
    };
  }
  if (status === 408 || status === 500 || status === 502 || status === 503 || status === 504) {
    return {
      retryable: true,
      reason: "transient-server-error",
      retryAt: rateLimit.retryAt,
    };
  }

  return { retryable: false, reason: "not-retryable" };
}
