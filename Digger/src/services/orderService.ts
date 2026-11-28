import { CustomScraperInput } from "../types/dataset.js";
import { supabase, isSupabaseConfigured } from "../db/supabase.js";
import { hashApiKey, signDownloadToken } from "./authService.js";
import { DatasetService } from "./datasetService.js";
import { DownloadService } from "./downloadService.js";

export type SnapshotFormat = "csv" | "xlsx" | "parquet";

export class OrderError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "OrderError";
  }
}

export interface CheckoutInput {
  datasetSlug: string;
  customerEmail?: string;
  planType?: "snapshot" | "custom";
  format?: SnapshotFormat;
}

const SANDBOX_TOKEN_TTL_MS = 60 * 60 * 1000;

export class OrderService {
  /**
   * Creates an UNFULFILLED order. No snapshot, download URL or payment is
   * produced until a payment integration (or the explicit sandbox flow) acts.
   */
  static async createPendingOrder(data: CheckoutInput) {
    const dataset = await DatasetService.getDatasetBySlug(data.datasetSlug);
    if (!dataset) throw new OrderError("Dataset not found", 404);

    const format = data.format || "csv";
    const amount = Number(dataset.snapshot_price) || 0;
    let orderId: string;

    if (isSupabaseConfigured() && supabase) {
      const { data: inserted, error } = await supabase
        .from("download_orders")
        .insert({
          dataset_id: dataset.id,
          customer_email: data.customerEmail || "anonymous@datz.internal",
          format,
          filters: {},
          amount_paid: 0,
          payment_provider: "sandbox",
          status: "pending",
          payment_status: "unpaid",
        })
        .select("id")
        .single();

      if (error || !inserted) {
        throw new OrderError("Could not create the pending order", 502);
      }
      orderId = String(inserted.id);
    } else {
      // Offline/local mode: no database row exists, but the response is still
      // explicitly pending and unfulfilled.
      orderId = `ORD-IN-${Date.now().toString(36).toUpperCase()}`;
    }

    return {
      orderId,
      status: "pending",
      paymentRequired: true,
      amount,
      dataset: { title: dataset.title, code: dataset.code, price: amount },
      message: "Payment integration pending; this order is not fulfilled.",
    };
  }

  /** Backwards-compatible alias for callers using the old method name. */
  static async processCheckout(data: CheckoutInput) {
    return this.createPendingOrder(data);
  }

  /**
   * Explicit sandbox-only authorization. Never enabled unless the operator sets
   * ALLOW_SANDBOX_PAYMENTS=true and the caller has the `admin:sandbox` scope.
   */
  static async confirmSandboxOrder(orderId: string) {
    if (!supabase) {
      throw new OrderError("Sandbox confirmation requires the Supabase admin client", 503);
    }

    const { data: order, error } = await supabase
      .from("download_orders")
      .select("id, dataset_id, format, status, payment_status, amount_paid, datasets(slug, code, title)")
      .eq("id", orderId)
      .single();

    if (error || !order) throw new OrderError("Order not found", 404);

    if (order.status !== "pending" || order.payment_status !== "unpaid") {
      throw new OrderError("Only unpaid pending orders can be authorized in sandbox mode", 409);
    }

    const relation = (order as unknown as Record<string, unknown>).datasets;
    const datasetRow = (Array.isArray(relation) ? relation[0] : relation) as { slug?: string } | null;
    const datasetSlug = datasetRow?.slug;
    if (!datasetSlug) throw new OrderError("Order dataset could not be resolved", 500);

    const format = order.format as SnapshotFormat;
    // Generate and upload exactly once. logDownloadOrder stays false so no
    // second (fulfilled) order row is created as a side effect.
    const snapshot = await DownloadService.generateSnapshot(
      { datasetSlug, format },
      { uploadToStorage: true, logDownloadOrder: false }
    );
    if (!snapshot.downloadUrl) {
      throw new OrderError("Snapshot upload failed; the order remains pending", 502);
    }

    const expiresAtMs = Date.now() + SANDBOX_TOKEN_TTL_MS;
    const expiresAt = new Date(expiresAtMs).toISOString();
    const downloadToken = signDownloadToken({
      orderId: String(order.id),
      datasetSlug,
      format,
      exp: expiresAtMs,
    });

    const { error: updateError } = await supabase
      .from("download_orders")
      .update({
        status: "ready",
        payment_status: "authorized",
        file_name: snapshot.fileName,
        download_url: snapshot.downloadUrl,
        expires_at: expiresAt,
        access_token_hash: hashApiKey(downloadToken),
        payment_provider: "sandbox",
        payment_id: `sandbox-${order.id}`,
      })
      .eq("id", order.id);

    if (updateError) throw new OrderError("Could not finalize the sandbox order", 502);

    return {
      sandbox: true,
      orderId: String(order.id),
      status: "ready",
      paymentStatus: "authorized",
      downloadToken,
      expiresAt,
      expiresIn: SANDBOX_TOKEN_TTL_MS / 1000,
      downloadUrl: `/api/v1/downloads/file?token=${encodeURIComponent(downloadToken)}`,
      warning: "Sandbox authorization only; no real payment was processed.",
    };
  }

  /** Submits a custom scraper request. */
  static async submitCustomRequest(input: CustomScraperInput) {
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from("custom_scraper_requests")
          .insert({
            customer_email: input.customerEmail,
            target_locations: input.targetLocations,
            target_sources: input.targetSources,
            required_attributes: input.requiredAttributes,
            budget_estimate: input.budgetEstimate || "Standard",
            status: "received",
          })
          .select()
          .single();
        if (!error && data) return data;
      } catch (err) {
        console.warn("Supabase insert error for custom request:", err);
      }
    }

    return {
      id: `REQ-${Date.now().toString(36).toUpperCase()}`,
      status: "received",
      customerEmail: input.customerEmail,
      createdAt: new Date().toISOString(),
      message: "Custom scraper request received. Our data engineering team will contact you within 24 hours.",
    };
  }
}
