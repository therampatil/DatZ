import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { supabase, isSupabaseConfigured } from "./db/supabase.js";
import { executeScrapingPipeline, DEFAULT_DATASET_ID } from "./engine/pipeline.js";

const app = express();
const port = Number(process.env.PORT || 4001);

app.use(cors());
app.use(express.json());

// In-memory fallback datasets/configs when Supabase is offline
interface ScraperTask {
  id: string;
  name: string;
  category: string;
  frequency: string;
  dataset_id: string;
  last_status: string;
  extracted_count: number;
  last_run_at: string | null;
  created_at: string;
}

let fallbackTasks: ScraperTask[] = [
  {
    id: "tsk-001",
    name: "Baner Residential Inventory",
    category: "Residential Real Estate",
    frequency: "manual",
    dataset_id: DEFAULT_DATASET_ID,
    last_status: "idle",
    extracted_count: 0,
    last_run_at: null,
    created_at: new Date().toISOString(),
  },
  {
    id: "tsk-002",
    name: "Kharadi Commercial Offices",
    category: "Commercial Real Estate",
    frequency: "daily",
    dataset_id: DEFAULT_DATASET_ID,
    last_status: "idle",
    extracted_count: 0,
    last_run_at: null,
    created_at: new Date().toISOString(),
  },
];

// --- 1. Scrape Tasks API ---

// GET /api/tasks
app.get("/api/tasks", async (_req, res) => {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from("scraper_configs")
        .select("*")
        .order("created_at", { ascending: false });

      if (!error && data) {
        res.json({ data });
        return;
      }
    } catch {
      // ignore
    }
  }
  res.json({ data: fallbackTasks });
});

// POST /api/tasks - Add category scraping task (NO target URL required)
app.post("/api/tasks", async (req, res) => {
  const { name, category, frequency, dataset_id } = req.body;
  if (!name || !category) {
    res.status(400).json({ error: "name and category are required" });
    return;
  }

  const newTask = {
    name: String(name).trim(),
    category: String(category).trim(),
    target_url: "auto-multi-portal",
    frequency: String(frequency || "manual").trim(),
    dataset_id: dataset_id || DEFAULT_DATASET_ID,
    last_status: "idle",
    last_error: null,
    extracted_count: 0,
  };

  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase.from("scraper_configs").insert(newTask).select().single();
      if (!error && data) {
        res.status(201).json({ data });
        return;
      }
    } catch {
      // ignore
    }
  }

  const memoryItem: ScraperTask = {
    ...newTask,
    id: `tsk-${Date.now().toString(36)}`,
    last_run_at: null,
    created_at: new Date().toISOString(),
  };
  fallbackTasks.unshift(memoryItem);
  res.status(201).json({ data: memoryItem });
});

// DELETE /api/tasks/:id
app.delete("/api/tasks/:id", async (req, res) => {
  const { id } = req.params;
  if (isSupabaseConfigured() && supabase) {
    try {
      await supabase.from("scraper_configs").delete().eq("id", id);
    } catch {
      // ignore
    }
  }
  fallbackTasks = fallbackTasks.filter((t) => t.id !== id);
  res.json({ success: true, id });
});

// POST /api/tasks/:id/run - Run scraper task
app.post("/api/tasks/:id/run", async (req, res) => {
  const { id } = req.params;
  let target = fallbackTasks.find((t) => t.id === id);

  if (isSupabaseConfigured() && supabase) {
    try {
      const { data } = await supabase.from("scraper_configs").select("*").eq("id", id).single();
      if (data) target = data;
    } catch {
      // ignore
    }
  }

  if (!target) {
    res.status(404).json({ error: "Scraper task not found" });
    return;
  }

  target.last_status = "running";
  target.last_run_at = new Date().toISOString();

  const result = await executeScrapingPipeline({
    configId: target.id,
    name: target.name,
    category: target.category,
    datasetId: target.dataset_id,
  });

  target.last_status = result.success ? "completed" : "failed";
  target.extracted_count = result.extractedCount;

  res.json({ data: result });
});

// POST /api/scrape/instant - One-click instant category scraper without saving
app.post("/api/scrape/instant", async (req, res) => {
  const { name, category, dataset_id } = req.body;
  if (!category) {
    res.status(400).json({ error: "category is required" });
    return;
  }

  const result = await executeScrapingPipeline({
    name: name || `${category} Scrape`,
    category,
    datasetId: dataset_id || DEFAULT_DATASET_ID,
  });

  res.json({ data: result });
});

// --- 2. Databases / Datasets API ---

// GET /api/datasets - List created databases
app.get("/api/datasets", async (_req, res) => {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from("datasets")
        .select("id, title, category, record_count, frequency, updated_at")
        .order("created_at", { ascending: false });

      if (!error && data) {
        res.json({ data });
        return;
      }
    } catch {
      // ignore
    }
  }

  // Fallback in-memory
  res.json({
    data: [
      {
        id: DEFAULT_DATASET_ID,
        title: "Pune Real Estate Data",
        category: "Residential Real Estate",
        record_count: 57,
        frequency: "Real-Time",
        updated_at: new Date().toISOString(),
      },
    ],
  });
});

// PATCH /api/datasets/:id - Edit database name / category / frequency
app.patch("/api/datasets/:id", async (req, res) => {
  const { id } = req.params;
  const { title, category, frequency } = req.body;

  if (isSupabaseConfigured() && supabase) {
    try {
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (title) updates.title = String(title).trim();
      if (category) updates.category = String(category).trim();
      if (frequency) updates.frequency = String(frequency).trim();

      const { data, error } = await supabase
        .from("datasets")
        .update(updates)
        .eq("id", id)
        .select("id, title, category, record_count, frequency, updated_at")
        .single();

      if (!error && data) {
        res.json({ data });
        return;
      }
    } catch (e) {
      console.warn("Update dataset in Supabase failed:", e);
    }
  }

  res.json({
    data: {
      id,
      title: title || "Pune Real Estate Data",
      category: category || "Residential Real Estate",
      record_count: 57,
      frequency: frequency || "Real-Time",
      updated_at: new Date().toISOString(),
    },
  });
});

// GET /api/stats
app.get("/api/stats", async (_req, res) => {
  let totalProperties = 0;
  let totalRuns = 0;

  if (isSupabaseConfigured() && supabase) {
    try {
      const [propsRes, runsRes] = await Promise.all([
        supabase.from("properties").select("id", { count: "exact", head: true }),
        supabase.from("scraper_runs").select("id", { count: "exact", head: true }),
      ]);
      totalProperties = propsRes.count ?? 0;
      totalRuns = runsRes.count ?? 0;
    } catch {
      // ignore
    }
  }

  res.json({
    data: {
      supabaseConfigured: isSupabaseConfigured(),
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      totalProperties,
      totalRuns,
      port,
    },
  });
});

// Serve frontend static assets from public/
const publicDir = path.resolve(process.cwd(), "public");
app.use(express.static(publicDir));

// Fallback to index.html for client-side routing
app.use((_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(port, () => {
  console.log(
    JSON.stringify({
      service: "digger-admin",
      port,
      supabase: isSupabaseConfigured() ? "connected" : "offline",
      ai: Boolean(process.env.GEMINI_API_KEY) ? "gemini-enabled" : "heuristic-fallback",
      adminUrl: `http://localhost:${port}`,
    })
  );
});
