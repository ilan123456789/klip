import { getDb, queryAll, queryFirst, execute } from "../utils/d1.js";
import { getAuthenticatedUid } from "../utils/auth.js";

/**
 * Cloudflare Pages Function: Comments API
 * Route: GET /api/comments?klipId=<klipId>
 * Route: POST /api/comments (create comment or like comment)
 * Route: DELETE /api/comments?id=<commentId>
 */
export async function onRequestGet(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const db = getDb(context.env);
    const url = new URL(context.request.url);
    const klipId = url.searchParams.get("klipId");

    if (!klipId) {
      return new Response(JSON.stringify({ success: false, error: "Missing klipId." }), {
        status: 400,
        headers,
      });
    }

    const comments = await queryAll(
      db,
      "SELECT * FROM klip_comments WHERE klip_id = ? ORDER BY created_at ASC;",
      klipId
    );

    return new Response(JSON.stringify({ success: true, count: comments.length, comments }), {
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
    const { action, id, klipId, userUid, userHandle, userInitials, userAvatarUrl, text, parentCommentId, replyToUid, replyToHandle } = body;

    const now = Math.floor(Date.now() / 1000);

    if (action === "like_comment") {
      const commentId = body.commentId || id;
      await execute(
        db,
        "INSERT OR IGNORE INTO comment_likes (user_uid, comment_id, created_at) VALUES (?, ?, ?);",
        userUid,
        commentId,
        now
      );
      await execute(db, "UPDATE klip_comments SET likes_count = likes_count + 1 WHERE id = ?;", commentId);
      return new Response(JSON.stringify({ success: true, action: "like_comment", commentId }), { status: 200, headers });
    }

    if (action === "unlike_comment") {
      const commentId = body.commentId || id;
      await execute(db, "DELETE FROM comment_likes WHERE user_uid = ? AND comment_id = ?;", userUid, commentId);
      await execute(db, "UPDATE klip_comments SET likes_count = MAX(0, likes_count - 1) WHERE id = ?;", commentId);
      return new Response(JSON.stringify({ success: true, action: "unlike_comment", commentId }), { status: 200, headers });
    }

    if (!id || !klipId || !userUid || !text) {
      return new Response(JSON.stringify({ success: false, error: "Missing required comment fields." }), {
        status: 400,
        headers,
      });
    }

    await execute(
      db,
      `INSERT INTO klip_comments (
        id, klip_id, user_uid, user_handle, user_initials, user_avatar_url,
        text, parent_comment_id, reply_to_uid, reply_to_handle, likes_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?);`,
      id,
      klipId,
      userUid,
      userHandle || "@user",
      userInitials || "KL",
      userAvatarUrl || "",
      text,
      parentCommentId || null,
      replyToUid || null,
      replyToHandle || null,
      now
    );

    await execute(db, "UPDATE klips SET comments_count = comments_count + 1 WHERE id = ?;", klipId);

    return new Response(JSON.stringify({ success: true, id, klipId }), { status: 200, headers });
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
    const klipId = url.searchParams.get("klipId");

    if (!id) {
      return new Response(JSON.stringify({ success: false, error: "Missing comment id." }), {
        status: 400,
        headers,
      });
    }

    const authUid = await getAuthenticatedUid(context.request);
    const comment = await queryFirst(db, "SELECT user_uid, klip_id FROM klip_comments WHERE id = ?;", id);
    if (comment && authUid) {
      const klip = await queryFirst(db, "SELECT creator_uid FROM klips WHERE id = ?;", comment.klip_id);
      const isAuthor = comment.user_uid === authUid;
      const isKlipCreator = klip && klip.creator_uid === authUid;
      if (!isAuthor && !isKlipCreator) {
        return new Response(JSON.stringify({ success: false, error: "Forbidden: You cannot delete another user's comment." }), {
          status: 403,
          headers,
        });
      }
    }

    await execute(db, "DELETE FROM klip_comments WHERE id = ?;", id);
    if (klipId) {
      await execute(db, "UPDATE klips SET comments_count = MAX(0, comments_count - 1) WHERE id = ?;", klipId);
    }

    return new Response(JSON.stringify({ success: true, message: "Comment deleted." }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers,
    });
  }
}

