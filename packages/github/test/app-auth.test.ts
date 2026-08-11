import { describe, expect, it } from "vitest";
import { createWebCryptoAppJwt } from "../src/app-auth.js";
import { TEST_RSA_PRIVATE_KEY_PKCS8, TEST_RSA_PUBLIC_KEY } from "./crypto-fixtures.js";

const FIXED_NOW = Date.parse("2026-08-10T23:27:02.000Z");

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodeJsonSegment(value: string): Record<string, unknown> {
  const json = new TextDecoder().decode(decodeBase64Url(value));
  const parsed = JSON.parse(json) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("JWT segment did not contain an object.");
  }
  return parsed as Record<string, unknown>;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function parsePem(pem: string): ArrayBuffer {
  const base64 = pem
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\s/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

describe("createWebCryptoAppJwt", () => {
  it("creates fixed GitHub App claims and a verifiable RS256 signature", async () => {
    const createJwt = createWebCryptoAppJwt(TEST_RSA_PRIVATE_KEY_PKCS8, {
      now: () => FIXED_NOW,
    });
    const result = await createJwt(12_345);
    const segments = result.jwt.split(".");

    expect(segments).toHaveLength(3);
    const headerSegment = segments[0];
    const payloadSegment = segments[1];
    const signatureSegment = segments[2];
    if (
      headerSegment === undefined ||
      payloadSegment === undefined ||
      signatureSegment === undefined
    ) {
      throw new Error("JWT did not contain three segments.");
    }

    expect(decodeJsonSegment(headerSegment)).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    expect(decodeJsonSegment(payloadSegment)).toEqual({
      iat: Math.floor(FIXED_NOW / 1_000) - 30,
      exp: Math.floor(FIXED_NOW / 1_000) + 570,
      iss: 12_345,
    });
    expect(result.expiresAt).toBe("2026-08-10T23:36:32.000Z");

    const publicKey = await crypto.subtle.importKey(
      "spki",
      parsePem(TEST_RSA_PUBLIC_KEY),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      toArrayBuffer(decodeBase64Url(signatureSegment)),
      toArrayBuffer(new TextEncoder().encode(`${headerSegment}.${payloadSegment}`)),
    );
    expect(valid).toBe(true);
  });

  it("applies the clock-difference contract used by auth-app", async () => {
    const createJwt = createWebCryptoAppJwt(TEST_RSA_PRIVATE_KEY_PKCS8, {
      now: () => FIXED_NOW,
    });
    const result = await createJwt("Iv1.client-id", 15);
    const payloadSegment = result.jwt.split(".")[1];
    if (payloadSegment === undefined) {
      throw new Error("JWT payload segment is missing.");
    }

    expect(decodeJsonSegment(payloadSegment)).toMatchObject({
      iat: Math.floor(FIXED_NOW / 1_000) - 15,
      exp: Math.floor(FIXED_NOW / 1_000) + 585,
      iss: "Iv1.client-id",
    });
    await expect(createJwt(1, 0.5)).rejects.toThrow("safe integer");
  });

  it("rejects PKCS#1 input without including key material in the error", () => {
    const keyMaterial = "test-key-material";
    const label = "RSA PRIVATE KEY";
    const pkcs1 = `-----BEGIN ${label}-----\n${keyMaterial}\n-----END ${label}-----`;

    expect(() => createWebCryptoAppJwt(pkcs1)).toThrow("converted from PKCS#1");
    try {
      createWebCryptoAppJwt(pkcs1);
    } catch (error: unknown) {
      expect(String(error)).not.toContain(keyMaterial);
    }
  });
});
