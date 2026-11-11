import { getDb, queryAll } from "../utils/d1.js";

/**
 * Cloudflare Pages Function: Feed API
 * Route: GET /api/feed?tab=FYP&userUid=<uid>&limit=30
 */
export async function onRequestGet(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const db = getDb(context.env);
    const url = new URL(context.request.url);
    const creatorUid = url.searchParams.get("creatorUid") || "";
    const maxLimit = creatorUid ? 1000 : 500;
    const defaultLimit = creatorUid ? "500" : "200";
    const limit = Math.min(maxLimit, Math.max(1, parseInt(url.searchParams.get("limit") || defaultLimit, 10)));
    const tab = (url.searchParams.get("tab") || "FYP").toUpperCase();
    const userUid = url.searchParams.get("userUid") || "";
    const tag = url.searchParams.get("tag") || "";

    let sql = `
      SELECT k.*,
        CASE WHEN l.user_uid IS NOT NULL THEN 1 ELSE 0 END AS is_liked,
        CASE WHEN b.user_uid IS NOT NULL THEN 1 ELSE 0 END AS is_bookmarked,
        CASE WHEN f.follower_uid IS NOT NULL THEN 1 ELSE 0 END AS is_followed
      FROM klips k
      LEFT JOIN klip_likes l ON l.klip_id = k.id AND l.user_uid = ?
      LEFT JOIN klip_bookmarks b ON b.klip_id = k.id AND b.user_uid = ?
      LEFT JOIN follows f ON f.followed_uid = k.creator_uid AND f.follower_uid = ?
      WHERE (k.playback_url != '' OR k.video_url != '' OR (k.photo_urls IS NOT NULL AND k.photo_urls != '[]' AND k.photo_urls != ''))
        AND k.creator_uid != ''
        AND k.creator_handle != ''
    `;

    const params = [userUid, userUid, userUid];

    if (creatorUid) {
      sql += " AND k.creator_uid = ? ORDER BY k.created_at DESC LIMIT ?";
      params.push(creatorUid, limit);
    } else if (tab === "SAVED" && userUid) {
      sql += ` AND k.id IN (SELECT klip_id FROM klip_bookmarks WHERE user_uid = ?)
               ORDER BY k.created_at DESC LIMIT ?`;
      params.push(userUid, limit);
    } else if (tab === "FEMALE") {
      sql += " AND k.is_female_only = 1 ORDER BY k.created_at DESC LIMIT ?";
      params.push(limit);
    } else if (tab === "FOLLOWING" && userUid) {
      sql += ` AND k.creator_uid IN (SELECT followed_uid FROM follows WHERE follower_uid = ?)
               ORDER BY k.created_at DESC LIMIT ?`;
      params.push(userUid, limit);
    } else if (tag) {
      sql += " AND k.tags LIKE ? ORDER BY k.created_at DESC LIMIT ?";
      params.push(`%${tag}%`, limit);
    } else {
      // General FYP Feed
      sql += " AND k.is_female_only = 0 ORDER BY k.created_at DESC LIMIT ?";
      params.push(limit);
    }

    const klips = await queryAll(db, sql, ...params);

    return new Response(JSON.stringify({ success: true, count: klips.length, klips }), {
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
