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
const token = env.CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_D1_API_TOKEN;

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
  return data.result[0].results;
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

async function main() {
  const exportPath = 'c:/Users/ilanl/Downloads/gevaldig-portal-default-rtdb-export.json';
  if (!fs.existsSync(exportPath)) {
    console.error('Export file not found at:', exportPath);
    return;
  }

  const data = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
  console.log('Loaded Firebase RTDB export from:', exportPath);

  // 1. Sync Users
  console.log('\n--- 1. SYNCING USERS ---');
  const d1Users = await queryD1('SELECT uid FROM users;');
  const d1UserSet = new Set(d1Users.map(u => u.uid));
  const fbUsers = data.users || {};

  let newUsersCount = 0;
  for (const [uid, u] of Object.entries(fbUsers)) {
    if (!d1UserSet.has(uid)) {
      console.log(`Inserting missing user: ${uid} (${u.Handle || u.handle})`);
      const now = Math.floor(Date.now() / 1000);
      const isMale = u.Gender?.toLowerCase() === 'female' ? 0 : 1;
      await executeD1(
        `INSERT INTO users (
          uid, handle, display_name, email, initials, bio, avatar_url,
          gender, is_male, can_post, followers_count, following_count,
          shkoyach_count, likes_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          uid,
          u.Handle || u.handle || '@user',
          u.DisplayName || u.displayName || '',
          u.Email || u.email || '',
          u.Initials || u.initials || 'KL',
          u.Bio || u.bio || 'Sharing Jewish life & simchas on Klip ✡',
          u.AvatarUrl || u.avatar_url || '',
          u.Gender || u.gender || 'Male',
          isMale,
          u.CanPost ? 1 : 0,
          Number(u.FollowersCount || 0),
          Number(u.FollowingCount || 0),
          Number(u.ShkoyachCount || 0),
          0,
          now,
          now
        ]
      );
      newUsersCount++;
    }
  }
  console.log(`Users synced: ${newUsersCount} new users inserted.`);

  // 2. Sync Likes (klip_likes)
  console.log('\n--- 2. SYNCING LIKES ---');
  const d1Likes = await queryD1('SELECT klip_id, user_uid FROM klip_likes;');
  const d1LikeSet = new Set(d1Likes.map(l => `${l.klip_id}_${l.user_uid}`));
  const d1ValidKlips = new Set((await queryD1('SELECT id FROM klips;')).map(k => k.id));

  let newLikesCount = 0;
  for (const [userUid, klipObj] of Object.entries(data.userLikes || {})) {
    for (const klipId of Object.keys(klipObj || {})) {
      const key = `${klipId}_${userUid}`;
      if (!d1LikeSet.has(key) && d1ValidKlips.has(klipId)) {
        const now = Math.floor(Date.now() / 1000);
        await executeD1(
          `INSERT OR IGNORE INTO klip_likes (klip_id, user_uid, created_at) VALUES (?, ?, ?);`,
          [klipId, userUid, now]
        );
        // Also update likes_count on klip
        await executeD1(
          `UPDATE klips SET likes_count = (SELECT COUNT(*) FROM klip_likes WHERE klip_id = ?) WHERE id = ?;`,
          [klipId, klipId]
        );
        newLikesCount++;
      }
    }
  }
  console.log(`Likes synced: ${newLikesCount} new likes inserted.`);

  // 3. Sync Bookmarks (klip_bookmarks)
  console.log('\n--- 3. SYNCING BOOKMARKS ---');
  const d1Bookmarks = await queryD1('SELECT klip_id, user_uid FROM klip_bookmarks;');
  const d1BookmarkSet = new Set(d1Bookmarks.map(b => `${b.klip_id}_${b.user_uid}`));

  let newBookmarksCount = 0;
  for (const [userUid, klipObj] of Object.entries(data.userBookmarks || {})) {
    for (const klipId of Object.keys(klipObj || {})) {
      const key = `${klipId}_${userUid}`;
      if (!d1BookmarkSet.has(key) && d1ValidKlips.has(klipId)) {
        const now = Math.floor(Date.now() / 1000);
        await executeD1(
          `INSERT OR IGNORE INTO klip_bookmarks (klip_id, user_uid, created_at) VALUES (?, ?, ?);`,
          [klipId, userUid, now]
        );
        await executeD1(
          `UPDATE klips SET bookmarks_count = (SELECT COUNT(*) FROM klip_bookmarks WHERE klip_id = ?) WHERE id = ?;`,
          [klipId, klipId]
        );
        newBookmarksCount++;
      }
    }
  }
  console.log(`Bookmarks synced: ${newBookmarksCount} new bookmarks inserted.`);

  // 4. Sync Follows (follows)
  console.log('\n--- 4. SYNCING FOLLOWS ---');
  const d1Follows = await queryD1('SELECT follower_uid, followed_uid FROM follows;');
  const d1FollowSet = new Set(d1Follows.map(f => `${f.follower_uid}_${f.followed_uid}`));

  let newFollowsCount = 0;
  for (const [followerUid, targetObj] of Object.entries(data.following || {})) {
    for (const followedUid of Object.keys(targetObj || {})) {
      const key = `${followerUid}_${followedUid}`;
      if (!d1FollowSet.has(key)) {
        const now = Math.floor(Date.now() / 1000);
        await executeD1(
          `INSERT OR IGNORE INTO follows (follower_uid, followed_uid, created_at) VALUES (?, ?, ?);`,
          [followerUid, followedUid, now]
        );
        newFollowsCount++;
      }
    }
  }
  console.log(`Follows synced: ${newFollowsCount} new follows inserted.`);

  // 5. Update user counts (followers_count, following_count)
  console.log('\n--- 5. UPDATING USER FOLLOWER/FOLLOWING COUNTS ---');
  await executeD1(`
    UPDATE users SET
      followers_count = (SELECT COUNT(*) FROM follows WHERE followed_uid = users.uid),
      following_count = (SELECT COUNT(*) FROM follows WHERE follower_uid = users.uid);
  `);
  console.log('User follower/following counts updated.');

  // 6. Verify Menachem & other users
  const menachem = await queryD1('SELECT * FROM users WHERE handle = ?;', ['@trippdafoxx']);
  console.log('\nMenachem record in D1:', menachem[0]);
  const menachemLikes = await queryD1('SELECT COUNT(*) as c FROM klip_likes WHERE user_uid = ?;', [menachem[0]?.uid]);
  console.log('Menachem likes count in D1:', menachemLikes[0]?.c);
  const menachemBookmarks = await queryD1('SELECT COUNT(*) as c FROM klip_bookmarks WHERE user_uid = ?;', [menachem[0]?.uid]);
  console.log('Menachem bookmarks count in D1:', menachemBookmarks[0]?.c);
  const menachemFollows = await queryD1('SELECT COUNT(*) as c FROM follows WHERE follower_uid = ?;', [menachem[0]?.uid]);
  console.log('Menachem following count in D1:', menachemFollows[0]?.c);
}

main().catch(console.error);

