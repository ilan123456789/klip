/**
 * Klip Firebase Complete Data Backup Script
 * Safely downloads a full snapshot of all Firebase Realtime Database collections
 * to local disk before any migration actions take place.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIREBASE_DATABASE_URL = process.env.FIREBASE_DATABASE_URL || "https://gevaldig-portal-default-rtdb.firebaseio.com";

const COLLECTIONS = [
  "users",
  "klips",
  "klipComments",
  "userLikes",
  "userBookmarks",
  "userCommentLikes",
  "followers",
  "following",
  "notifications",
  "status"
];

async function runBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(__dirname, "..", "backups", `backup_${timestamp}`);
  fs.mkdirSync(backupDir, { recursive: true });

  console.log(`[Backup] Starting full Firebase snapshot into ${backupDir}...`);

  const summary = {};

  for (const col of COLLECTIONS) {
    try {
      const url = `${FIREBASE_DATABASE_URL}/${col}.json`;
      console.log(`[Backup] Fetching collection: ${col}...`);
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[Backup] Warning: Failed to fetch ${col} (HTTP ${res.status})`);
        continue;
      }
      const data = await res.json();
      const count = data ? Object.keys(data).length : 0;
      summary[col] = count;

      const outPath = path.join(backupDir, `${col}.json`);
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf8");
      console.log(`[Backup] Saved ${col}: ${count} records -> ${outPath}`);
    } catch (err) {
      console.error(`[Backup] Error exporting ${col}:`, err);
    }
  }

  const summaryPath = path.join(backupDir, "summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify({ timestamp, summary }, null, 2), "utf8");
  console.log(`\n[Backup] Complete! Summary:`, summary);
}

runBackup().catch((e) => {
  console.error("[Backup] Fatal backup error:", e);
  process.exit(1);
});

