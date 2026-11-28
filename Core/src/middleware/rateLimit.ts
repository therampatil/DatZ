import type { NextFunction, Request, Response } from "express";
import { getClientIp } from "./apiKey.js";

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix: string;
}

const windows = new Map<string, number[]>();

/**
 * Small in-memory sliding-window limiter. Keyed by authenticated identity when
 * available, otherwise by client IP. Intended for single-instance deployments;
 * a distributed deployment should swap this for a shared store.
 */
export function rateLimit({ windowMs, max, keyPrefix }: RateLimitOptions) {
  if (!Number.isFinite(windowMs) || windowMs <= 0 || !Number.isInteger(max) || max <= 0) {
    throw new Error("rateLimit requires a positive windowMs and max");
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    const identity = req.auth
      ? `${req.auth.type}:${req.auth.subject || req.auth.name || getClientIp(req)}`
      : getClientIp(req);
    const key = `${keyPrefix}:${identity}`;
    const now = Date.now();
    const hits = (windows.get(key) || []).filter((timestamp) => now - timestamp < windowMs);

    if (hits.length >= max) {
      const retryAfter = Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      res.setHeader("X-RateLimit-Limit", String(max));
      res.setHeader("X-RateLimit-Remaining", "0");
      res.status(429).json({ error: "Too many requests", retryAfter });
      return;
    }

    hits.push(now);
    windows.set(key, hits);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - hits.length)));

    // Bound memory when many distinct clients pass through.
    if (windows.size > 10000) {
      for (const [entry, timestamps] of windows) {
        if (timestamps.every((timestamp) => now - timestamp >= windowMs)) windows.delete(entry);
      }
    }
    next();
  };
}
