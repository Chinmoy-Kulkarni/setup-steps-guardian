import { describe, expect, it, vi } from "vitest";
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
} from "../src/paddle.js";

async function sign(body: string, timestamp: number, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}:${body}`)),
  );
  const signature = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `ts=${timestamp};h1=${signature}`;
}

const parseOptions = {
  bindingSecret: "paddle-binding-secret-with-at-least-thirty-two-characters",
  teamPriceId: "pri_team",
  fleetPriceId: "pri_fleet",
} as const;

function subscriptionEvent(input: {
  readonly githubAccountId: string;
  readonly plan: "team" | "fleet";
  readonly priceId: string;
  readonly binding?: string;
}): string {
  return JSON.stringify({
    event_id: "evt_1",
    event_type: "subscription.updated",
    occurred_at: "2026-08-10T22:00:00.000Z",
    data: {
      id: "sub_1",
      customer_id: "ctm_1",
      status: "active",
      items: [
        {
          quantity: 1,
          price: { id: input.priceId },
        },
      ],
      custom_data: {
        github_account_id: input.githubAccountId,
        plan: input.plan,
        ...(input.binding === undefined ? {} : { binding: input.binding }),
      },
    },
  });
}

describe("Paddle webhooks", () => {
  it("verifies a signed raw body", async () => {
    const body = '{"event_id":"evt_1"}';
    const header = await sign(body, 1_000, "webhook-secret");

    await expect(
      verifyPaddleWebhook(body, header, "webhook-secret", {
        nowSeconds: 1_001,
        toleranceSeconds: 5,
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects mismatched and expired signatures", async () => {
    const body = '{"event_id":"evt_1"}';
    const header = await sign(body, 1_000, "webhook-secret");

    await expect(
      verifyPaddleWebhook(`${body} `, header, "webhook-secret", {
        nowSeconds: 1_001,
        toleranceSeconds: 5,
      }),
    ).rejects.toBeInstanceOf(PaddleSignatureError);

    await expect(
      verifyPaddleWebhook(body, header, "webhook-secret", {
        nowSeconds: 1_010,
        toleranceSeconds: 5,
      }),
    ).rejects.toMatchObject({ reason: "expired" });
  });

  it("rejects HMAC signatures with an invalid byte length", async () => {
    await expect(
      verifyPaddleWebhook('{"event_id":"evt_1"}', "ts=1000;h1=aa", "webhook-secret", {
        nowSeconds: 1_001,
        toleranceSeconds: 5,
      }),
    ).rejects.toMatchObject({ reason: "malformed" });
  });

  it("normalizes subscription entitlement updates with a server binding", async () => {
    const binding = await createPaddleSubscriptionBinding({
      githubAccountId: "42",
      plan: "team",
      priceId: "pri_team",
      secret: parseOptions.bindingSecret,
    });
    const update = await parseSubscriptionUpdate(
      subscriptionEvent({
        githubAccountId: "42",
        plan: "team",
        priceId: "pri_team",
        binding,
      }),
      parseOptions,
    );

    expect(update).toMatchObject({
      githubAccountId: "42",
      plan: "team",
      status: "active",
    });
  });

  it("rejects subscription custom data that was reassigned to another account", async () => {
    const binding = await createPaddleSubscriptionBinding({
      githubAccountId: "attacker-account",
      plan: "team",
      priceId: "pri_team",
      secret: parseOptions.bindingSecret,
    });

    await expect(
      parseSubscriptionUpdate(
        subscriptionEvent({
          githubAccountId: "victim-account",
          plan: "team",
          priceId: "pri_team",
          binding,
        }),
        parseOptions,
      ),
    ).rejects.toBeInstanceOf(PaddleBindingError);
  });

  it("rejects subscription custom data with a modified plan", async () => {
    const binding = await createPaddleSubscriptionBinding({
      githubAccountId: "42",
      plan: "team",
      priceId: "pri_team",
      secret: parseOptions.bindingSecret,
    });

    await expect(
      parseSubscriptionUpdate(
        subscriptionEvent({
          githubAccountId: "42",
          plan: "fleet",
          priceId: "pri_team",
          binding,
        }),
        parseOptions,
      ),
    ).rejects.toBeInstanceOf(PaddleBindingError);
  });

  it("rejects a valid Fleet binding replayed against the cheaper Team price", async () => {
    const binding = await createPaddleSubscriptionBinding({
      githubAccountId: "42",
      plan: "fleet",
      priceId: "pri_fleet",
      secret: parseOptions.bindingSecret,
    });

    await expect(
      parseSubscriptionUpdate(
        subscriptionEvent({
          githubAccountId: "42",
          plan: "fleet",
          priceId: "pri_team",
          binding,
        }),
        parseOptions,
      ),
    ).rejects.toBeInstanceOf(PaddleBindingError);
  });

  it("rejects missing bindings and malformed subscription payloads", async () => {
    await expect(
      parseSubscriptionUpdate(
        subscriptionEvent({
          githubAccountId: "42",
          plan: "team",
          priceId: "pri_team",
        }),
        parseOptions,
      ),
    ).rejects.toBeInstanceOf(PaddleBindingError);

    await expect(parseSubscriptionUpdate("not-json", parseOptions)).rejects.toBeInstanceOf(
      PaddlePayloadError,
    );
  });
});

describe("Paddle checkout", () => {
  it("creates a transaction with tenant custom data", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: "txn_1",
            checkout: {
              url: "https://pay.paddle.test/txn_1",
            },
          },
          meta: {
            request_id: "req_1",
          },
        }),
        { status: 201 },
      ),
    );

    await expect(
      createPaddleCheckout(
        {
          apiBaseUrl: "https://api.paddle.test",
          apiKey: "api-key",
          priceId: "pri_team",
          githubAccountId: "42",
          plan: "team",
          binding: "a".repeat(64),
        },
        fetchImplementation,
      ),
    ).resolves.toEqual({
      transactionId: "txn_1",
      checkoutUrl: "https://pay.paddle.test/txn_1",
    });

    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://api.paddle.test/transactions",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"github_account_id":"42"'),
      }),
    );
    expect(fetchImplementation.mock.calls[0]?.[1]?.body).toContain(`"binding":"${"a".repeat(64)}"`);
  });

  it("surfaces provider failures without a success-shaped fallback", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ meta: { request_id: "req_failed" } }), { status: 422 }),
      );

    await expect(
      createPaddleCheckout(
        {
          apiBaseUrl: "https://api.paddle.test",
          apiKey: "api-key",
          priceId: "pri_team",
          githubAccountId: "42",
          plan: "team",
          binding: "a".repeat(64),
        },
        fetchImplementation,
      ),
    ).rejects.toBeInstanceOf(PaddleApiError);
  });

  it("cancels a subscription immediately before account deletion", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: "sub_01h04vsc0qhwtsbsxh3422wjs4",
            status: "canceled",
          },
        }),
        { status: 200 },
      ),
    );

    await expect(
      cancelPaddleSubscription(
        {
          apiBaseUrl: "https://api.paddle.com",
          apiKey: "secret",
          subscriptionId: "sub_01h04vsc0qhwtsbsxh3422wjs4",
        },
        fetchImplementation,
      ),
    ).resolves.toBeUndefined();

    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://api.paddle.com/subscriptions/sub_01h04vsc0qhwtsbsxh3422wjs4/cancel",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ effective_from: "immediately" }),
      }),
    );
  });
});
