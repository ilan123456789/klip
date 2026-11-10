import { getDb, execute } from "../../utils/d1.js";

const DEFAULT_FIREBASE_API_KEY = "AIzaSyBajX8qjcF2nKXiMLwGhXSgObvy9LMyoQ0";

export async function onRequestPost(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const body = await context.request.json().catch(() => ({}));
    const { email, password, displayNameMeta } = body;

    if (!email || !password) {
      return new Response(JSON.stringify({ error: "Email and password are required." }), {
        status: 400,
        headers,
      });
    }

    if (displayNameMeta) {
      const handleCandidate = displayNameMeta.split("|")[0] || "";
      const coreHandle = handleCandidate.replace(/^@/, "").trim();
      if (!/^[a-zA-Z0-9_]{3,30}$/.test(coreHandle)) {
        return new Response(
          JSON.stringify({
            error: "Username can only contain English letters, numbers, and underscores (_), between 3 and 30 characters.",
          }),
          { status: 400, headers }
        );
      }
    }

    const apiKey = context.env.FIREBASE_API_KEY || DEFAULT_FIREBASE_API_KEY;

    // 1. Authenticate / Create user in Firebase Auth
    const fbRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(email).trim(),
          password: String(password),
          returnSecureToken: true,
        }),
      }
    );

    const doc = await fbRes.json();
    if (!fbRes.ok || !doc.localId) {
      const msg = doc?.error?.message || "Sign up failed.";
      return new Response(JSON.stringify({ error: msg }), {
        status: fbRes.status || 400,
        headers,
      });
    }

    // 2. Set Firebase Auth display name if provided
    if (displayNameMeta && doc.idToken) {
      fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idToken: doc.idToken,
            displayName: String(displayNameMeta),
            returnSecureToken: false,
          }),
        }
      ).catch(() => {});
    }

    // 3. Immediately insert new user into Cloudflare D1 users table
    try {
      const db = getDb(context.env);
      const now = Math.floor(Date.now() / 1000);
      const parts = String(displayNameMeta || "").split("|");
      const cleanHandle = (parts[0] || "@user").trim();
      const cleanName = (parts[1] || cleanHandle.replace(/^@/, "")).trim();
      const cleanGender = (parts[2] || "Male").trim();
      const initials = cleanName.slice(0, 2).toUpperCase() || "KL";
      const isMale = cleanGender.toLowerCase() === "female" ? 0 : 1;

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
          email = excluded.email,
          gender = excluded.gender,
          is_male = excluded.is_male,
          initials = excluded.initials,
          updated_at = ?;`,
        doc.localId,
        cleanHandle.startsWith("@") ? cleanHandle : `@${cleanHandle}`,
        cleanName,
        String(email).trim(),
        initials,
        "Sharing Jewish life & simchas on Klip ✡",
        "",
        cleanGender,
        isMale,
        0, 0, 0, 0, 0,
        now, now, now
      );
    } catch (d1Err) {
      console.warn("[SignUp Function] D1 insert warning:", d1Err?.message);
    }

    return new Response(
      JSON.stringify({
        authenticated: true,
        uid: doc.localId,
        email: String(email).trim(),
        idToken: doc.idToken,
        refreshToken: doc.refreshToken,
        expiresIn: doc.expiresIn,
      }),
      { status: 200, headers }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err?.message || "Sign up error." }), {
      status: 500,
      headers,
    });
  }
}

