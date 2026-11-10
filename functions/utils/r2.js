/**
 * Cloudflare R2 Helper Utilities for Klip
 * Operates on context.env.KLIPVIDEOS (bucket: klip-videos)
 */

export function getR2(env) {
  if (!env || !env.KLIPVIDEOS) {
    throw new Error("KLIPVIDEOS binding not found in environment.");
  }
  return env.KLIPVIDEOS;
}

export const R2_PUBLIC_DOMAIN = "videos.kliponline.com";

/**
 * Upload a stream, buffer, or string to R2
 */
export async function uploadObject(bucket, key, data, contentType = "application/octet-stream", customMetadata = {}) {
  return await bucket.put(key, data, {
    httpMetadata: {
      contentType,
      cacheControl: "public, max-age=31536000, immutable",
    },
    customMetadata,
  });
}

/**
 * Retrieve an object from R2
 */
export async function getObject(bucket, key) {
  return await bucket.get(key);
}

/**
 * Check if an object exists in R2
 */
export async function objectExists(bucket, key) {
  const head = await bucket.head(key);
  return head !== null;
}

/**
 * Delete an object from R2
 */
export async function deleteObject(bucket, key) {
  return await bucket.delete(key);
}

/**
 * Generate public delivery URL for an R2 key
 */
export function getPublicMediaUrl(key) {
  return `https://${R2_PUBLIC_DOMAIN}/${key.replace(/^\/+/, "")}`;
}

