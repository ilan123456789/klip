/**
 * Klip D1 Data Migration Generator
 * Converts Firebase snapshot data into idempotent SQL statements
 * matching schema.sql for Cloudflare D1.
 * Run with: node scripts/prepare-d1-migration-sql.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIREBASE_DATABASE_URL = process.env.FIREBASE_DATABASE_URL || "https://gevaldig-portal-default-rtdb.firebaseio.com";
const LEDGER_PATH = path.join(__dirname, "..", "migration-ledger.json");

function loadLedger() {
  if (fs.existsSync(LEDGER_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
    } catch {}
  }
  return { migrated: {}, failed: {} };
}

function esc(val) {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number") return isFinite(val) ? String(val) : "0";
  if (typeof val === "boolean") return val ? "1" : "0";
  const str = String(val).replace(/'/g, "''");
  return `'${str}'`;
}

async function generateSql() {
  console.log("[D1 SQL Generator] Fetching latest production Firebase data...");

  const [users, klips, comments, likes, bookmarks, commentLikes, follows, notifs, status] = await Promise.all([
    fetch(`${FIREBASE_DATABASE_URL}/users.json`).then((r) => r.json()),
    fetch(`${FIREBASE_DATABASE_URL}/klips.json`).then((r) => r.json()),
    fetch(`${FIREBASE_DATABASE_URL}/klipComments.json`).then((r) => r.json()),
    fetch(`${FIREBASE_DATABASE_URL}/userLikes.json`).then((r) => r.json()),
    fetch(`${FIREBASE_DATABASE_URL}/userBookmarks.json`).then((r) => r.json()),
    fetch(`${FIREBASE_DATABASE_URL}/userCommentLikes.json`).then((r) => r.json()),
    fetch(`${FIREBASE_DATABASE_URL}/followers.json`).then((r) => r.json()),
    fetch(`${FIREBASE_DATABASE_URL}/notifications.json`).then((r) => r.json()),
    fetch(`${FIREBASE_DATABASE_URL}/status.json`).then((r) => r.json()),
  ]);

  const statements = [];
  statements.push("-- KLIP D1 INITIAL DATA MIGRATION");
  statements.push("-- Generated automatically from Firebase Realtime Database");
  statements.push("");

  // 1. Users
  statements.push("-- 1. USERS");
  for (const [uid, u] of Object.entries(users || {})) {
    if (!u) continue;
    const now = Math.floor(Date.now() / 1000);
    statements.push(
      `INSERT OR REPLACE INTO users (uid, handle, display_name, email, initials, bio, avatar_url, gender, is_male, can_post, followers_count, following_count, shkoyach_count, likes_count, created_at, updated_at) VALUES (` +
        `${esc(uid)}, ${esc(u.Handle || "@user")}, ${esc(u.DisplayName || "")}, ${esc(u.Email || "")}, ` +
        `${esc(u.Initials || "")}, ${esc(u.Bio || "")}, ${esc(u.AvatarUrl || "")}, ${esc(u.Gender || "Male")}, ` +
        `${u.isMale !== false ? 1 : 0}, ${u.CanPost !== false ? 1 : 0}, ${Number(u.FollowersCount) || 0}, ` +
        `${Number(u.FollowingCount) || 0}, ${Number(u.ShkoyachCount) || 0}, ${Number(u.LikesCount) || 0}, ` +
        `${now}, ${now});`
    );
  }
  statements.push("");

  // 2. User Status
  statements.push("-- 2. USER STATUS");
  for (const [uid, s] of Object.entries(status || {})) {
    if (!s) continue;
    statements.push(
      `INSERT OR REPLACE INTO user_status (uid, state, last_changed) VALUES (` +
        `${esc(uid)}, ${esc(s.state || "offline")}, ${Number(s.last_changed) || Date.now()});`
    );
  }
  statements.push("");

  // 3. Klips
  statements.push("-- 3. KLIPS");
  const ledger = loadLedger();
  for (const [id, k] of Object.entries(klips || {})) {
    if (!k) continue;
    const now = Math.floor(Date.now() / 1000);
    const tagsJson = JSON.stringify(Array.isArray(k.Tags) ? k.Tags : []);
    const photosJson = JSON.stringify(Array.isArray(k.PhotoUrls) ? k.PhotoUrls : []);

    const migratedInfo = ledger.migrated[id];
    const videoProvider = migratedInfo ? "cloudflare" : (k.videoProvider || "firebase");
    const cloudflareVideoId = migratedInfo ? migratedInfo.uid : (k.cloudflareVideoId || "");
    const playbackUrl = migratedInfo ? migratedInfo.playbackUrl : (k.playbackUrl || "");
    const thumbnailUrl = (migratedInfo && migratedInfo.thumbnailUrl) ? migratedInfo.thumbnailUrl : (k.ThumbnailUrl || "");

    statements.push(
      `INSERT OR REPLACE INTO klips (id, creator_uid, creator_handle, creator_initials, creator_avatar_url, caption, tags, video_url, watermarked_video_url, thumbnail_url, photo_urls, video_provider, cloudflare_video_id, playback_url, playback_status, r2_video_key, sound_id, sound_title, sound_audio_url, sound_start_time, sound_end_time, is_female_only, audience, gender, color_hex, likes_count, views_count, bookmarks_count, comments_count, shares_count, created_at, updated_at) VALUES (` +
        `${esc(id)}, ${esc(k.CreatorUid || "")}, ${esc(k.CreatorHandle || "")}, ${esc(k.CreatorInitials || "")}, ` +
        `${esc(k.CreatorAvatarUrl || "")}, ${esc(k.Caption || "")}, ${esc(tagsJson)}, ${esc(k.VideoUrl || "")}, ` +
        `${esc(k.WatermarkedVideoUrl || "")}, ${esc(thumbnailUrl)}, ${esc(photosJson)}, ` +
        `${esc(videoProvider)}, ${esc(cloudflareVideoId)}, ${esc(playbackUrl)}, ` +
        `${esc(k.playbackStatus || "ready")}, '', ${esc(k.SoundId || "")}, ${esc(k.SoundTitle || "")}, ` +
        `${esc(k.SoundAudioUrl || "")}, ${Number(k.SoundStartTime) || 0}, ${Number(k.SoundEndTime) || 0}, ` +
        `${k.IsFemaleOnly ? 1 : 0}, ${esc(k.Audience || "general")}, ${esc(k.Gender || "Male")}, ` +
        `${esc(k.ColorHex || "#172554")}, ${Number(k.LikesCount) || 0}, ${Number(k.ViewsCount) || 0}, ` +
        `${Number(k.BookmarksCount) || 0}, ${Number(k.CommentsCount) || 0}, ${Number(k.SharesCount) || 0}, ` +
        `${Number(k.CreatedAtUnix) || now}, ${now});`
    );
  }
  statements.push("");

  // 4. Klip Likes
  statements.push("-- 4. KLIP LIKES");
  for (const [uid, userMap] of Object.entries(likes || {})) {
    if (!userMap) continue;
    for (const [klipId, isLiked] of Object.entries(userMap)) {
      if (isLiked) {
        statements.push(`INSERT OR REPLACE INTO klip_likes (user_uid, klip_id, created_at) VALUES (${esc(uid)}, ${esc(klipId)}, ${Math.floor(Date.now() / 1000)});`);
      }
    }
  }
  statements.push("");

  // 5. Klip Bookmarks
  statements.push("-- 5. KLIP BOOKMARKS");
  for (const [uid, userMap] of Object.entries(bookmarks || {})) {
    if (!userMap) continue;
    for (const [klipId, isSaved] of Object.entries(userMap)) {
      if (isSaved) {
        statements.push(`INSERT OR REPLACE INTO klip_bookmarks (user_uid, klip_id, created_at) VALUES (${esc(uid)}, ${esc(klipId)}, ${Math.floor(Date.now() / 1000)});`);
      }
    }
  }
  statements.push("");

  // 6. Follows
  statements.push("-- 6. FOLLOWS");
  for (const [targetUid, followerMap] of Object.entries(follows || {})) {
    if (!followerMap) continue;
    for (const [followerUid, isFollowing] of Object.entries(followerMap)) {
      if (isFollowing) {
        statements.push(`INSERT OR REPLACE INTO follows (follower_uid, followed_uid, created_at) VALUES (${esc(followerUid)}, ${esc(targetUid)}, ${Math.floor(Date.now() / 1000)});`);
      }
    }
  }
  statements.push("");

  // 7. Comments
  statements.push("-- 7. KLIP COMMENTS");
  for (const [klipId, commentMap] of Object.entries(comments || {})) {
    if (!commentMap) continue;
    for (const [cId, c] of Object.entries(commentMap)) {
      if (!c) continue;
      statements.push(
        `INSERT OR REPLACE INTO klip_comments (id, klip_id, user_uid, user_handle, user_initials, user_avatar_url, text, parent_comment_id, reply_to_uid, reply_to_handle, likes_count, created_at) VALUES (` +
          `${esc(c.Id || cId)}, ${esc(c.KlipId || klipId)}, ${esc(c.UserUid || "")}, ${esc(c.UserHandle || "")}, ` +
          `${esc(c.UserInitials || "")}, ${esc(c.UserAvatarUrl || "")}, ${esc(c.Text || "")}, ` +
          `${esc(c.ParentCommentId || null)}, ${esc(c.ReplyToUid || null)}, ${esc(c.ReplyToHandle || null)}, ` +
          `${Number(c.LikesCount) || 0}, ${Number(c.CreatedAtUnix) || Math.floor(Date.now() / 1000)});`
      );
    }
  }
  statements.push("");

  // 8. Comment Likes
  statements.push("-- 8. COMMENT LIKES");
  for (const [uid, userMap] of Object.entries(commentLikes || {})) {
    if (!userMap) continue;
    for (const [cId, isLiked] of Object.entries(userMap)) {
      if (isLiked) {
        statements.push(`INSERT OR REPLACE INTO comment_likes (user_uid, comment_id, created_at) VALUES (${esc(uid)}, ${esc(cId)}, ${Math.floor(Date.now() / 1000)});`);
      }
    }
  }
  statements.push("");

  // 9. Notifications
  statements.push("-- 9. NOTIFICATIONS");
  for (const [recipientUid, notifMap] of Object.entries(notifs || {})) {
    if (!notifMap) continue;
    for (const [nId, n] of Object.entries(notifMap)) {
      if (!n) continue;
      statements.push(
        `INSERT OR REPLACE INTO notifications (id, recipient_uid, from_uid, from_handle, from_initials, from_avatar_url, type, klip_id, comment_id, comment_text, parent_comment_id, message, is_read, created_at) VALUES (` +
          `${esc(n.Id || nId)}, ${esc(recipientUid)}, ${esc(n.FromUid || "")}, ${esc(n.FromHandle || "")}, ` +
          `${esc(n.FromInitials || "")}, ${esc(n.FromAvatarUrl || "")}, ${esc(n.Type || "like")}, ` +
          `${esc(n.KlipId || null)}, ${esc(n.CommentId || null)}, ${esc(n.CommentText || null)}, ` +
          `${esc(n.ParentCommentId || null)}, ${esc(n.Message || "")}, 0, ` +
          `${Number(n.CreatedAtUnix) || Math.floor(Date.now() / 1000)});`
      );
    }
  }
  statements.push("");

  const outDir = path.join(__dirname, "..", "migrations");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "0001_initial_data_migration.sql");
  fs.writeFileSync(outPath, statements.join("\n"), "utf8");

  console.log(`[D1 SQL Generator] Generated ${statements.length} lines of SQL -> ${outPath}`);
  console.log("[D1 SQL Generator] This SQL file is prepared for your review and has NOT been executed on D1.");
}

generateSql().catch((err) => {
  console.error("SQL generation error:", err);
  process.exit(1);
});

