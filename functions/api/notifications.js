import { getDb, queryAll, execute } from "../utils/d1.js";

/**
 * Cloudflare Pages Function: Notifications API
 * Route: GET /api/notifications?recipientUid=<uid>
 * Route: POST /api/notifications (create notification or mark read)
 */
export async function onRequestGet(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const db = getDb(context.env);
    const url = new URL(context.request.url);
    const recipientUid = url.searchParams.get("recipientUid") || url.searchParams.get("uid");

    if (!recipientUid) {
      return new Response(JSON.stringify({ success: false, error: "Missing recipientUid." }), {
        status: 400,
        headers,
      });
    }

    const notifs = await queryAll(
      db,
      "SELECT * FROM notifications WHERE recipient_uid = ? ORDER BY created_at DESC LIMIT 50;",
      recipientUid
    );

    return new Response(JSON.stringify({ success: true, count: notifs.length, notifications: notifs }), {
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

export async function onRequestPost(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const db = getDb(context.env);
    const body = await context.request.json().catch(() => ({}));
    const { action, id, recipientUid, fromUid, fromHandle, fromInitials, fromAvatarUrl, type, klipId, commentId, commentText, parentCommentId, message } = body;

    const now = Math.floor(Date.now() / 1000);

    if (action === "mark_read" && recipientUid) {
      if (id) {
        await execute(db, "UPDATE notifications SET is_read = 1 WHERE id = ? AND recipient_uid = ?;", id, recipientUid);
      } else {
        await execute(db, "UPDATE notifications SET is_read = 1 WHERE recipient_uid = ?;", recipientUid);
      }
      return new Response(JSON.stringify({ success: true, action: "mark_read" }), { status: 200, headers });
    }

    if (!id || !recipientUid) {
      return new Response(JSON.stringify({ success: false, error: "Missing required notification fields." }), {
        status: 400,
        headers,
      });
    }

    await execute(
      db,
      `INSERT INTO notifications (
        id, recipient_uid, from_uid, from_handle, from_initials, from_avatar_url,
        type, klip_id, comment_id, comment_text, parent_comment_id, message, is_read, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?);`,
      id,
      recipientUid,
      fromUid || "",
      fromHandle || "@user",
      fromInitials || "KL",
      fromAvatarUrl || "",
      type || "like",
      klipId || null,
      commentId || null,
      commentText || null,
      parentCommentId || null,
      message || "",
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

