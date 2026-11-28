import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { supabase } from "../db/supabase.js";
import { requireScope } from "../middleware/apiKey.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { hashApiKey, safeEqual, verifyDownloadToken } from "../services/authService.js";
import { DownloadService } from "../services/downloadService.js";

export const downloadsRouter = Router();

const formatSchema = z.enum(["csv", "xlsx", "parquet"]);
const dateStringSchema = z.string().refine((value) => !Number.isNaN(new Date(value).getTime()), {
  message: "Invalid date",
});

export const downloadRequestSchema = z.object({
  datasetSlug: z.string().min(1),
  format: formatSchema,
  city: z.string().optional(),
  from: dateStringSchema.optional(),
  to: dateStringSchema.optional(),
  customerEmail: z.string().email().optional(),
});

const sampleRequestSchema = z.object({
  datasetSlug: z.string().min(1),
  format: formatSchema.default("csv"),
  city: z.string().optional(),
  from: dateStringSchema.optional(),
  to: dateStringSchema.optional(),
});

const exportRequestSchema = z.object({
  datasetSlug: z.string().min(1),
  format: formatSchema,
});

const CONTENT_TYPES: Record<z.infer<typeof formatSchema>, string> = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  parquet: "application/vnd.apache.parquet",
};

/**
 * Explicit, reversible testing gate for unpaid full exports. Enabled by default
 * for local testing; set ALLOW_UNPAID_FULL_ACCESS=false when payments go live.
 */
function requireTestingAccess(_req: Request, res: Response, next: NextFunction): void {
  if (process.env.ALLOW_UNPAID_FULL_ACCESS === "false") {
    res.status(403).json({ error: "Unpaid full export is disabled" });
    return;
  }
  next();
}

/** A signed order token is sufficient; otherwise require a scoped server-to-server key. */
function requireDownloadAccess(req: Request, res: Response, next: NextFunction): void {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (token) {
    const payload = verifyDownloadToken(token);
    if (payload) {
      req.auth = {
        type: "download-token",
        name: "download-token",
        scopes: ["downloads:read"],
        subject: payload.orderId,
      };
      next();
      return;
    }
  }
  void requireScope("downloads:read")(req, res, next);
}

/** Server-to-server full snapshot export. Web session tokens are not accepted. */
downloadsRouter.post(
  "/snapshot",
  requireScope("downloads:read"),
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "download-snapshot" }),
  async (req, res) => {
    try {
      const input = downloadRequestSchema.parse(req.body);
      const snapshot = await DownloadService.generateSnapshot(input, {
        uploadToStorage: true,
        logDownloadOrder: false,
      });

      if (req.headers.accept?.includes("application/json") && snapshot.downloadUrl) {
        res.json({
          status: "ready",
          fileName: snapshot.fileName,
          downloadUrl: snapshot.downloadUrl,
          recordCount: snapshot.recordCount,
        });
        return;
      }

      res.setHeader("Content-Type", snapshot.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${snapshot.fileName}"`);
      res.setHeader("Content-Length", snapshot.buffer.length);
      res.send(snapshot.buffer);
    } catch (error) {
      res.status(error instanceof z.ZodError ? 400 : 500).json({
        error: error instanceof Error ? error.message : "Failed to generate snapshot",
      });
    }
  }
);

/** Public, capped sample export. No storage upload and no order row. */
downloadsRouter.post(
  "/sample",
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "download-sample" }),
  async (req, res) => {
    try {
      const input = sampleRequestSchema.parse(req.body);
      const snapshot = await DownloadService.generateSnapshot(input, {
        uploadToStorage: false,
        logDownloadOrder: false,
        maxRows: 50,
        sample: true,
      });

      res.setHeader("X-Datz-Export", "sample");
      res.setHeader("X-Datz-Sample", "true");
      res.setHeader("X-Datz-Row-Limit", "50");
      res.setHeader("Content-Type", snapshot.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${snapshot.fileName}"`);
      res.setHeader("Content-Length", snapshot.buffer.length);
      res.setHeader("Cache-Control", "no-store");
      res.send(snapshot.buffer);
    } catch (error) {
      res.status(error instanceof z.ZodError ? 400 : 500).json({
        error: error instanceof Error ? error.message : "Failed to generate sample",
      });
    }
  }
);

