import { Router } from "express";
import { supabase, isSupabaseConfigured } from "../db/supabase.js";
import { getClientIp } from "../middleware/apiKey.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { issueSessionToken } from "../services/authService.js";

export const authRouter = Router();

const SESSION_TTL_SECONDS = 15 * 60; // 15 min

/** Public, rate-limited endpoint for a short-lived, IP-bound browser session token. */
authRouter.post(
  "/session",
  rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "auth-session" }),
  (req, res) => {
    try {
      const token = issueSessionToken(getClientIp(req));
      res.setHeader("Cache-Control", "no-store");
      res.json({
        token,
        tokenType: "Bearer",
        expiresIn: SESSION_TTL_SECONDS,
        scopes: ["web:session"],
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Could not issue session" });
    }
  }
);

/** Returns public auth configuration for the browser (Supabase URL, Anon Key, OAuth config) */
authRouter.get("/config", (_req, res) => {
  res.json({
    configured: isSupabaseConfigured(),
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
    googleEnabled: true,
  });
});

/**
 * Initiates Google OAuth via Supabase.
 * The client supplies an optional `redirect` parameter where the user should land.
 */
authRouter.get("/google", (req, res) => {
  const redirectParam = (req.query.redirect as string) || "/";
  const redirectTo = encodeURIComponent(redirectParam);

  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    return res.status(500).json({ error: "Supabase URL not configured" });
  }

  const authUrl = `${supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${redirectTo}`;
  return res.redirect(authUrl);
});

/**
 * Validates a Supabase JWT from the Authorization header and returns user profile.
 */
authRouter.get("/user", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!supabase) {
    return res.status(503).json({ error: "Supabase client not configured" });
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: error?.message || "Invalid session token" });
    }

    const u = data.user;
    const metadata = u.user_metadata || {};
    return res.json({
      user: {
        id: u.id,
        email: u.email,
        name: metadata.full_name || metadata.name || u.email?.split("@")[0] || "User",
        avatarUrl: metadata.avatar_url || metadata.picture || null,
        provider: u.app_metadata?.provider || "google",
        createdAt: u.created_at,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to verify user" });
  }
});
