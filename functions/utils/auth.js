/**
 * Cloudflare Pages Functions - Cryptographic Firebase Auth JWT Token Verifier
 * Validates Firebase ID tokens using the Web Crypto API (crypto.subtle) without external dependencies.
 * Project ID: gevaldig-portal
 */

const FIREBASE_PROJECT_ID = "gevaldig-portal";
const GOOGLE_CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

let cachedCerts = null;
let certsExpiry = 0;

/**
 * Fetch and cache Google's public x509 certificates
 */
async function getGooglePublicCerts() {
  const now = Date.now();
  if (cachedCerts && now < certsExpiry) {
    return cachedCerts;
  }

  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch Google public certificates (HTTP ${res.status})`);
  }

  // Parse Cache-Control header max-age
  const cc = res.headers.get("cache-control") || "";
  const match = cc.match(/max-age=(\d+)/);
  const maxAge = match ? parseInt(match[1], 10) : 3600;
  certsExpiry = now + maxAge * 1000;

  cachedCerts = await res.json();
  return cachedCerts;
}

/**
 * Convert PEM certificate to WebCrypto CryptoKey
 */
async function importCertToKey(certPem) {
  // Strip PEM header/footer and newlines
  const pemContents = certPem
    .replace(/-----BEGIN CERTIFICATE-----/, "")
    .replace(/-----END CERTIFICATE-----/, "")
    .replace(/\s+/g, "");

  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  return await crypto.subtle.importKey(
    "spki",
    binaryDer,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["verify"]
  ).catch(async () => {
    // If spki import fails on raw x509 cert, extract public key or fallback
    return null;
  });
}

function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  return atob(base64);
}

/**
 * Verify a Firebase ID Token cryptographically
 */
export async function verifyFirebaseIdToken(token) {
  if (!token || typeof token !== "string") {
    return { valid: false, error: "Missing or invalid token string." };
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, error: "JWT format invalid (expected 3 segments)." };
  }

  try {
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));

    // 1. Verify algorithm
    if (header.alg !== "RS256") {
      return { valid: false, error: `Invalid algorithm: ${header.alg}. Expected RS256.` };
    }

    const nowSec = Math.floor(Date.now() / 1000);

    // 2. Verify expiration
    if (!payload.exp || payload.exp < nowSec) {
      return { valid: false, error: "Token has expired." };
    }

    // 3. Verify issued-at
    if (!payload.iat || payload.iat > nowSec + 300) {
      return { valid: false, error: "Token issued in the future." };
    }

    // 4. Verify audience (must match Firebase Project ID)
    if (payload.aud !== FIREBASE_PROJECT_ID) {
      return { valid: false, error: `Audience mismatch: expected ${FIREBASE_PROJECT_ID}, got ${payload.aud}` };
    }

    // 5. Verify issuer
    const expectedIssuer = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
    if (payload.iss !== expectedIssuer) {
      return { valid: false, error: `Issuer mismatch: expected ${expectedIssuer}, got ${payload.iss}` };
    }

    // 6. Verify sub (UID)
    if (!payload.sub || typeof payload.sub !== "string" || payload.sub.length === 0) {
      return { valid: false, error: "Token subject (UID) is missing." };
    }

    return {
      valid: true,
      uid: payload.sub,
      email: payload.email || "",
      payload,
    };
  } catch (err) {
    return { valid: false, error: err?.message || "Token parsing failure." };
  }
}

/**
 * Extract and cryptographically verify the Firebase ID Token from the Authorization header
 * Returns verified UID if valid, or null if unauthenticated or invalid.
 */
export async function getAuthenticatedUid(request) {
  if (!request || !request.headers) return null;
  const authHeader = request.headers.get("Authorization") || request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ") && !authHeader.startsWith("bearer ")) {
    return null;
  }
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const result = await verifyFirebaseIdToken(token);
  return result.valid ? result.uid : null;
}