/**
 * Testing-only unpaid full export for the in-app web-session flow. No storage
 * upload and no order row are created; the explicit env gate above can disable
 * it without touching the API-key-only snapshot or public sample routes.
 */
downloadsRouter.post(
  "/export",
  requireTestingAccess,
  requireScope("web:session"),
  rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "download-export" }),
  async (req, res) => {
    try {
      const input = exportRequestSchema.parse(req.body);
      const snapshot = await DownloadService.generateSnapshot(input, {
        uploadToStorage: false,
        logDownloadOrder: false,
      });

      res.setHeader("X-Datz-Export", "full");
      res.setHeader("Content-Type", snapshot.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${snapshot.fileName}"`);
      res.setHeader("Content-Length", snapshot.buffer.length);
      res.setHeader("Cache-Control", "no-store");
      res.send(snapshot.buffer);
    } catch (error) {
      res.status(error instanceof z.ZodError ? 400 : 500).json({
        error: error instanceof Error ? error.message : "Failed to generate export",
      });
    }
  }
);

/**
 * Fulfilled-only file access. There is deliberately no `?slug=&format=` path:
 * every request must carry a signed, order-specific, expiring token.
 */
downloadsRouter.get(
  "/file",
  rateLimit({ windowMs: 60_000, max: 30, keyPrefix: "file-download" }),
  requireDownloadAccess,
  async (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token) {
      res.status(400).json({ error: "A download token is required" });
      return;
    }

    const payload = verifyDownloadToken(token);
    if (!payload) {
      res.status(401).json({ error: "Invalid or expired download token" });
      return;
    }
    if (!supabase) {
      res.status(503).json({ error: "Order store unavailable" });
      return;
    }

    try {
      const { data: order, error } = await supabase
        .from("download_orders")
        .select(
          "id, format, status, payment_status, expires_at, access_token_hash, download_url, file_name, datasets(slug)"
        )
        .eq("id", payload.orderId)
        .single();

      if (error || !order) {
        res.status(404).json({ error: "Order not found" });
        return;
      }
      if (order.status !== "ready" || !["authorized", "paid"].includes(order.payment_status)) {
        res.status(403).json({ error: "Order has not been fulfilled" });
        return;
      }

      const relation = (order as unknown as Record<string, unknown>).datasets;
      const datasetRow = (Array.isArray(relation) ? relation[0] : relation) as { slug?: string } | null;
      if (
        datasetRow?.slug !== payload.datasetSlug ||
        order.format !== payload.format ||
        !order.access_token_hash ||
        !safeEqual(hashApiKey(token), order.access_token_hash)
      ) {
        res.status(403).json({ error: "Download token does not match this order" });
        return;
      }
      if (order.expires_at && Date.parse(order.expires_at) <= Date.now()) {
        res.status(403).json({ error: "Download link has expired" });
        return;
      }
      if (!order.download_url) {
        res.status(404).json({ error: "Snapshot is not available" });
        return;
      }

      const upstream = await fetch(order.download_url, { signal: AbortSignal.timeout(15000) });
      if (!upstream.ok) {
        res.status(502).json({ error: "Could not retrieve the snapshot" });
        return;
      }
      const buffer = Buffer.from(await upstream.arrayBuffer());
      const fileName = order.file_name || `${payload.datasetSlug}.${payload.format}`;
      res.setHeader("Content-Type", CONTENT_TYPES[payload.format]);
      res.setHeader("Content-Disposition", `attachment; filename="${fileName.replace(/[\r\n"]/g, "")}"`);
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("Cache-Control", "no-store");
      res.send(buffer);
    } catch (err) {
      console.warn("[downloads] file serve error:", err instanceof Error ? err.message : err);
      res.status(502).json({ error: "Could not serve the snapshot" });
    }
  }
);
