import { getDb, queryFirst, queryAll, execute } from "../utils/d1.js";
import { getAuthenticatedUid } from "../utils/auth.js";

/**
 * Cloudflare Pages Function: User Operations
 * Route: GET /api/user?uid=<uid>&handle=<handle> (or GET /api/user for all users)
 * Route: POST /api/user (update profile)
 */
export async function onRequestGet(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const db = getDb(context.env);
    const url = new URL(context.request.url);
    const uid = url.searchParams.get("uid");
    const handle = url.searchParams.get("handle");

    const userSelectSql = `
      SELECT u.*,
        MAX(u.shkoyach_count, COALESCE((SELECT SUM(likes_count) FROM klips WHERE creator_uid = u.uid), 0)) AS shkoyach_count
      FROM users u
    `;

    if (uid) {
      const user = await queryFirst(db, `${userSelectSql} WHERE u.uid = ?;`, uid);
      if (!user) {
        return new Response(JSON.stringify({ success: false, error: "User not found." }), {
          status: 404,
          headers,
        });
      }
      return new Response(JSON.stringify({ success: true, user }), { status: 200, headers });
    }

    if (handle) {
      const cleanHandle = handle.startsWith("@") ? handle : `@${handle}`;
      const user = await queryFirst(db, `${userSelectSql} WHERE LOWER(u.handle) = LOWER(?);`, cleanHandle);
      if (!user) {
        return new Response(JSON.stringify({ success: false, error: "User not found." }), {
          status: 404,
          headers,
        });
      }
      return new Response(JSON.stringify({ success: true, user }), { status: 200, headers });
    }

    // Default: return all users
    const users = await queryAll(db, `${userSelectSql} ORDER BY u.created_at DESC;`);
    return new Response(JSON.stringify({ success: true, count: users.length, users }), {
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
    const uid = body.uid || body.Uid;

    if (!uid) {
      return new Response(JSON.stringify({ success: false, error: "Missing user uid." }), {
        status: 400,
        headers,
      });
    }

    const authUid = await getAuthenticatedUid(context.request);
    if (authUid && authUid !== uid) {
      return new Response(JSON.stringify({ success: false, error: "Forbidden: You cannot modify another user's profile." }), {
        status: 403,
        headers,
      });
    }

    const now = Math.floor(Date.now() / 1000);

    await execute(
      db,
      `INSERT INTO users (
        uid, handle, display_name, email, initials, bio, avatar_url,
        gender, is_male, can_post, followers_count, following_count,
        shkoyach_count, likes_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(uid) DO UPDATE SET
        handle = excluded.handle,
        display_name = excluded.display_name,
        email = CASE WHEN excluded.email != '' THEN excluded.email ELSE users.email END,
        gender = excluded.gender,
        is_male = excluded.is_male,
        bio = excluded.bio,
        avatar_url = excluded.avatar_url,
        initials = excluded.initials,
        updated_at = ?;`,
      uid,
      body.handle || body.Handle || "@user",
      body.displayName || body.DisplayName || "",
      body.email || body.Email || "",
      body.initials || body.Initials || "KL",
      body.bio || body.Bio || "",
      body.avatarUrl || body.AvatarUrl || "",
      body.gender || body.Gender || "Male",
      body.isMale !== false ? 1 : 0,
      body.canPost ? 1 : 0,
      Number(body.followersCount || body.FollowersCount) || 0,
      Number(body.followingCount || body.FollowingCount) || 0,
      Number(body.shkoyachCount || body.ShkoyachCount) || 0,
      Number(body.likesCount || body.LikesCount) || 0,
      now,
      now,
      now
    );

    const avatarUrl = body.avatarUrl || body.AvatarUrl;
    if (avatarUrl !== undefined) {
      await execute(db, "UPDATE klips SET creator_avatar_url = ? WHERE creator_uid = ?;", avatarUrl || "", uid).catch(() => {});
      await execute(db, "UPDATE klip_comments SET user_avatar_url = ? WHERE user_uid = ?;", avatarUrl || "", uid).catch(() => {});
    }

    const handle = body.handle || body.Handle;
    if (handle) {
      await execute(db, "UPDATE klips SET creator_handle = ? WHERE creator_uid = ?;", handle, uid).catch(() => {});
      await execute(db, "UPDATE klip_comments SET user_handle = ? WHERE user_uid = ?;", handle, uid).catch(() => {});
    }

    const initials = body.initials || body.Initials;
    if (initials) {
      await execute(db, "UPDATE klips SET creator_initials = ? WHERE creator_uid = ?;", initials, uid).catch(() => {});
      await execute(db, "UPDATE klip_comments SET user_initials = ? WHERE user_uid = ?;", initials, uid).catch(() => {});
    }

    return new Response(JSON.stringify({ success: true, uid }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers,
    });
  }
}

