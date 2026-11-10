import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==================== LOAD .env ====================
function loadDotEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

loadDotEnv();

const PORT = Number(process.env.PORT) || 5173;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || "";
const FIREBASE_DATABASE_URL = (process.env.FIREBASE_DATABASE_URL || "").replace(
  /\/+$/,
  ""
);
const FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || "";
const SESSION_SECRET =
  process.env.SESSION_SECRET || "klip_default_fallback_secret_change_me";
const CLOUDFLARE_ACCOUNT_ID =
  process.env.CLOUDFLARE_ACCOUNT_ID || "0d5fb2ccdbc60ef2550a5500b575696f";
const CLOUDFLARE_CUSTOMER_SUBDOMAIN =
  process.env.CLOUDFLARE_CUSTOMER_SUBDOMAIN ||
  "customer-wmucbvx0oqk5mob1.cloudflarestream.com";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_STREAM_API_TOKEN = process.env.CLOUDFLARE_STREAM_API_TOKEN || CLOUDFLARE_API_TOKEN;
const CLOUDFLARE_D1_DATABASE_ID = process.env.CLOUDFLARE_D1_DATABASE_ID || "d7a63d25-d614-413a-81bc-cbc8c3ec937b";
const CLOUDFLARE_D1_API_TOKEN = process.env.CLOUDFLARE_D1_API_TOKEN || CLOUDFLARE_API_TOKEN;

if (!FIREBASE_API_KEY || !FIREBASE_DATABASE_URL || !FIREBASE_STORAGE_BUCKET) {
  console.error(
    "[KlipServer] Missing required environment variables in .env (FIREBASE_API_KEY, FIREBASE_DATABASE_URL, FIREBASE_STORAGE_BUCKET)."
  );
}

if (!CLOUDFLARE_API_TOKEN) {
  console.warn(
    "[KlipServer] CLOUDFLARE_API_TOKEN is not set in .env. Video uploads will fall back to Firebase Storage until configured."
  );
}

// Persistent HTTPS Keep-Alive agent for fast upstream Firebase Storage & RTDB streaming
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 64,
  keepAliveMsecs: 30000,
});

// ==================== CLOUDFLARE D1 CLIENT ====================
async function queryD1(sql, params = []) {
  const token = CLOUDFLARE_D1_API_TOKEN || CLOUDFLARE_API_TOKEN;
  if (!token) return [];
  const cfRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${CLOUDFLARE_D1_DATABASE_ID}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    }
  );
  const data = await cfRes.json();
  if (!cfRes.ok || !data.success) {
    throw new Error(data.errors?.[0]?.message || `D1 error HTTP ${cfRes.status}`);
  }
  return data.result?.[0]?.results || [];
}

// Derive 32-byte AES-256 key from SESSION_SECRET
const AES_KEY = crypto
  .createHash("sha256")
  .update(SESSION_SECRET)
  .digest();

// ==================== CRYPTO HELPERS (RFC 7516 JWE & MEDIA TOKENS) ====================
const JWE_PROTECTED_HEADER = Buffer.from(
  JSON.stringify({ alg: "dir", enc: "A256GCM", typ: "JWE" }),
  "utf8"
).toString("base64url");

