import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pool, isDatabaseConfigured } from "./db/pool.js";
import { supabase, supabasePublic, isSupabaseConfigured } from "./db/supabase.js";
import { authRouter } from "./routes/auth.js";
import { datasetsRouter } from "./routes/datasets.js";
import { downloadsRouter } from "./routes/downloads.js";
import { ordersRouter } from "./routes/orders.js";
import { telemetryRouter } from "./routes/telemetry.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

const app = express();
const port = Number(process.env.PORT || 4000);

app.use((req: Request, res: Response, next: NextFunction) => {
  const incoming = req.headers["x-request-id"];
  const requestId =
    typeof incoming === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(incoming) ? incoming : randomUUID();
  req.id = requestId;
  res.setHeader("X-Request-Id", requestId);
  const startedAt = Date.now();
  res.on("finish", () => {
    // Log metadata only: never log headers, bodies, tokens or API keys.
    console.log(
      JSON.stringify({
        level: "info",
        msg: "request",
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
      })
    );
  });
  next();
});

// Default to same-origin (no ACAO header). CORS is opt-in via CORS_ORIGIN.
const allowedOrigins = process.env.CORS_ORIGIN?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins?.length ? allowedOrigins : false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept", "Authorization", "X-API-Key", "X-Session-Token", "X-Request-Id"],
  })
);
app.use(express.json({ limit: "5mb" }));

// Health check: actually query a configured database before reporting healthy.
app.get("/health", async (_req, res) => {
  let database = "unconfigured";
  let supabaseStatus = "standby";
  let healthy = true;

  if (isSupabaseConfigured()) {
    // Prefer the admin client; the anon client can still prove reachability.
    const client = supabase || supabasePublic;
    if (!client) {
      database = "supabase-disconnected";
      supabaseStatus = "disconnected";
      healthy = false;
    } else {
      try {
        const { error } = await client.from("datasets").select("id", { count: "exact", head: true });
        if (error) {
          database = "supabase-disconnected";
          supabaseStatus = "disconnected";
          healthy = false;
        } else {
          database = "supabase-connected";
          supabaseStatus = supabase ? "active" : "public-only";
        }
      } catch {
        database = "supabase-disconnected";
        supabaseStatus = "disconnected";
        healthy = false;
      }
    }
  } else if (isDatabaseConfigured()) {
    try {
      await pool.query("SELECT 1");
      database = "postgres-connected";
    } catch {
      database = "postgres-disconnected";
      healthy = false;
    }
  }

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "healthy" : "unhealthy",
    database,
    supabase: supabaseStatus,
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/datasets", datasetsRouter);
app.use("/api/v1/downloads", downloadsRouter);
app.use("/api/v1/orders", ordersRouter);
app.use("/api/v1/telemetry", telemetryRouter);

// Serve frontend static assets
app.use(express.static(path.resolve(process.cwd())));

// Fallback for API routes
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API route not found" });
});

// Fallback to index.html for client-side routing
app.use((_req, res) => {
  res.sendFile(path.resolve(process.cwd(), "index.html"));
});

app.listen(port, () => {
  console.log(
    JSON.stringify({
      level: "info",
      msg: "server-started",
      port,
      database: isSupabaseConfigured() ? "supabase" : isDatabaseConfigured() ? "postgres" : "offline",
    })
  );
});
