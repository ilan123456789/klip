/**
 * Cloudflare Pages Function: Minimal R2 Connection Test
 * Route: GET /api/test-r2
 * Accesses: context.env.KLIPVIDEOS
 */
export async function onRequestGet(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  };

  try {
    const bucket = context.env?.KLIPVIDEOS;
    if (!bucket) {
      return new Response(
        JSON.stringify({
          success: false,
          bucket: "klip-videos",
          binding: "KLIPVIDEOS",
          error: "R2 bucket binding 'KLIPVIDEOS' is not configured in this environment.",
        }),
        { status: 500, headers }
      );
    }

    // Harmless non-destructive list operation with limit 1
    const listResult = await bucket.list({ limit: 1 });

    return new Response(
      JSON.stringify({
        success: true,
        bucket: "klip-videos",
        binding: "KLIPVIDEOS",
        result: {
          accessible: true,
          sampleCount: listResult?.objects?.length ?? 0,
        },
      }),
      { status: 200, headers }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        success: false,
        bucket: "klip-videos",
        binding: "KLIPVIDEOS",
        error: "R2 connection failed.",
        message: err?.message ? String(err.message).slice(0, 200) : "Unknown error",
      }),
      { status: 500, headers }
    );
  }
}

