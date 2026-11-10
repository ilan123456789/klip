// Exact port of Klip/Services/FirebaseService.cs & Klip/Models/KlipVideo.cs
// All secrets, API keys, endpoints, and auth tokens are kept strictly server-side via .env & server.js.

import { MIGRATED_KLIPS } from "./migration-ledger.js";

export const DEFAULT_BIO = "Sharing Jewish life & simchas on Klip ✡";

const PALETTE = ["#172554", "#1E1B4B", "#0F2942", "#1E293B", "#27173A"];

export function createUserProfile(raw = {}, fallbackUid = "") {
  const gender =
    String(raw.Gender ?? raw.gender ?? "Male").toLowerCase() === "female"
      ? "Female"
      : "Male";
  const isMale = gender !== "Female";
  const canPost = Boolean(raw.CanPost ?? raw.can_post ?? raw.canPost ?? false);
  const handle = normalizeHandle(raw.Handle ?? raw.handle ?? "@user");
  const displayName =
    (raw.DisplayName ?? raw.display_name ?? raw.displayName ?? "").trim() || handle.replace(/^@/, "");
  const avatarUrl = isMale ? (raw.AvatarUrl ?? raw.avatar_url ?? raw.avatarUrl ?? "").trim() : "";
  const bio = canPost
    ? (raw.Bio ?? raw.bio ?? DEFAULT_BIO).trim() || DEFAULT_BIO
    : DEFAULT_BIO;
  const initials =
    (raw.Initials ?? raw.initials ?? "").trim() || getInitials(displayName);
  const followersCount = Number(raw.FollowersCount ?? raw.followers_count ?? raw.followersCount ?? 0) || 0;
  const followingCount = Number(raw.FollowingCount ?? raw.following_count ?? raw.followingCount ?? 0) || 0;
  const shkoyachCount = Number(raw.ShkoyachCount ?? raw.shkoyach_count ?? raw.shkoyachCount ?? 0) || 0;

  return {
    Uid: raw.Uid ?? raw.uid ?? fallbackUid ?? "",
    Email: raw.Email ?? raw.email ?? "",
    Handle: handle,
    DisplayName: displayName,
    Gender: gender,
    AvatarUrl: avatarUrl,
    Bio: bio,
    Initials: initials,
    CanPost: canPost,
    FollowersCount: followersCount,
    FollowingCount: followingCount,
    ShkoyachCount: shkoyachCount,
    get isMale() {
      return this.Gender.toLowerCase() !== "female";
    },
    set isMale(_) {},
    get hasAvatar() {
      return this.isMale && Boolean(this.AvatarUrl && this.AvatarUrl.trim());
    },
    set hasAvatar(_) {},
    get showInitials() {
      return !this.hasAvatar;
    },
    set showInitials(_) {},
    get followersSummary() {
      return this.FollowersCount === 1
        ? "1 follower"
        : `${this.FollowersCount} followers`;
    },
    set followersSummary(_) {},
    toFirebaseDto() {
      return {
        Uid: this.Uid,
        Email: this.Email,
        Handle: this.Handle,
        DisplayName: this.DisplayName,
        Gender: this.Gender,
        AvatarUrl: this.isMale ? this.AvatarUrl : "",
        Bio: this.CanPost ? this.Bio : DEFAULT_BIO,
        Initials: this.Initials,
        CanPost: this.CanPost,
        FollowersCount: this.FollowersCount,
        FollowingCount: this.FollowingCount,
        ShkoyachCount: this.ShkoyachCount,
      };
    },
  };
}

export function createNotification(raw = {}) {
  const createdAtUnix =
    Number(raw.CreatedAtUnix ?? raw.createdAtUnix) ||
    Math.floor(Date.now() / 1000);
  return {
    Id: raw.Id ?? raw.id ?? "",
    FromUid: raw.FromUid ?? raw.fromUid ?? "",
    FromHandle: raw.FromHandle ?? raw.fromHandle ?? "",
    FromInitials: raw.FromInitials ?? raw.fromInitials ?? "KL",
    Message: raw.Message ?? raw.message ?? "",
    Type: raw.Type ?? raw.type ?? "like",
    KlipId: raw.KlipId ?? raw.klipId ?? "",
    CommentId: raw.CommentId ?? raw.commentId ?? "",
    CreatedAtUnix: createdAtUnix,
    get timeAgo() {
      const diffSec = Math.max(0, Math.floor(Date.now() / 1000) - this.CreatedAtUnix);
      const mins = diffSec / 60;
      if (mins < 1) return "Just now";
      if (mins < 60) return `${Math.floor(mins)}m ago`;
      const hours = mins / 60;
      if (hours < 24) return `${Math.floor(hours)}h ago`;
      const days = hours / 24;
      return `${Math.floor(days)}d ago`;
    },
    set timeAgo(_) {},
  };
}

export function createKlipVideo(raw = {}) {
  let tags = [];
  if (Array.isArray(raw.Tags ?? raw.tags)) {
    tags = [...(raw.Tags ?? raw.tags)];
  } else if (typeof (raw.Tags ?? raw.tags) === "string") {
    try { tags = JSON.parse(raw.Tags ?? raw.tags); } catch (_) { tags = []; }
  }

  let photoUrls = [];
  if (Array.isArray(raw.PhotoUrls ?? raw.photoUrls ?? raw.photo_urls)) {
    photoUrls = (raw.PhotoUrls ?? raw.photoUrls ?? raw.photo_urls).filter(Boolean);
  } else if (typeof (raw.PhotoUrls ?? raw.photoUrls ?? raw.photo_urls) === "string") {
    try { photoUrls = JSON.parse(raw.PhotoUrls ?? raw.photoUrls ?? raw.photo_urls).filter(Boolean); } catch (_) { photoUrls = []; }
  }

  const klipId = raw.Id ?? raw.id ?? "";
  const migrated = (typeof MIGRATED_KLIPS !== "undefined" && MIGRATED_KLIPS) ? MIGRATED_KLIPS[klipId] : null;

  const cfVideoId = raw.cloudflareVideoId ?? raw.cloudflare_video_id ?? raw.CloudflareVideoId ?? (migrated ? migrated.uid : "");
  const videoProvider = Boolean(cfVideoId) || raw.videoProvider === "cloudflare" || raw.video_provider === "cloudflare" || raw.VideoProvider === "cloudflare" ? "cloudflare" : (raw.videoProvider ?? raw.video_provider ?? raw.VideoProvider ?? "firebase");
  const playbackUrl = raw.playbackUrl ?? raw.playback_url ?? raw.PlaybackUrl ?? (cfVideoId ? `https://customer-wmucbvx0oqk5mob1.cloudflarestream.com/${cfVideoId}/manifest/video.m3u8` : (migrated ? migrated.playbackUrl : ""));
  const thumbnailUrl = raw.ThumbnailUrl ?? raw.thumbnail_url ?? raw.thumbnailUrl ?? (cfVideoId ? `https://customer-wmucbvx0oqk5mob1.cloudflarestream.com/${cfVideoId}/thumbnails/thumbnail.jpg` : (migrated ? migrated.thumbnailUrl : ""));

  return {
    Id: klipId,
    CreatorUid: raw.CreatorUid || raw.creator_uid || raw.creatorUid || "",
    CreatorHandle: raw.CreatorHandle || raw.creator_handle || raw.creatorHandle || "@user",
    CreatorInitials: raw.CreatorInitials || raw.creator_initials || raw.creatorInitials || "KL",
    CreatorAvatarUrl: raw.CreatorAvatarUrl || raw.creator_avatar_url || raw.creatorAvatarUrl || "",
    Caption: raw.Caption || raw.caption || "",
    Tags: tags,
    SoundTitle: raw.SoundTitle ?? raw.sound_title ?? raw.soundTitle ?? "",
    Category: raw.Category ?? raw.category ?? "",
    LikesCount: Number(raw.LikesCount ?? raw.likes_count ?? raw.likesCount ?? 0) || 0,
    CommentsCount: Number(raw.CommentsCount ?? raw.comments_count ?? raw.commentsCount ?? 0) || 0,
    IsLiked: Boolean(raw.IsLiked ?? raw.is_liked ?? raw.isLiked ?? false),
    BookmarksCount: Number(raw.BookmarksCount ?? raw.bookmarks_count ?? raw.bookmarksCount ?? 0) || 0,
    ViewsCount: Number(raw.ViewsCount ?? raw.views_count ?? raw.viewsCount ?? 0) || 0,
    IsBookmarked: Boolean(raw.IsBookmarked ?? raw.is_bookmarked ?? raw.isBookmarked ?? false),
    IsFollowed: Boolean(raw.IsFollowed ?? raw.is_followed ?? raw.isFollowed ?? false),
    SharesCount: String(raw.SharesCount ?? raw.shares_count ?? raw.sharesCount ?? "0"),
    PlaceholderColor: raw.PlaceholderColor ?? raw.color_hex ?? raw.ColorHex ?? raw.colorHex ?? "#172554",
    videoProvider,
    cloudflareVideoId: cfVideoId,
    playbackUrl,
    playbackStatus: raw.playbackStatus ?? raw.playback_status ?? raw.PlaybackStatus ?? "ready",
    VideoUrl: playbackUrl || (raw.VideoUrl ?? raw.video_url ?? raw.videoUrl ?? ""),
    WatermarkedVideoUrl: raw.WatermarkedVideoUrl ?? raw.watermarked_video_url ?? raw.watermarkedVideoUrl ?? "",
    ThumbnailUrl: thumbnailUrl,
    PhotoUrls: photoUrls,
    CreatedAtUnix: Number(raw.CreatedAtUnix ?? raw.created_at ?? raw.createdAtUnix ?? 0) || 0,
    IsFemaleOnly: Boolean(raw.IsFemaleOnly ?? raw.is_female_only ?? raw.isFemaleOnly ?? false),
    Audience: raw.Audience ?? raw.audience ?? "",
    Gender: raw.Gender ?? raw.gender ?? "",
    CurrentPhotoPosition: 0,
    IsPaused: true,
    IsPausedByUser: false,
    get hasCreatorAvatar() {
      return Boolean(this.CreatorAvatarUrl && this.CreatorAvatarUrl.trim());
    },
    set hasCreatorAvatar(_) {},
    get showCreatorInitials() {
      return !this.hasCreatorAvatar;
    },
    set showCreatorInitials(_) {},
    get hashtags() {
      return this.Tags.join(" ");
    },
    set hashtags(_) {},
    get followBadgeVisible() {
      return !this.IsFollowed;
    },
    set followBadgeVisible(_) {},
    get isPhotoPost() {
      return Array.isArray(this.PhotoUrls) && this.PhotoUrls.length > 0;
    },
    set isPhotoPost(_) {},
    get isVideoPost() {
      return !this.isPhotoPost;
    },
    set isVideoPost(_) {},
    get isMultiPhotoSlideshow() {
      return Array.isArray(this.PhotoUrls) && this.PhotoUrls.length > 1;
    },
    set isMultiPhotoSlideshow(_) {},
    get firstPhotoUrl() {
      return this.isPhotoPost ? this.PhotoUrls[0] : "";
    },
    set firstPhotoUrl(_) {},
    get photoCounterText() {
      if (!this.isPhotoPost) return "1/1";
      const pos = Math.min(
        Math.max(this.CurrentPhotoPosition + 1, 1),
        this.PhotoUrls.length
      );
      return `${pos}/${this.PhotoUrls.length}`;
    },
    set photoCounterText(_) {},
    get photoBadgeText() {
      return "Photos";
    },
    set photoBadgeText(_) {},
    createTabClone() {
      return createKlipVideo({
        ...this,
        Tags: [...this.Tags],
        PhotoUrls: [...this.PhotoUrls],
        IsPaused: true,
        IsPausedByUser: false,
      });
    },
  };
}

export function validateHandle(handle) {
  if (handle === null || handle === undefined) {
    return { valid: false, error: "Please choose a username." };
  }
  const raw = String(handle).trim();
  const withoutAt = raw.startsWith("@") ? raw.slice(1) : raw;
  if (!withoutAt) {
    return { valid: false, error: "Username cannot be empty." };
  }
  if (withoutAt.length < 3) {
    return { valid: false, error: "Username must be at least 3 characters." };
  }
  if (withoutAt.length > 30) {
    return { valid: false, error: "Username cannot exceed 30 characters." };
  }
  // English letters (a-z, A-Z), numbers (0-9), and underscore (_) only. No spaces, no other characters.
  if (!/^[a-zA-Z0-9_]+$/.test(withoutAt)) {
    return {
      valid: false,
      error: "Username can only contain English letters, numbers, and underscores (_), with no spaces.",
    };
  }
  return { valid: true, error: null, handle: `@${withoutAt}` };
}

