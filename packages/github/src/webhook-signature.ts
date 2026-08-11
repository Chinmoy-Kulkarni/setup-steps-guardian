export type RawWebhookBody = string | ArrayBuffer | Uint8Array;

const SHA256_BYTE_LENGTH = 32;
const SHA256_SIGNATURE_PATTERN = /^sha256=([a-f0-9]{64})$/i;
const textEncoder = new TextEncoder();

function toBytes(rawBody: RawWebhookBody): Uint8Array {
  if (typeof rawBody === "string") {
    return textEncoder.encode(rawBody);
  }
  if (rawBody instanceof Uint8Array) {
    return rawBody;
  }
  return new Uint8Array(rawBody);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function parseSignature(signatureHeader: string | null): {
  readonly bytes: Uint8Array;
  readonly valid: boolean;
} {
  const bytes = new Uint8Array(SHA256_BYTE_LENGTH);
  if (signatureHeader === null) {
    return { bytes, valid: false };
  }

  const match = SHA256_SIGNATURE_PATTERN.exec(signatureHeader);
  if (match === null) {
    return { bytes, valid: false };
  }

  const hex = match[1];
  if (hex === undefined) {
    return { bytes, valid: false };
  }
  for (let index = 0; index < SHA256_BYTE_LENGTH; index += 1) {
    const pair = hex.slice(index * 2, index * 2 + 2);
    bytes[index] = Number.parseInt(pair, 16);
  }
  return { bytes, valid: true };
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export async function verifyWebhookSignature(
  secret: string,
  rawBody: RawWebhookBody,
  signatureHeader: string | null,
  webCrypto: Pick<Crypto, "subtle"> = globalThis.crypto,
): Promise<boolean> {
  if (secret.length === 0) {
    throw new TypeError("Webhook secret must not be empty.");
  }

  const key = await webCrypto.subtle.importKey(
    "raw",
    toArrayBuffer(textEncoder.encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const actual = new Uint8Array(
    await webCrypto.subtle.sign("HMAC", key, toArrayBuffer(toBytes(rawBody))),
  );
  const expected = parseSignature(signatureHeader);
  const matches = constantTimeEqual(actual, expected.bytes);
  return expected.valid && matches;
}
