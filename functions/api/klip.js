import { getDb, queryFirst, queryAll, execute } from "../utils/d1.js";
import { getAuthenticatedUid } from "../utils/auth.js";

/**
 * Cloudflare Pages Function: Klip Operations
 * Route: GET /api/klip?id=<klipId>
 * Route: POST /api/klip (create or update)
 * Route: DELETE /api/klip?id=<klipId>
 */
export async function onRequestGet(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const db = getDb(context.env);
    const url = new URL(context.request.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return new Response(JSON.stringify({ success: false, error: "Missing 'id' parameter." }), {
        status: 400,
        headers,
      });
    }

    const klip = await queryFirst(db, "SELECT * FROM klips WHERE id = ?;", id);
    if (!klip) {
      return new Response(JSON.stringify({ success: false, error: "Klip not found." }), {
        status: 404,
        headers,
      });
    }

    // Increment views asynchronously
    context.waitUntil?.(
      execute(db, "UPDATE klips SET views_count = views_count + 1 WHERE id = ?;", id).catch(() => {})
    );

    return new Response(JSON.stringify({ success: true, klip }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers,
    });
  }
}

export async function onRequestPost(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const db = getDb(context.env);
    const body = await context.request.json().catch(() => ({}));
    const id = body.id || body.Id;

    if (!id) {
      return new Response(JSON.stringify({ success: false, error: "Missing klip id." }), {
        status: 400,
        headers,
      });
    }

    const authUid = await getAuthenticatedUid(context.request);
    const existing = await queryFirst(db, "SELECT creator_uid FROM klips WHERE id = ?;", id);
    if (existing && authUid && existing.creator_uid && existing.creator_uid !== authUid) {
      return new Response(JSON.stringify({ success: false, error: "Forbidden: You can only edit your own Klips." }), {
        status: 403,
        headers,
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const tagsJson = JSON.stringify(Array.isArray(body.tags || body.Tags) ? (body.tags || body.Tags) : []);
    const photosJson = JSON.stringify(Array.isArray(body.photoUrls || body.PhotoUrls) ? (body.photoUrls || body.PhotoUrls) : []);

    await execute(
      db,
      `INSERT INTO klips (
        id, creator_uid, creator_handle, creator_initials, creator_avatar_url,
        caption, tags, video_url, watermarked_video_url, thumbnail_url,
        photo_urls, video_provider, cloudflare_video_id, playback_url,
        playback_status, r2_video_key, sound_id, sound_title, sound_audio_url,
        sound_start_time, sound_end_time, is_female_only, audience, gender,
        color_hex, likes_count, views_count, bookmarks_count, comments_count,
        shares_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        caption = excluded.caption,
        tags = excluded.tags,
        video_url = excluded.video_url,
        watermarked_video_url = excluded.watermarked_video_url,
        thumbnail_url = excluded.thumbnail_url,
        video_provider = excluded.video_provider,
        cloudflare_video_id = excluded.cloudflare_video_id,
        playback_url = excluded.playback_url,
        updated_at = ?;`,
      id,
      body.creatorUid || body.CreatorUid || "",
      body.creatorHandle || body.CreatorHandle || "@user",
      body.creatorInitials || body.CreatorInitials || "KL",
      body.creatorAvatarUrl || body.CreatorAvatarUrl || "",
      body.caption || body.Caption || "",
      tagsJson,
      body.videoUrl || body.VideoUrl || "",
      body.watermarkedVideoUrl || body.WatermarkedVideoUrl || "",
      body.thumbnailUrl || body.ThumbnailUrl || "",
      photosJson,
      body.videoProvider || "cloudflare",
      body.cloudflareVideoId || body.CloudflareVideoId || "",
      body.playbackUrl || body.PlaybackUrl || "",
      body.playbackStatus || "ready",
      body.r2VideoKey || "",
      body.soundId || body.SoundId || "",
      body.soundTitle || body.SoundTitle || "",
      body.soundAudioUrl || body.SoundAudioUrl || "",
      Number(body.soundStartTime || body.SoundStartTime) || 0,
      Number(body.soundEndTime || body.SoundEndTime) || 0,
      body.isFemaleOnly ? 1 : 0,
      body.audience || "general",
      body.gender || "Male",
      body.colorHex || body.ColorHex || "#172554",
      Number(body.likesCount || body.LikesCount) || 0,
      Number(body.viewsCount || body.ViewsCount) || 0,
      Number(body.bookmarksCount || body.BookmarksCount) || 0,
      Number(body.commentsCount || body.CommentsCount) || 0,
      Number(body.sharesCount || body.SharesCount) || 0,
      Number(body.createdAtUnix || body.CreatedAtUnix) || now,
      now,
      now
    );

    return new Response(JSON.stringify({ success: true, id }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers,
    });
  }
}

export async function onRequestDelete(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const db = getDb(context.env);
    const url = new URL(context.request.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return new Response(JSON.stringify({ success: false, error: "Missing klip id." }), {
        status: 400,
        headers,
      });
    }

    const authUid = await getAuthenticatedUid(context.request);
    const existing = await queryFirst(db, "SELECT creator_uid FROM klips WHERE id = ?;", id);
    if (existing && authUid && existing.creator_uid && existing.creator_uid !== authUid) {
      return new Response(JSON.stringify({ success: false, error: "Forbidden: You can only delete your own Klips." }), {
        status: 403,
        headers,
      });
    }

    await execute(db, "DELETE FROM klips WHERE id = ?;", id);
    await execute(db, "DELETE FROM klip_likes WHERE klip_id = ?;", id);
    await execute(db, "DELETE FROM klip_bookmarks WHERE klip_id = ?;", id);
    await execute(db, "DELETE FROM klip_comments WHERE klip_id = ?;", id);

    return new Response(JSON.stringify({ success: true, message: "Klip deleted." }), {
      status: 200,
      headers,
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers,
    });
  }
}

export async function onRequestPatch(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const db = getDb(context.env);
    const body = await context.request.json().catch(() => ({}));
    const id = body.id || body.Id;

    if (!id) {
      return new Response(JSON.stringify({ success: false, error: "Missing klip id." }), {
        status: 400,
        headers,
      });
    }

    const updates = [];
    const params = [];

    if (body.watermarkedVideoUrl !== undefined || body.WatermarkedVideoUrl !== undefined) {
      updates.push("watermarked_video_url = ?");
      params.push(body.watermarkedVideoUrl || body.WatermarkedVideoUrl || "");
    }
    if (body.thumbnailUrl !== undefined || body.ThumbnailUrl !== undefined) {
      updates.push("thumbnail_url = ?");
      params.push(body.thumbnailUrl || body.ThumbnailUrl || "");
    }
    if (body.soundTitle !== undefined || body.SoundTitle !== undefined) {
      updates.push("sound_title = ?");
      params.push(body.soundTitle || body.SoundTitle || "");
    }
    if (body.soundId !== undefined || body.SoundId !== undefined) {
      updates.push("sound_id = ?");
      params.push(body.soundId || body.SoundId || "");
    }
    if (body.viewsCount !== undefined || body.ViewsCount !== undefined) {
      updates.push("views_count = ?");
      params.push(Number(body.viewsCount || body.ViewsCount) || 0);
    }
    if (body.incrementViews) {
      updates.push("views_count = views_count + 1");
    }

    if (updates.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No updates provided." }), { status: 200, headers });
    }

    updates.push("updated_at = ?");
    params.push(Math.floor(Date.now() / 1000));
    params.push(id);

    await execute(db, `UPDATE klips SET ${updates.join(", ")} WHERE id = ?;`, ...params);

    return new Response(JSON.stringify({ success: true, id }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers,
    });
  }
}

