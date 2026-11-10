/**
 * Cloudflare Pages Function: Minimal D1 Connection Test
 * Route: GET /api/test-db
 * Accesses: context.env.KLIPBASE
 */
export async function onRequestGet(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  };

  try {
    const db = context.env?.KLIPBASE;
    if (!db) {
      return new Response(
        JSON.stringify({
          success: false,
          database: "KLIPBASE",
          error: "D1 database binding 'KLIPBASE' is not configured in this environment.",
        }),
        { status: 500, headers }
      );
    }

    // Execute harmless connection verification query
    const statement = db.prepare("SELECT 1 AS connected;");
    const row = await statement.first();

    return new Response(
      JSON.stringify({
        success: true,
        database: "KLIPBASE",
        result: {
          connected: row?.connected === 1 || row?.connected === "1" ? 1 : Number(row?.connected) || 1,
        },
      }),
      { status: 200, headers }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        success: false,
        database: "KLIPBASE",
        error: "Database connection failed.",
        message: err?.message ? String(err.message).slice(0, 200) : "Unknown error",
      }),
      { status: 500, headers }
    );
  }
}

