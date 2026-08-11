import type { GitHubRateLimitMetadata, GitHubRetryClassification } from "./rate-limit.js";

export class WebhookPayloadError extends Error {
  readonly eventName: string;
  readonly path: string;

  constructor(eventName: string, path: string, detail: string) {
    super(`Invalid ${eventName} webhook payload at ${path}: ${detail}`);
    this.name = "WebhookPayloadError";
    this.eventName = eventName;
    this.path = path;
  }
}

export class MalformedGitHubResponseError extends Error {
  readonly path: string;

  constructor(path: string, detail: string) {
    super(`Malformed GitHub API response at ${path}: ${detail}`);
    this.name = "MalformedGitHubResponseError";
    this.path = path;
  }
}

export type GitHubResource =
  | "file"
  | "installation"
  | "installation repositories"
  | "repository"
  | "user"
  | "user installations"
  | "user installation repositories"
  | "workflow"
  | "workflow run"
  | "workflow run diagnostics";

export class GitHubNotFoundError extends Error {
  readonly status = 404;
  readonly resource: GitHubResource;
  readonly rateLimit: GitHubRateLimitMetadata;

  constructor(resource: GitHubResource, rateLimit: GitHubRateLimitMetadata) {
    super(`GitHub ${resource} was not found.`);
    this.name = "GitHubNotFoundError";
    this.resource = resource;
    this.rateLimit = rateLimit;
  }
}

export class GitHubApiError extends Error {
  readonly status: number;
  readonly rateLimit: GitHubRateLimitMetadata;
  readonly retry: GitHubRetryClassification;

  constructor(
    status: number,
    rateLimit: GitHubRateLimitMetadata,
    retry: GitHubRetryClassification,
  ) {
    super(`GitHub API request failed with status ${status}.`);
    this.name = "GitHubApiError";
    this.status = status;
    this.rateLimit = rateLimit;
    this.retry = retry;
  }
}

export class GitHubAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubAuthorizationError";
  }
}

export type GitHubOAuthErrorCode =
  | "access_denied"
  | "bad_verification_code"
  | "http_error"
  | "incorrect_client_credentials"
  | "malformed_callback"
  | "malformed_response"
  | "provider_error"
  | "redirect_uri_mismatch"
  | "state_mismatch"
  | "unverified_user_email";

const oauthErrorMessages: Readonly<Record<GitHubOAuthErrorCode, string>> = {
  access_denied: "GitHub user authorization was denied.",
  bad_verification_code: "GitHub rejected the expired or invalid authorization code.",
  http_error: "GitHub user token exchange failed.",
  incorrect_client_credentials: "GitHub rejected the App client credentials.",
  malformed_callback: "GitHub authorization callback is missing a valid code.",
  malformed_response: "GitHub user token response is malformed.",
  provider_error: "GitHub returned an unrecognized OAuth provider error.",
  redirect_uri_mismatch: "GitHub rejected the OAuth callback URL.",
  state_mismatch: "GitHub authorization callback state did not match.",
  unverified_user_email: "GitHub requires the user to verify their primary email address.",
};

export class GitHubOAuthError extends Error {
  readonly code: GitHubOAuthErrorCode;
  readonly status: number | null;

  constructor(code: GitHubOAuthErrorCode, status: number | null = null) {
    super(oauthErrorMessages[code]);
    this.name = "GitHubOAuthError";
    this.code = code;
    this.status = status;
  }
}
