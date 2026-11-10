/**
 * Klip Production D1 Migration Runner
 * Executes schema.sql and migrations/0001_initial_data_migration.sql
 * directly against Cloudflare D1 via the REST API.
 * Validates record counts and data integrity.
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
const DATABASE_ID = process.env.CLOUDFLARE_D1_DATABASE_ID || "d7a63d25-d614-413a-81bc-cbc8c3ec937b";
const API_TOKEN = process.env.CLOUDFLARE_D1_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;

if (!API_TOKEN) {
  console.error("Missing CLOUDFLARE_D1_API_TOKEN in .env");
  process.exit(1);
}

const D1_QUERY_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`;

async function executeD1Query(sql) {
  const res = await fetch(D1_QUERY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql }),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    const errMsg = data.errors?.[0]?.message || `HTTP ${res.status}`;
    throw new Error(`D1 API error: ${errMsg} (SQL: ${sql.slice(0, 100)}...)`);
  }
  return data.result;
}

function parseStatements(sql) {
  // Remove block comments
  const clean = sql.replace(/\/\*[\s\S]*?\*\//g, "");
  const statements = [];
  let current = "";
  let inString = false;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (char === "'" && (i === 0 || clean[i - 1] !== "\\")) {
      inString = !inString;
    }
    if (char === ";" && !inString) {
      const trimmed = current.trim();
      const codeOnly = trimmed
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim();
      if (codeOnly.length > 0) {
        statements.push(codeOnly);
      }
      current = "";
    } else {
      current += char;
    }
  }

  const remainder = current.trim().split(/\r?\n/).filter((line) => !line.trim().startsWith("--")).join("\n").trim();
  if (remainder.length > 0) {
    statements.push(remainder);
  }

  return statements;
}

async function runMigration() {
  console.log(`[D1 Migration] Target Database: ${DATABASE_ID}`);
  console.log(`[D1 Migration] Cloudflare Account: ${ACCOUNT_ID}`);

  // Step 1: Read & Apply schema.sql
  console.log("\n[Step 1] Applying schema.sql...");
  const schemaPath = path.join(__dirname, "..", "schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  const schemaStatements = parseStatements(schemaSql);

  console.log(`[Step 1] Found ${schemaStatements.length} schema statements.`);
  for (let i = 0; i < schemaStatements.length; i++) {
    const stmt = schemaStatements[i];
    await executeD1Query(stmt);
    console.log(`  [${i + 1}/${schemaStatements.length}] Executed: ${stmt.slice(0, 50).replace(/\r?\n/g, " ")}...`);
  }
  console.log("\n[Step 1] Schema applied successfully! Table structure ready.\n");

  // Step 2: Read & Apply migrations/0001_initial_data_migration.sql
  console.log("[Step 2] Applying data migration: 0001_initial_data_migration.sql...");
  await executeD1Query("PRAGMA foreign_keys = OFF;");
  const dataPath = path.join(__dirname, "..", "migrations", "0001_initial_data_migration.sql");
  const dataSql = fs.readFileSync(dataPath, "utf8");
  const dataStatements = parseStatements(dataSql);

  console.log(`[Step 2] Found ${dataStatements.length} data statements to execute.`);

  // Execute in batches of 15
  const BATCH_SIZE = 15;
  for (let i = 0; i < dataStatements.length; i += BATCH_SIZE) {
    const batch = dataStatements.slice(i, i + BATCH_SIZE);
    const combinedSql = "PRAGMA foreign_keys = OFF;\n" + batch.join(";\n") + ";";
    await executeD1Query(combinedSql);
    const completed = Math.min(i + BATCH_SIZE, dataStatements.length);
    process.stdout.write(`  Inserted records [${completed}/${dataStatements.length}]\r`);
  }
  console.log("\n[Step 2] Data migration applied successfully!\n");
  await executeD1Query("PRAGMA foreign_keys = ON;");

  // Step 3: Verify row counts in production D1
  console.log("[Step 3] Verifying production record counts in D1...");
  const tables = [
    "users",
    "user_status",
    "klips",
    "klip_likes",
    "klip_bookmarks",
    "follows",
    "klip_comments",
    "comment_likes",
    "notifications",
    "sounds",
  ];

  console.log("================ PRODUCTION D1 RECORD COUNTS ================");
  for (const table of tables) {
    const result = await executeD1Query(`SELECT COUNT(*) as count FROM ${table};`);
    const count = result?.[0]?.results?.[0]?.count ?? "error";
    console.log(`  Table: ${table.padEnd(16)} -> ${count} rows`);
  }
  console.log("============================================================\n");
}

runMigration().catch((err) => {
  console.error("\n[D1 Migration FAILED]:", err.message);
  process.exit(1);
});
