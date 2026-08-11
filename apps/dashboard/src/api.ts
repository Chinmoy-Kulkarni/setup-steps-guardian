import {
  CheckoutResponseSchema,
  type FleetSummary,
  FleetSummarySchema,
  type HealthResponse,
  HealthResponseSchema,
  type RepositoryDetail,
  RepositoryDetailSchema,
  type SessionResponse,
  SessionResponseSchema,
} from "@setup-fleet/contracts";

export type ApiErrorKind = "http" | "invalid-response" | "network";

export interface ApiRequestOptions {
  signal?: AbortSignal;
}

interface JsonRequestOptions extends ApiRequestOptions {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  csrfToken?: string;
}

interface RuntimeSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown };
}

interface ApiErrorOptions {
  kind: ApiErrorKind;
  status?: number;
  cause?: unknown;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | undefined;

  constructor(message: string, options: ApiErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ApiError";
    this.kind = options.kind;
    this.status = options.status;
  }
}

export function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return false;
  }

  return (error as { name?: unknown }).name === "AbortError";
}

async function requestJson<T>(
  endpoint: string,
  schema: RuntimeSchema<T>,
  options: JsonRequestOptions,
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(endpoint, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(options.csrfToken === undefined ? {} : { "X-CSRF-Token": options.csrfToken }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    throw new ApiError("The API could not be reached.", {
      kind: "network",
      cause: error,
    });
  }

  if (!response.ok) {
    throw new ApiError(`The API request failed with status ${response.status}.`, {
      kind: "http",
      status: response.status,
    });
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch (error) {
    throw new ApiError("The API returned unreadable JSON.", {
      kind: "invalid-response",
      cause: error,
    });
  }

  const result = schema.safeParse(payload);

  if (!result.success) {
    throw new ApiError("The API response did not match the expected contract.", {
      kind: "invalid-response",
      cause: result.error,
    });
  }

  return result.data;
}

async function requestEmpty(endpoint: string, options: JsonRequestOptions): Promise<void> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: options.method ?? "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(options.csrfToken === undefined ? {} : { "X-CSRF-Token": options.csrfToken }),
      },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw new ApiError("The API could not be reached.", {
      kind: "network",
      cause: error,
    });
  }

  if (!response.ok) {
    throw new ApiError(`The API request failed with status ${response.status}.`, {
      kind: "http",
      status: response.status,
    });
  }
}

export function getSession(options: ApiRequestOptions = {}): Promise<SessionResponse> {
  return requestJson("/api/session", SessionResponseSchema, options);
}

export function getFleet(
  accountId: string,
  options: ApiRequestOptions = {},
): Promise<FleetSummary> {
  return requestJson(
    `/api/accounts/${encodeURIComponent(accountId)}/fleet`,
    FleetSummarySchema,
    options,
  );
}

export function getRepositoryDetail(
  accountId: string,
  repositoryId: string,
  options: ApiRequestOptions = {},
): Promise<RepositoryDetail> {
  return requestJson(
    `/api/accounts/${encodeURIComponent(accountId)}/repositories/${encodeURIComponent(
      repositoryId,
    )}`,
    RepositoryDetailSchema,
    options,
  );
}

export function requestRepositoryScan(
  accountId: string,
  repositoryId: string,
  csrfToken: string,
): Promise<{ accepted: boolean; created: boolean }> {
  return requestJson(
    `/api/accounts/${encodeURIComponent(accountId)}/repositories/${encodeURIComponent(
      repositoryId,
    )}/scan`,
    {
      safeParse(value: unknown) {
        if (
          value !== null &&
          typeof value === "object" &&
          "accepted" in value &&
          typeof value.accepted === "boolean" &&
          "created" in value &&
          typeof value.created === "boolean"
        ) {
          return {
            success: true as const,
            data: { accepted: value.accepted, created: value.created },
          };
        }
        return { success: false as const, error: value };
      },
    },
    { method: "POST", csrfToken },
  );
}

export function createCheckout(
  accountId: string,
  plan: "team" | "fleet",
  csrfToken: string,
): Promise<{ transactionId: string; checkoutUrl: string }> {
  return requestJson(
    `/api/accounts/${encodeURIComponent(accountId)}/checkout`,
    CheckoutResponseSchema,
    {
      method: "POST",
      csrfToken,
      body: { accountId, plan },
    },
  );
}

export function logout(csrfToken: string): Promise<void> {
  return requestEmpty("/api/auth/logout", {
    method: "POST",
    csrfToken,
  });
}

export function deleteAccount(accountId: string, csrfToken: string): Promise<void> {
  return requestEmpty(`/api/accounts/${encodeURIComponent(accountId)}`, {
    method: "DELETE",
    csrfToken,
  });
}

export function getHealth(options: ApiRequestOptions = {}): Promise<HealthResponse> {
  return requestJson("/api/health", HealthResponseSchema, options);
}
