import { Router } from "express";
import { TelemetryService } from "../services/telemetryService.js";

export const telemetryRouter = Router();

telemetryRouter.get("/", async (_req, res) => {
  try {
    const telemetry = await TelemetryService.getTelemetry();
    res.json({ data: telemetry });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load telemetry",
    });
  }
});
