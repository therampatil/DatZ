import type { NextFunction, Request, Response } from "express";
import { supabase } from "../db/supabase.js";
import { hashApiKey, safeEqual, verifySessionToken } from "../services/authService.js";

export interface AuthContext {
  type: "api-key" | "session" | "download-token";
  name: string;
  scopes: string[];
  subject?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

interface DevApiKey {
  name: string;
  key: string;
  scopes: string[];
}

interface ApiKeyRow {
  name: string;
  key_hash: string;
  scopes: string[] | null;
  is_active: boolean;
  expires_at: string | null;
}

type Resolution = { auth: AuthContext | null; reason?: "inactive" | "expired" };

/**
 * X-Forwarded-For is trivially spoofable unless a trusted proxy overwrites it.
 * We only take the first address, which is what a single trusted proxy appends.
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return first?.trim() || req.ip || req.socket.remoteAddress || "unknown";
}

let devKeysCache: DevApiKey[] | null = null;

function getDevApiKeys(): DevApiKey[] {
  if (devKeysCache) return devKeysCache;
  const raw = process.env.DATZ_API_KEYS;
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("DATZ_API_KEYS must be an array");
    devKeysCache = parsed
      .filter((item): item is DevApiKey => {
        if (!item || typeof item !== "object") return false;
        const candidate = item as Partial<DevApiKey>;
        return typeof candidate.name === "string" && typeof candidate.key === "string";
      })
      .map((item) => ({
        name: item.name,
        key: item.key,
        scopes: Array.isArray(item.scopes) ? item.scopes.filter((s): s is string => typeof s === "string") : [],
      }));
  } catch {
    console.warn("[auth] DATZ_API_KEYS is not valid JSON; ignoring local dev keys.");
    devKeysCache = [];
  }
  return devKeysCache;
}

function extractCredential(req: Request): { kind: "api-key" | "session"; value: string } | null {
  const apiKeyHeader = req.headers["x-api-key"];
  if (typeof apiKeyHeader === "string" && apiKeyHeader.trim()) {
    return { kind: "api-key", value: apiKeyHeader.trim() };
  }

  const sessionHeader = req.headers["x-session-token"];
  if (typeof sessionHeader === "string" && sessionHeader.trim()) {
    return { kind: "session", value: sessionHeader.trim() };
  }

  const authorization = req.headers.authorization;
  if (typeof authorization === "string" && authorization.toLowerCase().startsWith("bearer ")) {
    const value = authorization.slice(7).trim();
    if (!value) return null;
    // Signed tokens contain a dot separator; API keys are opaque single tokens.
    return { kind: value.includes(".") ? "session" : "api-key", value };
  }
  return null;
}

function rowAuth(row: ApiKeyRow, keyDigest: string): AuthContext {
  return {
    type: "api-key",
    name: row.name,
    subject: keyDigest,
    scopes: Array.isArray(row.scopes) ? row.scopes : [],
  };
}

async function resolveApiKey(key: string): Promise<Resolution> {
  const digest = hashApiKey(key);

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("api_keys")
        .select("name, key_hash, scopes, is_active, expires_at")
        .eq("key_hash", digest)
        .maybeSingle();

      if (!error) {
        if (!data) return { auth: null };
        const row = data as unknown as ApiKeyRow;
        if (row.is_active === false) return { auth: null, reason: "inactive" };
        if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
          return { auth: null, reason: "expired" };
        }
        // Best-effort usage tracking; authentication must not depend on it.
        try {
          void Promise.resolve(
            supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("key_hash", digest)
          ).catch(() => undefined);
        } catch {
          // Ignore usage-tracking failures and still authenticate.
        }
        return { auth: rowAuth(row, digest) };
      }
      console.warn("[auth] API key lookup failed; falling back to local dev keys:", error.message);
    } catch (err) {
      console.warn("[auth] API key lookup error:", err instanceof Error ? err.message : err);
    }
  }

  // Local dev fallback only while Supabase is unavailable or the lookup failed.
  for (const dev of getDevApiKeys()) {
    if (safeEqual(hashApiKey(dev.key), digest)) {
      return { auth: { type: "api-key", name: dev.name, subject: digest, scopes: dev.scopes } };
    }
  }
  return { auth: null };
}

/**
 * Requires ANY of the supplied scopes (e.g. an API key scope or `web:session`).
 * 401 = no/invalid credentials; 403 = valid credentials but insufficient scope.
 */
export function requireScope(...scopes: string[]) {
  if (scopes.length === 0) throw new Error("requireScope needs at least one scope");

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const credential = extractCredential(req);
    if (!credential) {
      res.status(401).json({ error: "Authentication required", requiredScopes: scopes });
      return;
    }

    try {
      let auth: AuthContext | null = null;
      if (credential.kind === "session") {
        const payload = verifySessionToken(credential.value, getClientIp(req));
        if (payload) {
          auth = { type: "session", name: "web-session", scopes: payload.scopes, subject: payload.ip };
        }
      }
      // Bearer tokens may be either signed sessions or opaque API keys.
      if (!auth) {
        const resolution = await resolveApiKey(credential.value);
        if (resolution.reason) {
          res.status(403).json({ error: `API key is ${resolution.reason}` });
          return;
        }
        auth = resolution.auth;
      }
      if (!auth) {
        res.status(401).json({ error: "Invalid or expired credential" });
        return;
      }
      req.auth = auth;

      if (!scopes.some((scope) => auth.scopes.includes(scope))) {
        res.status(403).json({ error: "Insufficient scope", requiredScopes: scopes });
        return;
      }
      next();
    } catch (err) {
      console.warn("[auth] verification error:", err instanceof Error ? err.message : err);
      res.status(401).json({ error: "Authentication failed" });
    }
  };
}