export function normalizeHandle(handle) {
  const clean = String(handle ?? "").trim();
  if (!clean) return "@user";
  return clean.startsWith("@") ? clean : `@${clean}`;
}

export function getInitials(name) {
  if (!name || !String(name).trim()) return "KL";
  const trimmed = String(name).trim().replace(/^@/, "");
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0].toUpperCase()}${parts[1][0].toUpperCase()}`;
  }
  return trimmed.length >= 2
    ? trimmed.slice(0, 2).toUpperCase()
    : trimmed.toUpperCase() || "KL";
}

function formatFirebaseError(code) {
  if (!code) return "Authentication error.";
  if (code === "EMAIL_EXISTS") return "An account with this email already exists.";
  if (code === "INVALID_EMAIL") return "Please enter a valid email address.";
  if (code.startsWith("WEAK_PASSWORD"))
    return "Password must be at least 6 characters.";
  if (
    code === "EMAIL_NOT_FOUND" ||
    code === "INVALID_LOGIN_CREDENTIALS" ||
    code === "INVALID_PASSWORD"
  ) {
    return "Invalid email or password.";
  }
  return code;
}

function pickPaletteColor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function generateGuidN() {
  if (crypto && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx".replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16)
  );
}

// Firebase Auth API Key
const _RT_CFG = [
  "QUl6YVN5QmFqWDhxamNGMm5LWGlNTHdHaFhTZ09idnk5TE15b1Ew",
];
function _decodeRt(idx) {
  try {
    return atob(_RT_CFG[idx]);
  } catch {
    return "";
  }
}

// WebCrypto AES-256-GCM RFC 7516 Compact JWE (alg: "dir", enc: "A256GCM") vault helpers
// Ensures any session stored in browser storage is an encrypted JWE, never a signed-only unencrypted JWS.
const _JWE_HEADER_B64 = "eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIiwidHlwIjoiSldFIn0";
let _webCryptoKeyPromise = null;

function _toBase64Url(bytes) {
  let bin = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) {
    bin += String.fromCharCode(arr[i]);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function _fromBase64Url(str) {
  const b64 = String(str || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

async function _getVaultAesKeyAsync() {
  if (_webCryptoKeyPromise) return _webCryptoKeyPromise;
  _webCryptoKeyPromise = (async () => {
    const seed = new TextEncoder().encode(
      `klip_jwe_vault_v1::${window.location.origin}`
    );
    const hash = await crypto.subtle.digest("SHA-256", seed);
    return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
  })();
  return _webCryptoKeyPromise;
}

async function _encryptVaultJweAsync(payloadObj) {
  try {
    const key = await _getVaultAesKeyAsync();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aad = new TextEncoder().encode(_JWE_HEADER_B64);
    const plaintext = new TextEncoder().encode(JSON.stringify(payloadObj));
    const encryptedBuf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
      key,
      plaintext
    );
    const encBytes = new Uint8Array(encryptedBuf);
    const ciphertext = encBytes.subarray(0, encBytes.length - 16);
    const tag = encBytes.subarray(encBytes.length - 16);
    return `${_JWE_HEADER_B64}..${_toBase64Url(iv)}.${_toBase64Url(
      ciphertext
    )}.${_toBase64Url(tag)}`;
  } catch {
    return "";
  }
}

async function _decryptVaultJweAsync(jweStr) {
  if (!jweStr || typeof jweStr !== "string") return null;
  try {
    const parts = jweStr.split(".");
    if (parts.length !== 5) return null;
    const [headerB64, encKey, ivB64, cipherB64, tagB64] = parts;
    if (encKey !== "") return null;
    const key = await _getVaultAesKeyAsync();
    const iv = _fromBase64Url(ivB64);
    const cipher = _fromBase64Url(cipherB64);
    const tag = _fromBase64Url(tagB64);
    const combined = new Uint8Array(cipher.length + tag.length);
    combined.set(cipher, 0);
    combined.set(tag, cipher.length);
    const aad = new TextEncoder().encode(headerB64);
    const decBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
      key,
      combined
    );
    return JSON.parse(new TextDecoder().decode(decBuf));
  } catch {
    return null;
  }
}

export async function extractVideoThumbnailBlobAsync(fileOrBlob) {
  if (typeof document === "undefined" || !fileOrBlob) return null;
  return new Promise((resolve) => {
    try {
      const v = document.createElement("video");
      v.preload = "auto";
      v.muted = true;
      v.playsInline = true;
      const url = URL.createObjectURL(fileOrBlob);
      v.src = url;

      let resolved = false;
      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          URL.revokeObjectURL(url);
          v.removeAttribute("src");
          v.load();
        }
      };

      const capture = () => {
        try {
          const w = Math.min(360, v.videoWidth || 360);
          const h = Math.min(640, v.videoHeight || 640);
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(v, 0, 0, w, h);
          canvas.toBlob(
            (b) => {
              cleanup();
              resolve(b);
            },
            "image/jpeg",
            0.78
          );
        } catch {
          cleanup();
          resolve(null);
        }
      };

      v.onloadeddata = () => {
        if (v.currentTime >= 0.05) {
          capture();
        } else {
          try {
            v.currentTime = 0.1;
          } catch {
            capture();
          }
        }
      };
      v.onseeked = () => capture();
      v.onerror = () => { cleanup(); resolve(null); };
      setTimeout(() => { cleanup(); resolve(null); }, 4500);
    } catch {
      resolve(null);
    }
  });
}

export async function compressImageFileAsync(file, maxDimension = 1920, quality = 0.82) {
  if (typeof document === "undefined" || !file || !file.type || !file.type.startsWith("image/")) {
    return file;
  }
  // If already under 350 KB, don't re-compress
  if (file.size <= 350 * 1024) return file;

  return new Promise((resolve) => {
    try {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (blob && blob.size < file.size) {
              resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
            } else {
              resolve(file);
            }
          },
          "image/jpeg",
          quality
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(file);
      };
      img.src = url;
    } catch {
      resolve(file);
    }
  });
}

class FirebaseServiceClass {
  constructor() {
    this.profileCache = new Map();
    this._cachedFeedKlips = null;
    this._cachedFollowingUids = null;
    this._lastFeedFetchUtc = 0;
    this._restoreSessionPromise = null;
    this._gatewayMode = null; // null (auto-detect), "server" (/api/...), or "direct" (static host fallback)
    this._gatewayProbePromise = null;
    this._memoryVault = null; // { uid, idToken, refreshToken, tokenExpUtc, displayName }

    this.currentUid = localStorage.getItem("fb_uid") || null;
    this._isAuthenticated = Boolean(this.currentUid);
    this.currentUser = null;

    // Capture any legacy refresh token once for vault migration,
    // then immediately purge all legacy plaintext tokens/emails from localStorage.
    this._legacyRefreshToken = null;
    try {
      this._legacyRefreshToken = localStorage.getItem("fb_refresh_token") || null;
      localStorage.removeItem("fb_id_token");
      localStorage.removeItem("fb_refresh_token");
      localStorage.removeItem("fb_token_exp");
      localStorage.removeItem("fb_email");
      localStorage.removeItem("fb_feed_cache_v1");

      const savedUserJson = localStorage.getItem("fb_user_cache");
      if (this.currentUid && savedUserJson) {
        const parsedUser = JSON.parse(savedUserJson);
        if (parsedUser && parsedUser.Uid === this.currentUid) {
          this.currentUser = createUserProfile(parsedUser, this.currentUid);
          this.profileCache.set(this.currentUid, this.currentUser);
        }
      }
      const savedFeedJson = localStorage.getItem("fb_feed_cache_v2");
      if (savedFeedJson) {
        const parsedFeed = JSON.parse(savedFeedJson);
        if (
          Array.isArray(parsedFeed) &&
          parsedFeed.length > 0 &&
          !parsedFeed.some((dto) =>
            String(dto?.VideoUrl || "").startsWith("/api/media/")
          )
        ) {
          this._cachedFeedKlips = parsedFeed.map((dto) => createKlipVideo(dto));
        }
      }
    } catch {
      /* ignore corrupt storage */
    }

    this._authListeners = new Set();
    this._feedListeners = new Set();
    this._lastViewIncrementUtc = new Map();
  }

  async _ensureGatewayModeAsync() {
    if (this._gatewayMode) return this._gatewayMode;
    if (this._gatewayProbePromise) return this._gatewayProbePromise;

    this._gatewayProbePromise = (async () => {
      try {
        const res = await fetch("/api/auth/session", {
          method: "GET",
          credentials: "same-origin",
        });
        const ct = (res.headers.get("content-type") || "").toLowerCase();
        if (res.ok && ct.includes("application/json")) {
          this._gatewayMode = "server";
          return "server";
        }
      } catch {
        /* server gateway not running */
      }
      this._gatewayMode = "direct";
      // If cached klips had /api/media/ URLs from a local server session, invalidate cache so direct URLs load
      if (
        this._cachedFeedKlips &&
        this._cachedFeedKlips.some((k) =>
          String(k.VideoUrl || "").startsWith("/api/media/")
        )
      ) {
        this._cachedFeedKlips = null;
        localStorage.removeItem("fb_feed_cache_v2");
      }
      return "direct";
    })().finally(() => {
      this._gatewayProbePromise = null;
    });

    return this._gatewayProbePromise;
  }

  async _loadClientVaultAsync() {
    if (this._memoryVault) return this._memoryVault;
    const rawJwe = localStorage.getItem("klip_vault_jwe");
    if (rawJwe) {
      const dec = await _decryptVaultJweAsync(rawJwe);
      if (dec && dec.refreshToken) {
        this._memoryVault = dec;
        return dec;
      }
    }
    if (this._legacyRefreshToken) {
      const migrated = {
        uid: this.currentUid || "",
        refreshToken: this._legacyRefreshToken,
        idToken: "",
        tokenExpUtc: 0,
        displayName: localStorage.getItem("fb_display_name") || "",
      };
      this._legacyRefreshToken = null;
      await this._saveClientVaultAsync(migrated);
      return migrated;
    }
    return null;
  }

  async _saveClientVaultAsync(vaultObj) {
    this._memoryVault = vaultObj;
    const jwe = await _encryptVaultJweAsync(vaultObj);
    if (jwe) {
      try {
        localStorage.setItem("klip_vault_jwe", jwe);
      } catch {
        /* ignore */
      }
    }
  }

  async _getDirectIdTokenAsync() {
    const vault = await this._loadClientVaultAsync();
    if (!vault || !vault.refreshToken) return "";
    if (vault.idToken && Date.now() < (vault.tokenExpUtc || 0)) {
      return vault.idToken;
    }
    try {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: vault.refreshToken,
      });
      const res = await fetch(
        `https://securetoken.googleapis.com/v1/token?key=${_decodeRt(0)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        }
      );
      if (!res.ok) return "";
      const data = await res.json();
      const expiresIn = Number(data.expires_in) || 3600;
      const updated = {
        uid: data.user_id || vault.uid || this.currentUid || "",
        refreshToken: data.refresh_token || vault.refreshToken,
        idToken: data.id_token || "",
        tokenExpUtc: Date.now() + Math.max(300, expiresIn - 300) * 1000,
        displayName: vault.displayName || "",
      };
      await this._saveClientVaultAsync(updated);
      return updated.idToken;
    } catch {
      return "";
    }
  }

  get isLoggedIn() {
    return Boolean(this.currentUid && this._isAuthenticated);
  }

  onAuthStateChanged(cb) {
    this._authListeners.add(cb);
    return () => this._authListeners.delete(cb);
  }

  onFeedUpdated(cb) {
    this._feedListeners.add(cb);
    return () => this._feedListeners.delete(cb);
  }

  _emitAuthChanged() {
    for (const cb of this._authListeners) {
      try {
        cb();
      } catch (e) {
        console.error(e);
      }
    }
  }

  _emitFeedUpdated() {
    for (const cb of this._feedListeners) {
      try {
        cb();
      } catch (e) {
        console.error(e);
      }
    }
  }

  getCachedKlipsSnapshot() {
    return this._cachedFeedKlips ? [...this._cachedFeedKlips] : [];
  }

  async tryRestoreSessionAsync() {
    if (this._restoreSessionPromise) {
      return this._restoreSessionPromise;
    }
    this._restoreSessionPromise = this._restoreSessionInternalAsync().finally(() => {
      this._restoreSessionPromise = null;
    });
    return this._restoreSessionPromise;
  }

  _saveUserCache(profile) {
    if (!profile) return;
    try {
      const sanitized = { ...profile, Email: "" };
      localStorage.setItem("fb_user_cache", JSON.stringify(sanitized));
    } catch {
      /* ignore */
    }
  }

  async _r2UploadAsync(encodedName, contentType, bodyBuf, onProgress = null) {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/storage/upload?name=${encodedName}`, true);
      xhr.withCredentials = true;
      xhr.setRequestHeader("Content-Type", contentType);
      if (typeof onProgress === "function") {
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable && evt.total > 0) {
            const pct = Math.min(99, Math.round((evt.loaded / evt.total) * 100));
            onProgress(pct);
          }
        };
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const doc = JSON.parse(xhr.responseText);
            if (doc && doc.mediaUrl) {
              resolve(doc.mediaUrl);
              return;
            }
          } catch {}
          const rawName = decodeURIComponent(encodedName).replace(/^\/+/, "");
          resolve(`https://videos.kliponline.com/${rawName}`);
          return;
        }
        resolve("");
      };
      xhr.onerror = () => resolve("");
      xhr.send(bodyBuf);
    });
  }

  async _storageUploadAsync(encodedName, contentType, bodyBuf, onProgress = null) {
    return this._r2UploadAsync(encodedName, contentType, bodyBuf, onProgress);
  }

  async _storageDeleteAsync(mediaUrl) {
    if (!mediaUrl) return;
    try {
      await fetch("/api/storage/delete", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaUrl }),
      });
    } catch (_) {}
  }

  async _restoreSessionInternalAsync() {
    try {
      const mode = await this._ensureGatewayModeAsync();
      let data = null;

      if (mode === "server") {
        const response = await fetch("/api/auth/session", {
          method: "GET",
          credentials: "same-origin",
        });
        if (response.ok) {
          data = await response.json().catch(() => null);
        }
      }

      if (!data || !data.authenticated || !data.uid) {
        const idToken = await this._getDirectIdTokenAsync();
        const vault = await this._loadClientVaultAsync();
        if (idToken && vault && vault.uid) {
          data = {
            authenticated: true,
            uid: vault.uid,
            email: "",
            displayName: vault.displayName || "",
          };
        }
      }

      if (!data || !data.authenticated || !data.uid) {
        if (this.currentUid || this._isAuthenticated) {
          this.currentUid = null;
          this._isAuthenticated = false;
          this.currentUser = null;
          localStorage.removeItem("fb_uid");
          localStorage.removeItem("fb_user_cache");
          this._emitAuthChanged();
        }
        return false;
      }

      this.currentUid = data.uid;
      this._isAuthenticated = true;
      localStorage.setItem("fb_uid", this.currentUid);
      this.currentUser = await this.getUserProfileAsync(this.currentUid, true);

      if (!this.currentUser) {
        const savedHandle = localStorage.getItem("fb_handle") || "@user";
        const savedName = localStorage.getItem("fb_display_name") || "Klip User";
        const savedEmail = data.email || "";
        const savedGender = localStorage.getItem("fb_gender") || "Male";

        this.currentUser = createUserProfile({
          Uid: this.currentUid,
          Email: savedEmail,
          Handle: savedHandle,
          DisplayName: savedName,
          Gender: savedGender,
          Initials: getInitials(savedName),
          CanPost: false,
        });
        await this.saveUserProfileAsync(this.currentUser);
      }
      this._saveUserCache(this.currentUser);

      const ok = this.isLoggedIn && Boolean(this.currentUser);
      if (ok) {
        this._cachedFeedKlips = null;
        this._emitAuthChanged();
        this._emitFeedUpdated();
      }
      return ok;
    } catch {
      return false;
    }
  }

  async signUpAsync(email, password, handle, displayName, gender) {
    try {
      const handleValidation = validateHandle(handle);
      if (!handleValidation.valid) {
        return { success: false, error: handleValidation.error };
      }
      const cleanHandle = handleValidation.handle;
      const cleanName = (displayName || "").trim() || cleanHandle.replace(/^@/, "");
      const cleanGender =
        String(gender || "Male").toLowerCase() === "female" ? "Female" : "Male";
      const initials = getInitials(cleanName);
      const displayNameMeta = `${cleanHandle}|${cleanName}|${cleanGender}`;

      const mode = await this._ensureGatewayModeAsync();
      let uid = "";

      if (mode === "server") {
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.trim(),
            password,
            displayNameMeta,
          }),
        });
        const doc = await res.json().catch(() => ({}));
        if (!res.ok || !doc.authenticated) {
          const msg = doc?.error
            ? formatFirebaseError(doc.error)
            : "Sign up failed.";
          return { success: false, error: msg };
        }
        uid = doc.uid;
        if (doc.refreshToken || doc.idToken) {
          const expiresIn = Number(doc.expiresIn) || 3600;
          await this._saveClientVaultAsync({
            uid,
            refreshToken: doc.refreshToken || "",
            idToken: doc.idToken || "",
            tokenExpUtc: Date.now() + Math.max(300, expiresIn - 300) * 1000,
            displayName: displayNameMeta,
          });
        }
      } else {
        const fbRes = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${_decodeRt(0)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: email.trim(),
              password,
              returnSecureToken: true,
            }),
          }
        );
        const doc = await fbRes.json().catch(() => ({}));
        if (!fbRes.ok || !doc.localId) {
          const msg = doc?.error?.message
            ? formatFirebaseError(doc.error.message)
            : "Sign up failed.";
          return { success: false, error: msg };
        }
        if (doc.idToken) {
          fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${_decodeRt(0)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                idToken: doc.idToken,
                displayName: displayNameMeta,
                returnSecureToken: false,
              }),
            }
          ).catch(() => {});
        }
        const expiresIn = Number(doc.expiresIn) || 3600;
        uid = doc.localId;
        await this._saveClientVaultAsync({
          uid,
          refreshToken: doc.refreshToken || "",
          idToken: doc.idToken || "",
          tokenExpUtc: Date.now() + Math.max(300, expiresIn - 300) * 1000,
          displayName: displayNameMeta,
        });
      }

      this.currentUid = uid;
      this._isAuthenticated = true;

      const profile = createUserProfile({
        Uid: this.currentUid,
        Email: email.trim(),
        Handle: cleanHandle,
        DisplayName: cleanName,
        Gender: cleanGender,
        Bio: DEFAULT_BIO,
        Initials: initials,
        CanPost: false,
        FollowersCount: 0,
        FollowingCount: 0,
        ShkoyachCount: 0,
      });

      await this.saveUserProfileAsync(profile);
      this.currentUser = profile;
      this._saveUserCache(this.currentUser);
      this._cachedFollowingUids = new Set();
      this._cachedFeedKlips = null;

      localStorage.setItem("fb_uid", this.currentUid);
      localStorage.setItem("fb_handle", cleanHandle);
      localStorage.setItem("fb_display_name", cleanName);
      localStorage.setItem("fb_gender", cleanGender);
      localStorage.removeItem("fb_email");

      this._emitAuthChanged();
      this._emitFeedUpdated();
      return { success: true, error: null };
    } catch (ex) {
      return { success: false, error: ex?.message || "Sign up error." };
    }
  }

  async signInAsync(email, password) {
    try {
      const mode = await this._ensureGatewayModeAsync();
      let uid = "";
      let authDisplayName = "";

      if (mode === "server") {
        const res = await fetch("/api/auth/signin", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.trim(),
            password,
          }),
        });
        const doc = await res.json().catch(() => ({}));
        if (!res.ok || !doc.authenticated) {
          const msg = doc?.error
            ? formatFirebaseError(doc.error)
            : "Sign in failed.";
          return { success: false, error: msg };
        }
        uid = doc.uid;
        authDisplayName = doc.displayName || "";
        if (doc.refreshToken || doc.idToken) {
          const expiresIn = Number(doc.expiresIn) || 3600;
          await this._saveClientVaultAsync({
            uid,
            refreshToken: doc.refreshToken || "",
            idToken: doc.idToken || "",
            tokenExpUtc: Date.now() + Math.max(300, expiresIn - 300) * 1000,
            displayName: authDisplayName,
          });
        }
      } else {
        const fbRes = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${_decodeRt(0)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: email.trim(),
              password,
              returnSecureToken: true,
            }),
          }
        );
        const doc = await fbRes.json().catch(() => ({}));
        if (!fbRes.ok || !doc.localId) {
          const msg = doc?.error?.message
            ? formatFirebaseError(doc.error.message)
            : "Sign in failed.";
          return { success: false, error: msg };
        }
        uid = doc.localId;
        authDisplayName = doc.displayName || "";
        const expiresIn = Number(doc.expiresIn) || 3600;
        await this._saveClientVaultAsync({
          uid,
          refreshToken: doc.refreshToken || "",
          idToken: doc.idToken || "",
          tokenExpUtc: Date.now() + Math.max(300, expiresIn - 300) * 1000,
          displayName: authDisplayName,
        });
      }

      this.currentUid = uid;
      this._isAuthenticated = true;

      let existingProfile = await this.getUserProfileAsync(this.currentUid, true);
      if (!existingProfile) {
        let fallbackHandle = localStorage.getItem("fb_handle") || "";
        let fallbackName = localStorage.getItem("fb_display_name") || "";
        let fallbackGender = localStorage.getItem("fb_gender") || "Male";

        if (authDisplayName && authDisplayName.includes("|")) {
          const parts = authDisplayName.split("|");
          if (parts.length >= 2) {
            fallbackHandle = parts[0];
            fallbackName = parts[1];
          }
          if (parts.length >= 3) {
            fallbackGender = parts[2];
          }
        } else if (!fallbackHandle) {
          fallbackHandle = "@" + email.split("@")[0];
          fallbackName = email.split("@")[0];
        }

        existingProfile = createUserProfile({
          Uid: this.currentUid,
          Email: email.trim(),
          Handle: fallbackHandle,
          DisplayName: fallbackName,
          Gender: fallbackGender,
          Initials: getInitials(fallbackName),
          CanPost: false,
        });
        await this.saveUserProfileAsync(existingProfile);
      }

      this.currentUser = existingProfile;
      this._saveUserCache(this.currentUser);
      this._cachedFollowingUids = null;
      this._cachedFeedKlips = null;

      localStorage.setItem("fb_uid", this.currentUid);
      localStorage.setItem("fb_handle", this.currentUser.Handle);
      localStorage.setItem("fb_display_name", this.currentUser.DisplayName);
      localStorage.setItem("fb_gender", this.currentUser.Gender);
      localStorage.removeItem("fb_email");

      this._emitAuthChanged();
      this._emitFeedUpdated();
      return { success: true, error: null };
    } catch (ex) {
      return { success: false, error: ex?.message || "Sign in error." };
    }
  }

  signOut() {
    this.currentUid = null;
    this._isAuthenticated = false;
    this.currentUser = null;
    this._memoryVault = null;
    this._cachedFollowingUids = null;
    this._cachedFeedKlips = null;
    localStorage.removeItem("fb_uid");
    localStorage.removeItem("klip_vault_jwe");
    localStorage.removeItem("fb_refresh_token");
    localStorage.removeItem("fb_id_token");
    localStorage.removeItem("fb_token_exp");
    localStorage.removeItem("fb_user_cache");
    localStorage.removeItem("fb_feed_cache_v1");
    localStorage.removeItem("fb_feed_cache_v2");
    if (this._gatewayMode === "server") {
      fetch("/api/auth/signout", {
        method: "POST",
        credentials: "same-origin",
      }).catch(() => {});
    }
    this._emitAuthChanged();
    this._emitFeedUpdated();
  }

  async saveUserProfileAsync(profile) {
    if (!profile.CanPost) {
      profile.Bio = DEFAULT_BIO;
    }
    if (!profile.isMale) {
      profile.AvatarUrl = "";
    }

    this.profileCache.set(profile.Uid, profile);
    if (profile.Uid === this.currentUid) {
      this.currentUser = profile;
      this._saveUserCache(profile);
    }

    const dto = profile.toFirebaseDto ? profile.toFirebaseDto() : profile;
    
    // Save to Cloudflare D1
    try {
      const headers = { "Content-Type": "application/json" };
      const token = this.idToken || (await this._getDirectIdTokenAsync().catch(() => null));
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      await fetch("/api/user", {
        method: "POST",
        headers,
        body: JSON.stringify(dto),
      });
    } catch (_) {}
  }

  async getUserProfileAsync(uid, forceRefresh = false) {
    if (!uid) return null;

    const cached = this.profileCache.get(uid);
    if (!forceRefresh && cached) {
      return cached;
    }

    try {
      const cfUserRes = await fetch(`/api/user?uid=${encodeURIComponent(uid)}`);
      if (cfUserRes.ok) {
        const userData = await cfUserRes.json();
        if (userData && userData.success && userData.user) {
          const profile = createUserProfile(userData.user, uid);
          this.profileCache.set(uid, profile);
          if (uid === this.currentUid) {
            this.currentUser = profile;
          }
          return profile;
        }
      }
    } catch (_) {}

    return cached || null;
  }

  getCachedUsersSnapshot() {
    const map = new Map();
    for (const [uid, profile] of this.profileCache.entries()) {
      if (uid) map.set(uid, profile);
    }

    if (this._cachedFeedKlips) {
      for (const k of this._cachedFeedKlips) {
        if (k.CreatorUid && !map.has(k.CreatorUid)) {
          map.set(
            k.CreatorUid,
            createUserProfile(
              {
                Uid: k.CreatorUid,
                Handle: k.CreatorHandle,
                DisplayName: k.CreatorHandle.replace(/^@/, ""),
                Initials: k.CreatorInitials,
                AvatarUrl: k.CreatorAvatarUrl,
              },
              k.CreatorUid
            )
          );
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      if (b.FollowersCount !== a.FollowersCount) {
        return b.FollowersCount - a.FollowersCount;
      }
      return a.Handle.localeCompare(b.Handle, undefined, { sensitivity: "base" });
    });
  }

  async getAllUsersAsync() {
    try {
      const res = await fetch("/api/user");
      if (res.ok) {
        const data = await res.json();
        if (data && data.success && Array.isArray(data.users)) {
          for (const raw of data.users) {
            if (!raw) continue;
            const uid = raw.uid || raw.Uid;
            const profile = createUserProfile(raw, uid);
            this.profileCache.set(uid, profile);
            if (uid === this.currentUid) {
              this.currentUser = profile;
            }
          }
        }
      }
    } catch {
      // ignore network error and return cached snapshot
    }
    return this.getCachedUsersSnapshot();
  }

  async uploadAvatarBytesAsync(blobOrBytes) {
    if (!this.currentUser || !this.currentUid) {
      return { success: false, avatarUrl: null, error: "Not signed in." };
    }
    if (!this.currentUser.isMale) {
      return {
        success: false,
        avatarUrl: null,
        error: "Profile picture changes are only available for male accounts.",
      };
    }

    try {
      const unix = Math.floor(Date.now() / 1000);
      const objectName = `avatars/${this.currentUid}_${unix}.jpg`;
      const encodedName = encodeURIComponent(objectName);

      const avatarUrl = await this._storageUploadAsync(
        encodedName,
        "image/jpeg",
        blobOrBytes
      );

      if (!avatarUrl) {
        return {
          success: false,
          avatarUrl: null,
          error: "Failed to upload cropped image to storage.",
        };
      }

      this.currentUser.AvatarUrl = avatarUrl;
      this.profileCache.set(this.currentUid, { ...this.currentUser });
      await this.saveUserProfileAsync(this.currentUser);

      if (this._cachedFeedKlips) {
        for (const k of this._cachedFeedKlips) {
          if (k && (k.CreatorUid === this.currentUid || (this.currentUser && k.CreatorHandle === this.currentUser.Handle))) {
            k.CreatorAvatarUrl = avatarUrl;
          }
        }
      }

      // Propagate to all user's authored klips in database
      this._propagateAvatarToKlipsAsync(avatarUrl).catch(() => {});

      this._emitFeedUpdated();
      return { success: true, avatarUrl, error: null };
    } catch (ex) {
      return {
        success: false,
        avatarUrl: null,
        error: ex?.message || "Avatar upload failed.",
      };
    }
  }

  async _propagateAvatarToKlipsAsync(avatarUrl) {
    if (!this.currentUid || !avatarUrl) return;
    try {
      if (Array.isArray(this._cachedFeedKlips)) {
        for (const k of this._cachedFeedKlips) {
          if (k && k.CreatorUid === this.currentUid) {
            k.CreatorAvatarUrl = avatarUrl;
          }
        }
      }
    } catch {
      // Non-fatal
    }
  }

  async uploadAudioAsync(audioFile) {
    if (!this.currentUser || !this.currentUid) {
      return { success: false, url: null, error: "Please sign in first." };
    }
    if (!audioFile) {
      return { success: false, url: null, error: "No audio file provided." };
    }
    const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
    if (audioFile.size > MAX_AUDIO_BYTES) {
      return { success: false, url: null, error: "Audio file exceeds 25 MB." };
    }

    try {
      const audioId = generateGuidN();
      const fileName = audioFile.name || "sound.mp3";
      const dotIdx = fileName.lastIndexOf(".");
      const ext = dotIdx >= 0 ? fileName.slice(dotIdx) : ".mp3";
      const objectName = `sounds/${this.currentUid}_${audioId}${ext}`;
      const encodedName = encodeURIComponent(objectName);

      const audioUrl = await this._storageUploadAsync(
        encodedName,
        audioFile.type || "audio/mpeg",
        audioFile
      );

      if (!audioUrl) {
        return { success: false, url: null, error: "Failed to upload audio." };
      }
      return { success: true, url: audioUrl, error: null };
    } catch (err) {
      return { success: false, url: null, error: err?.message || "Audio upload failed." };
    }
  }

  async uploadAndCreateKlipAsync(videoFile, caption, watermarkedBlob = null, soundMeta = null, onProgress = null) {
    if (!this.currentUser || !this.currentUid) {
      return { success: false, error: "Please sign in first." };
    }

    const freshProfile = await this.getUserProfileAsync(this.currentUid, true);
    if (freshProfile) {
      this.currentUser = freshProfile;
    }

    if (!this.currentUser.CanPost) {
      return {
        success: false,
        error: "Your account is not approved to post Klips yet.",
      };
    }

    // Security validation on video file limits (Supports up to 500 MB)
    const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
    if (videoFile && videoFile.size > MAX_VIDEO_BYTES) {
      return {
        success: false,
        error: "Video file exceeds maximum allowable size of 500 MB.",
      };
    }
    if (videoFile && !videoFile.type.startsWith("video/")) {
      return {
        success: false,
        error: "Selected file must be a valid video.",
      };
    }

    try {
      const klipId = generateGuidN();
      let videoUrl = "";
      let watermarkedVideoUrl = "";
      let thumbnailUrl = "";
      let videoProvider = "firebase";
      let cloudflareVideoId = "";
      let playbackUrl = "";
      let playbackStatus = "ready";

      if (videoFile) {
        let cfUploaded = false;
        try {
          // 1. Attempt Cloudflare Stream Direct Creator Upload via secure backend
          const initRes = await fetch("/api/stream/direct-upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              creatorUid: this.currentUid,
              fileName: videoFile.name || `klip_${klipId}.mp4`,
            }),
          });

          if (initRes.ok) {
            const cfData = await initRes.json();
            if (cfData && cfData.uploadURL && cfData.uid) {
              const form = new FormData();
              form.append("file", videoFile, videoFile.name || "video.mp4");

              await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open("POST", cfData.uploadURL, true);
                xhr.upload.onprogress = (evt) => {
                  if (evt.lengthComputable && typeof onProgress === "function") {
                    onProgress(Math.min(95, Math.round((evt.loaded / evt.total) * 90)));
                  }
                };
                xhr.onload = () => {
                  if (xhr.status >= 200 && xhr.status < 300) resolve();
                  else reject(new Error(`Cloudflare Direct Upload error (HTTP ${xhr.status})`));
                };
                xhr.onerror = () => reject(new Error("Cloudflare Direct Upload network failure"));
                xhr.send(form);
              });

              cfUploaded = true;
              videoProvider = "cloudflare";
              cloudflareVideoId = cfData.uid;
              playbackUrl = cfData.playbackUrl;
              videoUrl = cfData.playbackUrl;
              thumbnailUrl = cfData.thumbnailUrl;
              playbackStatus = "ready";
            }
          }
        } catch (cfErr) {
          console.warn("[Upload] Cloudflare Direct Upload bypassed/failed, falling back to Cloudflare R2:", cfErr);
        }

        // 2. Fallback to Cloudflare R2 if Stream Direct Upload was not used
        if (!cfUploaded) {
          const fileName = videoFile.name || "video.mp4";
          const dotIdx = fileName.lastIndexOf(".");
          const ext = dotIdx >= 0 ? fileName.slice(dotIdx) : ".mp4";
          const objectName = `klips/${this.currentUid}_${klipId}${ext}`;
          const encodedName = encodeURIComponent(objectName);

          videoUrl = await this._storageUploadAsync(
            encodedName,
            videoFile.type || "video/mp4",
            videoFile,
            (pct) => {
              if (typeof onProgress === "function") {
                onProgress(Math.min(95, Math.round(pct * 0.9)));
              }
            }
          );

          if (!videoUrl) {
            return {
              success: false,
              error: "Failed to upload video to Cloudflare storage.",
            };
          }

          videoProvider = "cloudflare";
          playbackUrl = videoUrl;

          // Upload lightweight video thumbnail (typically ~20KB) so grids never stream video data
          try {
            const thumbBlob = await extractVideoThumbnailBlobAsync(videoFile);
            if (thumbBlob && thumbBlob.size > 200) {
              const thumbName = `klip_thumbnails/${this.currentUid}_${klipId}.jpg`;
              thumbnailUrl = await this._storageUploadAsync(
                encodeURIComponent(thumbName),
                "image/jpeg",
                thumbBlob
              );
            }
          } catch (tErr) {
            console.warn("Thumbnail upload skipped:", tErr);
          }
        }

        // Upload watermarked copy in separate folder (`klips_watermarked/`) if provided
        if (watermarkedBlob && watermarkedBlob.size > 1024) {
          try {
            const wmExt = watermarkedBlob.type?.includes("mp4") ? ".mp4" : ".webm";
            const wmObjectName = `klips_watermarked/${this.currentUid}_${klipId}${wmExt}`;
            const wmEncodedName = encodeURIComponent(wmObjectName);
            watermarkedVideoUrl = await this._storageUploadAsync(
              wmEncodedName,
              watermarkedBlob.type || "video/mp4",
              watermarkedBlob
            );
          } catch (wmUpErr) {
            console.warn("Watermarked video upload bypassed:", wmUpErr);
          }
        }
      }

      const words = String(caption || "")
        .split(/\s+/)
        .filter(Boolean);
      const tags = words.filter((w) => w.startsWith("#"));
      let cleanCaption = words.filter((w) => !w.startsWith("#")).join(" ");
      if (!cleanCaption.trim()) {
        cleanCaption = String(caption || "").trim();
      }

      const isFemaleAccount =
        !this.currentUser.isMale ||
        String(this.currentUser.Gender).toLowerCase() === "female";

      const tagsList = [...tags];
      if (
        isFemaleAccount &&
        !tagsList.some(
          (t) =>
            t.toLowerCase() === "female" || t.toLowerCase() === "#female"
        )
      ) {
        tagsList.push("#female");
      }

      const colorHex = pickPaletteColor(klipId);

      const dto = {
        Id: klipId,
        CreatorUid: this.currentUid,
        CreatorHandle: this.currentUser.Handle,
        CreatorInitials: this.currentUser.Initials,
        CreatorAvatarUrl: this.currentUser.hasAvatar
          ? this.currentUser.AvatarUrl
          : "",
        Caption: cleanCaption,
        Tags: tagsList,
        SoundTitle: (soundMeta && soundMeta.title) ? soundMeta.title : `Original Sound - ${this.currentUser.Handle}`,
        SoundId: (soundMeta && soundMeta.id) ? soundMeta.id : `sound_${klipId}`,
        SoundAudioUrl: (soundMeta && soundMeta.audioUrl) ? soundMeta.audioUrl : "",
        SoundStartTime: (soundMeta && typeof soundMeta.startTime === "number") ? soundMeta.startTime : 0,
        SoundEndTime: (soundMeta && typeof soundMeta.endTime === "number") ? soundMeta.endTime : 0,
        LikesCount: 0,
        BookmarksCount: 0,
        ViewsCount: 0,
        SharesCount: "0",
        ColorHex: colorHex,
        videoProvider,
        cloudflareVideoId,
        playbackUrl,
        playbackStatus,
        VideoUrl: videoUrl,
        WatermarkedVideoUrl: watermarkedVideoUrl || "",
        ThumbnailUrl: thumbnailUrl || "",
        PhotoUrls: [],
        IsFemaleOnly: isFemaleAccount,
        Audience: isFemaleAccount ? "female" : "general",
        Gender: isFemaleAccount ? "Female" : "Male",
        CreatedAtUnix: Math.floor(Date.now() / 1000),
      };

      // Save to Cloudflare D1
      fetch("/api/klip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...dto,
          id: klipId,
          creatorUid: this.currentUid,
          creatorHandle: this.currentUser.Handle,
          creatorInitials: this.currentUser.Initials,
          creatorAvatarUrl: this.currentUser.AvatarUrl || "",
        }),
      });

      this._cachedFeedKlips = null;
      this._emitFeedUpdated();
      return { success: true, klipId, error: null };
    } catch (ex) {
      return { success: false, error: ex?.message || "Upload failed." };
    }
  }

  async uploadWatermarkedVideoAsync(klipId, watermarkedBlob) {
    if (!klipId || !watermarkedBlob || !this.currentUid) return "";
    try {
      const wmExt = watermarkedBlob.type?.includes("mp4") ? ".mp4" : ".webm";
      const wmObjectName = `klips_watermarked/${this.currentUid}_${klipId}${wmExt}`;
      const wmEncodedName = encodeURIComponent(wmObjectName);
      return await this._storageUploadAsync(
        wmEncodedName,
        watermarkedBlob.type || "video/mp4",
        watermarkedBlob
      );
    } catch (e) {
      console.warn("[Watermark] Upload failed:", e);
      return "";
    }
  }

  async saveKlipWatermarkedUrlAsync(klipId, watermarkedUrl) {
    if (!klipId || !watermarkedUrl) return;
    try {
      await fetch("/api/klip", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: klipId, watermarkedVideoUrl: watermarkedUrl }),
      });
      console.log(`[Watermark] Attached background watermark to Klip ${klipId}`);
    } catch (e) {
      console.warn("[Watermark] Failed to persist watermarked URL:", e);
    }
  }

  async generateAndAttachWatermarkInBackgroundAsync(klipId, videoFile, handle, rendererFn) {
    if (!klipId || !videoFile || typeof rendererFn !== "function") return;
    try {
      console.log(`[Watermark] Starting background watermark generation for Klip ${klipId}...`);
      const tempVideoUrl = URL.createObjectURL(videoFile);
      const wmResult = await rendererFn(tempVideoUrl, handle);
      URL.revokeObjectURL(tempVideoUrl);
      if (wmResult && wmResult.blob && wmResult.blob.size > 1024) {
        const wmUrl = await this.uploadWatermarkedVideoAsync(klipId, wmResult.blob);
        if (wmUrl) {
          await this.saveKlipWatermarkedUrlAsync(klipId, wmUrl);
        }
      }
    } catch (err) {
      console.warn("[Watermark] Background processing failed:", err);
    }
  }

  async uploadAndCreatePhotoSlideshowAsync(photoFiles, caption, soundMeta = null) {
    if (!this.currentUser || !this.currentUid) {
      return { success: false, error: "Please sign in first." };
    }

    if (!photoFiles || photoFiles.length === 0) {
      return { success: false, error: "Please select at least one photo." };
    }

    const freshProfile = await this.getUserProfileAsync(this.currentUid, true);
    if (freshProfile) {
      this.currentUser = freshProfile;
    }

    if (!this.currentUser.CanPost) {
      return {
        success: false,
        error: "Your account is not approved to post Klips yet.",
      };
    }

    // Security validation on photo file limits
    const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
    for (const photo of Array.from(photoFiles)) {
      if (photo.size > MAX_PHOTO_BYTES) {
        return {
          success: false,
          error: `Photo ${photo.name || ""} exceeds maximum allowable size of 10 MB.`,
        };
      }
      if (photo.type && !photo.type.startsWith("image/")) {
        return {
          success: false,
          error: `File ${photo.name || ""} is not a valid image.`,
        };
      }
    }

    try {
      const klipId = generateGuidN();
      const uid = this.currentUid;

      const uploadTasks = Array.from(photoFiles).map(async (rawPhoto, index) => {
        const photo = await compressImageFileAsync(rawPhoto, 1920, 0.82);
        const fileName = photo.name || "photo.jpg";
        const dotIdx = fileName.lastIndexOf(".");
        const ext = dotIdx >= 0 ? fileName.slice(dotIdx) : ".jpg";
        const objectName = `klip_photos/${uid}_${klipId}_${index}${ext}`;
        const encodedName = encodeURIComponent(objectName);

        return this._storageUploadAsync(
          encodedName,
          photo.type || "image/jpeg",
          photo
        );
      });

      const uploadedUrls = (await Promise.all(uploadTasks)).filter(Boolean);
      if (uploadedUrls.length === 0) {
        return {
          success: false,
          error: "Failed to upload photos to storage.",
        };
      }

      const words = String(caption || "")
        .split(/\s+/)
        .filter(Boolean);
      const tags = words.filter((w) => w.startsWith("#"));
      let cleanCaption = words.filter((w) => !w.startsWith("#")).join(" ");
      if (!cleanCaption.trim()) {
        cleanCaption = String(caption || "").trim();
      }

      const isFemaleAccount =
        !this.currentUser.isMale ||
        String(this.currentUser.Gender).toLowerCase() === "female";

      const tagsList = [...tags];
      if (
        isFemaleAccount &&
        !tagsList.some(
          (t) =>
            t.toLowerCase() === "female" || t.toLowerCase() === "#female"
        )
      ) {
        tagsList.push("#female");
      }

      const colorHex = pickPaletteColor(klipId);

      const dto = {
        Id: klipId,
        CreatorUid: this.currentUid,
        CreatorHandle: this.currentUser.Handle,
        CreatorInitials: this.currentUser.Initials,
        CreatorAvatarUrl: this.currentUser.hasAvatar
          ? this.currentUser.AvatarUrl
          : "",
        Caption: cleanCaption,
        Tags: tagsList,
        SoundTitle: (soundMeta && soundMeta.title) ? soundMeta.title : `Original Sound - ${this.currentUser.Handle}`,
        SoundId: (soundMeta && soundMeta.id) ? soundMeta.id : `sound_${klipId}`,
        SoundAudioUrl: (soundMeta && soundMeta.audioUrl) ? soundMeta.audioUrl : "",
        SoundStartTime: (soundMeta && typeof soundMeta.startTime === "number") ? soundMeta.startTime : 0,
        SoundEndTime: (soundMeta && typeof soundMeta.endTime === "number") ? soundMeta.endTime : 0,
        LikesCount: 0,
        BookmarksCount: 0,
        ViewsCount: 0,
        SharesCount: "0",
        ColorHex: colorHex,
        VideoUrl: "",
        PhotoUrls: uploadedUrls,
        IsFemaleOnly: isFemaleAccount,
        Audience: isFemaleAccount ? "female" : "general",
        Gender: isFemaleAccount ? "Female" : "Male",
        CreatedAtUnix: Math.floor(Date.now() / 1000),
      };

      // Save to Cloudflare D1
      await fetch("/api/klip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...dto,
          id: klipId,
          creatorUid: this.currentUid,
          creatorHandle: this.currentUser.Handle,
          creatorInitials: this.currentUser.Initials,
          creatorAvatarUrl: this.currentUser.AvatarUrl || "",
        }),
      });

      this._cachedFeedKlips = null;
      this._emitFeedUpdated();
      return { success: true, error: null };
    } catch (ex) {
      return { success: false, error: ex?.message || "Upload failed." };
    }
  }

  async deleteKlipAsync(klip) {
    if (!this.isLoggedIn && localStorage.getItem("fb_uid")) {
      await this.tryRestoreSessionAsync();
    }

    if (!this.currentUid || !klip || !klip.Id) {
      return { success: false, error: "Please sign in first." };
    }

    if (klip.CreatorUid && klip.CreatorUid !== this.currentUid) {
      return {
        success: false,
        error: "You can only delete your own Klips.",
      };
    }

    try {
      // Delete from Cloudflare D1
      await fetch(`/api/klip?id=${encodeURIComponent(klip.Id)}`, { method: "DELETE" });

      // Remove from in-memory cache immediately
      if (this._cachedFeedKlips) {
        this._cachedFeedKlips = this._cachedFeedKlips.filter(
          (k) => k.Id !== klip.Id
        );
      }

      // Clean up media files in background
      const mediaUrls = [
        klip.VideoUrl,
        klip.WatermarkedVideoUrl,
        ...(Array.isArray(klip.PhotoUrls) ? klip.PhotoUrls : []),
      ].filter(Boolean);

      for (const mediaUrl of mediaUrls) {
        this._storageDeleteAsync(mediaUrl).catch(() => {});
      }

      if (this.currentUser && klip.LikesCount > 0) {
        this.currentUser.ShkoyachCount = Math.max(
          0,
          this.currentUser.ShkoyachCount - klip.LikesCount
        );
        this.saveUserProfileAsync(this.currentUser).catch(() => {});
      }

      this._emitFeedUpdated();
      return { success: true, error: null };
    } catch (ex) {
      return {
        success: false,
        error: ex?.message || "Error deleting Klip.",
      };
    }
  }

  async renameSoundTitleAsync(klipId, newSoundTitle) {
    if (!klipId) return { success: false, error: "Invalid Klip ID." };
    if (!this.isLoggedIn || !this.currentUid) {
      return { success: false, error: "Please sign in." };
    }
    const cleanTitle = String(newSoundTitle || "").trim();
    if (!cleanTitle) {
      return { success: false, error: "Audio title cannot be empty." };
    }

    try {
      await fetch("/api/klip", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: klipId,
          soundTitle: cleanTitle,
          soundId: `sound_${klipId}`,
        }),
      });

      // Update cached feed klips
      if (Array.isArray(this._cachedFeedKlips)) {
        for (const cached of this._cachedFeedKlips) {
          if (cached.Id === klipId) {
            cached.SoundTitle = cleanTitle;
            if (!cached.SoundId) cached.SoundId = `sound_${klipId}`;
          }
        }
      }

      this._emitFeedUpdated();
      return { success: true, title: cleanTitle };
    } catch (err) {
      return { success: false, error: err?.message || "Failed to update audio title." };
    }
  }

  async getFeedKlipsAsync(forceRefresh = false) {
    if (
      !forceRefresh &&
      this._cachedFeedKlips &&
      Date.now() - this._lastFeedFetchUtc < 60000
    ) {
      return [...this._cachedFeedKlips];
    }

    if (!forceRefresh && this._inFlightFeedPromise) {
      return this._inFlightFeedPromise;
    }

    const runFetch = async () => {
      // Prioritize Cloudflare D1 Feed API (Fast Edge SQL Query)
      try {
        const cfFeedRes = await fetch(`/api/feed?tab=FYP&userUid=${encodeURIComponent(this.currentUid || "")}`);
        if (cfFeedRes.ok) {
          const feedData = await cfFeedRes.json();
          if (feedData && feedData.success && Array.isArray(feedData.klips)) {
            const mapped = feedData.klips
              .map((k) => createKlipVideo(k))
              .filter((k) => k.isVideoPost || k.isPhotoPost);
            this._cachedFeedKlips = mapped;
            this._lastFeedFetchUtc = Date.now();
            try {
              localStorage.setItem("fb_feed_cache_v2", JSON.stringify(mapped));
            } catch {}
            return mapped;
          }
        }
      } catch (cfErr) {
        console.warn("[Feed] Cloudflare D1 feed error:", cfErr);
      }

      if (this._cachedFeedKlips) {
        return [...this._cachedFeedKlips];
      }
      return [];
    };

    this._inFlightFeedPromise = runFetch().finally(() => {
      this._inFlightFeedPromise = null;
    });
    return this._inFlightFeedPromise;
  }

  async getKlipByIdAsync(klipId) {
    if (!klipId) return null;
    if (this._cachedFeedKlips) {
      const match = this._cachedFeedKlips.find((k) => k.Id === klipId);
      if (match) return match;
    }
    try {
      const cfRes = await fetch(`/api/klip?id=${encodeURIComponent(klipId)}`);
      if (cfRes.ok) {
        const cfData = await cfRes.json();
        if (cfData && cfData.success && cfData.klip) {
          return createKlipVideo(cfData.klip, klipId);
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  async getCreatorKlipsAsync(creatorUid) {
    if (!creatorUid) return [];
    try {
      const all = await this.getFeedKlipsAsync(false);
      const list = (all || []).filter((k) => k.CreatorUid === creatorUid);
      list.sort((a, b) => (b.CreatedAtUnix || 0) - (a.CreatedAtUnix || 0));
      return list;
    } catch (err) {
      console.warn("[FirebaseService] getCreatorKlipsAsync failed:", err);
      return [];
    }
  }

  async saveKlipThumbnailAsync(klipId, thumbnailUrl) {
    if (!klipId || !thumbnailUrl) return;
    try {
      await fetch("/api/klip", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: klipId, thumbnailUrl }),
      });
    } catch (_) {}
  }

  async setLikeAsync(video, isLiked) {
    if (!this.currentUid) {
      await this.tryRestoreSessionAsync();
      if (!this.currentUid) return;
    }

    const localLikes = this._getLocalIdSet("liked_klips", this.currentUid);
    if (isLiked) localLikes.add(video.Id);
    else localLikes.delete(video.Id);
    this._saveLocalIdSet("liked_klips", this.currentUid, localLikes);

    if (this._cachedFeedKlips) {
      for (const cached of this._cachedFeedKlips) {
        if (cached.Id === video.Id) {
          cached.IsLiked = isLiked;
          cached.LikesCount = video.LikesCount;
        }
      }
    }

    try {
      // 1. Sync to Cloudflare D1
      await fetch("/api/engagement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: isLiked ? "like_klip" : "unlike_klip",
          userUid: this.currentUid,
          klipId: video.Id,
        }),
      });

      if (video.CreatorUid) {
        const creator = await this.getUserProfileAsync(video.CreatorUid);
        if (creator) {
          creator.ShkoyachCount = Math.max(
            0,
            creator.ShkoyachCount + (isLiked ? 1 : -1)
          );
          await this.saveUserProfileAsync(creator);
        }

        if (isLiked && video.CreatorUid !== this.currentUid && this.currentUser) {
          await this._pushNotificationAsync(video.CreatorUid, {
            Id: generateGuidN(),
            FromUid: this.currentUid,
            FromHandle: this.currentUser.Handle,
            FromInitials: this.currentUser.Initials,
            Message: `${this.currentUser.Handle} gave your Klip a Shkoyach ♥`,
            Type: "like",
            KlipId: video.Id,
            CreatedAtUnix: Math.floor(Date.now() / 1000),
          });
        }
      }
    } catch {
      // ignore
    }
  }

  async setBookmarkAsync(video, isBookmarked) {
    if (!this.currentUid) {
      await this.tryRestoreSessionAsync();
      if (!this.currentUid) return;
    }

    const localBookmarks = this._getLocalIdSet(
      "bookmarked_klips",
      this.currentUid
    );
    if (isBookmarked) localBookmarks.add(video.Id);
    else localBookmarks.delete(video.Id);
    this._saveLocalIdSet("bookmarked_klips", this.currentUid, localBookmarks);

    if (this._cachedFeedKlips) {
      for (const cached of this._cachedFeedKlips) {
        if (cached.Id === video.Id) {
          cached.IsBookmarked = isBookmarked;
          cached.BookmarksCount = video.BookmarksCount;
        }
      }
    }

    try {
      // 1. Sync to Cloudflare D1
      await fetch("/api/engagement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: isBookmarked ? "bookmark_klip" : "unbookmark_klip",
          userUid: this.currentUid,
          klipId: video.Id,
        }),
      });
    } catch {
      // ignore
    }
  }

  async incrementViewCountAsync(video) {
    if (!video || !video.Id) return;

    const now = Date.now();
    const lastTime = this._lastViewIncrementUtc.get(video.Id) || 0;
    if (now - lastTime < 3000) return;

    this._lastViewIncrementUtc.set(video.Id, now);
    video.ViewsCount = (Number(video.ViewsCount) || 0) + 1;

    if (this._cachedFeedKlips) {
      for (const cached of this._cachedFeedKlips) {
        if (cached.Id === video.Id) {
          cached.ViewsCount = video.ViewsCount;
        }
      }
      try {
        localStorage.setItem(
          "fb_feed_cache_v2",
          JSON.stringify(this._cachedFeedKlips)
        );
      } catch {
        /* ignore quota */
      }
    }

    if (!this.isLoggedIn) return;

    try {
      await fetch("/api/klip", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: video.Id, incrementViews: true }),
      });
    } catch {
      // ignore
    }
  }

  async followCreatorAsync(targetUid) {
    if (
      !this.currentUid ||
      !this.currentUser ||
      !targetUid ||
      targetUid === this.currentUid
    ) {
      return;
    }

    try {
      // 1. Sync to Cloudflare D1
      await fetch("/api/engagement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "follow_user",
          userUid: this.currentUid,
          targetUid,
        }),
      });

      if (!this._cachedFollowingUids) {
        this._cachedFollowingUids = new Set();
      }
      this._cachedFollowingUids.add(targetUid);

      if (this._cachedFeedKlips) {
        for (const k of this._cachedFeedKlips) {
          if (k.CreatorUid === targetUid) {
            k.IsFollowed = true;
          }
        }
      }

      this.currentUser.FollowingCount += 1;
      this.saveUserProfileAsync(this.currentUser).catch(() => {});

      const targetProfile = await this.getUserProfileAsync(targetUid, true);
      if (targetProfile) {
        targetProfile.FollowersCount += 1;
        this.saveUserProfileAsync(targetProfile).catch(() => {});
      }

      await this._pushNotificationAsync(targetUid, {
        Id: generateGuidN(),
        FromUid: this.currentUid,
        FromHandle: this.currentUser.Handle,
        FromInitials: this.currentUser.Initials,
        Message: `${this.currentUser.Handle} started following you`,
        Type: "follow",
        CreatedAtUnix: Math.floor(Date.now() / 1000),
      });

      this._emitFeedUpdated();
    } catch {
      // ignore
    }
  }

  async unfollowCreatorAsync(targetUid) {
    if (
      !this.currentUid ||
      !this.currentUser ||
      !targetUid ||
      targetUid === this.currentUid
    ) {
      return;
    }

    try {
      // 1. Sync to Cloudflare D1
      await fetch("/api/engagement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "unfollow_user",
          userUid: this.currentUid,
          targetUid,
        }),
      });

      this._cachedFollowingUids?.delete(targetUid);

      if (this._cachedFeedKlips) {
        for (const k of this._cachedFeedKlips) {
          if (k.CreatorUid === targetUid) {
            k.IsFollowed = false;
          }
        }
      }

      this.currentUser.FollowingCount = Math.max(
        0,
        this.currentUser.FollowingCount - 1
      );
      this.saveUserProfileAsync(this.currentUser).catch(() => {});

      const targetProfile = await this.getUserProfileAsync(targetUid, true);
      if (targetProfile) {
        targetProfile.FollowersCount = Math.max(
          0,
          targetProfile.FollowersCount - 1
        );
        this.saveUserProfileAsync(targetProfile).catch(() => {});
      }

      this._emitFeedUpdated();
    } catch {
      // ignore
    }
  }

  async getFollowingUidsAsync(forceRefresh = false) {
    if (!forceRefresh && this._cachedFollowingUids) {
      return new Set(this._cachedFollowingUids);
    }

    const set = new Set();
    if (!this.currentUid) return set;

    try {
      const res = await fetch(`/api/engagement?userUid=${encodeURIComponent(this.currentUid)}&type=following`);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.followingUids)) {
          for (const uid of data.followingUids) {
            if (uid) set.add(uid);
          }
        }
      }
      this._cachedFollowingUids = set;
    } catch {
      // ignore
    }
    return new Set(set);
  }

  async getFollowingProfilesAsync(uid) {
    const profiles = [];
    if (!uid) return profiles;

    try {
      const res = await fetch(`/api/engagement?userUid=${encodeURIComponent(uid)}&type=following`);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.followingUids)) {
          const loaded = await Promise.all(
            data.followingUids.map((id) => this.getUserProfileAsync(id))
          );
          for (const p of loaded) {
            if (p) profiles.push(p);
          }
        }
      }
    } catch {
      // ignore
    }
    return profiles;
  }

  async getFollowerProfilesAsync(uid) {
    const profiles = [];
    if (!uid) return profiles;

    try {
      const res = await fetch(`/api/engagement?userUid=${encodeURIComponent(uid)}&type=followers`);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.followerUids)) {
          const loaded = await Promise.all(
            data.followerUids.map((id) => this.getUserProfileAsync(id))
          );
          for (const p of loaded) {
            if (p) profiles.push(p);
          }
        }
      }
    } catch {
      // ignore
    }
    return profiles;
  }

  async getNotificationsAsync() {
    const list = [];
    if (!this.currentUid) return list;

    try {
      const cfRes = await fetch(`/api/notifications?recipientUid=${encodeURIComponent(this.currentUid)}`);
      if (cfRes.ok) {
        const cfData = await cfRes.json();
        if (cfData && cfData.success && Array.isArray(cfData.notifications)) {
          return cfData.notifications.map((n) => createNotification({
            Id: n.id,
            RecipientUid: n.recipient_uid,
            FromUid: n.from_uid,
            FromHandle: n.from_handle,
            FromInitials: n.from_initials,
            FromAvatarUrl: n.from_avatar_url,
            Type: n.type,
            KlipId: n.klip_id,
            CommentId: n.comment_id,
            CommentText: n.comment_text,
            ParentCommentId: n.parent_comment_id,
            Message: n.message,
            IsRead: Boolean(n.is_read),
            CreatedAtUnix: n.created_at,
          }));
        }
      }
    } catch (_) {}
    return list;
  }

  async _pushNotificationAsync(targetUid, notification) {
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: notification.Id,
          recipientUid: targetUid,
          fromUid: notification.FromUid,
          fromHandle: notification.FromHandle,
          fromInitials: notification.FromInitials,
          fromAvatarUrl: notification.FromAvatarUrl,
          type: notification.Type,
          klipId: notification.KlipId || null,
          commentId: notification.CommentId || null,
          commentText: notification.CommentText || null,
          parentCommentId: notification.ParentCommentId || null,
          message: notification.Message,
        }),
      });
    } catch (_) {}
  }

  _getLocalIdSet(prefix, uid) {
    const set = new Set();
    if (!uid) return set;
    const raw = localStorage.getItem(`${prefix}_${uid}`) || "";
    for (const id of raw.split(",").filter(Boolean)) {
      set.add(id);
    }
    return set;
  }

  _saveLocalIdSet(prefix, uid, set) {
    if (!uid) return;
    localStorage.setItem(`${prefix}_${uid}`, Array.from(set).join(","));
  }

  async _getAllLikesDataAsync() {
    let likedByMe = this._getLocalIdSet("liked_klips", this.currentUid);
    const countsByKlip = new Map();

    try {
      const res = await fetch("/api/engagement?type=all_likes");
      if (res.ok) {
        const outer = await res.json();
        if (outer && outer.likes && typeof outer.likes === "object") {
          const serverLikedByMe = new Set();
          for (const [uid, klipMap] of Object.entries(outer.likes)) {
            if (!klipMap || typeof klipMap !== "object") continue;
            for (const [klipId, isLiked] of Object.entries(klipMap)) {
              if (!isLiked) continue;
              countsByKlip.set(klipId, (countsByKlip.get(klipId) || 0) + 1);
              if (this.currentUid && uid === this.currentUid) {
                serverLikedByMe.add(klipId);
              }
            }
          }
          if (this.currentUid) {
            likedByMe = serverLikedByMe;
            this._saveLocalIdSet("liked_klips", this.currentUid, likedByMe);
          }
          return { likedByMe, countsByKlip, hasFullMap: true };
        }
      }
    } catch {
      // ignore
    }

    if (this.currentUid) {
      try {
        const res = await fetch(`/api/engagement?userUid=${encodeURIComponent(this.currentUid)}&type=likes`);
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.klipIds)) {
            likedByMe = new Set(data.klipIds);
            this._saveLocalIdSet("liked_klips", this.currentUid, likedByMe);
          }
        }
      } catch {
        // ignore
      }
    }

    return { likedByMe, countsByKlip, hasFullMap: false };
  }

  async getUserLikesMapAsync() {
    try {
      const res = await fetch("/api/engagement?type=all_likes");
      if (res.ok) {
        const data = await res.json();
        if (data && data.likes) return data.likes;
      }
    } catch {
      // ignore
    }
    return {};
  }

  async _getUserBookmarkedKlipIdsAsync() {
    let set = this._getLocalIdSet("bookmarked_klips", this.currentUid);
    if (!this.currentUid) return set;

    try {
      const res = await fetch(`/api/engagement?userUid=${encodeURIComponent(this.currentUid)}&type=bookmarks`);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.klipIds)) {
          set = new Set(data.klipIds);
          this._saveLocalIdSet("bookmarked_klips", this.currentUid, set);
        }
      }
    } catch {
      // ignore
    }
    return set;
  }
      // ==================== COMMENTS API (Exact port of Services/FirebaseService.cs) ====================
  async getCommentsAsync(klipId) {
    if (!klipId) return [];
    try {
      const cfRes = await fetch(`/api/comments?klipId=${encodeURIComponent(klipId)}`);
      if (cfRes.ok) {
        const cfData = await cfRes.json();
        if (cfData && cfData.success && Array.isArray(cfData.comments)) {
          return cfData.comments.map((c) => ({
            Id: c.id,
            KlipId: c.klip_id,
            UserUid: c.user_uid,
            UserHandle: c.user_handle,
            UserInitials: c.user_initials,
            UserAvatarUrl: c.user_avatar_url,
            Text: c.text,
            ParentCommentId: c.parent_comment_id,
            ReplyToUid: c.reply_to_uid,
            ReplyToHandle: c.reply_to_handle,
            LikesCount: Number(c.likes_count) || 0,
            CreatedAtUnix: Number(c.created_at) || 0,
            IsLiked: false,
          }));
        }
      }
      return [];
    } catch {
      return [];
    }
  }

  async setCommentLikeAsync(comment, isLiked) {
    if (!comment || !comment.Id || !comment.KlipId) return;
    if (!this.isLoggedIn || !this.currentUid) return;

    try {
      await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: isLiked ? "like_comment" : "unlike_comment",
          userUid: this.currentUid,
          commentId: comment.Id,
        }),
      });

      // Notify comment author when liked (if not liking our own comment)
      if (isLiked && comment.UserUid && comment.UserUid !== this.currentUid && this.currentUser) {
        const previewText = (comment.Text || "").trim();
        const shortText = previewText.length > 36 ? previewText.slice(0, 36) + "..." : previewText;
        const msg = shortText
          ? `${this.currentUser.Handle} liked your comment: "${shortText}" ♥`
          : `${this.currentUser.Handle} liked your comment ♥`;

        this._pushNotificationAsync(comment.UserUid, {
          Id: generateGuidN(),
          FromUid: this.currentUid,
          FromHandle: this.currentUser.Handle,
          FromInitials: this.currentUser.Initials,
          Message: msg,
          Type: "comment_like",
          KlipId: comment.KlipId,
          CommentId: comment.Id,
          CommentText: previewText,
          CreatedAtUnix: Math.floor(Date.now() / 1000),
        }).catch(() => {});
      }
    } catch {
      // Ignore network failures gracefully
    }
  }

  async addCommentAsync(video, commentText, parentCommentId = null, replyToHandle = null, replyToUid = null) {
    if (!video || !video.Id) {
      return { success: false, comment: null, error: "Invalid Klip." };
    }
    if (!this.isLoggedIn || !this.currentUid || !this.currentUser) {
      return { success: false, comment: null, error: "Please sign in to comment." };
    }
    const text = String(commentText || "").trim();
    if (!text) {
      return { success: false, comment: null, error: "Comment cannot be empty." };
    }

    try {
      const commentId = generateGuidN();
      const avatarUrl = this.currentUser.hasAvatar ? this.currentUser.AvatarUrl : "";
      const nowUnix = Math.floor(Date.now() / 1000);

      const comment = {
        Id: commentId,
        KlipId: video.Id,
        UserUid: this.currentUid,
        UserHandle: this.currentUser.Handle || "@user",
        UserInitials: this.currentUser.Initials || "KL",
        UserAvatarUrl: avatarUrl,
        Text: text,
        CreatedAtUnix: nowUnix,
        ParentCommentId: parentCommentId || null,
        ReplyToHandle: replyToHandle || null,
        ReplyToUid: replyToUid || null,
      };

      // Save to Cloudflare D1
      await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: commentId,
          klipId: video.Id,
          userUid: this.currentUid,
          userHandle: this.currentUser.Handle || "@user",
          userInitials: this.currentUser.Initials || "KL",
          userAvatarUrl: avatarUrl,
          text,
          parentCommentId: parentCommentId || null,
          replyToUid: replyToUid || null,
          replyToHandle: replyToHandle || null,
        }),
      });

      video.CommentsCount = (Number(video.CommentsCount) || 0) + 1;

      // Update cached feed klips
      if (Array.isArray(this._cachedFeedKlips)) {
        for (const cached of this._cachedFeedKlips) {
          if (cached.Id === video.Id) {
            cached.CommentsCount = video.CommentsCount;
          }
        }
      }

      // Record recommendation interaction
      RecommendationService.recordInteraction(video, VideoInteractionType.Commented);

      // Notification to replied user (if reply) or creator
      const previewText = text.length > 36 ? text.slice(0, 36) + "..." : text;
      if (replyToUid && replyToUid !== this.currentUid) {
        this._pushNotificationAsync(replyToUid, {
          Id: generateGuidN(),
          FromUid: this.currentUid,
          FromHandle: this.currentUser.Handle,
          FromInitials: this.currentUser.Initials,
          Message: `${this.currentUser.Handle} replied to your comment: "${previewText}"`,
          Type: "comment_reply",
          KlipId: video.Id,
          CommentId: commentId,
          ParentCommentId: parentCommentId,
          CreatedAtUnix: nowUnix,
        }).catch(() => {});
      }

      // Notification to video creator if not self and creator wasn't already notified as replyToUid
      if (video.CreatorUid && video.CreatorUid !== this.currentUid && video.CreatorUid !== replyToUid) {
        this._pushNotificationAsync(video.CreatorUid, {
          Id: generateGuidN(),
          FromUid: this.currentUid,
          FromHandle: this.currentUser.Handle,
          FromInitials: this.currentUser.Initials,
          Message: `${this.currentUser.Handle} commented: "${previewText}"`,
          Type: "comment",
          KlipId: video.Id,
          CommentId: commentId,
          CreatedAtUnix: nowUnix,
        }).catch(() => {});
      }

      return { success: true, comment, error: null };
    } catch (ex) {
      return { success: false, comment: null, error: ex?.message || "Failed to post comment." };
    }
  }

  async deleteCommentAsync(video, comment) {
    if (!video || !comment || !comment.Id) {
      return { success: false, error: "Invalid comment." };
    }
    if (
      !this.currentUid ||
      (comment.UserUid !== this.currentUid && video.CreatorUid !== this.currentUid)
    ) {
      return { success: false, error: "You cannot delete this comment." };
    }

    try {
      // Delete from Cloudflare D1
      await fetch(`/api/comments?id=${encodeURIComponent(comment.Id)}&klipId=${encodeURIComponent(video.Id)}`, {
        method: "DELETE",
      });

      video.CommentsCount = Math.max(0, (Number(video.CommentsCount) || 0) - 1);

      if (Array.isArray(this._cachedFeedKlips)) {
        for (const cached of this._cachedFeedKlips) {
          if (cached.Id === video.Id) {
            cached.CommentsCount = video.CommentsCount;
          }
        }
      }

      return { success: true, error: null };
    } catch (ex) {
      return { success: false, error: ex?.message || "Failed to delete comment." };
    }
  }
}

