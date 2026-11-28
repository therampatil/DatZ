import crypto from "node:crypto";
import { DownloadService } from "../services/downloadService.js";
import { DatasetService } from "../services/datasetService.js";
import { supabase, isSupabaseConfigured, uploadSnapshotToSupabase, STORAGE_BUCKETS } from "../db/supabase.js";
import { DatasetModel } from "../types/dataset.js";

const DATASET_CONCURRENCY = 2;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export class SnapshotBuilder {
  /**
   * Pre-compiles and uploads snapshot bundles (CSV, XLSX, Parquet)
   * to Supabase Storage for all active datasets. Datasets are processed
   * concurrently with a small limit; each format is uploaded exactly once.
   */
  static async buildAllSnapshots(): Promise<{
    processedDatasets: number;
    totalSnapshotsCreated: number;
  }> {
    if (!isSupabaseConfigured() || !supabase) {
      console.warn("Supabase is not configured. Snapshot uploads skipped.");
      return { processedDatasets: 0, totalSnapshotsCreated: 0 };
    }

    const datasets = await DatasetService.getDatasets({});
    const formats: Array<"csv" | "xlsx" | "parquet"> = ["csv", "xlsx", "parquet"];

    const createdPerDataset = await mapWithConcurrency(datasets, DATASET_CONCURRENCY, async (dataset: DatasetModel) => {
      console.log(`Building pre-compiled snapshot bundles for: ${dataset.title} (${dataset.code})`);
      let created = 0;

      for (const format of formats) {
        try {
          // The builder owns the storage upload and dataset_snapshots bookkeeping,
          // so disable the download-service's own upload/order logging.
          const snapshot = await DownloadService.generateSnapshot(
            { datasetSlug: dataset.slug, format },
            { uploadToStorage: false, logDownloadOrder: false }
          );

          const checksum = crypto.createHash("sha256").update(snapshot.buffer).digest("hex");
          const storagePath = `snapshots/${dataset.slug}/${snapshot.fileName}`;

          await uploadSnapshotToSupabase(storagePath, snapshot.buffer, snapshot.contentType);

          await supabase!.from("dataset_snapshots").insert({
            dataset_id: dataset.id,
            format,
            storage_bucket: STORAGE_BUCKETS.SNAPSHOTS_VAULT,
            storage_path: storagePath,
            file_size_bytes: snapshot.buffer.length,
            record_count: snapshot.recordCount,
            sha256_checksum: checksum,
            generated_at: new Date().toISOString(),
          });

          created++;
        } catch (err) {
          console.warn(`Snapshot generation failed for ${dataset.slug} (${format}):`, err);
        }
      }

      await supabase!
        .from("datasets")
        .update({
          updated_tag: "Just now",
          updated_at: new Date().toISOString(),
        })
        .eq("id", dataset.id);

      return created;
    });

    return {
      processedDatasets: datasets.length,
      totalSnapshotsCreated: createdPerDataset.reduce((sum, count) => sum + count, 0),
    };
  }
}
