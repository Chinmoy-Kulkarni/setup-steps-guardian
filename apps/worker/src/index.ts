import { createApiApp } from "./app.js";
import { parseWorkerConfig } from "./config.js";
import { createGitHubRuntime } from "./github-runtime.js";
import { createD1ScanStore, processScanBatch } from "./scan-processor.js";

const api = createApiApp();

export async function handleRequest(
  request: Request,
  env: Env,
  context?: ExecutionContext,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === "/health" || path.startsWith("/api/")) {
    return context === undefined ? api.fetch(request, env) : api.fetch(request, env, context);
  }

  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
  );
  headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=()");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const worker = {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, context);
  },
  scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext): void {
    const run = async (): Promise<void> => {
      const config = parseWorkerConfig(env);
      const github = createGitHubRuntime(config);
      const result = await processScanBatch({
        store: createD1ScanStore(env.DB),
        readerFactory: github.readerFactory,
        failureClassifier: github.failureClassifier,
      });
      console.log(
        JSON.stringify({
          level: "info",
          event: "scan_batch_completed",
          ...result,
        }),
      );
    };

    context.waitUntil(run());
  },
};

export default worker;