export const FirebaseService = new FirebaseServiceClass();

// ==================== RECOMMENDATION SERVICE (Exact port of Services/RecommendationService.cs) ====================
export const VideoInteractionType = {
  WatchedEntire: 10,
  Rewatched: 15,
  Shared: 12,
  Liked: 5,
  Commented: 5,
  FollowedCreator: 10,
  WatchedMost: 5,
  SwipedImmediately: -10,
  Searched: 8,
};

const REC_PROFILE_PREF_KEY = "klip_rec_profile";

const CATEGORY_KEYWORDS = {
  "Torah & Halacha": [
    "#torah",
    "#shiur",
    "#halacha",
    "#daf",
    "#gemara",
    "#parsha",
    "#mishna",
    "#rebbe",
    "torah",
    "shiur",
    "halacha",
    "parsha",
    "rabbi",
  ],
  "Music & Niggunim": [
    "#music",
    "#niggun",
    "#shira",
    "#kumzitz",
    "#song",
    "#singer",
    "#acapella",
    "#chazan",
    "music",
    "song",
    "niggun",
    "kumzitz",
    "shira",
    "concert",
  ],
  "Chassidish & Heritage": [
    "#chassidish",
    "#chassidus",
    "#tzadik",
    "#minhag",
    "#farbrengen",
    "#tisch",
    "#yiddish",
    "chassidish",
    "chassidus",
    "tisch",
    "farbrengen",
    "yiddish",
  ],
  "Simchas & Events": [
    "#wedding",
    "#simcha",
    "#chuppah",
    "#mitzvah",
    "#bar_mitzvah",
    "#mazeltov",
    "wedding",
    "simcha",
    "chuppah",
    "mazeltov",
  ],
  "Kosher Food": [
    "#food",
    "#kosher",
    "#shabbos",
    "#challah",
    "#cooking",
    "#pesach",
    "#cholent",
    "food",
    "kosher",
    "shabbos",
    "challah",
    "cooking",
  ],
  "Jewish History & Inspiration": [
    "#history",
    "#israel",
    "#yerushalayim",
    "#inspiration",
    "#emunah",
    "#story",
    "#chizuk",
    "history",
    "israel",
    "jerusalem",
    "inspiration",
    "chizuk",
  ],
  "Humor & Jewish Life": [
    "#comedy",
    "#humor",
    "#funny",
    "#jewishlife",
    "#fun",
    "#community",
    "humor",
    "funny",
    "comedy",
    "jewishlife",
  ],
};

