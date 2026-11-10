import { getAuthenticatedUid } from "../../utils/auth.js";
import { getDb, queryFirst } from "../../utils/d1.js";

export async function onRequestGet(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const uid = await getAuthenticatedUid(context.request);
    if (!uid) {
      return new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers,
      });
    }

    let user = null;
    try {
      const db = getDb(context.env);
      user = await queryFirst(db, "SELECT * FROM users WHERE uid = ?;", uid);
    } catch (_) {}

    return new Response(
      JSON.stringify({
        authenticated: true,
        uid,
        user,
      }),
      { status: 200, headers }
    );
  } catch (err) {
    return new Response(JSON.stringify({ authenticated: false, error: err.message }), {
      status: 200,
      headers,
    });
  }
}

