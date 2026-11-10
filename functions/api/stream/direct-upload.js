/**
 * Cloudflare Pages Function: Stream Direct Creator Upload
 * Route: POST /api/stream/direct-upload
 */
export async function onRequestPost(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  try {
    const accountId = context.env.CLOUDFLARE_ACCOUNT_ID || "0d5fb2ccdbc60ef2550a5500b575696f";
    const apiToken = context.env.CLOUDFLARE_STREAM_API_TOKEN || context.env.CLOUDFLARE_API_TOKEN;
    const customerSubdomain = context.env.CLOUDFLARE_CUSTOMER_SUBDOMAIN || "customer-wmucbvx0oqk5mob1.cloudflarestream.com";

    if (!apiToken) {
      return new Response(
        JSON.stringify({ success: false, error: "CLOUDFLARE_API_TOKEN is not configured." }),
        { status: 500, headers }
      );
    }

    const body = await context.request.json().catch(() => ({}));
    const uid = body.creatorUid || "anonymous";
    const name = (body.name || body.fileName || "Klip Video").slice(0, 100);
    const maxDurationSeconds = Math.min(Number(body.maxDurationSeconds) || 1800, 3600);

    const cfRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/direct_upload`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          maxDurationSeconds,
          expiry: new Date(Date.now() + 1 * 3600 * 1000).toISOString(),
          creator: uid,
          meta: {
            name,
            creatorUid: uid,
          },
        }),
      }
    );

    const cfData = await cfRes.json();
    if (!cfRes.ok || !cfData.success) {
      const errMsg = cfData.errors?.[0]?.message || "Cloudflare Direct Upload initialization failed.";
      return new Response(JSON.stringify({ success: false, error: errMsg, details: cfData.errors }), {
        status: 502,
        headers,
      });
    }

    const uploadURL = cfData.result.uploadURL;
    const videoUid = cfData.result.uid;

    return new Response(
      JSON.stringify({
        success: true,
        uploadURL,
        uid: videoUid,
        playbackUrl: `https://${customerSubdomain}/${videoUid}/manifest/video.m3u8`,
        thumbnailUrl: `https://${customerSubdomain}/${videoUid}/thumbnails/thumbnail.jpg`,
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

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

