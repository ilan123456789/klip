/**
 * Klip Idempotent Video Migration Script: Firebase Storage -> Cloudflare Stream
 * Safely copies videos into Cloudflare Stream via the /stream/copy API.
 * Tracks progress in migration-ledger.json so it can be resumed at any time.
 * Run with: node scripts/migrate-videos-to-cloudflare.js --dry-run
 * Run with: node scripts/migrate-videos-to-cloudflare.js --live
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse .env natively without external dependencies
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
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CUSTOMER_SUBDOMAIN = process.env.CLOUDFLARE_CUSTOMER_SUBDOMAIN || "customer-wmucbvx0oqk5mob1.cloudflarestream.com";
const FIREBASE_DATABASE_URL = process.env.FIREBASE_DATABASE_URL || "https://gevaldig-portal-default-rtdb.firebaseio.com";

const LEDGER_PATH = path.join(__dirname, "..", "migration-ledger.json");
const isLive = process.argv.includes("--live");

function loadLedger() {
  if (fs.existsSync(LEDGER_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
    } catch {}
  }
  return { migrated: {}, failed: {} };
}

function saveLedger(ledger) {
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2), "utf8");
}

async function migrateVideos() {
  if (!API_TOKEN) {
    throw new Error("CLOUDFLARE_API_TOKEN is missing in .env");
  }

  console.log(`[Stream Migration] Mode: ${isLive ? "LIVE EXECUTION" : "DRY RUN (pass --live to execute)"}`);
  console.log(`[Stream Migration] Target Cloudflare Subdomain: https://${CUSTOMER_SUBDOMAIN}`);

  const ledger = loadLedger();

  // 1. Fetch current production klips
  console.log("[Stream Migration] Fetching Klips from Firebase RTDB...");
  const res = await fetch(`${FIREBASE_DATABASE_URL}/klips.json`);
  if (!res.ok) {
    throw new Error(`Failed to fetch klips (HTTP ${res.status})`);
  }
  const klips = await res.json();
  const entries = Object.entries(klips || {});

  const candidates = entries.filter(([id, k]) => {
    if (!k || !k.VideoUrl) return false;
    // Exclude photo posts
    if (Array.isArray(k.PhotoUrls) && k.PhotoUrls.length > 0) return false;
    // Only migrate videos currently on Firebase Storage
    return k.VideoUrl.includes("firebasestorage.googleapis.com") && k.videoProvider !== "cloudflare";
  });

  console.log(`[Stream Migration] Found ${entries.length} total Klips.`);
  console.log(`[Stream Migration] Found ${candidates.length} videos hosted on Firebase Storage ready for migration.\n`);

  let countSuccess = 0;
  let countSkipped = 0;
  let countFailed = 0;

  for (let i = 0; i < candidates.length; i++) {
    const [klipId, klip] = candidates[i];
    const rawUrl = klip.VideoUrl;
    const caption = (klip.Caption || "Klip Video").slice(0, 80);

    // Check if already migrated in ledger
    if (ledger.migrated[klipId]) {
      console.log(`[${i + 1}/${candidates.length}] Already migrated: ${klipId} -> UID: ${ledger.migrated[klipId].uid}`);
      countSkipped++;
      continue;
    }

    console.log(`[${i + 1}/${candidates.length}] Processing: ${klipId} ("${caption}")`);

    if (!isLive) {
      console.log(`  -> DRY RUN: Would copy URL: ${rawUrl.slice(0, 75)}...`);
      continue;
    }

    try {
      const copyRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/stream/copy`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: rawUrl,
            meta: {
              name: `${caption} (${klipId})`,
              klipId: klipId,
              creatorUid: klip.CreatorUid || "",
            },
          }),
        }
      );

      const copyData = await copyRes.json();
      if (!copyRes.ok || !copyData.success) {
        const errMessage = copyData.errors?.[0]?.message || `HTTP ${copyRes.status}`;
        console.error(`  -> FAILED: ${errMessage}`);
        ledger.failed[klipId] = { error: errMessage, timestamp: new Date().toISOString() };
        saveLedger(ledger);
        countFailed++;
        continue;
      }

      const uid = copyData.result.uid;
      const playbackUrl = `https://${CUSTOMER_SUBDOMAIN}/${uid}/manifest/video.m3u8`;
      const thumbnailUrl = `https://${CUSTOMER_SUBDOMAIN}/${uid}/thumbnails/thumbnail.jpg`;

      ledger.migrated[klipId] = {
        uid,
        playbackUrl,
        thumbnailUrl,
        originalUrl: rawUrl,
        timestamp: new Date().toISOString(),
      };
      saveLedger(ledger);

      console.log(`  -> SUCCESS! Cloudflare Stream UID: ${uid}`);
      console.log(`  -> Playback HLS: ${playbackUrl}`);
      countSuccess++;
    } catch (err) {
      console.error(`  -> ERROR:`, err.message);
      ledger.failed[klipId] = { error: err.message, timestamp: new Date().toISOString() };
      saveLedger(ledger);
      countFailed++;
    }
  }

  console.log(`\n================ MIGRATION REPORT ================`);
  console.log(`Total Candidates: ${candidates.length}`);
  console.log(`Successfully Initiated: ${countSuccess}`);
  console.log(`Previously Migrated: ${countSkipped}`);
  console.log(`Failed: ${countFailed}`);
  console.log(`Ledger Path: ${LEDGER_PATH}`);
  console.log(`==================================================\n`);
}

migrateVideos().catch((err) => {
  console.error("Migration halted with error:", err);
  process.exit(1);
});