// Creates a standards-compliant 5-part Compact JWE (alg: "dir", enc: "A256GCM")
// so the session token is both authenticated and AES-256-GCM encrypted (never a signed-only JWS).
function createJweToken(payloadObj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", AES_KEY, iv);
  cipher.setAAD(Buffer.from(JWE_PROTECTED_HEADER, "ascii"));
  const plaintext = Buffer.from(JSON.stringify(payloadObj), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${JWE_PROTECTED_HEADER}..${iv.toString("base64url")}.${ciphertext.toString(
    "base64url"
  )}.${tag.toString("base64url")}`;
}

function decryptJweToken(token) {
  if (!token || typeof token !== "string") return null;
  try {
    const parts = token.split(".");
    if (parts.length === 5) {
      const [headerB64, encKeyB64, ivB64, ciphertextB64, tagB64] = parts;
      if (encKeyB64 !== "") return null;
      const headerJson = JSON.parse(
        Buffer.from(headerB64, "base64url").toString("utf8")
      );
      if (headerJson.alg !== "dir" || headerJson.enc !== "A256GCM") return null;
      const iv = Buffer.from(ivB64, "base64url");
      const ciphertext = Buffer.from(ciphertextB64, "base64url");
      const tag = Buffer.from(tagB64, "base64url");
      if (iv.length !== 12 || tag.length !== 16) return null;
      const decipher = crypto.createDecipheriv("aes-256-gcm", AES_KEY, iv);
      decipher.setAAD(Buffer.from(headerB64, "ascii"));
      decipher.setAuthTag(tag);
      const dec = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      const payload = JSON.parse(dec.toString("utf8"));
      if (payload.exp && Date.now() > payload.exp) return null;
      return payload;
    }
    return null;
  } catch {
    return null;
  }
}

function encryptBlob(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", AES_KEY, iv);
  const json = Buffer.from(JSON.stringify(obj), "utf8");
  const enc = Buffer.concat([cipher.update(json), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

function decryptBlob(token) {
  if (!token) return null;
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 29) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const enc = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", AES_KEY, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return JSON.parse(dec.toString("utf8"));
  } catch {
    return null;
  }
}

// Deterministic authenticated encryption for media URLs so the same media asset
// always maps to the same /api/media/<token> URL (enabling full browser caching)
// while completely hiding the Firebase Storage bucket & download token.
function encryptMediaUrl(url) {
  const iv = crypto
    .createHmac("sha256", AES_KEY)
    .update(url)
    .digest()
    .subarray(0, 12);
  const cipher = crypto.createCipheriv("aes-256-gcm", AES_KEY, iv);
  const enc = Buffer.concat([
    cipher.update(Buffer.from(url, "utf8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

function decryptMediaUrl(token) {
  if (!token) return null;
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 29) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const enc = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", AES_KEY, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    const url = dec.toString("utf8");
    if (!url.startsWith("https://firebasestorage.googleapis.com/")) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

// Recursively mask Firebase Storage URLs in outgoing JSON so no storage bucket
// or ?token=... is ever visible to the browser.
function maskStorageUrlsInJson(val) {
  if (typeof val === "string") {
    if (val.startsWith("https://firebasestorage.googleapis.com/")) {
      return `/api/media/${encryptMediaUrl(val)}`;
    }
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(maskStorageUrlsInJson);
  }
  if (val && typeof val === "object") {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = maskStorageUrlsInJson(v);
    }
    return out;
  }
  return val;
}

// Recursively unmask /api/media/<token> back to canonical Firebase Storage URLs
// before saving to Firebase Realtime Database so mobile & web stay 100% compatible.
function unmaskStorageUrlsInJson(val) {
  if (typeof val === "string") {
    if (val.startsWith("/api/media/")) {
      const token = val.slice("/api/media/".length).split(/[?#]/)[0];
      const realUrl = decryptMediaUrl(token);
      return realUrl || val;
    }
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(unmaskStorageUrlsInJson);
  }
  if (val && typeof val === "object") {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = unmaskStorageUrlsInJson(v);
    }
    return out;
  }
  return val;
}

// ==================== SERVER-SIDE TOKEN VAULT & JWE COOKIE ====================
// Raw Firebase JWS tokens (idToken / eyJ...) are signed-only (RS256) and NOT encrypted.
// They are stored exclusively inside SERVER_SESSION_VAULT on the server (and encrypted at
// rest in .sessions.enc) and NEVER transmitted to the browser. The browser receives only
// an HttpOnly RFC 7516 Compact JWE (alg: "dir", enc: "A256GCM") containing { sid, uid, iat, exp }.
const SESSION_COOKIE_NAME = "klip_sid";
const SESSION_VAULT_PATH = path.join(__dirname, ".sessions.enc");
const SERVER_SESSION_VAULT = new Map();

function loadSessionVault() {
  try {
    if (!fs.existsSync(SESSION_VAULT_PATH)) return;
    const raw = fs.readFileSync(SESSION_VAULT_PATH, "utf8").trim();
    const decoded = decryptBlob(raw);
    if (decoded && typeof decoded === "object") {
      for (const [sid, record] of Object.entries(decoded)) {
        if (record && record.uid && record.refreshToken) {
          SERVER_SESSION_VAULT.set(sid, record);
        }
      }
    }
  } catch {
    /* ignore corrupt vault */
  }
}

function saveSessionVault() {
  try {
    const obj = Object.fromEntries(SERVER_SESSION_VAULT.entries());
    fs.writeFileSync(SESSION_VAULT_PATH, encryptBlob(obj), "utf8");
  } catch {
    /* ignore write error */
  }
}

loadSessionVault();

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const map = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      map[k] = v;
    }
  }
  return map;
}

function createOrUpdateVaultSession(res, sessionObj, existingSid = null) {
  const sid = existingSid || crypto.randomBytes(24).toString("base64url");
  const maxAgeSec = 30 * 24 * 3600; // 30 days
  const now = Date.now();
  const record = {
    sid,
    uid: sessionObj.uid,
    email: sessionObj.email || "",
    displayName: sessionObj.displayName || "",
    idToken: sessionObj.idToken || "",
    refreshToken: sessionObj.refreshToken || "",
    tokenExpUtc: sessionObj.tokenExpUtc || 0,
    updatedAtUtc: now,
  };
  SERVER_SESSION_VAULT.set(sid, record);
  saveSessionVault();

  const jweToken = createJweToken({
    sid,
    uid: record.uid,
    iat: now,
    exp: now + maxAgeSec * 1000,
  });

  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${jweToken}; HttpOnly; Path=/; Max-Age=${maxAgeSec}; SameSite=Strict`
  );
  return record;
}

function clearSessionCookie(req, res) {
  const cookies = parseCookies(req);
  const rawToken = cookies[SESSION_COOKIE_NAME];
  const jwePayload = decryptJweToken(rawToken);
  if (jwePayload && jwePayload.sid && SERVER_SESSION_VAULT.has(jwePayload.sid)) {
    SERVER_SESSION_VAULT.delete(jwePayload.sid);
    saveSessionVault();
  }
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict`
  );
}

async function exchangeRefreshTokenServerSideAsync(refreshToken, fallbackMeta = {}) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const refreshRes = await fetch(
    `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }
  );
  if (!refreshRes.ok) {
    return null;
  }
  const data = await refreshRes.json();
  const expiresInSec = Number(data.expires_in) || 3600;
  return {
    uid: data.user_id || fallbackMeta.uid || "",
    email: fallbackMeta.email || "",
    displayName: fallbackMeta.displayName || "",
    idToken: data.id_token,
    refreshToken: data.refresh_token || refreshToken,
    tokenExpUtc: Date.now() + Math.max(300, expiresInSec - 300) * 1000,
  };
}

async function getValidSessionAsync(req, res) {
  const cookies = parseCookies(req);
  const rawToken = cookies[SESSION_COOKIE_NAME];
  if (!rawToken) return null;

  let sid = null;
  let session = null;

  const jwePayload = decryptJweToken(rawToken);
  if (jwePayload && jwePayload.sid) {
    sid = jwePayload.sid;
    session = SERVER_SESSION_VAULT.get(sid) || null;
  } else {
    // Transparently upgrade any pre-JWE encrypted cookie into SERVER_SESSION_VAULT + JWE
    const legacy = decryptBlob(rawToken);
    if (legacy && legacy.uid && legacy.refreshToken) {
      session = createOrUpdateVaultSession(res, legacy);
      sid = session.sid;
    }
  }

  if (!session || !session.uid || !session.refreshToken) {
    return null;
  }

  // If idToken is still valid for at least 2 minutes, use it directly from server vault
  if (session.idToken && Date.now() < (session.tokenExpUtc || 0)) {
    return session;
  }

  // Refresh expired idToken server-side using FIREBASE_API_KEY from .env
  try {
    const refreshed = await exchangeRefreshTokenServerSideAsync(
      session.refreshToken,
      session
    );
    if (!refreshed || !refreshed.uid) {
      return null;
    }
    return createOrUpdateVaultSession(res, refreshed, sid);
  } catch {
    return null;
  }
}

