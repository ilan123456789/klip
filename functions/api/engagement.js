import { getDb, execute, queryFirst, queryAll } from "../utils/d1.js";

/**
 * Cloudflare Pages Function: Engagement (Likes, Bookmarks, Follows)
 * Route: GET /api/engagement?userUid=<uid>&type=likes|bookmarks|following|followers
 * Route: POST /api/engagement
 */
export async function onRequestGet(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const db = getDb(context.env);
    const url = new URL(context.request.url);
    const userUid = url.searchParams.get("userUid") || url.searchParams.get("uid");
    const type = url.searchParams.get("type") || "likes";

    if (!userUid && type !== "all_likes") {
      return new Response(JSON.stringify({ success: false, error: "Missing userUid." }), {
        status: 400,
        headers,
      });
    }

    if (type === "likes") {
      const rows = await queryAll(db, "SELECT klip_id FROM klip_likes WHERE user_uid = ?;", userUid);
      const klipIds = rows.map((r) => r.klip_id);
      return new Response(JSON.stringify({ success: true, count: klipIds.length, klipIds }), { status: 200, headers });
    }

    if (type === "bookmarks") {
      const rows = await queryAll(db, "SELECT klip_id FROM klip_bookmarks WHERE user_uid = ?;", userUid);
      const klipIds = rows.map((r) => r.klip_id);
      return new Response(JSON.stringify({ success: true, count: klipIds.length, klipIds }), { status: 200, headers });
    }

    if (type === "following") {
      const rows = await queryAll(db, "SELECT followed_uid FROM follows WHERE follower_uid = ?;", userUid);
      const followedUids = rows.map((r) => r.followed_uid);
      return new Response(JSON.stringify({ success: true, count: followedUids.length, followingUids: followedUids }), { status: 200, headers });
    }

    if (type === "followers") {
      const rows = await queryAll(db, "SELECT follower_uid FROM follows WHERE followed_uid = ?;", userUid);
      const followerUids = rows.map((r) => r.follower_uid);
      return new Response(JSON.stringify({ success: true, count: followerUids.length, followerUids }), { status: 200, headers });
    }

    if (type === "all_likes") {
      const rows = await queryAll(db, "SELECT user_uid, klip_id FROM klip_likes;");
      const map = {};
      for (const r of rows) {
        if (!map[r.user_uid]) map[r.user_uid] = {};
        map[r.user_uid][r.klip_id] = true;
      }
      return new Response(JSON.stringify({ success: true, likes: map }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ success: false, error: "Invalid type." }), { status: 400, headers });
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
    const { action, userUid, klipId, targetUid } = body;

    if (!userUid) {
      return new Response(JSON.stringify({ success: false, error: "Missing userUid." }), {
        status: 400,
        headers,
      });
    }

    const now = Math.floor(Date.now() / 1000);

    // 1. LIKE KLIP
    if (action === "like_klip" && klipId) {
      await execute(
        db,
        "INSERT OR IGNORE INTO klip_likes (user_uid, klip_id, created_at) VALUES (?, ?, ?);",
        userUid,
        klipId,
        now
      );
      await execute(db, "UPDATE klips SET likes_count = likes_count + 1 WHERE id = ?;", klipId);
      return new Response(JSON.stringify({ success: true, action, klipId, liked: true }), { status: 200, headers });
    }

    // 2. UNLIKE KLIP
    if (action === "unlike_klip" && klipId) {
      await execute(db, "DELETE FROM klip_likes WHERE user_uid = ? AND klip_id = ?;", userUid, klipId);
      await execute(db, "UPDATE klips SET likes_count = MAX(0, likes_count - 1) WHERE id = ?;", klipId);
      return new Response(JSON.stringify({ success: true, action, klipId, liked: false }), { status: 200, headers });
    }

    // 3. BOOKMARK KLIP
    if (action === "bookmark_klip" && klipId) {
      await execute(
        db,
        "INSERT OR IGNORE INTO klip_bookmarks (user_uid, klip_id, created_at) VALUES (?, ?, ?);",
        userUid,
        klipId,
        now
      );
      await execute(db, "UPDATE klips SET bookmarks_count = bookmarks_count + 1 WHERE id = ?;", klipId);
      return new Response(JSON.stringify({ success: true, action, klipId, bookmarked: true }), { status: 200, headers });
    }

    // 4. UNBOOKMARK KLIP
    if (action === "unbookmark_klip" && klipId) {
      await execute(db, "DELETE FROM klip_bookmarks WHERE user_uid = ? AND klip_id = ?;", userUid, klipId);
      await execute(db, "UPDATE klips SET bookmarks_count = MAX(0, bookmarks_count - 1) WHERE id = ?;", klipId);
      return new Response(JSON.stringify({ success: true, action, klipId, bookmarked: false }), { status: 200, headers });
    }

    // 5. FOLLOW USER
    if (action === "follow_user" && targetUid) {
      await execute(
        db,
        "INSERT OR IGNORE INTO follows (follower_uid, followed_uid, created_at) VALUES (?, ?, ?);",
        userUid,
        targetUid,
        now
      );
      await execute(db, "UPDATE users SET following_count = following_count + 1 WHERE uid = ?;", userUid);
      await execute(db, "UPDATE users SET followers_count = followers_count + 1 WHERE uid = ?;", targetUid);
      return new Response(JSON.stringify({ success: true, action, targetUid, following: true }), { status: 200, headers });
    }

    // 6. UNFOLLOW USER
    if (action === "unfollow_user" && targetUid) {
      await execute(db, "DELETE FROM follows WHERE follower_uid = ? AND followed_uid = ?;", userUid, targetUid);
      await execute(db, "UPDATE users SET following_count = MAX(0, following_count - 1) WHERE uid = ?;", userUid);
      await execute(db, "UPDATE users SET followers_count = MAX(0, followers_count - 1) WHERE uid = ?;", targetUid);
      return new Response(JSON.stringify({ success: true, action, targetUid, following: false }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ success: false, error: "Invalid action." }), { status: 400, headers });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers,
    });
  }
}

