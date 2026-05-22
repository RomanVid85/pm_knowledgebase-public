// Storage helpers for the 'artifacts' bucket. Bucket is private (see
// migration 0007_storage_buckets.sql); these helpers use the service-role
// admin client.

import { adminClient } from "@/lib/supabase/admin";

const BUCKET = "artifacts";

/** Upload a file to the artifacts bucket. Returns the storage path. */
export async function uploadArtifact(
  file: File | Blob,
  storagePath: string,
): Promise<{ path: string }> {
  const supabase = adminClient();
  const { data, error } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
    upsert: false,
  });
  if (error || !data) {
    throw new Error(`Storage upload failed: ${error?.message ?? "no data"}`);
  }
  return { path: data.path };
}

/** Download a file from the artifacts bucket as a Buffer. */
export async function downloadArtifact(storagePath: string): Promise<Buffer> {
  const supabase = adminClient();
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
  if (error || !data) {
    throw new Error(`Storage download failed: ${error?.message ?? "no data"}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

/** Build a deterministic storage path for a given user + filename + timestamp. */
export function storagePathFor(userId: string, filename: string): string {
  const safeName = filename.replace(/[^\w.-]/g, "_");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${userId}/${ts}-${safeName}`;
}
