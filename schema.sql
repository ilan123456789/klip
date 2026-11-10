-- ==========================================================
-- KLIP D1 SQL SCHEMA (Cloudflare D1 Database)
-- Binding: KLIPBASE | Database ID: d7a63d25-d614-413a-81bc-cbc8c3ec937b
-- Preserves 100% of Firebase data structures, GUIDs, and counters
-- ==========================================================

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  display_name TEXT DEFAULT '',
  email TEXT DEFAULT '',
  initials TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  avatar_url TEXT DEFAULT '',
  gender TEXT DEFAULT 'Male',
  is_male INTEGER DEFAULT 1,
  can_post INTEGER DEFAULT 1,
  followers_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  shkoyach_count INTEGER DEFAULT 0,
  likes_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_handle ON users(handle);

-- 2. USER PRESENCE / STATUS TABLE (Mirrors /status/{uid})
CREATE TABLE IF NOT EXISTS user_status (
  uid TEXT PRIMARY KEY,
  state TEXT DEFAULT 'offline',
  last_changed INTEGER NOT NULL
);

-- 3. KLIPS TABLE (Video & Photo Posts)
CREATE TABLE IF NOT EXISTS klips (
  id TEXT PRIMARY KEY,
  creator_uid TEXT DEFAULT '',
  creator_handle TEXT DEFAULT '@user',
  creator_initials TEXT DEFAULT '',
  creator_avatar_url TEXT DEFAULT '',
  caption TEXT DEFAULT '',
  tags TEXT DEFAULT '[]',
  video_url TEXT DEFAULT '',
  watermarked_video_url TEXT DEFAULT '',
  thumbnail_url TEXT DEFAULT '',
  photo_urls TEXT DEFAULT '[]',
  video_provider TEXT DEFAULT 'cloudflare',
  cloudflare_video_id TEXT DEFAULT '',
  playback_url TEXT DEFAULT '',
  playback_status TEXT DEFAULT 'ready',
  r2_video_key TEXT DEFAULT '',
  sound_id TEXT DEFAULT '',
  sound_title TEXT DEFAULT '',
  sound_audio_url TEXT DEFAULT '',
  sound_start_time REAL DEFAULT 0,
  sound_end_time REAL DEFAULT 0,
  is_female_only INTEGER DEFAULT 0,
  audience TEXT DEFAULT 'general',
  gender TEXT DEFAULT 'Male',
  color_hex TEXT DEFAULT '#172554',
  likes_count INTEGER DEFAULT 0,
  views_count INTEGER DEFAULT 0,
  bookmarks_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  shares_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_klips_created ON klips(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_klips_creator ON klips(creator_uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_klips_audience ON klips(audience, is_female_only, created_at DESC);

-- 4. USER LIKES TABLE (Many-to-Many with unique constraint)
CREATE TABLE IF NOT EXISTS klip_likes (
  user_uid TEXT NOT NULL,
  klip_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_uid, klip_id)
);

CREATE INDEX IF NOT EXISTS idx_likes_klip ON klip_likes(klip_id);

-- 5. USER BOOKMARKS TABLE (Saved videos)
CREATE TABLE IF NOT EXISTS klip_bookmarks (
  user_uid TEXT NOT NULL,
  klip_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_uid, klip_id)
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON klip_bookmarks(user_uid, created_at DESC);

-- 6. FOLLOWS TABLE (Follower relationships)
CREATE TABLE IF NOT EXISTS follows (
  follower_uid TEXT NOT NULL,
  followed_uid TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (follower_uid, followed_uid)
);

CREATE INDEX IF NOT EXISTS idx_follows_followed ON follows(followed_uid);
CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_uid);

-- 7. COMMENTS TABLE (Includes Nested Replies)
CREATE TABLE IF NOT EXISTS klip_comments (
  id TEXT PRIMARY KEY,
  klip_id TEXT NOT NULL,
  user_uid TEXT NOT NULL,
  user_handle TEXT NOT NULL,
  user_initials TEXT DEFAULT '',
  user_avatar_url TEXT DEFAULT '',
  text TEXT NOT NULL,
  parent_comment_id TEXT DEFAULT NULL,
  reply_to_uid TEXT DEFAULT NULL,
  reply_to_handle TEXT DEFAULT NULL,
  likes_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_klip ON klip_comments(klip_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON klip_comments(parent_comment_id);

-- 8. COMMENT LIKES TABLE
CREATE TABLE IF NOT EXISTS comment_likes (
  user_uid TEXT NOT NULL,
  comment_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_uid, comment_id)
);

-- 9. NOTIFICATIONS TABLE
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  recipient_uid TEXT NOT NULL,
  from_uid TEXT NOT NULL,
  from_handle TEXT NOT NULL,
  from_initials TEXT DEFAULT '',
  from_avatar_url TEXT DEFAULT '',
  type TEXT NOT NULL,
  klip_id TEXT DEFAULT NULL,
  comment_id TEXT DEFAULT NULL,
  comment_text TEXT DEFAULT NULL,
  parent_comment_id TEXT DEFAULT NULL,
  message TEXT NOT NULL,
  is_read INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_uid, is_read, created_at DESC);

-- 10. SOUNDS TABLE (Audio Library)
CREATE TABLE IF NOT EXISTS sounds (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  creator_handle TEXT DEFAULT '',
  audio_url TEXT NOT NULL,
  duration REAL DEFAULT 0,
  use_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
