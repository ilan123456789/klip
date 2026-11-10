import fs from 'node:fs';

const backupDir = 'c:/Users/ilanl/Downloads/KlipWeb/backups/backup_2026-11-10T18-01-28-611Z';
const accountId = '0d5fb2ccdbc60ef2550a5500b575696f';
const dbId = 'd7a63d25-d614-413a-81bc-cbc8c3ec937b';
const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_D1_API_TOKEN || '';

async function queryD1(sql, params = []) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sql, params })
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(`D1 query failed: ${JSON.stringify(data.errors)}`);
  }
  return data.result[0].results;
}

async function audit() {
  console.log('=== AUDIT 1: KLIPS COMPARISON ===');
  const backupKlips = JSON.parse(fs.readFileSync(`${backupDir}/klips.json`, 'utf8'));
  const backupKlipKeys = Object.keys(backupKlips);
  console.log(`Backup Klips Count: ${backupKlipKeys.length}`);

  const d1Klips = await queryD1('SELECT id, creator_uid, caption, video_url, created_at FROM klips;');
  console.log(`Production D1 Klips Count: ${d1Klips.length}`);

  const d1KlipIds = new Set(d1Klips.map(r => r.id));
  const missingInD1 = backupKlipKeys.filter(k => !d1KlipIds.has(k));
  const extraInD1 = d1Klips.filter(r => !backupKlips[r.id]);

  console.log(`Missing in D1 (${missingInD1.length}):`, missingInD1);
  for (const id of missingInD1) {
    console.log(`Details of missing Klip [${id}]:`, JSON.stringify(backupKlips[id], null, 2));
  }
  console.log(`Extra in D1 (${extraInD1.length}):`, extraInD1.map(r => ({ id: r.id, caption: r.caption, creator: r.creator_uid })));

  console.log('\n=== AUDIT 2: USERS COMPARISON ===');
  const backupUsers = JSON.parse(fs.readFileSync(`${backupDir}/users.json`, 'utf8'));
  const backupUserKeys = Object.keys(backupUsers);
  const d1Users = await queryD1('SELECT uid, handle, email FROM users;');
  console.log(`Backup Users: ${backupUserKeys.length} | D1 Users: ${d1Users.length}`);

  console.log('\n=== AUDIT 3: LIKES COMPARISON ===');
  const backupUserLikes = JSON.parse(fs.readFileSync(`${backupDir}/userLikes.json`, 'utf8'));
  let totalBackupLikes = 0;
  for (const uid of Object.keys(backupUserLikes)) {
    totalBackupLikes += Object.keys(backupUserLikes[uid] || {}).length;
  }
  const d1Likes = await queryD1('SELECT COUNT(*) as count FROM klip_likes;');
  console.log(`Backup UserLikes Pairs: ${totalBackupLikes} | D1 klip_likes Count: ${d1Likes[0].count}`);

  console.log('\n=== AUDIT 4: BOOKMARKS COMPARISON ===');
  const backupUserBookmarks = JSON.parse(fs.readFileSync(`${backupDir}/userBookmarks.json`, 'utf8'));
  let totalBackupBookmarks = 0;
  for (const uid of Object.keys(backupUserBookmarks)) {
    totalBackupBookmarks += Object.keys(backupUserBookmarks[uid] || {}).length;
  }
  const d1Bookmarks = await queryD1('SELECT COUNT(*) as count FROM klip_bookmarks;');
  console.log(`Backup UserBookmarks Pairs: ${totalBackupBookmarks} | D1 klip_bookmarks Count: ${d1Bookmarks[0].count}`);

  console.log('\n=== AUDIT 5: FOLLOWS COMPARISON ===');
  const backupFollowers = JSON.parse(fs.readFileSync(`${backupDir}/followers.json`, 'utf8'));
  let totalBackupFollowers = 0;
  for (const uid of Object.keys(backupFollowers)) {
    totalBackupFollowers += Object.keys(backupFollowers[uid] || {}).length;
  }
  const d1Follows = await queryD1('SELECT COUNT(*) as count FROM follows;');
  console.log(`Backup Follow Pairs: ${totalBackupFollowers} | D1 follows Count: ${d1Follows[0].count}`);

  console.log('\n=== AUDIT 6: COMMENTS COMPARISON ===');
  const backupComments = JSON.parse(fs.readFileSync(`${backupDir}/klipComments.json`, 'utf8'));
  let totalBackupComments = 0;
  for (const klipId of Object.keys(backupComments)) {
    totalBackupComments += Object.keys(backupComments[klipId] || {}).length;
  }
  const d1Comments = await queryD1('SELECT COUNT(*) as count FROM klip_comments;');
  console.log(`Backup Comments Count: ${totalBackupComments} | D1 klip_comments Count: ${d1Comments[0].count}`);

  console.log('\n=== AUDIT 7: NOTIFICATIONS COMPARISON ===');
  const backupNotifs = JSON.parse(fs.readFileSync(`${backupDir}/notifications.json`, 'utf8'));
  let totalBackupNotifs = 0;
  for (const uid of Object.keys(backupNotifs)) {
    totalBackupNotifs += Object.keys(backupNotifs[uid] || {}).length;
  }
  const d1Notifs = await queryD1('SELECT COUNT(*) as count FROM notifications;');
  console.log(`Backup Notifications Count: ${totalBackupNotifs} | D1 notifications Count: ${d1Notifs[0].count}`);

  console.log('\n=== AUDIT 8: USER STATUS COMPARISON ===');
  const backupStatus = JSON.parse(fs.readFileSync(`${backupDir}/status.json`, 'utf8'));
  const d1Status = await queryD1('SELECT COUNT(*) as count FROM user_status;');
  console.log(`Backup Status Count: ${Object.keys(backupStatus).length} | D1 user_status Count: ${d1Status[0].count}`);
}

audit().catch(console.error);

