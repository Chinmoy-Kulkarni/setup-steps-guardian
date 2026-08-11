import {
  CheckoutRequestSchema,
  CheckoutResponseSchema,
  type FleetSummary,
  FleetSummarySchema,
  HealthResponseSchema,
} from "@setup-fleet/contracts";
import {
  deleteAccount,
  enqueueScanJob,
  getFleetSummary,
  getGitHubAccount,
  getRepository,
  getRepositoryDetails,
  getSubscriptionEntitlement,
} from "@setup-fleet/data";
import {
  GitHubApiError,
  GitHubOAuthError,
  parseWebhookJson,
  verifyWebhookSignature,
  WebhookPayloadError,
} from "@setup-fleet/github";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { ZodError } from "zod";
import { applyPaddleSubscriptionUpdate, priceIdForPlan } from "./billing-service.js";
import { parseWorkerConfig, requiresSecureCookies, type WorkerConfig } from "./config.js";
import { asDataDatabase } from "./data-adapter.js";
import {
  beginGitHubAuthorization,
  completeGitHubAuthorization,
  type GitHubAuthConfig,
} from "./github-auth-service.js";
import { createGitHubRuntime } from "./github-runtime.js";
import { processGitHubWebhook, UnknownInstallationError } from "./github-webhook-service.js";
import { HttpError } from "./http-error.js";
import {
  cancelPaddleSubscription,
  createPaddleCheckout,
  createPaddleSubscriptionBinding,
  PaddleApiError,
  PaddleBindingError,
  PaddlePayloadError,
  PaddleSignatureError,
  parseSubscriptionUpdate,
  verifyPaddleWebhook,
} from "./paddle.js";
import { reconcileRepositoryEntitlements } from "./repository-entitlements.js";
import { repositoryDetail } from "./repository-view.js";
import {
  authorizeAccount,
  requireAccountAdministrator,
  requireCsrf,
  requireRepositoryAccess,
  requireSession,
} from "./request-auth.js";
import { enqueueEligibleAccountScans } from "./scan-enqueue.js";
import {
  clearOAuthStateCookie,
  clearSessionCookie,
  readOAuthStateCookie,
  SealedTokenError,
} from "./session.js";
import { buildSessionResponse } from "./session-response.js";

const GITHUB_WEBHOOK_BODY_LIMIT = 2 * 1024 * 1024;
const PADDLE_WEBHOOK_BODY_LIMIT = 256 * 1024;
const JSON_BODY_LIMIT = 16 * 1024;

function githubAuthConfig(config: WorkerConfig): GitHubAuthConfig {
  return {
    appUrl: config.productBaseUrl,
    clientId: config.github.clientId,
    clientSecret: config.github.clientSecret,
    callbackUrl: new URL("/api/auth/github/callback", config.productBaseUrl).toString(),
    sessionSecret: config.sessionSecret,
  };
}

function parseNumericId(value: string, name: string): string {
  if (!/^\d+$/.test(value)) {
    throw new HttpError(422, "INVALID_IDENTIFIER", `${name} must be a numeric GitHub ID.`);
  }
  return value;
}

function restrictFleetSummary(
  summary: FleetSummary,
  repositoryIds: ReadonlySet<string>,
): FleetSummary {
  const repositories = summary.repositories.filter((repository) =>
    repositoryIds.has(repository.repositoryId),
  );
  const passing = repositories.filter((repository) => repository.status === "passing").length;

  return FleetSummarySchema.parse({
    ...summary,
    repositories,
    totals: {
      selected: repositories.length,
      passing,
      attention: repositories.length - passing,
    },
  });
}

async function readRawBody(request: Request, limit: number): Promise<string> {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new HttpError(422, "INVALID_CONTENT_LENGTH", "Content-Length is invalid.");
    }
    if (parsed > limit) {
      throw new HttpError(422, "PAYLOAD_TOO_LARGE", "The request payload is too large.");
    }
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > limit) {
    throw new HttpError(422, "PAYLOAD_TOO_LARGE", "The request payload is too large.");
  }
  return body;
}

async function readJson(request: Request): Promise<unknown> {
  const rawBody = await readRawBody(request, JSON_BODY_LIMIT);
  try {
    return JSON.parse(rawBody) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new HttpError(422, "INVALID_JSON", "The request body is not valid JSON.");
    }
    throw error;
  }
}

