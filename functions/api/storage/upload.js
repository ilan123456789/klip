import { getR2, uploadObject, getPublicMediaUrl } from "../../utils/r2.js";

/**
 * Cloudflare Pages Function: Media Storage Upload (R2)
 * Route: POST /api/storage/upload?name=<filename>
 * Uploads avatars, slideshow photos, audio files to Cloudflare R2 bucket.
 */
export async function onRequestPost(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const url = new URL(context.request.url);
    const objectName = url.searchParams.get("name");

    if (!objectName || objectName.includes("..")) {
      return new Response(JSON.stringify({ success: false, error: "Invalid object name." }), {
        status: 400,
        headers,
      });
    }

    const r2 = getR2(context.env);
    const contentType = context.request.headers.get("content-type") || "application/octet-stream";
    const bodyStream = context.request.body;

    if (!bodyStream) {
      return new Response(JSON.stringify({ success: false, error: "Empty request body." }), {
        status: 400,
        headers,
      });
    }

    await uploadObject(r2, objectName, bodyStream, contentType);
    const mediaUrl = getPublicMediaUrl(objectName);

    return new Response(
      JSON.stringify({
        success: true,
        handled: true,
        mediaUrl,
        key: objectName,
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

