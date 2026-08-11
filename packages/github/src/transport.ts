import { Octokit, RequestError } from "octokit";
import type { GitHubHttpMethod } from "./rate-limit.js";

export const GITHUB_API_VERSION = "2026-03-10";

export type GitHubRoute = `${GitHubHttpMethod} ${string}`;

export interface GitHubTransportRequest {
  readonly route: GitHubRoute;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly authorization: string;
}

export interface GitHubTransportResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly data: unknown;
}

export interface GitHubRequestTransport {
  request(request: GitHubTransportRequest): Promise<GitHubTransportResponse>;
}

export interface OctokitRequestTransportOptions {
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
}

function normalizeHeaders(
  headers: Readonly<Record<string, string | number | undefined>>,
): Readonly<Record<string, string>> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) {
      normalized[name.toLowerCase()] = String(value);
    }
  }
  return normalized;
}

export class OctokitRequestTransport implements GitHubRequestTransport {
  readonly #options: OctokitRequestTransportOptions;

  constructor(options: OctokitRequestTransportOptions = {}) {
    if (options.baseUrl !== undefined) {
      let baseUrl: URL;
      try {
        baseUrl = new URL(options.baseUrl);
      } catch (error: unknown) {
        if (error instanceof TypeError) {
          throw new TypeError("GitHub API baseUrl must be an absolute HTTPS URL.");
        }
        throw error;
      }
      if (
        baseUrl.protocol !== "https:" ||
        baseUrl.username.length > 0 ||
        baseUrl.password.length > 0 ||
        baseUrl.search.length > 0 ||
        baseUrl.hash.length > 0
      ) {
        throw new TypeError(
          "GitHub API baseUrl must be HTTPS and must not contain credentials, query, or fragment.",
        );
      }
    }
    this.#options = options;
  }

  async request(request: GitHubTransportRequest): Promise<GitHubTransportResponse> {
    const octokit = new Octokit({
      retry: { enabled: false },
      ...(this.#options.baseUrl === undefined ? {} : { baseUrl: this.#options.baseUrl }),
      ...(this.#options.fetch === undefined ? {} : { request: { fetch: this.#options.fetch } }),
    });

    octokit.hook.before("request", (options) => {
      options.headers.authorization = request.authorization;
      options.headers["x-github-api-version"] = GITHUB_API_VERSION;
    });

    try {
      const response = await octokit.request(request.route, request.parameters);
      return {
        status: response.status,
        headers: normalizeHeaders(response.headers),
        data: response.data as unknown,
      };
    } catch (error: unknown) {
      if (error instanceof RequestError) {
        return {
          status: error.status,
          headers: normalizeHeaders(error.response?.headers ?? {}),
          data: null,
        };
      }
      throw error;
    }
  }
}
