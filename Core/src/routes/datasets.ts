import { Router } from "express";
import { z } from "zod";
import { requireScope } from "../middleware/apiKey.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { DatasetService } from "../services/datasetService.js";

export const datasetsRouter = Router();

datasetsRouter.get("/", async (req, res) => {
  try {
    const query = z
      .object({
        search: z.string().optional(),
        category: z.string().optional(),
        geography: z.string().optional(),
        frequency: z.string().optional(),
      })
      .parse(req.query);

    const datasets = await DatasetService.getDatasets(query);
    res.json({ data: datasets, count: datasets.length });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Invalid filter parameters",
    });
  }
});

datasetsRouter.get("/:slug", async (req, res) => {
  try {
    const dataset = await DatasetService.getDatasetBySlug(req.params.slug);
    if (!dataset) {
      res.status(404).json({ error: "Dataset not found" });
      return;
    }
    res.json({ data: dataset });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch dataset" });
  }
});

datasetsRouter.get("/:slug/preview", async (req, res) => {
  try {
    const previewData = await DatasetService.getDatasetPreview(req.params.slug);
    if (!previewData) {
      res.status(404).json({ error: "Dataset not found" });
      return;
    }
    res.json({ data: previewData });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch preview" });
  }
});

/**
 * In-app full-dataset view used after the (simulated) access step. Payment is
 * deliberately not considered for testing; this gate can be tightened later
 * without changing the shaping/export path.
 */
datasetsRouter.get(
  "/:slug/records",
  requireScope("web:session"),
  rateLimit({ windowMs: 60_000, max: 30, keyPrefix: "dataset-records" }),
  async (req, res) => {
    try {
      const { slug } = z.object({ slug: z.string().min(1) }).parse(req.params);
      const dataset = await DatasetService.getDatasetBySlug(slug);
      if (!dataset) {
        res.status(404).json({ error: "Dataset not found" });
        return;
      }
      const records = await DatasetService.getFullRecords(slug);
      res.json({ data: { records, total: records.length } });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch records" });
    }
  }
);