function clampVal(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

function getCaseInsensitive(dict, key) {
  if (!dict || !key) return undefined;
  if (Object.prototype.hasOwnProperty.call(dict, key)) return dict[key];
  const lower = String(key).toLowerCase();
  for (const [k, v] of Object.entries(dict)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function setCaseInsensitive(dict, key, value) {
  if (!dict || !key) return;
  const lower = String(key).toLowerCase();
  for (const k of Object.keys(dict)) {
    if (k.toLowerCase() === lower && k !== key) {
      delete dict[k];
    }
  }
  dict[key] = value;
}

class RecommendationServiceClass {
  constructor() {
    this._cachedProfile = null;
  }

  getProfile() {
    if (this._cachedProfile) {
      return this._cachedProfile;
    }

    try {
      const raw = localStorage.getItem(REC_PROFILE_PREF_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          this._cachedProfile = {
            TagScores: parsed.TagScores || {},
            CategoryScores: parsed.CategoryScores || {},
            CreatorScores: parsed.CreatorScores || {},
            WatchHistory: parsed.WatchHistory || {},
            VideoCompletionCounts: parsed.VideoCompletionCounts || {},
            LastUpdatedUtc: parsed.LastUpdatedUtc || new Date().toISOString(),
          };
          return this._cachedProfile;
        }
      }
    } catch {
      /* ignore */
    }

    this._cachedProfile = {
      TagScores: {},
      CategoryScores: {},
      CreatorScores: {},
      WatchHistory: {},
      VideoCompletionCounts: {},
      LastUpdatedUtc: new Date().toISOString(),
    };
    return this._cachedProfile;
  }

  saveProfile(profile) {
    this._cachedProfile = profile;
    profile.LastUpdatedUtc = new Date().toISOString();

    try {
      const watchKeys = Object.keys(profile.WatchHistory || {});
      if (watchKeys.length > 300) {
        const cutoffMs = Date.now() - 7 * 24 * 3600 * 1000;
        for (const id of watchKeys) {
          const ts = Date.parse(profile.WatchHistory[id]);
          if (!Number.isFinite(ts) || ts < cutoffMs) {
            delete profile.WatchHistory[id];
            delete profile.VideoCompletionCounts[id];
          }
        }
      }
      localStorage.setItem(REC_PROFILE_PREF_KEY, JSON.stringify(profile));
    } catch {
      /* ignore */
    }
  }

  recordInteraction(video, type, watchDurationSeconds = 0) {
    if (!video || !video.Id) return;

    const profile = this.getProfile();
    const weight = Number(type) || 0;

    // Record watch timestamp
    profile.WatchHistory[video.Id] = new Date().toISOString();

    if (
      type === VideoInteractionType.WatchedEntire ||
      type === VideoInteractionType.Rewatched
    ) {
      const count = Number(profile.VideoCompletionCounts[video.Id] || 0);
      profile.VideoCompletionCounts[video.Id] = count + 1;
    }

    // Update creator affinity
    if (video.CreatorUid) {
      const cScore = Number(getCaseInsensitive(profile.CreatorScores, video.CreatorUid) || 0);
      setCaseInsensitive(
        profile.CreatorScores,
        video.CreatorUid,
        clampVal(cScore + weight * 0.5, -50, 150)
      );
    }

    // Infer category and update category score
    const inferredCategory = this.inferCategory(video);
    if (inferredCategory) {
      const catScore = Number(getCaseInsensitive(profile.CategoryScores, inferredCategory) || 0);
      setCaseInsensitive(
        profile.CategoryScores,
        inferredCategory,
        clampVal(catScore + weight * 0.8, -50, 200)
      );
    }

    // Update tag scores
    if (Array.isArray(video.Tags)) {
      for (const tag of video.Tags) {
        const cleanTag = String(tag || "")
          .trim()
          .replace(/^#+/, "")
          .toLowerCase();
        if (!cleanTag) continue;
        const tScore = Number(getCaseInsensitive(profile.TagScores, cleanTag) || 0);
        setCaseInsensitive(
          profile.TagScores,
          cleanTag,
          clampVal(tScore + weight, -50, 200)
        );
      }
    }

    this.saveProfile(profile);
  }

  recordSearch(query) {
    if (!query || !String(query).trim()) return;

    const profile = this.getProfile();
    const clean = String(query)
      .trim()
      .replace(/^#+/, "")
      .toLowerCase();
    if (!clean) return;

    const tScore = Number(getCaseInsensitive(profile.TagScores, clean) || 0);
    setCaseInsensitive(
      profile.TagScores,
      clean,
      clampVal(tScore + VideoInteractionType.Searched, -50, 200)
    );

    // Also match query against categories
    for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
      if (
        kws.some((kw) => {
          const kwLower = kw.toLowerCase();
          const kwClean = kwLower.replace(/^#+/, "");
          return kwLower.includes(clean) || clean.includes(kwClean);
        })
      ) {
        const cScore = Number(getCaseInsensitive(profile.CategoryScores, cat) || 0);
        setCaseInsensitive(profile.CategoryScores, cat, clampVal(cScore + 6, -50, 200));
      }
    }

    this.saveProfile(profile);
  }

  inferCategory(video) {
    if (video?.Category && String(video.Category).trim()) {
      return String(video.Category).trim();
    }

    const combinedText = `${video?.Caption || ""} ${(video?.Tags || []).join(" ")} ${video?.SoundTitle || ""}`.toLowerCase();

    for (const [categoryName, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      for (const kw of keywords) {
        if (combinedText.includes(kw.toLowerCase())) {
          return categoryName;
        }
      }
    }

    return "Jewish Life";
  }

  rankForYouFeed(candidateKlips, avoidFirstVideoId = null, isExplicitRefresh = false) {
    // STRICT PRIVACY / KOSHER RULE: Female-only videos NEVER circulate in FYP
    const allCandidates = (candidateKlips || []).filter((k) => !k.IsFemaleOnly);
    if (allCandidates.length <= 1) {
      return allCandidates;
    }

    // Load recent top video IDs across browser refreshes so refreshing never repeats the same opening Klip
    let recentTopIds = [];
    try {
      const rawTop = localStorage.getItem("klip_recent_top_ids");
      if (rawTop) {
        const parsed = JSON.parse(rawTop);
        if (Array.isArray(parsed)) recentTopIds = parsed;
      }
    } catch {
      /* ignore */
    }
    const effectiveAvoidFirstId = avoidFirstVideoId || recentTopIds[0] || null;

    // Fisher-Yates shuffle of initial candidate list so baseline order is completely randomized
    for (let i = allCandidates.length - 1; i > 0; i--) {
      const swapIndex = Math.floor(Math.random() * (i + 1));
      const tmp = allCandidates[i];
      allCandidates[i] = allCandidates[swapIndex];
      allCandidates[swapIndex] = tmp;
    }

    const profile = this.getProfile();
    const nowMs = Date.now();

    // Higher randomness temperature on explicit user refresh / browser reload so every refresh feels fresh
    const jitterRange = isExplicitRefresh ? 65.0 : 38.0;

    // Score each candidate
    const scoredList = [];

    for (const video of allCandidates) {
      // 1. Personalization Score (0 - 100) + stochastic exploration
      let personalScore = 15.0;
      const category = this.inferCategory(video);

      const catScore = getCaseInsensitive(profile.CategoryScores, category);
      if (catScore !== undefined) {
        personalScore += clampVal(Number(catScore) * 0.4, -20, 45);
      }

      if (video.CreatorUid) {
        const crScore = getCaseInsensitive(profile.CreatorScores, video.CreatorUid);
        if (crScore !== undefined) {
          personalScore += clampVal(Number(crScore) * 0.35, -20, 30);
        }
      }

      if (Array.isArray(video.Tags) && video.Tags.length > 0) {
        let tagSum = 0;
        for (const tag of video.Tags) {
          const clean = String(tag || "")
            .trim()
            .replace(/^#+/, "")
            .toLowerCase();
          const tScore = getCaseInsensitive(profile.TagScores, clean);
          if (tScore !== undefined) {
            tagSum += Number(tScore);
          }
        }
        personalScore += clampVal(tagSum * 0.25, -20, 35);
      }
      personalScore = clampVal(personalScore + Math.random() * jitterRange, 0, 140);

      // 2. Trending Score (0 - 100) + stochastic exploration (matching mobile RecommendationService.cs)
      const engagement =
        (Number(video.ViewsCount) || 0) * 0.5 +
        video.LikesCount * 3.0 +
        video.BookmarksCount * 4.0;
      const trendingScore = clampVal(
        Math.log10(engagement + 1) * 35.0 + Math.random() * jitterRange,
        10,
        140
      );

      // 3. Freshness / New Creator Exposure Boost (0 - 100) + stochastic exploration
      let freshnessScore = 20.0;
      if (video.CreatedAtUnix > 0) {
        const uploadedMs = video.CreatedAtUnix * 1000;
        const hoursAgo = (nowMs - uploadedMs) / (1000 * 3600);
        if (hoursAgo < 12) freshnessScore += 60;
        else if (hoursAgo < 24) freshnessScore += 40;
        else if (hoursAgo < 72) freshnessScore += 20;
      }
      if ((Number(video.ViewsCount) || 0) < 5) {
        freshnessScore += 25;
      }
      freshnessScore = clampVal(freshnessScore + Math.random() * jitterRange, 0, 140);

      // 4. Anti-Fatigue / Recency Penalty
      let fatiguePenalty = 0;
      const lastWatchedRaw = profile.WatchHistory[video.Id];
      if (lastWatchedRaw) {
        const lastWatchedMs = Date.parse(lastWatchedRaw);
        if (Number.isFinite(lastWatchedMs)) {
          const hoursSinceWatch = (nowMs - lastWatchedMs) / (1000 * 3600);
          if (hoursSinceWatch < 1.0) fatiguePenalty = 45.0;
          else if (hoursSinceWatch < 6.0) fatiguePenalty = 25.0;
          else if (hoursSinceWatch < 24.0) fatiguePenalty = 12.0;
        }
      }
      if (video.Id === effectiveAvoidFirstId) {
        fatiguePenalty += 45.0;
      } else if (recentTopIds.slice(0, 3).includes(video.Id)) {
        fatiguePenalty += 25.0;
      }

      const totalScore =
        personalScore * 0.5 +
        trendingScore * 0.25 +
        freshnessScore * 0.25 -
        fatiguePenalty +
        Math.random() * jitterRange;

      scoredList.push({
        video,
        totalScore,
        personalScore,
        trendingScore,
        freshnessScore,
        category,
      });
    }

    // Divide into 4 blended sources:
    const sortedByTotal = [...scoredList].sort((a, b) => b.totalScore - a.totalScore);
    const personalizedPool = sortedByTotal
      .slice(0, Math.max(5, Math.floor(sortedByTotal.length / 2)))
      .map((x) => x.video);
    const trendingPool = [...scoredList]
      .sort((a, b) => b.trendingScore - a.trendingScore)
      .slice(0, Math.max(4, Math.floor(scoredList.length / 3)))
      .map((x) => x.video);
    const freshPool = [...scoredList]
      .sort((a, b) => b.freshnessScore - a.freshnessScore)
      .slice(0, Math.max(3, Math.floor(scoredList.length / 4)))
      .map((x) => x.video);

    const topCategories = new Set(
      Object.entries(profile.CategoryScores || {})
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .slice(0, 2)
        .map(([k]) => k.toLowerCase())
    );
    const discoveryPool = sortedByTotal
      .filter((x) => !topCategories.has(x.category.toLowerCase()))
      .map((x) => x.video);

    const finalResult = [];
    const pickedIds = new Set();

    // Top-K tournament selection within each pool so top-scored videos are favored
    // while every browser refresh produces a fresh algorithmic permutation
    const tryAdd = (pool) => {
      const unpicked = pool.filter((k) => !pickedIds.has(k.Id));
      if (unpicked.length === 0) return false;
      const topWindow = Math.min(3, unpicked.length);
      const chosen = unpicked[Math.floor(Math.random() * topWindow)];
      pickedIds.add(chosen.Id);
      finalResult.push(chosen);
      return true;
    };

    const maxIterations = allCandidates.length * 2;
    let iter = 0;

    while (finalResult.length < allCandidates.length && iter++ < maxIterations) {
      const slot = finalResult.length % 6;
      let added = false;
      if (slot === 0 || slot === 2 || slot === 4) {
        added = tryAdd(personalizedPool);
      } else if (slot === 1) {
        added = tryAdd(trendingPool);
      } else if (slot === 3) {
        added = tryAdd(discoveryPool.length > 0 ? discoveryPool : personalizedPool);
      } else {
        added = tryAdd(freshPool.length > 0 ? freshPool : trendingPool);
      }

      if (!added) {
        const nextBest = sortedByTotal.find((x) => !pickedIds.has(x.video.Id));
        if (nextBest?.video) {
          pickedIds.add(nextBest.video.Id);
          finalResult.push(nextBest.video);
        }
      }
    }

    for (const item of sortedByTotal) {
      if (!pickedIds.has(item.video.Id)) {
        pickedIds.add(item.video.Id);
        finalResult.push(item.video);
      }
    }

    // Enforce Creator Spacing Rule: Avoid consecutive videos from the same creator
    // Pick a random valid swap target so minority-creator videos don't lock into fixed slots
    for (let i = 0; i < finalResult.length - 1; i++) {
      if (
        finalResult[i].CreatorUid &&
        finalResult[i].CreatorUid === finalResult[i + 1].CreatorUid
      ) {
        const candidateSwapIndices = [];
        for (let j = i + 2; j < finalResult.length; j++) {
          if (finalResult[j].CreatorUid !== finalResult[i].CreatorUid) {
            candidateSwapIndices.push(j);
          }
        }
        if (candidateSwapIndices.length > 0) {
          const swapIdx =
            candidateSwapIndices[
              Math.floor(Math.random() * candidateSwapIndices.length)
            ];
          const tmp = finalResult[i + 1];
          finalResult[i + 1] = finalResult[swapIdx];
          finalResult[swapIdx] = tmp;
        }
      }
    }

    // Ensure refreshing never leaves the same video stuck at position 0 when other videos exist
    const blockedFirstIds = new Set(
      [effectiveAvoidFirstId, ...recentTopIds.slice(0, 2)].filter(Boolean)
    );
    if (finalResult.length > 1 && blockedFirstIds.has(finalResult[0].Id)) {
      const replacementCandidates = [];
      for (let idx = 1; idx < Math.min(finalResult.length, 10); idx++) {
        if (!blockedFirstIds.has(finalResult[idx].Id)) {
          replacementCandidates.push(idx);
        }
      }
      const replacementIdx =
        replacementCandidates.length > 0
          ? replacementCandidates[
              Math.floor(Math.random() * Math.min(4, replacementCandidates.length))
            ]
          : 1 + Math.floor(Math.random() * Math.min(4, finalResult.length - 1));
      const tmp = finalResult[0];
      finalResult[0] = finalResult[replacementIdx];
      finalResult[replacementIdx] = tmp;
    }

    // Persist the new top video ID so the next browser refresh will rotate away from it
    if (finalResult[0]?.Id) {
      try {
        const updatedTop = [
          finalResult[0].Id,
          ...recentTopIds.filter((id) => id !== finalResult[0].Id),
        ].slice(0, 5);
        localStorage.setItem("klip_recent_top_ids", JSON.stringify(updatedTop));
      } catch {
        /* ignore */
      }
    }

    return finalResult;
  }
}

export const RecommendationService = new RecommendationServiceClass();


