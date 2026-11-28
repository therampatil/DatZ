import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Two deliberately separate clients:
 *
 * - `supabase` uses the SERVICE ROLE key. It bypasses RLS and is for server-only
 *   work (writes, download fulfilment, scraper runs). NEVER expose this client or
 *   the service-role key to client-facing/browser code or bundled assets.
 * - `supabasePublic` uses the ANON key and is for public catalog/preview reads
 *   that are safe under RLS. It must never be used for writes or order access.
 *
 * Both are null in offline mode so the local catalog fixtures keep working.
 */
const supabaseUrl = process.env.SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const anonKey = process.env.SUPABASE_ANON_KEY?.trim();

const hasUsableUrl = Boolean(supabaseUrl && !supabaseUrl.includes("your-project-id"));

if (hasUsableUrl && anonKey && !serviceRoleKey) {
  console.warn(
    "[supabase] SUPABASE_SERVICE_ROLE_KEY is missing while SUPABASE_ANON_KEY is set. " +
      "The admin client is disabled (server-side writes/downloads will not work); " +
      "public reads will use the anon client. The service-role key must never be " +
      "used in client-facing code."
  );
}

/** True when either key is configured; individual clients may still be null. */
export const isSupabaseConfigured = (): boolean => {
  return Boolean(hasUsableUrl && (serviceRoleKey || anonKey));
};

const createServerClient = (key: string): SupabaseClient =>
  createClient(supabaseUrl!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

/** Service-role client. SERVER ONLY — bypasses RLS. */
export const supabase: SupabaseClient | null =
  hasUsableUrl && serviceRoleKey ? createServerClient(serviceRoleKey) : null;

/** Anon-key client for safe public reads only. */
export const supabasePublic: SupabaseClient | null =
  hasUsableUrl && anonKey ? createServerClient(anonKey) : null;

export const STORAGE_BUCKETS = {
  SNAPSHOTS_VAULT: process.env.SUPABASE_STORAGE_BUCKET || "snapshots-vault",
  SAMPLES_PUBLIC: process.env.SUPABASE_STORAGE_PUBLIC_BUCKET || "samples-public",
};

/**
 * Creates a time-limited signed URL for a snapshot stored in Supabase Storage.
 * Requires the admin client so private snapshots are never exposed by accident.
 */
export async function createSignedSnapshotUrl(
  path: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKETS.SNAPSHOTS_VAULT)
      .createSignedUrl(path, expiresInSeconds);
    if (error) {
      console.warn("Failed to create signed Supabase Storage URL:", error.message);
      return null;
    }
    return data?.signedUrl || null;
  } catch (err) {
    console.warn("Supabase Storage error:", err);
    return null;
  }
}

/**
 * Uploads a snapshot buffer to Supabase Storage using the server-only client.
 */
export async function uploadSnapshotToSupabase(
  path: string,
  fileBuffer: Buffer | Uint8Array,
  contentType: string
): Promise<{ path: string; publicUrl?: string } | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKETS.SNAPSHOTS_VAULT)
      .upload(path, fileBuffer, {
        contentType,
        upsert: true,
      });
    if (error) {
      console.warn("Failed to upload snapshot to Supabase:", error.message);
      return null;
    }
    return { path: data.path };
  } catch (err) {
    console.warn("Supabase Storage upload error:", err);
    return null;
  }
}