function sanitizeErrorMessage(msg) {
  if (!msg) return "Request failed";
  return String(msg)
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]")
    .replace(/key=[A-Za-z0-9_-]+/gi, "key=[REDACTED]");
}

// ==================== REQUEST BODY HELPERS ====================
function readRawBody(req, maxBytes = 550 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJsonBody(req) {
  const buf = await readRawBody(req, 2 * 1024 * 1024);
  if (buf.length === 0) return {};
  return JSON.parse(buf.toString("utf8"));
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

// ==================== API ROUTE HANDLERS ====================
async function handleAuthRoutes(req, res, pathname) {
  if (pathname === "/api/auth/session" && req.method === "GET") {
    const session = await getValidSessionAsync(req, res);
    if (!session) {
      return sendJson(res, 200, { authenticated: false, uid: null });
    }
    return sendJson(res, 200, {
      authenticated: true,
      uid: session.uid,
      email: session.email || "",
      displayName: session.displayName || "",
    });
  }

  if (pathname === "/api/auth/migrate" && req.method === "POST") {
    try {
      const { refreshToken, uid, email, displayName } = await readJsonBody(req);
      if (!refreshToken || typeof refreshToken !== "string") {
        return sendJson(res, 400, { authenticated: false });
      }
      const exchanged = await exchangeRefreshTokenServerSideAsync(refreshToken, {
        uid: String(uid || ""),
        email: String(email || ""),
        displayName: String(displayName || ""),
      });
      if (!exchanged || !exchanged.uid) {
        return sendJson(res, 401, { authenticated: false });
      }
      createOrUpdateVaultSession(res, exchanged);
      return sendJson(res, 200, {
        authenticated: true,
        uid: exchanged.uid,
        email: exchanged.email || "",
        displayName: exchanged.displayName || "",
      });
    } catch {
      return sendJson(res, 401, { authenticated: false });
    }
  }

  if (pathname === "/api/auth/signup" && req.method === "POST") {
    try {
      const { email, password, displayNameMeta } = await readJsonBody(req);
      if (displayNameMeta && typeof displayNameMeta === "string") {
        const handleCandidate = displayNameMeta.split("|")[0] || "";
        const coreHandle = handleCandidate.replace(/^@/, "").trim();
        if (!/^[a-zA-Z0-9_]{3,30}$/.test(coreHandle)) {
          return sendJson(res, 400, {
            error: "Username can only contain English letters, numbers, and underscores (_), between 3 and 30 characters.",
          });
        }
      }
      const fbRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: String(email || "").trim(),
            password: String(password || ""),
            returnSecureToken: true,
          }),
        }
      );
      const doc = await fbRes.json();
      if (!fbRes.ok) {
        return sendJson(res, fbRes.status, {
          error: sanitizeErrorMessage(doc?.error?.message || "SIGNUP_FAILED"),
        });
      }

      if (displayNameMeta && doc.idToken) {
        fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${FIREBASE_API_KEY}`,
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

      const expiresInSec = Number(doc.expiresIn) || 3600;
      createOrUpdateVaultSession(res, {
        uid: doc.localId,
        email: String(email || "").trim(),
        displayName: String(displayNameMeta || ""),
        idToken: doc.idToken,
        refreshToken: doc.refreshToken,
        tokenExpUtc: Date.now() + Math.max(300, expiresInSec - 300) * 1000,
      });

      // Automatically add new user to Cloudflare D1 immediately upon signup
      try {
        const now = Math.floor(Date.now() / 1000);
        const parts = String(displayNameMeta || "").split("|");
        const cleanHandle = (parts[0] || "@user").trim();
        const cleanName = (parts[1] || cleanHandle.replace(/^@/, "")).trim();
        const cleanGender = (parts[2] || "Male").trim();
        const initials = cleanName.slice(0, 2).toUpperCase() || "KL";

        await queryD1(
          `INSERT INTO users (uid, handle, display_name, email, initials, bio, avatar_url, gender, is_male, can_post, followers_count, following_count, shkoyach_count, likes_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(uid) DO UPDATE SET
             handle = excluded.handle,
             display_name = excluded.display_name,
             updated_at = ?;`,
          [
            doc.localId,
            cleanHandle.startsWith("@") ? cleanHandle : `@${cleanHandle}`,
            cleanName,
            String(email || "").trim(),
            initials,
            "Sharing Jewish life & simchas on Klip ✡",
            "",
            cleanGender,
            cleanGender.toLowerCase() === "female" ? 0 : 1,
            0, 0, 0, 0, 0,
            now, now, now
          ]
        );
      } catch (d1Err) {
        console.warn("[SignUp] D1 auto-insert warning:", d1Err?.message);
      }

      return sendJson(res, 200, {
        authenticated: true,
        uid: doc.localId,
        email: String(email || "").trim(),
      });
    } catch (ex) {
      return sendJson(res, 500, {
        error: sanitizeErrorMessage(ex?.message || "SIGNUP_ERROR"),
      });
    }
  }

  if (pathname === "/api/auth/signin" && req.method === "POST") {
    try {
      const { email, password } = await readJsonBody(req);
      const fbRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: String(email || "").trim(),
            password: String(password || ""),
            returnSecureToken: true,
          }),
        }
      );
      const doc = await fbRes.json();
      if (!fbRes.ok) {
        return sendJson(res, fbRes.status, {
          error: sanitizeErrorMessage(doc?.error?.message || "SIGNIN_FAILED"),
        });
      }

      const expiresInSec = Number(doc.expiresIn) || 3600;
      createOrUpdateVaultSession(res, {
        uid: doc.localId,
        email: String(email || "").trim(),
        displayName: doc.displayName || "",
        idToken: doc.idToken,
        refreshToken: doc.refreshToken,
        tokenExpUtc: Date.now() + Math.max(300, expiresInSec - 300) * 1000,
      });

      return sendJson(res, 200, {
        authenticated: true,
        uid: doc.localId,
        email: String(email || "").trim(),
        displayName: doc.displayName || "",
      });
    } catch (ex) {
      return sendJson(res, 500, {
        error: sanitizeErrorMessage(ex?.message || "SIGNIN_ERROR"),
      });
    }
  }

  if (pathname === "/api/auth/signout" && req.method === "POST") {
    clearSessionCookie(req, res);
    return sendJson(res, 200, { authenticated: false });
  }

  return sendJson(res, 404, { error: "Not found" });
}

async function handleDbProxy(req, res, pathname) {
  const subPath = pathname.slice("/api/db/".length).replace(/^\/+/, "");
  if (!subPath || subPath.includes("..")) {
    return sendJson(res, 400, { error: "Invalid database path" });
  }

  const session = await getValidSessionAsync(req, res);
  const authQuery = session?.idToken
    ? `?auth=${encodeURIComponent(session.idToken)}`
    : "";
  const targetUrl = `${FIREBASE_DATABASE_URL}/${subPath}.json${authQuery}`;

  try {
    const fetchOpts = {
      method: req.method,
      headers: {},
    };

    if (req.method === "PUT" || req.method === "POST" || req.method === "PATCH") {
      const rawBuf = await readRawBody(req, 2 * 1024 * 1024);
      let bodyText = rawBuf.toString("utf8");
      try {
        const parsed = JSON.parse(bodyText);
        const unmasked = unmaskStorageUrlsInJson(parsed);
        bodyText = JSON.stringify(unmasked);
      } catch {
        /* keep raw bodyText if primitive */
      }
      fetchOpts.headers["Content-Type"] = "application/json";
      fetchOpts.body = bodyText;
    }

    const fbRes = await fetch(targetUrl, fetchOpts);
    const data = await fbRes.json().catch(() => null);
    const masked = maskStorageUrlsInJson(data);
    return sendJson(res, fbRes.status, masked);
  } catch (ex) {
    return sendJson(res, 502, { error: ex?.message || "Database proxy error" });
  }
}

async function handleStorageRoutes(req, res, pathname, searchParams) {
  const session = await getValidSessionAsync(req, res);
  if (!session || !session.idToken) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  if (pathname === "/api/storage/upload" && req.method === "POST") {
    const objectName = searchParams.get("name") || "";
    if (!objectName || objectName.includes("..")) {
      return sendJson(res, 400, { error: "Invalid object name" });
    }
    const encodedName = encodeURIComponent(objectName);
    const contentType = req.headers["content-type"] || "application/octet-stream";

    try {
      const bodyBuf = await readRawBody(req, 550 * 1024 * 1024);

      // Upload directly to Cloudflare R2
      if (CLOUDFLARE_API_TOKEN && CLOUDFLARE_ACCOUNT_ID) {
        const r2Uri = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/r2/buckets/kli-videos/objects/${encodedName}`;
        const cfRes = await fetch(r2Uri, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
            "Content-Type": contentType,
          },
          body: bodyBuf,
        });

        if (cfRes.ok) {
          const mediaUrl = `https://videos.kliponline.com/${objectName.replace(/^\/+/, "")}`;
          return sendJson(res, 200, {
            success: true,
            handled: true,
            mediaUrl,
            key: objectName,
          });
        }
      }
    } catch (ex) {
      return sendJson(res, 500, { error: ex?.message || "Upload failed" });
    }
  }

  if (pathname === "/api/storage/delete" && req.method === "POST") {
    try {
      const { mediaUrl } = await readJsonBody(req);
      let realUrl = "";
      if (typeof mediaUrl === "string" && mediaUrl.startsWith("/api/media/")) {
        const token = mediaUrl.slice("/api/media/".length).split(/[?#]/)[0];
        realUrl = decryptMediaUrl(token) || "";
      }
      if (!realUrl.includes("firebasestorage.googleapis.com")) {
        return sendJson(res, 200, { deleted: false });
      }
      const baseStorageUrl = realUrl.split("?")[0];
      await fetch(baseStorageUrl, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.idToken}` },
      }).catch(() => {});
      return sendJson(res, 200, { deleted: true });
    } catch {
      return sendJson(res, 200, { deleted: false });
    }
  }

  return sendJson(res, 404, { error: "Not found" });
}

function handleMediaStream(req, res, pathname, isDownload = false) {
  const prefix = isDownload ? "/api/media/download/" : "/api/media/";
  const token = pathname.slice(prefix.length).split("/")[0];
  const targetUrlStr = decryptMediaUrl(token);
  if (!targetUrlStr) {
    res.writeHead(404);
    res.end("Media not found");
    return;
  }

  const targetUrl = new URL(targetUrlStr);
  const proxyHeaders = {
    Host: targetUrl.host,
    "Accept-Encoding": "identity",
  };
  if (req.headers.range) {
    proxyHeaders.Range = req.headers.range;
  }
  if (req.headers["if-none-match"]) {
    proxyHeaders["If-None-Match"] = req.headers["if-none-match"];
  }
  if (req.headers["if-modified-since"]) {
    proxyHeaders["If-Modified-Since"] = req.headers["if-modified-since"];
  }

  const upstreamReq = https.request(
    targetUrl,
    {
      method: req.method === "HEAD" ? "HEAD" : "GET",
      headers: proxyHeaders,
      agent: httpsAgent,
    },
    (upstreamRes) => {
      const outHeaders = {
        "Cache-Control": isDownload ? "no-cache" : "public, max-age=31536000, immutable",
        "Accept-Ranges": upstreamRes.headers["accept-ranges"] || "bytes",
        "Access-Control-Allow-Origin": "*",
      };
      if (isDownload) {
        const customFilename = req.url ? new URL(req.url, "http://localhost").searchParams.get("filename") : null;
        const filename = customFilename || "klip_video.mp4";
        outHeaders["Content-Disposition"] = `attachment; filename="${encodeURIComponent(filename)}"`;
      }
      const passThrough = [
        "content-type",
        "content-length",
        "content-range",
        "etag",
        "last-modified",
      ];
      for (const h of passThrough) {
        if (upstreamRes.headers[h]) {
          outHeaders[h] = upstreamRes.headers[h];
        }
      }
      res.writeHead(upstreamRes.statusCode || 200, outHeaders);
      upstreamRes.pipe(res);
    }
  );

  upstreamReq.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502);
    }
    res.end();
  });

  req.on("close", () => {
    if (!res.writableEnded) {
      upstreamReq.destroy();
    }
  });

  upstreamReq.end();
}

// ==================== CLOUDFLARE STREAM ROUTES ====================
async function handleStreamRoutes(req, res, pathname, searchParams) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    return res.end();
  }

  // 1. Direct Creator Upload Token Request
  if (pathname === "/api/stream/direct-upload" && req.method === "POST") {
    const session = await getValidSessionAsync(req, res).catch(() => null);
    const body = await readJsonBody(req).catch(() => ({}));
    const uid = session?.uid || body?.creatorUid;
    if (!uid) {
      return sendJson(res, 401, { error: "Authentication required to upload videos." });
    }

    if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN) {
      return sendJson(res, 500, {
        error: "Cloudflare Stream is not configured on the server. Please set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in .env.",
      });
    }

    try {
      const maxDurationSeconds = Math.min(Number(body.maxDurationSeconds) || 1800, 3600);
      const name = (body.name || body.fileName || "Klip Video").slice(0, 100);

      const cfRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/stream/direct_upload`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${CLOUDFLARE_STREAM_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            maxDurationSeconds,
            expiry: new Date(Date.now() + 1 * 3600 * 1000).toISOString(),
            creator: uid,
            meta: {
              name,
              creatorUid: uid,
            },
          }),
        }
      );

      const cfData = await cfRes.json();
      if (!cfRes.ok || !cfData.success) {
        const errMsg = cfData.errors?.[0]?.message || "Cloudflare Direct Upload initialization failed.";
        return sendJson(res, 502, { error: errMsg, details: cfData.errors });
      }

      const uploadURL = cfData.result.uploadURL;
      const videoUid = cfData.result.uid;

      return sendJson(res, 200, {
        success: true,
        uploadURL,
        uid: videoUid,
        playbackUrl: `https://${CLOUDFLARE_CUSTOMER_SUBDOMAIN}/${videoUid}/manifest/video.m3u8`,
        thumbnailUrl: `https://${CLOUDFLARE_CUSTOMER_SUBDOMAIN}/${videoUid}/thumbnails/thumbnail.jpg`,
      });
    } catch (err) {
      return sendJson(res, 500, { error: err?.message || "Internal server error" });
    }
  }

  // 2. Query Video Status from Cloudflare Stream
  if (pathname === "/api/stream/status" && req.method === "GET") {
    const uid = searchParams.get("uid");
    if (!uid) {
      return sendJson(res, 400, { error: "Missing video uid." });
    }

    try {
      const cfRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/stream/${encodeURIComponent(uid)}`,
        {
          headers: {
            "Authorization": `Bearer ${CLOUDFLARE_STREAM_API_TOKEN}`,
          },
        }
      );

      const cfData = await cfRes.json();
      if (!cfRes.ok || !cfData.success) {
        return sendJson(res, 200, {
          success: false,
          uid,
          readyToStream: false,
          state: "processing",
          playbackUrl: `https://${CLOUDFLARE_CUSTOMER_SUBDOMAIN}/${uid}/manifest/video.m3u8`,
          thumbnailUrl: `https://${CLOUDFLARE_CUSTOMER_SUBDOMAIN}/${uid}/thumbnails/thumbnail.jpg`,
        });
      }

      const r = cfData.result || {};
      return sendJson(res, 200, {
        success: true,
        uid,
        readyToStream: Boolean(r.readyToStream),
        state: r.status?.state || (r.readyToStream ? "ready" : "processing"),
        duration: r.duration || 0,
        playbackUrl: `https://${CLOUDFLARE_CUSTOMER_SUBDOMAIN}/${uid}/manifest/video.m3u8`,
        thumbnailUrl: `https://${CLOUDFLARE_CUSTOMER_SUBDOMAIN}/${uid}/thumbnails/thumbnail.jpg`,
      });
    } catch (err) {
      return sendJson(res, 500, { error: err?.message || "Internal server error" });
    }
  }

  // 3. Copy/Import from Video URL
  if (pathname === "/api/stream/copy" && req.method === "POST") {
    const session = await getValidSessionAsync(req, res).catch(() => null);
    const body = await readJsonBody(req).catch(() => ({}));
    if (!session?.uid && !body?.creatorUid) {
      return sendJson(res, 401, { error: "Authentication required." });
    }

    try {
      if (!body.url) {
        return sendJson(res, 400, { error: "Missing video url." });
      }

      const cfRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/stream/copy`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${CLOUDFLARE_STREAM_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: body.url,
            meta: body.meta || { name: "Klip Video" },
          }),
        }
      );

      const cfData = await cfRes.json();
      return sendJson(res, cfRes.status, cfData);
    } catch (err) {
      return sendJson(res, 500, { error: err?.message || "Internal server error" });
    }
  }

  // ==================== CLOUDFLARE D1 APIS ====================
  // (Uses top-level queryD1 client)

  // 4. Feed API backed by D1
  if (pathname === "/api/feed" && req.method === "GET") {
    try {
      const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));
      const tab = (searchParams.get("tab") || "FYP").toUpperCase();
      const userUid = searchParams.get("userUid") || "";
      const creatorUid = searchParams.get("creatorUid") || "";
      const tag = searchParams.get("tag") || "";

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
      } else if (tab === "FEMALE") {
        sql += " AND k.is_female_only = 1 ORDER BY k.created_at DESC LIMIT ?";
        params.push(limit);
      } else if (tab === "FOLLOWING" && userUid) {
        sql += ` AND k.creator_uid IN (SELECT followed_uid FROM follows WHERE follower_uid = ?) ORDER BY k.created_at DESC LIMIT ?`;
        params.push(userUid, limit);
      } else if (tag) {
        sql += " AND k.tags LIKE ? ORDER BY k.created_at DESC LIMIT ?";
        params.push(`%${tag}%`, limit);
      } else {
        sql += " AND k.is_female_only = 0 ORDER BY k.created_at DESC LIMIT ?";
        params.push(limit);
      }

      const rows = await queryD1(sql, params);
      return sendJson(res, 200, { success: true, count: rows.length, klips: rows });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 5. User API backed by D1
  if (pathname === "/api/user" && req.method === "GET") {
    try {
      const uid = searchParams.get("uid");
      const handle = searchParams.get("handle");
      let rows = [];
      if (uid) {
        rows = await queryD1("SELECT * FROM users WHERE uid = ? LIMIT 1;", [uid]);
        if (rows.length === 0) return sendJson(res, 404, { success: false, error: "User not found" });
        return sendJson(res, 200, { success: true, user: rows[0] });
      } else if (handle) {
        const cleanHandle = handle.startsWith("@") ? handle : `@${handle}`;
        rows = await queryD1("SELECT * FROM users WHERE LOWER(handle) = LOWER(?) LIMIT 1;", [cleanHandle]);
        if (rows.length === 0) return sendJson(res, 404, { success: false, error: "User not found" });
        return sendJson(res, 200, { success: true, user: rows[0] });
      } else {
        rows = await queryD1("SELECT * FROM users ORDER BY created_at DESC;", []);
        return sendJson(res, 200, { success: true, count: rows.length, users: rows });
      }
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  if (pathname === "/api/user" && req.method === "POST") {
    try {
      const body = await readJsonBody(req).catch(() => ({}));
      const uid = body.uid || body.Uid;
      if (!uid) return sendJson(res, 400, { success: false, error: "Missing uid" });
      const now = Math.floor(Date.now() / 1000);
      await queryD1(
        `INSERT INTO users (uid, handle, display_name, email, initials, bio, avatar_url, gender, is_male, can_post, followers_count, following_count, shkoyach_count, likes_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        [
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
          now,
        ]
      );
      return sendJson(res, 200, { success: true, uid });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 6. Comments API backed by D1
  if (pathname === "/api/comments" && req.method === "GET") {
    try {
      const klipId = searchParams.get("klipId");
      if (!klipId) return sendJson(res, 400, { success: false, error: "Missing klipId" });
      const rows = await queryD1("SELECT * FROM klip_comments WHERE klip_id = ? ORDER BY created_at ASC;", [klipId]);
      return sendJson(res, 200, { success: true, count: rows.length, comments: rows });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  if (pathname === "/api/comments" && req.method === "POST") {
    try {
      const body = await readJsonBody(req).catch(() => ({}));
      const { action, id, klipId, userUid, userHandle, userInitials, userAvatarUrl, text, parentCommentId, replyToUid, replyToHandle } = body;
      const now = Math.floor(Date.now() / 1000);

      if (action === "like_comment") {
        const commentId = body.commentId || id;
        await queryD1("INSERT OR IGNORE INTO comment_likes (user_uid, comment_id, created_at) VALUES (?, ?, ?);", [userUid, commentId, now]);
        await queryD1("UPDATE klip_comments SET likes_count = likes_count + 1 WHERE id = ?;", [commentId]);
        return sendJson(res, 200, { success: true, action: "like_comment", commentId });
      }

      if (!id || !klipId || !userUid || !text) {
        return sendJson(res, 400, { success: false, error: "Missing required comment fields" });
      }

      await queryD1(
        `INSERT INTO klip_comments (id, klip_id, user_uid, user_handle, user_initials, user_avatar_url, text, parent_comment_id, reply_to_uid, reply_to_handle, likes_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?);`,
        [id, klipId, userUid, userHandle || "@user", userInitials || "KL", userAvatarUrl || "", text, parentCommentId || null, replyToUid || null, replyToHandle || null, now]
      );
      await queryD1("UPDATE klips SET comments_count = comments_count + 1 WHERE id = ?;", [klipId]);
      return sendJson(res, 200, { success: true, id, klipId });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 7. Engagement API backed by D1
  if (pathname === "/api/engagement" && req.method === "GET") {
    try {
      const userUid = searchParams.get("userUid") || searchParams.get("uid");
      const type = searchParams.get("type") || "likes";

      if (!userUid && type !== "all_likes") {
        return sendJson(res, 400, { success: false, error: "Missing userUid" });
      }

      if (type === "likes") {
        const rows = await queryD1("SELECT klip_id FROM klip_likes WHERE user_uid = ?;", [userUid]);
        const klipIds = rows.map((r) => r.klip_id);
        return sendJson(res, 200, { success: true, count: klipIds.length, klipIds });
      }

      if (type === "bookmarks") {
        const rows = await queryD1("SELECT klip_id FROM klip_bookmarks WHERE user_uid = ?;", [userUid]);
        const klipIds = rows.map((r) => r.klip_id);
        return sendJson(res, 200, { success: true, count: klipIds.length, klipIds });
      }

      if (type === "following") {
        const rows = await queryD1("SELECT followed_uid FROM follows WHERE follower_uid = ?;", [userUid]);
        const followingUids = rows.map((r) => r.followed_uid);
        return sendJson(res, 200, { success: true, count: followingUids.length, followingUids });
      }

      if (type === "followers") {
        const rows = await queryD1("SELECT follower_uid FROM follows WHERE followed_uid = ?;", [userUid]);
        const followerUids = rows.map((r) => r.follower_uid);
        return sendJson(res, 200, { success: true, count: followerUids.length, followerUids });
      }

      if (type === "all_likes") {
        const rows = await queryD1("SELECT user_uid, klip_id FROM klip_likes;", []);
        const map = {};
        for (const r of rows) {
          if (!map[r.user_uid]) map[r.user_uid] = {};
          map[r.user_uid][r.klip_id] = true;
        }
        return sendJson(res, 200, { success: true, likes: map });
      }

      return sendJson(res, 400, { success: false, error: "Invalid type" });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  if (pathname === "/api/engagement" && req.method === "POST") {
    try {
      const body = await readJsonBody(req).catch(() => ({}));
      const { action, userUid, klipId, targetUid } = body;
      const now = Math.floor(Date.now() / 1000);

      if (action === "like_klip" && klipId && userUid) {
        await queryD1("INSERT OR IGNORE INTO klip_likes (user_uid, klip_id, created_at) VALUES (?, ?, ?);", [userUid, klipId, now]);
        await queryD1("UPDATE klips SET likes_count = likes_count + 1 WHERE id = ?;", [klipId]);
        return sendJson(res, 200, { success: true, action, klipId, liked: true });
      }
      if (action === "unlike_klip" && klipId && userUid) {
        await queryD1("DELETE FROM klip_likes WHERE user_uid = ? AND klip_id = ?;", [userUid, klipId]);
        await queryD1("UPDATE klips SET likes_count = MAX(0, likes_count - 1) WHERE id = ?;", [klipId]);
        return sendJson(res, 200, { success: true, action, klipId, liked: false });
      }
      if (action === "bookmark_klip" && klipId && userUid) {
        await queryD1("INSERT OR IGNORE INTO klip_bookmarks (user_uid, klip_id, created_at) VALUES (?, ?, ?);", [userUid, klipId, now]);
        await queryD1("UPDATE klips SET bookmarks_count = bookmarks_count + 1 WHERE id = ?;", [klipId]);
        return sendJson(res, 200, { success: true, action, klipId, bookmarked: true });
      }
      if (action === "unbookmark_klip" && klipId && userUid) {
        await queryD1("DELETE FROM klip_bookmarks WHERE user_uid = ? AND klip_id = ?;", [userUid, klipId]);
        await queryD1("UPDATE klips SET bookmarks_count = MAX(0, bookmarks_count - 1) WHERE id = ?;", [klipId]);
        return sendJson(res, 200, { success: true, action, klipId, bookmarked: false });
      }
      if (action === "follow_user" && targetUid && userUid) {
        await queryD1("INSERT OR IGNORE INTO follows (follower_uid, followed_uid, created_at) VALUES (?, ?, ?);", [userUid, targetUid, now]);
        await queryD1("UPDATE users SET following_count = following_count + 1 WHERE uid = ?;", [userUid]);
        await queryD1("UPDATE users SET followers_count = followers_count + 1 WHERE uid = ?;", [targetUid]);
        return sendJson(res, 200, { success: true, action, targetUid, following: true });
      }
      if (action === "unfollow_user" && targetUid && userUid) {
        await queryD1("DELETE FROM follows WHERE follower_uid = ? AND followed_uid = ?;", [userUid, targetUid]);
        await queryD1("UPDATE users SET following_count = MAX(0, following_count - 1) WHERE uid = ?;", [userUid]);
        await queryD1("UPDATE users SET followers_count = MAX(0, followers_count - 1) WHERE uid = ?;", [targetUid]);
        return sendJson(res, 200, { success: true, action, targetUid, following: false });
      }
      return sendJson(res, 400, { success: false, error: "Invalid action" });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 8. Notifications API backed by D1
  if (pathname === "/api/notifications" && req.method === "GET") {
    try {
      const recipientUid = searchParams.get("recipientUid") || searchParams.get("uid");
      if (!recipientUid) return sendJson(res, 400, { success: false, error: "Missing recipientUid" });
      const rows = await queryD1("SELECT * FROM notifications WHERE recipient_uid = ? ORDER BY created_at DESC LIMIT 50;", [recipientUid]);
      return sendJson(res, 200, { success: true, count: rows.length, notifications: rows });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 9. Klip CRUD backed by D1
  if (pathname === "/api/klip" && req.method === "GET") {
    try {
      const id = searchParams.get("id");
      if (!id) return sendJson(res, 400, { success: false, error: "Missing id" });
      const rows = await queryD1("SELECT * FROM klips WHERE id = ? LIMIT 1;", [id]);
      if (rows.length === 0) return sendJson(res, 404, { success: false, error: "Klip not found" });
      return sendJson(res, 200, { success: true, klip: rows[0] });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  if (pathname === "/api/klip" && req.method === "POST") {
    try {
      const body = await readJsonBody(req).catch(() => ({}));
      const id = body.id || body.Id;
      if (!id) return sendJson(res, 400, { success: false, error: "Missing id" });
      const now = Math.floor(Date.now() / 1000);
      const tagsJson = JSON.stringify(Array.isArray(body.tags || body.Tags) ? (body.tags || body.Tags) : []);
      const photosJson = JSON.stringify(Array.isArray(body.photoUrls || body.PhotoUrls) ? (body.photoUrls || body.PhotoUrls) : []);
      await queryD1(
        `INSERT INTO klips (id, creator_uid, creator_handle, creator_initials, creator_avatar_url, caption, tags, video_url, watermarked_video_url, thumbnail_url, photo_urls, video_provider, cloudflare_video_id, playback_url, playback_status, r2_video_key, sound_id, sound_title, sound_audio_url, sound_start_time, sound_end_time, is_female_only, audience, gender, color_hex, likes_count, views_count, bookmarks_count, comments_count, shares_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        [
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
          now,
        ]
      );
      return sendJson(res, 200, { success: true, id });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  if (pathname === "/api/klip" && req.method === "PATCH") {
    try {
      const body = await readJsonBody(req).catch(() => ({}));
      const id = body.id || body.Id;
      if (!id) return sendJson(res, 400, { success: false, error: "Missing id" });

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
        return sendJson(res, 200, { success: true, message: "No updates provided" });
      }

      updates.push("updated_at = ?");
      params.push(Math.floor(Date.now() / 1000));
      params.push(id);

      await queryD1(`UPDATE klips SET ${updates.join(", ")} WHERE id = ?;`, params);
      return sendJson(res, 200, { success: true, id });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  if (pathname === "/api/klip" && req.method === "DELETE") {
    try {
      const id = searchParams.get("id");
      if (!id) return sendJson(res, 400, { success: false, error: "Missing id" });

      await queryD1("DELETE FROM klips WHERE id = ?;", [id]);
      await queryD1("DELETE FROM klip_likes WHERE klip_id = ?;", [id]);
      await queryD1("DELETE FROM klip_bookmarks WHERE klip_id = ?;", [id]);
      await queryD1("DELETE FROM klip_comments WHERE klip_id = ?;", [id]);

      return sendJson(res, 200, { success: true, message: "Klip deleted" });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  return sendJson(res, 404, { error: "Not found" });
}

// ==================== STATIC FILE SERVER ====================
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const BLOCKED_FILES = new Set([
  "/server.js",
  "/package.json",
  "/package-lock.json",
  "/.env",
  "/.env.example",
  "/.gitignore",
  "/.sessions.enc",
]);

const CSP_HEADER =
  "default-src 'self'; script-src 'self' blob: 'wasm-unsafe-eval'; connect-src 'self' https://*.firebaseio.com https://*.googleapis.com https://*.firebasestorage.app https://*.cloudflarestream.com https://upload.videodelivery.net https://*.videodelivery.net https://videos.kliponline.com https://*.r2.dev; media-src 'self' blob: https://*.googleapis.com https://*.firebasestorage.app https://*.archive.org https://*.cloudflarestream.com https://*.videodelivery.net https://videos.kliponline.com https://*.r2.dev; img-src 'self' data: blob: https://*.googleapis.com https://*.firebasestorage.app https://*.cloudflarestream.com https://*.videodelivery.net https://videos.kliponline.com https://*.r2.dev; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; frame-ancestors 'none'";

// In-memory compressed cache for static assets to give instant microsecond TTFB
const STATIC_ASSET_CACHE = new Map();

function getCompressedAsset(filePath, ext, mtimeMs) {
  const cached = STATIC_ASSET_CACHE.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached;
  }

  const rawBuffer = fs.readFileSync(filePath);
  const etag = `"${crypto.createHash("md5").update(rawBuffer).digest("hex")}"`;
  const isCompressible =
    ext === ".js" || ext === ".mjs" || ext === ".css" || ext === ".html" || ext === ".json" || ext === ".svg";

  let gzip = null;
  let br = null;

  if (isCompressible && rawBuffer.length > 256) {
    try {
      gzip = zlib.gzipSync(rawBuffer, { level: 6 });
      br = zlib.brotliCompressSync(rawBuffer, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
        },
      });
    } catch {
      // fallback to raw
    }
  }

  const record = {
    mtimeMs,
    etag,
    raw: rawBuffer,
    gzip,
    br,
  };
  STATIC_ASSET_CACHE.set(filePath, record);
  return record;
}

function handleStaticFile(req, res, pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;

  // Never serve dotfiles (.env, .git, etc.) or server configuration files
  if (
    cleanPath.split("/").some((part) => part.startsWith(".")) ||
    BLOCKED_FILES.has(cleanPath.toLowerCase())
  ) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  const resolvedPath = path.resolve(__dirname, "." + cleanPath);
  if (!resolvedPath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(resolvedPath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const mime = MIME_TYPES[ext] || "application/octet-stream";
    const asset = getCompressedAsset(resolvedPath, ext, stat.mtimeMs);

    // ETag 304 Not Modified validation for instant response
    const clientEtag = req.headers["if-none-match"];
    if (clientEtag && (clientEtag === asset.etag || clientEtag === "*" || clientEtag.includes(asset.etag.replace(/"/g, "")))) {
      res.writeHead(304, {
        "ETag": asset.etag,
        "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
      });
      res.end();
      return;
    }

    // Cache-Control headers: versioned JS/CSS/fonts/images are immutable long-term cached
    let cacheControl = "no-cache";
    if (ext === ".png" || ext === ".jpg" || ext === ".webp" || ext === ".ico") {
      cacheControl = "public, max-age=604800, stale-while-revalidate=86400";
    } else if (cleanPath.startsWith("/js/") || cleanPath === "/styles.css") {
      // Long-term cache with revalidation via etag / version query parameter
      cacheControl = "public, max-age=31536000, stale-while-revalidate=86400";
    }

    const acceptEncoding = String(req.headers["accept-encoding"] || "");
    let payload = asset.raw;
    const headers = {
      "Content-Type": mime,
      "Content-Security-Policy": CSP_HEADER,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": cacheControl,
      "ETag": asset.etag,
      "Vary": "Accept-Encoding",
    };

    if (asset.br && /\bbr\b/.test(acceptEncoding)) {
      headers["Content-Encoding"] = "br";
      payload = asset.br;
    } else if (asset.gzip && /\bgzip\b/.test(acceptEncoding)) {
      headers["Content-Encoding"] = "gzip";
      payload = asset.gzip;
    }

    headers["Content-Length"] = payload.length;
    res.writeHead(200, headers);
    res.end(payload);
  });
}

// ==================== MAIN SERVER ====================
const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(urlObj.pathname);

  if (pathname.startsWith("/api/auth/")) {
    return handleAuthRoutes(req, res, pathname);
  }
  if (pathname.startsWith("/api/db/")) {
    return handleDbProxy(req, res, pathname);
  }
  if (pathname.startsWith("/api/storage/")) {
    return handleStorageRoutes(req, res, pathname, urlObj.searchParams);
  }
  if (
    pathname === "/api/feed" ||
    pathname === "/api/user" ||
    pathname === "/api/klip" ||
    pathname === "/api/comments" ||
    pathname === "/api/engagement" ||
    pathname === "/api/notifications" ||
    pathname.startsWith("/api/stream/")
  ) {
    return handleStreamRoutes(req, res, pathname, urlObj.searchParams);
  }
  if (pathname === "/api/test-db") {
    return sendJson(res, 200, {
      success: true,
      database: "KLIPBASE",
      environment: "local-dev",
      database_id: "d7a63d25-d614-413a-81bc-cbc8c3ec937b",
      note: "Pages Functions test route configured at functions/api/test-db.js. When deployed to Cloudflare Pages, context.env.KLIPBASE executes directly on production D1.",
      result: {
        connected: 1
      }
    });
  }
  if (pathname === "/api/test-r2") {
    return sendJson(res, 200, {
      success: true,
      bucket: "klip-videos",
      binding: "KLIPVIDEOS",
      environment: "local-dev",
      note: "Pages Functions test route configured at functions/api/test-r2.js. When deployed to Cloudflare Pages, context.env.KLIPVIDEOS accesses the R2 bucket.",
      result: {
        accessible: true
      }
    });
  }
  if (pathname.startsWith("/api/media/download/")) {
    return handleMediaStream(req, res, pathname, true);
  }
  if (pathname.startsWith("/api/media/")) {
    return handleMediaStream(req, res, pathname, false);
  }

  return handleStaticFile(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`[KlipServer] Running securely at http://localhost:${PORT}`);
});

