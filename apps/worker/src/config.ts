import { z } from "zod";

const WorkerConfigSchema = z.object({
  appEnvironment: z.enum(["local", "preview", "production"]),
  appVersion: z.string().min(1),
  productBaseUrl: z.string().url(),
  github: z.object({
    appId: z.string().regex(/^\d+$/u),
    appSlug: z.string().min(1),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    privateKeyPkcs8: z
      .string()
      .includes("-----BEGIN PRIVATE KEY-----")
      .includes("-----END PRIVATE KEY-----"),
    webhookSecret: z.string().min(16),
  }),
  sessionSecret: z.string().min(32),
  paddle: z
    .object({
      apiBaseUrl: z.string().url(),
      apiKey: z.string().min(1),
      webhookSecret: z.string().min(16),
      bindingSecret: z.string().min(32),
      teamPriceId: z.string().startsWith("pri_"),
      fleetPriceId: z.string().startsWith("pri_"),
    })
    .refine((paddle) => paddle.teamPriceId !== paddle.fleetPriceId, {
      message: "Paddle Team and Fleet plans must use different price IDs.",
    }),
});

export type WorkerConfig = z.infer<typeof WorkerConfigSchema>;

export function parseWorkerConfig(env: Env): WorkerConfig {
  return WorkerConfigSchema.parse({
    appEnvironment: env.APP_ENV,
    appVersion: env.APP_VERSION,
    productBaseUrl: env.PRODUCT_BASE_URL,
    github: {
      appId: env.GITHUB_APP_ID,
      appSlug: env.GITHUB_APP_SLUG,
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      privateKeyPkcs8: env.GITHUB_PRIVATE_KEY_PKCS8,
      webhookSecret: env.GITHUB_WEBHOOK_SECRET,
    },
    sessionSecret: env.SESSION_SECRET,
    paddle: {
      apiBaseUrl: env.PADDLE_API_BASE_URL,
      apiKey: env.PADDLE_API_KEY,
      webhookSecret: env.PADDLE_WEBHOOK_SECRET,
      bindingSecret: env.PADDLE_BINDING_SECRET,
      teamPriceId: env.PADDLE_TEAM_PRICE_ID,
      fleetPriceId: env.PADDLE_FLEET_PRICE_ID,
    },
  });
}

export function requiresSecureCookies(config: WorkerConfig): boolean {
  return new URL(config.productBaseUrl).protocol === "https:";
}
