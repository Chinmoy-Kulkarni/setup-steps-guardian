export interface GitHubAppJwt {
  readonly jwt: string;
  readonly expiresAt: string;
}

export type GitHubAppJwtCreator = (
  appId: string | number,
  timeDifferenceSeconds?: number,
) => Promise<GitHubAppJwt>;

export interface WebCryptoJwtSignerOptions {
  readonly crypto?: Pick<Crypto, "subtle">;
  readonly now?: () => number;
}

const PKCS8_BEGIN = "-----BEGIN PRIVATE KEY-----";
const PKCS8_END = "-----END PRIVATE KEY-----";
const PKCS1_BEGIN = "-----BEGIN RSA PRIVATE KEY-----";
const textEncoder = new TextEncoder();

function decodeBase64(value: string): Uint8Array {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new TypeError("PKCS#8 private key contains invalid base64 data.");
  }

  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function parsePkcs8PrivateKey(privateKey: string): Uint8Array {
  const normalized = privateKey.replace(/\\n/g, "\n").trim();
  if (normalized.startsWith(PKCS1_BEGIN)) {
    throw new TypeError(
      "GitHub App private key must be converted from PKCS#1 to unencrypted PKCS#8.",
    );
  }
  if (!normalized.startsWith(PKCS8_BEGIN) || !normalized.endsWith(PKCS8_END)) {
    throw new TypeError("GitHub App private key must be an unencrypted PKCS#8 PEM.");
  }

  const base64 = normalized
    .slice(PKCS8_BEGIN.length, normalized.length - PKCS8_END.length)
    .replace(/\s/g, "");
  return decodeBase64(base64);
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function encodeJson(value: Readonly<Record<string, unknown>>): string {
  return encodeBase64Url(textEncoder.encode(JSON.stringify(value)));
}

function validateAppId(appId: string | number): void {
  if (typeof appId === "number") {
    if (!Number.isSafeInteger(appId) || appId <= 0) {
      throw new TypeError("GitHub App ID must be a positive safe integer.");
    }
    return;
  }
  if (appId.length === 0 || /\s/.test(appId)) {
    throw new TypeError("GitHub App ID must not be empty.");
  }
}

export function createWebCryptoAppJwt(
  privateKeyPkcs8: string,
  options: WebCryptoJwtSignerOptions = {},
): GitHubAppJwtCreator {
  const webCrypto = options.crypto ?? globalThis.crypto;
  const now = options.now ?? Date.now;
  const privateKeyBytes = parsePkcs8PrivateKey(privateKeyPkcs8);
  let importedKey: Promise<CryptoKey> | undefined;

  const getKey = (): Promise<CryptoKey> => {
    if (importedKey === undefined) {
      importedKey = webCrypto.subtle.importKey(
        "pkcs8",
        toArrayBuffer(privateKeyBytes),
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"],
      );
      privateKeyBytes.fill(0);
    }
    return importedKey;
  };

  return async (appId: string | number, timeDifferenceSeconds = 0): Promise<GitHubAppJwt> => {
    validateAppId(appId);
    if (!Number.isSafeInteger(timeDifferenceSeconds)) {
      throw new TypeError("GitHub API clock difference must be a safe integer.");
    }

    const nowMilliseconds = now();
    if (!Number.isFinite(nowMilliseconds)) {
      throw new TypeError("The current time must be a finite millisecond timestamp.");
    }
    const currentSeconds = Math.floor(nowMilliseconds / 1_000) + timeDifferenceSeconds;
    const issuedAt = currentSeconds - 30;
    const expiresAtSeconds = issuedAt + 10 * 60;
    const expiration = new Date(expiresAtSeconds * 1_000);
    if (Number.isNaN(expiration.getTime())) {
      throw new TypeError("GitHub App JWT expiration is outside the supported date range.");
    }
    const header = encodeJson({ alg: "RS256", typ: "JWT" });
    const payload = encodeJson({
      iat: issuedAt,
      exp: expiresAtSeconds,
      iss: appId,
    });
    const signingInput = `${header}.${payload}`;
    const signature = new Uint8Array(
      await webCrypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        await getKey(),
        toArrayBuffer(textEncoder.encode(signingInput)),
      ),
    );

    return {
      jwt: `${signingInput}.${encodeBase64Url(signature)}`,
      expiresAt: expiration.toISOString(),
    };
  };
}
