/**
 * Cloudflare D1 Helper Utilities for Klip
 * Operates on context.env.KLIPBASE
 */

export function getDb(env) {
  if (!env || !env.KLIPBASE) {
    throw new Error("KLIPBASE binding not found in environment.");
  }
  return env.KLIPBASE;
}

/**
 * Execute a query returning the first matching row
 */
export async function queryFirst(db, sql, ...params) {
  const stmt = db.prepare(sql).bind(...params);
  return await stmt.first();
}

/**
 * Execute a query returning all matching rows
 */
export async function queryAll(db, sql, ...params) {
  const stmt = db.prepare(sql).bind(...params);
  const result = await stmt.all();
  return result?.results || [];
}

/**
 * Execute a write query (INSERT / UPDATE / DELETE)
 */
export async function execute(db, sql, ...params) {
  const stmt = db.prepare(sql).bind(...params);
  return await stmt.run();
}

