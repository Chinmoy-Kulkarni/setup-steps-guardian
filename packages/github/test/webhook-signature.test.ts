import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "../src/webhook-signature.js";

describe("verifyWebhookSignature", () => {
  const secret = "It's a Secret to Everybody";
  const body = "Hello, World!";
  const signature = "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";

  it("accepts GitHub's fixed HMAC-SHA256 test vector", async () => {
    await expect(verifyWebhookSignature(secret, body, signature)).resolves.toBe(true);
  });

  it("rejects incorrect, malformed, and missing signatures", async () => {
    const incorrect = `${signature.slice(0, -1)}0`;

    await expect(verifyWebhookSignature(secret, body, incorrect)).resolves.toBe(false);
    await expect(verifyWebhookSignature(secret, body, "sha256=not-hex")).resolves.toBe(false);
    await expect(verifyWebhookSignature(secret, body, null)).resolves.toBe(false);
  });

  it("verifies the exact raw bytes rather than parsed JSON", async () => {
    const compact = '{"ok":true}';
    const formatted = '{ "ok": true }';
    const compactSignature =
      "sha256=cb2946927aab5f592852ea5d07b5ac9ecd62b36419135c04db47f392b6d3c5ca";

    await expect(verifyWebhookSignature("fixture-secret", compact, compactSignature)).resolves.toBe(
      true,
    );
    await expect(
      verifyWebhookSignature("fixture-secret", formatted, compactSignature),
    ).resolves.toBe(false);
  });

  it("rejects an empty webhook secret", async () => {
    await expect(verifyWebhookSignature("", body, signature)).rejects.toThrow("must not be empty");
  });
});
