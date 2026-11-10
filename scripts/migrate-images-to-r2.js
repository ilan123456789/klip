/**
 * Klip Idempotent Image & Media Migration Script: Firebase Storage -> Cloudflare R2
 * Scans user avatars and slideshow photos from Firebase.
 * Uploads them into Cloudflare R2 bucket: kli-videos (videos.kliponline.com).
 * Verifies accessibility via custom domain and updates D1 database records.
 * Run with: node scripts/migrate-images-to-r2.js --live
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse .env natively
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const envText = fs.readFileSync(envPath, "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "0d5fb2ccdbc60ef2550a5500b575696f";
const BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET || "kli-videos";
const DATABASE_ID = process.env.CLOUDFLARE_D1_DATABASE_ID || "d7a63d25-d614-413a-81bc-cbc8c3ec937b";
const API_TOKEN = process.env.CLOUDFLARE_R2_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const FIREBASE_DATABASE_URL = process.env.FIREBASE_DATABASE_URL || "https://gevaldig-portal-default-rtdb.firebaseio.com";
const R2_PUBLIC_DOMAIN = "videos.kliponline.com";
const isLive = process.argv.includes("--live");

async function executeD1Query(sql, params = []) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    }
  );
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.errors?.[0]?.message || `D1 error HTTP ${res.status}`);
  }
  return data.result;
}

async function uploadToR2(targetKey, buffer, contentType) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET_NAME}/objects/${encodeURIComponent(targetKey)}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": contentType || "image/jpeg",
    },
    body: buffer,
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.errors?.[0]?.message || `R2 Upload failed with HTTP ${res.status}`);
  }
  return data.result;
}

async function migrateImages() {
  console.log(`[R2 Migration] Mode: ${isLive ? "LIVE EXECUTION" : "DRY RUN (pass --live to execute)"}`);
  console.log(`[R2 Migration] Target R2 Bucket: ${BUCKET_NAME}`);
  console.log(`[R2 Migration] Public Delivery Domain: https://${R2_PUBLIC_DOMAIN}`);

  // 1. Scan User Avatars
  console.log("\n[1/3] Scanning Firebase users for avatar images...");
  const usersRes = await fetch(`${FIREBASE_DATABASE_URL}/users.json`);
  const users = await usersRes.json();
  const avatarItems = [];

  for (const [uid, user] of Object.entries(users || {})) {
    if (user && user.AvatarUrl && user.AvatarUrl.includes("firebasestorage.googleapis.com")) {
      avatarItems.push({
        uid,
        type: "avatar",
        handle: user.Handle,
        sourceUrl: user.AvatarUrl,
        targetKey: `avatars/${uid}.jpg`,
        publicUrl: `https://${R2_PUBLIC_DOMAIN}/avatars/${uid}.jpg`,
      });
    }
  }
  console.log(`Found ${avatarItems.length} user avatars hosted on Firebase Storage.`);

  // 2. Scan Klips for Slideshow Photos
  console.log("\n[2/3] Scanning Klips for slideshow photos...");
  const klipsRes = await fetch(`${FIREBASE_DATABASE_URL}/klips.json`);
  const klips = await klipsRes.json();
  const photoItems = [];

  for (const [klipId, klip] of Object.entries(klips || {})) {
    if (klip && Array.isArray(klip.PhotoUrls)) {
      klip.PhotoUrls.forEach((photoUrl, idx) => {
        if (photoUrl && photoUrl.includes("firebasestorage.googleapis.com")) {
          photoItems.push({
            klipId,
            index: idx,
            type: "slideshow_photo",
            sourceUrl: photoUrl,
            targetKey: `klip_photos/${klipId}_${idx}.jpg`,
            publicUrl: `https://${R2_PUBLIC_DOMAIN}/klip_photos/${klipId}_${idx}.jpg`,
          });
        }
      });
    }
  }
  console.log(`Found ${photoItems.length} slideshow photos hosted on Firebase Storage.`);

  const allItems = [...avatarItems, ...photoItems];
  console.log(`Total Media Assets to Migrate: ${allItems.length}`);

  if (!isLive) {
    console.log("\n[Dry Run Completed] Run with `node scripts/migrate-images-to-r2.js --live` to execute.");
    return;
  }

  // Live Execution: Download, Upload to R2, Verify
  console.log("\nStarting Live R2 Media Migration...");
  let countUploaded = 0;
  let countVerified = 0;
  let countFailed = 0;

  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i];
    console.log(`[${i + 1}/${allItems.length}] Migrating ${item.type}: ${item.targetKey}`);

    try {
      // A. Download from Firebase Storage
      const dlRes = await fetch(item.sourceUrl);
      if (!dlRes.ok) {
        throw new Error(`Failed to download from Firebase (HTTP ${dlRes.status})`);
      }
      const arrayBuf = await dlRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      const contentType = dlRes.headers.get("content-type") || "image/jpeg";

      // B. Upload to R2
      await uploadToR2(item.targetKey, buffer, contentType);
      countUploaded++;

      // C. Verify via custom domain
      const checkRes = await fetch(item.publicUrl, { method: "HEAD" });
      if (checkRes.ok) {
        console.log(`  -> SUCCESS! Live at: ${item.publicUrl} (${buffer.length} bytes, HTTP ${checkRes.status})`);
        countVerified++;
      } else {
        console.warn(`  -> WARNING: Uploaded to R2, but public domain returned HTTP ${checkRes.status}`);
      }
    } catch (err) {
      console.error(`  -> FAILED: ${err.message}`);
      countFailed++;
    }
  }

  // 3. Update D1 Database references to use R2 URLs
  console.log("\n[3/3] Updating D1 Database references to use Cloudflare R2 URLs...");

  // Update Users Avatars in D1
  for (const avatar of avatarItems) {
    await executeD1Query(
      `UPDATE users SET avatar_url = ? WHERE uid = ?;`,
      [avatar.publicUrl, avatar.uid]
    );
    await executeD1Query(
      `UPDATE klips SET creator_avatar_url = ? WHERE creator_uid = ?;`,
      [avatar.publicUrl, avatar.uid]
    );
    await executeD1Query(
      `UPDATE klip_comments SET user_avatar_url = ? WHERE user_uid = ?;`,
      [avatar.publicUrl, avatar.uid]
    );
    await executeD1Query(
      `UPDATE notifications SET from_avatar_url = ? WHERE from_uid = ?;`,
      [avatar.publicUrl, avatar.uid]
    );
  }
  console.log(`  -> Updated avatar URLs in D1 for ${avatarItems.length} users.`);

  // Update Slideshow Photos in D1
  // Group photos by KlipId
  const klipPhotosMap = {};
  for (const p of photoItems) {
    if (!klipPhotosMap[p.klipId]) klipPhotosMap[p.klipId] = [];
    klipPhotosMap[p.klipId][p.index] = p.publicUrl;
  }

  for (const [kId, urls] of Object.entries(klipPhotosMap)) {
    const jsonStr = JSON.stringify(urls);
    await executeD1Query(
      `UPDATE klips SET photo_urls = ? WHERE id = ?;`,
      [jsonStr, kId]
    );
  }
  console.log(`  -> Updated photo_urls in D1 for ${Object.keys(klipPhotosMap).length} slideshow Klips.`);

  console.log(`\n================ R2 MIGRATION SUMMARY ================`);
  console.log(`Total Media Assets: ${allItems.length}`);
  console.log(`Uploaded to R2:     ${countUploaded}`);
  console.log(`Verified Active:    ${countVerified}`);
  console.log(`Failed:             ${countFailed}`);
  console.log(`D1 URLs Updated:    YES`);
  console.log(`======================================================\n`);
}

migrateImages().catch((err) => {
  console.error("R2 migration fatal error:", err);
  process.exit(1);
});
