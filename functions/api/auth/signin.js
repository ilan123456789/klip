const DEFAULT_FIREBASE_API_KEY = "AIzaSyBajX8qjcF2nKXiMLwGhXSgObvy9LMyoQ0";

export async function onRequestPost(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const body = await context.request.json().catch(() => ({}));
    const { email, password } = body;

    if (!email || !password) {
      return new Response(JSON.stringify({ error: "Email and password are required." }), {
        status: 400,
        headers,
      });
    }

    const apiKey = context.env.FIREBASE_API_KEY || DEFAULT_FIREBASE_API_KEY;

    const fbRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
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
      const msg = doc?.error?.message || "Sign in failed.";
      return new Response(JSON.stringify({ error: msg }), {
        status: fbRes.status || 400,
        headers,
      });
    }

    return new Response(
      JSON.stringify({
        authenticated: true,
        uid: doc.localId,
        email: String(email).trim(),
        displayName: doc.displayName || "",
        idToken: doc.idToken,
        refreshToken: doc.refreshToken,
        expiresIn: doc.expiresIn,
      }),
      { status: 200, headers }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err?.message || "Sign in error." }), {
      status: 500,
      headers,
    });
  }
}

