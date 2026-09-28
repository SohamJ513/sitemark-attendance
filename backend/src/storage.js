import { createClient } from '@supabase/supabase-js';

// Check-in photos live in Supabase Storage (not local disk) so they survive
// redeploys/restarts on hosts with ephemeral filesystems (Render, Railway, etc).
const BUCKET = process.env.SUPABASE_PHOTO_BUCKET || 'attendance-photos';

let client = null;
function getClient() {
  if (client) return client;
  const rawUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!rawUrl || !key) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example) to store check-in photos.'
    );
  }
  // A trailing slash or an extra path segment (e.g. copying the URL from a
  // place that appends /rest/v1) makes the storage client build a malformed
  // request URL, which Supabase reports as "Invalid path specified in
  // request URL" — so normalize down to just the origin, every time.
  let url;
  try {
    url = new URL(rawUrl).origin;
  } catch {
    throw new Error(`SUPABASE_URL is not a valid URL: "${rawUrl}"`);
  }
  // Service role key bypasses the bucket's RLS/policies, which is fine here —
  // this server is the only thing that ever touches the bucket directly, and
  // access control for photos is already enforced in index.js.
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export async function uploadPhoto(pathInBucket, buffer, contentType) {
  const { error } = await getClient()
    .storage.from(BUCKET)
    .upload(pathInBucket, buffer, { contentType, upsert: false });
  if (error) throw new Error(`Photo upload failed: ${error.message}`);
}

export async function downloadPhoto(pathInBucket) {
  const { data, error } = await getClient().storage.from(BUCKET).download(pathInBucket);
  if (error) throw new Error(`Photo download failed: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function deletePhoto(pathInBucket) {
  if (!pathInBucket) return;
  // Best-effort — if this fails we'd rather leave an orphaned file than crash
  // whatever request triggered the delete.
  await getClient()
    .storage.from(BUCKET)
    .remove([pathInBucket])
    .catch(() => {});
}