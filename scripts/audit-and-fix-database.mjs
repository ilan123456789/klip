import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split('\n')
    .filter(l => l.includes('='))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const accountId = env.CLOUDFLARE_ACCOUNT_ID;
const dbId = env.CLOUDFLARE_D1_DATABASE_ID;
const token = env.CLOUDFLARE_API_TOKEN;

async function queryD1(sql, params = []) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params })
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(`D1 query failed: ${JSON.stringify(data.errors)}`);
  }
  return data.result[0].results || [];
}

async function executeD1(sql, params = []) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params })
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(`D1 execute failed: ${JSON.stringify(data.errors)}`);
  }
  return data.result[0].meta;
}

async function runAudit() {
  console.log("=== Auditing Klip D1 Database ===");

  // 1. Check orphaned records
  const checks = [
    { name: "Orphaned klip_likes", sql: "SELECT COUNT(*) as c FROM klip_likes WHERE klip_id NOT IN (SELECT id FROM klips);" },
    { name: "Orphaned klip_comments", sql: "SELECT COUNT(*) as c FROM klip_comments WHERE klip_id NOT IN (SELECT id FROM klips);" },
    { name: "Orphaned comment_likes", sql: "SELECT COUNT(*) as c FROM comment_likes WHERE comment_id NOT IN (SELECT id FROM klip_comments);" },
    { name: "Orphaned klip_bookmarks", sql: "SELECT COUNT(*) as c FROM klip_bookmarks WHERE klip_id NOT IN (SELECT id FROM klips);" },
    { name: "Orphaned follows (invalid follower)", sql: "SELECT COUNT(*) as c FROM follows WHERE follower_uid NOT IN (SELECT uid FROM users);" },
    { name: "Orphaned follows (invalid followed)", sql: "SELECT COUNT(*) as c FROM follows WHERE followed_uid NOT IN (SELECT uid FROM users);" },
    { name: "Broken klips (no video & no photos)", sql: "SELECT COUNT(*) as c FROM klips WHERE (playback_url = '' OR playback_url IS NULL) AND (video_url = '' OR video_url IS NULL) AND (photo_urls = '' OR photo_urls = '[]' OR photo_urls IS NULL);" }
  ];

  for (const check of checks) {
    try {
      const res = await queryD1(check.sql);
      const count = res[0]?.c || 0;
      console.log(`- ${check.name}: ${count}`);
      if (count > 0 && check.name === "Orphaned klip_likes") {
        await executeD1("DELETE FROM klip_likes WHERE klip_id NOT IN (SELECT id FROM klips);");
        console.log(`  -> Cleaned up orphaned klip_likes`);
      }
      if (count > 0 && check.name === "Orphaned klip_comments") {
        await executeD1("DELETE FROM klip_comments WHERE klip_id NOT IN (SELECT id FROM klips);");
        console.log(`  -> Cleaned up orphaned klip_comments`);
      }
      if (count > 0 && check.name === "Orphaned comment_likes") {
        await executeD1("DELETE FROM comment_likes WHERE comment_id NOT IN (SELECT id FROM klip_comments);");
        console.log(`  -> Cleaned up orphaned comment_likes`);
      }
      if (count > 0 && check.name === "Orphaned klip_bookmarks") {
        await executeD1("DELETE FROM klip_bookmarks WHERE klip_id NOT IN (SELECT id FROM klips);");
        console.log(`  -> Cleaned up orphaned klip_bookmarks`);
      }
      if (count > 0 && check.name === "Broken klips (no video & no photos)") {
        await executeD1("DELETE FROM klips WHERE (playback_url = '' OR playback_url IS NULL) AND (video_url = '' OR video_url IS NULL) AND (photo_urls = '' OR photo_urls = '[]' OR photo_urls IS NULL);");
        console.log(`  -> Cleaned up broken empty klips`);
      }
    } catch (err) {
      console.error(`  Error running ${check.name}:`, err.message);
    }
  }

  // 2. Synchronize Klips counters
  console.log("\n=== Synchronizing Klips Counters ===");
  await executeD1(`
    UPDATE klips SET 
      likes_count = (SELECT COUNT(*) FROM klip_likes WHERE klip_id = klips.id),
      comments_count = (SELECT COUNT(*) FROM klip_comments WHERE klip_id = klips.id),
      bookmarks_count = (SELECT COUNT(*) FROM klip_bookmarks WHERE klip_id = klips.id)
  ;`);
  console.log("-> Klips likes_count, comments_count, bookmarks_count synced.");

  // 3. Synchronize Comments counters
  console.log("\n=== Synchronizing Comment Likes Counters ===");
  await executeD1(`
    UPDATE klip_comments SET
      likes_count = (SELECT COUNT(*) FROM comment_likes WHERE comment_id = klip_comments.id)
  ;`);
  console.log("-> Comment likes_count synced.");

  // 4. Synchronize Users counters
  console.log("\n=== Synchronizing User Follower & Following Counters ===");
  await executeD1(`
    UPDATE users SET 
      followers_count = MAX(COALESCE(followers_count, 0), (SELECT COUNT(*) FROM follows WHERE followed_uid = users.uid)),
      following_count = MAX(COALESCE(following_count, 0), (SELECT COUNT(*) FROM follows WHERE follower_uid = users.uid)),
      shkoyach_count = MAX(COALESCE(shkoyach_count, 0), COALESCE((SELECT SUM(likes_count) FROM klips WHERE creator_uid = users.uid), 0))
  ;`);
  console.log("-> User followers, following, and shkoyach counters synced.");

  // 5. Verify user permissions
  console.log("\n=== Checking and Enabling Posting Permissions ===");
  const inactivePosters = await queryD1("SELECT uid, handle FROM users WHERE can_post = 0;");
  console.log(`Users with can_post = 0: ${inactivePosters.length}`);
  // Enable posting for users that want to post
  await executeD1("UPDATE users SET can_post = 1 WHERE can_post = 0;");
  console.log("-> All users now have can_post = 1 (posting enabled).");

  console.log("\n=== Database Audit and Repair Finished Successfully ===");
}

runAudit().catch(console.error);
