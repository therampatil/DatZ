import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Stateless HMAC-SHA256 auth helpers. No new dependencies and no secret logging.
 * Tokens are compact `<base64url(payload)>.<base64url(hmac)>` strings.
 */

const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes
const DOWNLOAD_TTL_MS = 60 * 60 * 1000; // 1 hour
const WEB_SESSION_SCOPE = "web:session";

let processSigningSecret: string | null = null;
let processSecretWarningIssued = false;

/** DOWNLOAD_TOKEN_SECRET is required in production; the fallback is per-process only. */
function getSigningSecret(): string {
  const configured = process.env.DOWNLOAD_TOKEN_SECRET?.trim();
  if (configured) return configured;
  if (!processSecretWarningIssued) {
    processSecretWarningIssued = true;
    console.warn(
      "[auth] DOWNLOAD_TOKEN_SECRET is not set; using a generated per-process secret. " +
        "Session and download tokens will be invalid after a restart."
    );
  }
  if (!processSigningSecret) processSigningSecret = randomBytes(32).toString("hex");
  return processSigningSecret;
}

/** Optional HMAC pepper for stored API key hashes. Falls back to a stable SHA-256 digest. */
function getApiKeyPepper(): string | null {
  return process.env.API_KEY_HMAC_SECRET?.trim() || null;
}

/** One-way digest suitable for the `api_keys.key_hash` lookup column. */
export function hashApiKey(key: string): string {
  if (typeof key !== "string" || key.length === 0) throw new Error("API key is required");
  const pepper = getApiKeyPepper();
  return pepper
    ? createHmac("sha256", pepper).update(key).digest("hex")
    : createHash("sha256").update(key).digest("hex");
}

export interface IssuedApiKeyRecord {
  name: string;
  key: string;
  key_prefix: string;
  key_hash: string;
  scopes: string[];
  is_active: boolean;
  expires_at: string | null;
}

/** Generates a random, high-entropy key. Only the returned plaintext is shown to a human once. */
export function generateApiKey(): string {
  return `datz_${randomBytes(24).toString("base64url")}`;
}

/** Builds an api_keys row plus the plaintext key to hand to the caller exactly once. */
export function issueApiKeyRecord(input: {
  name: string;
  scopes: string[];
  expiresAt?: string | Date | null;
  key?: string;
}): IssuedApiKeyRecord {
  const key = input.key || generateApiKey();
  return {
    name: input.name,
    key,
    key_prefix: key.slice(0, 12),
    key_hash: hashApiKey(key),
    scopes: [...input.scopes],
    is_active: true,
    expires_at: input.expiresAt ? new Date(input.expiresAt).toISOString() : null,
  };
}

/** Constant-time comparison for signatures and API key digests. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function encodeAndSign(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", getSigningSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function decodeAndVerify<T>(token: string, guard: (value: unknown) => value is T): T | null {
  if (typeof token !== "string") return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = createHmac("sha256", getSigningSecret()).update(encoded).digest("base64url");
  if (!safeEqual(signature, expected)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!guard(parsed)) return null;
  const payload = parsed as T & { exp: number };
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp <= Date.now()) return null;
  return payload;
}

export interface SessionTokenPayload {
  type: "web:session";
  ip: string;
  scopes: string[];
  iat: number;
  exp: number;
}

function isSessionPayload(value: unknown): value is SessionTokenPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SessionTokenPayload>;
  return (
    candidate.type === "web:session" &&
    typeof candidate.ip === "string" &&
    Array.isArray(candidate.scopes) &&
    candidate.scopes.includes(WEB_SESSION_SCOPE) &&
    typeof candidate.iat === "number" &&
    typeof candidate.exp === "number"
  );
}

/** Short-lived session token bound to the requesting IP (default 15 minutes). */
export function issueSessionToken(ip: string, ttlMs = SESSION_TTL_MS): string {
  const now = Date.now();
  return encodeAndSign({
    type: "web:session",
    ip: ip || "unknown",
    scopes: [WEB_SESSION_SCOPE],
    iat: now,
    exp: now + ttlMs,
  });
}

/** Returns the verified payload, or null when invalid, tampered, expired or from another IP. */
export function verifySessionToken(token: string, ip: string): SessionTokenPayload | null {
  const payload = decodeAndVerify(token, isSessionPayload);
  if (!payload) return null;
  return payload.ip === (ip || "unknown") ? payload : null;
}

export interface DownloadTokenPayload {
  type: "download";
  orderId: string;
  datasetSlug: string;
  format: "csv" | "xlsx" | "parquet";
  scope: "downloads:read";
  iat: number;
  exp: number;
}

export interface DownloadTokenInput {
  orderId: string;
  datasetSlug: string;
  format: "csv" | "xlsx" | "parquet";
  /** Absolute expiry in ms since epoch. Defaults to one hour from now. */
  exp?: number;
  ttlMs?: number;
}

function isDownloadPayload(value: unknown): value is DownloadTokenPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DownloadTokenPayload>;
  return (
    candidate.type === "download" &&
    typeof candidate.orderId === "string" &&
    typeof candidate.datasetSlug === "string" &&
    (candidate.format === "csv" || candidate.format === "xlsx" || candidate.format === "parquet") &&
    candidate.scope === "downloads:read" &&
    typeof candidate.iat === "number" &&
    typeof candidate.exp === "number"
  );
}

/** Signs an expiring, order-specific download token. */
export function signDownloadToken(input: DownloadTokenInput): string {
  const now = Date.now();
  return encodeAndSign({
    type: "download",
    orderId: input.orderId,
    datasetSlug: input.datasetSlug,
    format: input.format,
    scope: "downloads:read",
    iat: now,
    exp: input.exp ?? now + (input.ttlMs ?? DOWNLOAD_TTL_MS),
  });
}

/** Returns the verified payload, or null when invalid, tampered or expired. */
export function verifyDownloadToken(token: string): DownloadTokenPayload | null {
  return decodeAndVerify(token, isDownloadPayload);
}
