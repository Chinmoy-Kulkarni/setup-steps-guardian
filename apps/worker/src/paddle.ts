import { z } from "zod";
import { constantTimeEqual } from "./encoding.js";

const PaddleSubscriptionDataSchema = z.object({
  id: z.string().min(1),
  customer_id: z.string().min(1),
  status: z.string().min(1),
  items: z
    .array(
      z.object({
        quantity: z.number().int().positive(),
        price: z.object({
          id: z.string().startsWith("pri_"),
        }),
      }),
    )
    .min(1),
  custom_data: z.unknown(),
});

const PaddleSubscriptionCustomDataSchema = z.object({
  github_account_id: z.string().min(1),
  plan: z.enum(["team", "fleet"]),
  binding: z.string().regex(/^[a-f0-9]{64}$/),
});

const PaddleWebhookSchema = z.object({
  event_id: z.string().min(1),
  event_type: z.string().min(1),
  occurred_at: z.string().datetime({ offset: true }),
  data: z.unknown(),
});

const PaddleTransactionResponseSchema = z.object({
  data: z.object({
    id: z.string().min(1),
    checkout: z.object({
      url: z.string().url(),
    }),
  }),
  meta: z
    .object({
      request_id: z.string().optional(),
    })
    .optional(),
});

const PaddleCanceledSubscriptionResponseSchema = z.object({
  data: z.object({
    id: z.string().regex(/^sub_[a-z\d]{26}$/),
    status: z.literal("canceled"),
  }),
});

export type BillingPlan = "team" | "fleet";
export type SubscriptionStatus = "active" | "past_due" | "paused" | "canceled";

export interface SubscriptionUpdate {
  readonly eventId: string;
  readonly githubAccountId: string;
  readonly providerSubscriptionId: string;
  readonly providerCustomerId: string;
  readonly plan: BillingPlan;
  readonly status: SubscriptionStatus;
  readonly occurredAt: string;
}

export interface PaddlePriceCatalog {
  readonly teamPriceId: string;
  readonly fleetPriceId: string;
}

export interface PaddleSubscriptionBindingInput {
  readonly githubAccountId: string;
  readonly plan: BillingPlan;
  readonly priceId: string;
  readonly secret: string;
}

export interface ParseSubscriptionUpdateOptions extends PaddlePriceCatalog {
  readonly bindingSecret: string;
}

export class PaddleSignatureError extends Error {
  constructor(
    message: string,
    readonly reason: "missing" | "malformed" | "expired" | "mismatch",
  ) {
    super(message);
    this.name = "PaddleSignatureError";
  }
}

export class PaddleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "PaddleApiError";
  }
}

export class PaddleBindingError extends Error {
  override readonly name = "PaddleBindingError";
}

export class PaddlePayloadError extends Error {
  override readonly name = "PaddlePayloadError";
}

function encodeHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function paddleBindingDigest(
  githubAccountId: string,
  plan: BillingPlan,
  priceId: string,
  secret: string,
): Promise<Uint8Array> {
  if (secret.length < 32) {
    throw new TypeError("Paddle binding secret must contain at least 32 characters.");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(
        `setup-steps-guardian:paddle-binding:v1:${githubAccountId}:${plan}:${priceId}`,
      ),
    ),
  );
}

export async function createPaddleSubscriptionBinding(
  input: PaddleSubscriptionBindingInput,
): Promise<string> {
  return encodeHex(
    await paddleBindingDigest(input.githubAccountId, input.plan, input.priceId, input.secret),
  );
}

function decodeHex(value: string): Uint8Array {
  if (!/^[a-f0-9]+$/iu.test(value) || value.length % 2 !== 0) {
    throw new PaddleSignatureError("Paddle signature is not valid hexadecimal.", "malformed");
  }

  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function parseSignatureHeader(header: string | null): {
  timestamp: number;
  signatures: readonly Uint8Array[];
} {
  if (header === null || header.length === 0) {
    throw new PaddleSignatureError("Paddle-Signature header is missing.", "missing");
  }

  let timestamp: number | undefined;
  const signatures: Uint8Array[] = [];

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      throw new PaddleSignatureError("Paddle-Signature header is malformed.", "malformed");
    }

    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name === "ts") {
      timestamp = Number(value);
    } else if (name === "h1") {
      const signature = decodeHex(value);
      if (signature.byteLength !== 32) {
        throw new PaddleSignatureError(
          "Paddle HMAC signatures must contain 32 bytes.",
          "malformed",
        );
      }
      signatures.push(signature);
    }
  }

  if (
    timestamp === undefined ||
    !Number.isInteger(timestamp) ||
    timestamp <= 0 ||
    signatures.length === 0
  ) {
    throw new PaddleSignatureError("Paddle-Signature header is incomplete.", "malformed");
  }

  return { timestamp, signatures };
}

