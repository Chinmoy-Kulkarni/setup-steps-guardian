import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  decodeBase64Url,
  encodeBase64Url,
  randomToken,
} from "../src/encoding.js";

describe("encoding helpers", () => {
  it("round-trips base64url without padding", () => {
    const value = new TextEncoder().encode("setup-steps-guardian");
    const encoded = encodeBase64Url(value);

    expect(encoded).not.toMatch(/[+/=]/u);
    expect(new TextDecoder().decode(decodeBase64Url(encoded))).toBe("setup-steps-guardian");
  });

  it("compares equal-length values without early value branches", () => {
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });

  it("generates URL-safe random tokens", () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    expect(() => randomToken(8)).toThrow();
  });
});