export function createApiApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.use("*", requestId());
  app.use("*", async (context, next) => {
    await next();
    context.header("Cache-Control", "no-store");
  });
  app.use(
    "*",
    secureHeaders({
      strictTransportSecurity: "max-age=31536000; includeSubDomains",
      xFrameOptions: "DENY",
      xXssProtection: false,
    }),
  );

  const healthHandler = (environment: Env) => {
    try {
      const config = parseWorkerConfig(environment);
      return {
        payload: HealthResponseSchema.parse({
          status: "ok",
          version: config.appVersion,
          timestamp: new Date().toISOString(),
        }),
        status: 200 as const,
      };
    } catch (error) {
      if (!(error instanceof ZodError)) {
        throw error;
      }

      return {
        payload: HealthResponseSchema.parse({
          status: "degraded",
          version: environment.APP_VERSION || "unknown",
          timestamp: new Date().toISOString(),
        }),
        status: 503 as const,
      };
    }
  };

  app.get("/health", (context) => {
    const health = healthHandler(context.env);
    return context.json(health.payload, health.status);
  });
  app.get("/api/health", (context) => {
    const health = healthHandler(context.env);
    return context.json(health.payload, health.status);
  });

  app.get("/api/auth/github", async (context) => {
    const config = parseWorkerConfig(context.env);
    const authorization = await beginGitHubAuthorization(
      githubAuthConfig(config),
      context.req.query("return_to") ?? null,
    );
    context.header("Set-Cookie", authorization.stateCookie);
    return context.redirect(authorization.authorizationUrl, 302);
  });

  app.get("/api/auth/github/callback", async (context) => {
    const config = parseWorkerConfig(context.env);
    const secure = requiresSecureCookies(config);
    const sealedState = readOAuthStateCookie(context.req.raw.headers.get("Cookie"));
    if (sealedState === undefined) {
      context.header("Set-Cookie", clearOAuthStateCookie(secure));
      throw new HttpError(400, "OAUTH_STATE_MISSING", "The GitHub authorization state is missing.");
    }

    try {
      const runtime = createGitHubRuntime(config);
      const authorization = await completeGitHubAuthorization({
        config: githubAuthConfig(config),
        callbackUrl: context.req.url,
        sealedState,
        client: runtime.client,
      });
      context.header("Set-Cookie", authorization.sessionCookie, { append: true });
      context.header("Set-Cookie", clearOAuthStateCookie(secure), {
        append: true,
      });
      return context.redirect(authorization.redirectTo, 302);
    } catch (error) {
      context.header("Set-Cookie", clearOAuthStateCookie(secure));
      if (
        error instanceof GitHubOAuthError ||
        error instanceof SealedTokenError ||
        error instanceof ZodError
      ) {
        throw new HttpError(
          422,
          "GITHUB_AUTHORIZATION_FAILED",
          "GitHub authorization could not be completed. Start again.",
        );
      }
      throw error;
    }
  });

  app.post("/api/auth/logout", async (context) => {
    const config = parseWorkerConfig(context.env);
    const session = await requireSession(context.req.raw, config);
    requireCsrf(context.req.raw, session);
    context.header("Set-Cookie", clearSessionCookie(requiresSecureCookies(config)));
    return context.body(null, 204);
  });

  app.get("/api/session", async (context) => {
    const config = parseWorkerConfig(context.env);
    const session = await requireSession(context.req.raw, config);
    const runtime = createGitHubRuntime(config);
    const [user, installations] = await Promise.all([
      runtime.client.getAuthenticatedUser(session.accessToken),
      runtime.client.getAuthenticatedUserInstallations(session.accessToken),
    ]);
    return context.json(
      await buildSessionResponse({
        db: asDataDatabase(context.env.DB),
        session,
        user: user.value,
        installations: installations.value,
      }),
    );
  });

  app.get("/api/accounts/:accountId/fleet", async (context) => {
    const config = parseWorkerConfig(context.env);
    const accountId = parseNumericId(context.req.param("accountId"), "accountId");
    const session = await requireSession(context.req.raw, config);
    const runtime = createGitHubRuntime(config);
    const authorization = await authorizeAccount(runtime.client, session, accountId);
    const fleet = await getFleetSummary(asDataDatabase(context.env.DB), accountId);
    return context.json(restrictFleetSummary(fleet, authorization.repositoryIds));
  });

  app.get("/api/accounts/:accountId/repositories/:repositoryId", async (context) => {
    const config = parseWorkerConfig(context.env);
    const accountId = parseNumericId(context.req.param("accountId"), "accountId");
    const repositoryId = parseNumericId(context.req.param("repositoryId"), "repositoryId");
    const session = await requireSession(context.req.raw, config);
    const runtime = createGitHubRuntime(config);
    const authorization = await authorizeAccount(runtime.client, session, accountId);
    requireRepositoryAccess(authorization, repositoryId);
    const details = await getRepositoryDetails(
      asDataDatabase(context.env.DB),
      accountId,
      repositoryId,
    );
    if (details === null) {
      throw new HttpError(404, "REPOSITORY_NOT_FOUND", "The selected repository was not found.");
    }
    return context.json(repositoryDetail(details));
  });

  app.post("/api/accounts/:accountId/repositories/:repositoryId/scan", async (context) => {
    const config = parseWorkerConfig(context.env);
    const accountId = parseNumericId(context.req.param("accountId"), "accountId");
    const repositoryId = parseNumericId(context.req.param("repositoryId"), "repositoryId");
    const session = await requireSession(context.req.raw, config);
    requireCsrf(context.req.raw, session);
    const runtime = createGitHubRuntime(config);
    const authorization = await authorizeAccount(runtime.client, session, accountId);
    requireRepositoryAccess(authorization, repositoryId);
    const db = asDataDatabase(context.env.DB);
    const repository = await getRepository(db, accountId, repositoryId);
    if (repository === null) {
      throw new HttpError(404, "REPOSITORY_NOT_FOUND", "The selected repository was not found.");
    }
    if (!repository.scanEnabled) {
      throw new HttpError(
        409,
        "REPOSITORY_LIMIT_REACHED",
        "Upgrade the account plan before scanning this private repository.",
      );
    }
    const now = new Date();
    const result = await enqueueScanJob(db, {
      accountId,
      jobId: crypto.randomUUID(),
      repositoryId,
      reason: "manual",
      dedupeKey: `manual:${session.githubUserId}:${repositoryId}:${Math.floor(
        now.getTime() / 60_000,
      )}`,
      priority: 100,
      availableAt: now.toISOString(),
      createdAt: now.toISOString(),
    });
    return context.json({ accepted: true, created: result.created }, 202);
  });

  app.post("/api/accounts/:accountId/checkout", async (context) => {
    const config = parseWorkerConfig(context.env);
    const accountId = parseNumericId(context.req.param("accountId"), "accountId");
    const session = await requireSession(context.req.raw, config);
    requireCsrf(context.req.raw, session);
    const runtime = createGitHubRuntime(config);
    await authorizeAccount(runtime.client, session, accountId);
    const db = asDataDatabase(context.env.DB);
    await requireAccountAdministrator(db, session, accountId);

    const parsed = CheckoutRequestSchema.safeParse(await readJson(context.req.raw));
    if (!parsed.success) {
      throw new HttpError(422, "INVALID_CHECKOUT_REQUEST", "The checkout request is invalid.");
    }
    if (parsed.data.accountId !== accountId) {
      throw new HttpError(
        403,
        "ACCOUNT_ACCESS_DENIED",
        "The checkout account does not match the authorized account.",
      );
    }
    const priceId = priceIdForPlan(parsed.data.plan, {
      team: config.paddle.teamPriceId,
      fleet: config.paddle.fleetPriceId,
    });
    const checkout = await createPaddleCheckout({
      apiBaseUrl: config.paddle.apiBaseUrl,
      apiKey: config.paddle.apiKey,
      priceId,
      githubAccountId: accountId,
      plan: parsed.data.plan,
      binding: await createPaddleSubscriptionBinding({
        githubAccountId: accountId,
        plan: parsed.data.plan,
        priceId,
        secret: config.paddle.bindingSecret,
      }),
    });
    return context.json(CheckoutResponseSchema.parse(checkout));
  });

  app.delete("/api/accounts/:accountId", async (context) => {
    const config = parseWorkerConfig(context.env);
    const accountId = parseNumericId(context.req.param("accountId"), "accountId");
    const session = await requireSession(context.req.raw, config);
    requireCsrf(context.req.raw, session);
    const runtime = createGitHubRuntime(config);
    await authorizeAccount(runtime.client, session, accountId);
    const db = asDataDatabase(context.env.DB);
    await requireAccountAdministrator(db, session, accountId);
    const subscription = await getSubscriptionEntitlement(db, accountId);
    if (
      subscription?.source === "paddle" &&
      subscription.providerSubscriptionId !== null &&
      subscription.status !== "inactive"
    ) {
      await cancelPaddleSubscription({
        apiBaseUrl: config.paddle.apiBaseUrl,
        apiKey: config.paddle.apiKey,
        subscriptionId: subscription.providerSubscriptionId,
      });
    }
    await deleteAccount(db, accountId);
    return context.body(null, 204);
  });

  app.post("/api/webhooks/github", async (context) => {
    const config = parseWorkerConfig(context.env);
    const rawBody = await readRawBody(context.req.raw, GITHUB_WEBHOOK_BODY_LIMIT);
    const signatureValid = await verifyWebhookSignature(
      config.github.webhookSecret,
      rawBody,
      context.req.header("X-Hub-Signature-256") ?? null,
    );
    if (!signatureValid) {
      throw new HttpError(
        401,
        "GITHUB_SIGNATURE_INVALID",
        "The GitHub webhook signature is invalid.",
      );
    }
    const eventName = context.req.header("X-GitHub-Event");
    const deliveryId = context.req.header("X-GitHub-Delivery");
    if (
      eventName === undefined ||
      eventName.length > 64 ||
      deliveryId === undefined ||
      !/^[A-Za-z0-9-]{1,100}$/.test(deliveryId)
    ) {
      throw new HttpError(
        422,
        "GITHUB_HEADERS_INVALID",
        "Required GitHub webhook headers are missing or invalid.",
      );
    }

    const event = parseWebhookJson(eventName, rawBody);
    const runtime = createGitHubRuntime(config);
    const outcome = await processGitHubWebhook({
      db: asDataDatabase(context.env.DB),
      eventName,
      deliveryId,
      event,
      repositoryHydrator: runtime.repositoryHydrator,
      now: new Date(),
    });
    return context.json({ accepted: true, duplicate: outcome === "duplicate" }, 202);
  });

  app.post("/api/webhooks/paddle", async (context) => {
    const config = parseWorkerConfig(context.env);
    const rawBody = await readRawBody(context.req.raw, PADDLE_WEBHOOK_BODY_LIMIT);
    await verifyPaddleWebhook(
      rawBody,
      context.req.header("Paddle-Signature") ?? null,
      config.paddle.webhookSecret,
    );
    const update = await parseSubscriptionUpdate(rawBody, {
      bindingSecret: config.paddle.bindingSecret,
      teamPriceId: config.paddle.teamPriceId,
      fleetPriceId: config.paddle.fleetPriceId,
    });
    if (update === undefined) {
      return context.json({ accepted: true }, 202);
    }

    const db = asDataDatabase(context.env.DB);
    if ((await getGitHubAccount(db, update.githubAccountId)) === null) {
      return context.json({ accepted: true, accountDeleted: true }, 202);
    }
    const result = await applyPaddleSubscriptionUpdate(context.env.DB, update);
    await reconcileRepositoryEntitlements(db, update.githubAccountId, update.occurredAt);
    await enqueueEligibleAccountScans({
      db,
      accountId: update.githubAccountId,
      dedupePrefix: `paddle:${update.eventId}`,
      reason: "webhook",
      priority: 50,
      now: update.occurredAt,
    });
    return context.json({ accepted: true, outcome: result.outcome }, 202);
  });

  app.notFound((context) =>
    context.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "The requested API route does not exist.",
        },
      },
      404,
    ),
  );

  app.onError((error, context) => {
    if (error instanceof HttpError) {
      return context.json(
        {
          error: {
            code: error.code,
            message: error.message,
          },
        },
        error.status,
      );
    }

    if (error instanceof PaddleSignatureError) {
      return context.json(
        {
          error: {
            code: "PADDLE_SIGNATURE_INVALID",
            message: "The Paddle webhook signature is invalid.",
          },
        },
        401,
      );
    }
    if (error instanceof PaddleBindingError) {
      return context.json(
        {
          error: {
            code: "PADDLE_BINDING_INVALID",
            message: "The Paddle entitlement binding is invalid.",
          },
        },
        401,
      );
    }
    if (error instanceof PaddlePayloadError) {
      return context.json(
        {
          error: {
            code: "PADDLE_PAYLOAD_INVALID",
            message: "The Paddle webhook payload is invalid.",
          },
        },
        422,
      );
    }
    if (error instanceof WebhookPayloadError) {
      return context.json(
        {
          error: {
            code: "WEBHOOK_PAYLOAD_INVALID",
            message: "The webhook payload is invalid.",
          },
        },
        422,
      );
    }
    if (error instanceof UnknownInstallationError) {
      return context.json(
        {
          error: {
            code: "INSTALLATION_NOT_READY",
            message: "The GitHub installation is not ready. Retry the delivery.",
          },
        },
        503,
      );
    }
    if (error instanceof GitHubApiError) {
      const status = error.status === 401 ? 401 : error.retry.retryable ? 503 : 502;
      return context.json(
        {
          error: {
            code:
              status === 401
                ? "SESSION_INVALID"
                : error.retry.retryable
                  ? "GITHUB_UNAVAILABLE"
                  : "GITHUB_REQUEST_FAILED",
            message:
              status === 401
                ? "The GitHub session has expired. Sign in again."
                : "GitHub could not complete the request.",
          },
        },
        status,
      );
    }
    if (error instanceof PaddleApiError) {
      return context.json(
        {
          error: {
            code: "BILLING_PROVIDER_ERROR",
            message: "The billing provider could not complete the request.",
          },
        },
        502,
      );
    }

    console.error(
      JSON.stringify({
        level: "error",
        event: "request_failed",
        requestId: context.get("requestId"),
        errorName: error.name,
      }),
    );

    return context.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "The request could not be completed.",
        },
      },
      500,
    );
  });

  return app;
}
