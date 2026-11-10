/**
 * Cloudflare Pages Function: Stream Video Status
 * Route: GET /api/stream/status?uid=<videoUid>
 */
export async function onRequestGet(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  try {
    const accountId = context.env.CLOUDFLARE_ACCOUNT_ID || "0d5fb2ccdbc60ef2550a5500b575696f";
    const apiToken = context.env.CLOUDFLARE_STREAM_API_TOKEN || context.env.CLOUDFLARE_API_TOKEN;
    const customerSubdomain = context.env.CLOUDFLARE_CUSTOMER_SUBDOMAIN || "customer-wmucbvx0oqk5mob1.cloudflarestream.com";

    const url = new URL(context.request.url);
    const uid = url.searchParams.get("uid");

    if (!uid) {
      return new Response(JSON.stringify({ success: false, error: "Missing video uid." }), {
        status: 400,
        headers,
      });
    }

    if (!apiToken) {
      return new Response(
        JSON.stringify({ success: false, error: "CLOUDFLARE_API_TOKEN is not configured." }),
        { status: 500, headers }
      );
    }

    const cfRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${encodeURIComponent(uid)}`,
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
      }
    );

    const cfData = await cfRes.json();
    if (!cfRes.ok || !cfData.success) {
      return new Response(
        JSON.stringify({
          success: false,
          uid,
          readyToStream: false,
          state: "processing",
          playbackUrl: `https://${customerSubdomain}/${uid}/manifest/video.m3u8`,
          thumbnailUrl: `https://${customerSubdomain}/${uid}/thumbnails/thumbnail.jpg`,
        }),
        { status: 200, headers }
      );
    }

    const r = cfData.result || {};
    return new Response(
      JSON.stringify({
        success: true,
        uid: r.uid,
        readyToStream: Boolean(r.readyToStream),
        status: r.status,
        duration: r.duration,
        meta: r.meta,
        playbackUrl: `https://${customerSubdomain}/${r.uid}/manifest/video.m3u8`,
        thumbnailUrl: `https://${customerSubdomain}/${r.uid}/thumbnails/thumbnail.jpg`,
      }),
      { status: 200, headers }
    );
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers,
    });
  }
}

