import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { requireScope } from "../middleware/apiKey.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { OrderError, OrderService } from "../services/orderService.js";

export const ordersRouter = Router();

const checkoutSchema = z.object({
  datasetSlug: z.string().min(1),
  customerEmail: z.string().email().optional(),
  planType: z.enum(["snapshot", "custom"]).default("snapshot"),
  format: z.enum(["csv", "xlsx", "parquet"]).default("csv"),
});

const customRequestSchema = z.object({
  customerEmail: z.string().email(),
  targetLocations: z.string().min(1),
  targetSources: z.string().min(1),
  requiredAttributes: z.string().min(1),
  budgetEstimate: z.string().optional(),
});

function requireSandboxPayments(_req: Request, res: Response, next: NextFunction): void {
  if (process.env.ALLOW_SANDBOX_PAYMENTS !== "true") {
    res.status(403).json({ error: "Sandbox payments are disabled" });
    return;
  }
  next();
}

ordersRouter.post(
  "/checkout",
  rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "order-checkout" }),
  requireScope("orders:write", "web:session"),
  async (req, res) => {
    try {
      const input = checkoutSchema.parse(req.body);
      const result = await OrderService.createPendingOrder(input);
      res.json({ success: true, ...result });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid checkout request", details: error.issues });
        return;
      }
      res.status(error instanceof OrderError ? error.status : 400).json({
        error: error instanceof Error ? error.message : "Checkout failed",
      });
    }
  }
);

/** Sandbox-only escape hatch; a real payment provider must replace this flow. */
ordersRouter.post(
  "/:id/confirm",
  rateLimit({ windowMs: 60_000, max: 5, keyPrefix: "order-confirm" }),
  requireScope("admin:sandbox"),
  requireSandboxPayments,
  async (req, res) => {
    try {
      const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
      const result = await OrderService.confirmSandboxOrder(id);
      res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid order id" });
        return;
      }
      res.status(error instanceof OrderError ? error.status : 500).json({
        error: error instanceof Error ? error.message : "Sandbox confirmation failed",
      });
    }
  }
);

ordersRouter.post("/custom-requests", async (req, res) => {
  try {
    const input = customRequestSchema.parse(req.body);
    const result = await OrderService.submitCustomRequest(input);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Invalid request form",
    });
  }
});