export async function verifyPaddleWebhook(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  options: { nowSeconds?: number; toleranceSeconds?: number } = {},
): Promise<void> {
  const { timestamp, signatures } = parseSignatureHeader(signatureHeader);
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const toleranceSeconds = options.toleranceSeconds ?? 300;

  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    throw new PaddleSignatureError("Paddle webhook timestamp is outside tolerance.", "expired");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}:${rawBody}`)),
  );

  if (!signatures.some((signature) => constantTimeEqual(signature, expected))) {
    throw new PaddleSignatureError("Paddle webhook signature does not match.", "mismatch");
  }
}

function normalizeSubscriptionStatus(value: string): SubscriptionStatus {
  switch (value) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    case "paused":
      return "paused";
    case "canceled":
      return "canceled";
    default:
      throw new PaddlePayloadError(`Unsupported Paddle subscription status: ${value}`);
  }
}

function purchasedSubscriptionPlan(
  subscription: z.infer<typeof PaddleSubscriptionDataSchema>,
  catalog: PaddlePriceCatalog,
): { readonly plan: BillingPlan; readonly priceId: string } {
  if (subscription.items.length !== 1 || subscription.items[0]?.quantity !== 1) {
    throw new PaddleBindingError(
      "Paddle subscription items do not match a supported single-plan purchase.",
    );
  }

  const priceId = subscription.items[0].price.id;
  if (priceId === catalog.teamPriceId) {
    return { plan: "team", priceId };
  }
  if (priceId === catalog.fleetPriceId) {
    return { plan: "fleet", priceId };
  }
  throw new PaddleBindingError("Paddle subscription price does not match the configured catalog.");
}

export async function parseSubscriptionUpdate(
  rawBody: string,
  options: ParseSubscriptionUpdateOptions,
): Promise<SubscriptionUpdate | undefined> {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new PaddlePayloadError("Paddle webhook body is not valid JSON.");
  }

  const parsedEvent = PaddleWebhookSchema.safeParse(payload);
  if (!parsedEvent.success) {
    throw new PaddlePayloadError("Paddle webhook envelope is invalid.");
  }
  const event = parsedEvent.data;
  if (!event.event_type.startsWith("subscription.")) {
    return undefined;
  }

  const parsedSubscription = PaddleSubscriptionDataSchema.safeParse(event.data);
  if (!parsedSubscription.success) {
    throw new PaddlePayloadError("Paddle subscription data is invalid.");
  }
  const subscription = parsedSubscription.data;
  const parsedCustomData = PaddleSubscriptionCustomDataSchema.safeParse(subscription.custom_data);
  if (!parsedCustomData.success) {
    throw new PaddleBindingError("Paddle subscription custom_data is missing its server binding.");
  }
  const customData = parsedCustomData.data;
  const purchased = purchasedSubscriptionPlan(subscription, options);
  if (customData.plan !== purchased.plan) {
    throw new PaddleBindingError(
      "Paddle subscription metadata does not match the purchased price.",
    );
  }
  const expectedBinding = await paddleBindingDigest(
    customData.github_account_id,
    purchased.plan,
    purchased.priceId,
    options.bindingSecret,
  );
  if (!constantTimeEqual(decodeHex(customData.binding), expectedBinding)) {
    throw new PaddleBindingError(
      "Paddle subscription custom_data does not match its server binding.",
    );
  }

  return {
    eventId: event.event_id,
    githubAccountId: customData.github_account_id,
    providerSubscriptionId: subscription.id,
    providerCustomerId: subscription.customer_id,
    plan: purchased.plan,
    status: normalizeSubscriptionStatus(subscription.status),
    occurredAt: event.occurred_at,
  };
}

export interface PaddleCheckoutInput {
  readonly apiBaseUrl: string;
  readonly apiKey: string;
  readonly priceId: string;
  readonly githubAccountId: string;
  readonly plan: BillingPlan;
  readonly binding: string;
}

export interface PaddleCancelSubscriptionInput {
  readonly apiBaseUrl: string;
  readonly apiKey: string;
  readonly subscriptionId: string;
}

function readPaddleRequestId(rawResponse: string): string | undefined {
  try {
    const value: unknown = JSON.parse(rawResponse);
    if (
      value !== null &&
      typeof value === "object" &&
      "meta" in value &&
      value.meta !== null &&
      typeof value.meta === "object" &&
      "request_id" in value.meta &&
      typeof value.meta.request_id === "string"
    ) {
      return value.meta.request_id;
    }
    return undefined;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

export async function createPaddleCheckout(
  input: PaddleCheckoutInput,
  fetchImplementation: typeof fetch = fetch,
): Promise<{ transactionId: string; checkoutUrl: string }> {
  const response = await fetchImplementation(`${input.apiBaseUrl}/transactions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: [{ price_id: input.priceId, quantity: 1 }],
      collection_mode: "automatic",
      custom_data: {
        github_account_id: input.githubAccountId,
        plan: input.plan,
        binding: input.binding,
      },
    }),
  });

  const rawResponse = await response.text();
  if (!response.ok) {
    throw new PaddleApiError(
      `Paddle transaction creation failed with HTTP ${response.status}.`,
      response.status,
      readPaddleRequestId(rawResponse),
    );
  }

  const transaction = PaddleTransactionResponseSchema.parse(JSON.parse(rawResponse));
  return {
    transactionId: transaction.data.id,
    checkoutUrl: transaction.data.checkout.url,
  };
}

export async function cancelPaddleSubscription(
  input: PaddleCancelSubscriptionInput,
  fetchImplementation: typeof fetch = fetch,
): Promise<void> {
  const subscriptionId = z
    .string()
    .regex(/^sub_[a-z\d]{26}$/)
    .parse(input.subscriptionId);
  const response = await fetchImplementation(
    `${input.apiBaseUrl}/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
    {
      method: "POST",
      headers: {
        Authorization: ["Bearer", input.apiKey].join(" "),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ effective_from: "immediately" }),
    },
  );
  const rawResponse = await response.text();
  if (!response.ok) {
    throw new PaddleApiError(
      `Paddle subscription cancellation failed with HTTP ${response.status}.`,
      response.status,
      readPaddleRequestId(rawResponse),
    );
  }

  PaddleCanceledSubscriptionResponseSchema.parse(JSON.parse(rawResponse));
}
