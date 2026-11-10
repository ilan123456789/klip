import { getDb } from "../../utils/d1.js";

/**
 * Cloudflare Pages Function: Admin D1 Setup & Verification
 * Route: POST /api/admin/setup-d1
 * Protected by X-Admin-Key matching context.env.SESSION_SECRET
 */
export async function onRequestPost(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const adminKey = context.request.headers.get("x-admin-key");
    const expectedSecret = context.env.SESSION_SECRET;

    if (!adminKey || !expectedSecret || adminKey !== expectedSecret || expectedSecret.includes("klip_secret_session_key")) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized. Admin secret is unconfigured or invalid." }), {
        status: 401,
        headers,
      });
    }

    const db = getDb(context.env);
    const body = await context.request.json().catch(() => ({}));
    const action = body.action || "status";

    if (action === "execute") {
      const sql = body.sql;
      if (!sql || typeof sql !== "string") {
        return new Response(JSON.stringify({ success: false, error: "Missing 'sql' string." }), {
          status: 400,
          headers,
        });
      }

      // Execute SQL using D1 native exec()
      const execResult = await db.exec(sql);
      return new Response(JSON.stringify({ success: true, result: execResult }), { status: 200, headers });
    }

    if (action === "batch") {
      const statements = body.statements;
      if (!Array.isArray(statements) || statements.length === 0) {
        return new Response(JSON.stringify({ success: false, error: "Missing 'statements' array." }), {
          status: 400,
          headers,
        });
      }

      const prepared = statements.map((stmt) => db.prepare(stmt));
      const batchResult = await db.batch(prepared);
      return new Response(JSON.stringify({ success: true, count: batchResult.length }), { status: 200, headers });
    }

    // Default: Check DB Status and Count Rows
    const tables = ["users", "user_status", "klips", "klip_likes", "klip_bookmarks", "follows", "klip_comments", "comment_likes", "notifications", "sounds"];
    const counts = {};

    for (const tbl of tables) {
      try {
        const row = await db.prepare(`SELECT COUNT(*) AS c FROM ${tbl};`).first();
        counts[tbl] = row ? row.c : 0;
      } catch (e) {
        counts[tbl] = `Not created yet (${e.message})`;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      database: "KLIPBASE",
      status: "connected",
      tables: counts,
    }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers,
    });
  }
}

