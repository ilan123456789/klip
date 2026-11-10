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
  return data.result[0].results || data.result[0].meta;
}

async function main() {
  console.log('1. Finding user @ilanlev...');
  const users = await queryD1("SELECT uid, handle, display_name FROM users WHERE LOWER(handle) = '@ilanlev' OR LOWER(handle) = 'ilanlev';");
  if (!users || users.length === 0) {
    console.error('User @ilanlev not found!');
    return;
  }

  const targetUser = users[0];
  const targetUid = targetUser.uid;
  console.log(`Target User: ${targetUser.handle} (UID: ${targetUid})`);

  console.log('2. Fetching all other users...');
  const allUsers = await queryD1("SELECT uid, handle FROM users WHERE uid != ?;", [targetUid]);
  console.log(`Found ${allUsers.length} other users.`);

  console.log('3. Inserting follow records into follows table...');
  const now = Math.floor(Date.now() / 1000);
  let addedCount = 0;

  for (const u of allUsers) {
    await queryD1(
      "INSERT OR IGNORE INTO follows (follower_uid, followed_uid, created_at) VALUES (?, ?, ?);",
      [u.uid, targetUid, now]
    );
    addedCount++;
  }
  console.log(`Processed ${addedCount} follow operations.`);

  console.log('4. Updating follower and following counts across users table...');
  await queryD1(`
    UPDATE users SET
      followers_count = (SELECT COUNT(*) FROM follows WHERE followed_uid = users.uid),
      following_count = (SELECT COUNT(*) FROM follows WHERE follower_uid = users.uid);
  `);

  console.log('5. Verifying @ilanlev counts...');
  const updatedUser = await queryD1("SELECT uid, handle, followers_count, following_count FROM users WHERE uid = ?;", [targetUid]);
  console.log('Updated record:', updatedUser[0]);
}

main().catch(console.error);
