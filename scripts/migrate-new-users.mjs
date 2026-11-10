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
const firebaseUrl = env.FIREBASE_DATABASE_URL || 'https://gevaldig-portal-default-rtdb.firebaseio.com';

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

async function main() {
  console.log('1. Fetching current D1 users...');
  const d1Users = await queryD1('SELECT uid, handle, email, display_name FROM users;');
  const d1Uids = new Set(d1Users.map(u => u.uid));
  console.log(`D1 Users count: ${d1Users.length}`);

  console.log('2. Fetching Firebase RTDB users...');
  const fbRes = await fetch(`${firebaseUrl}/users.json`);
  const fbUsers = await fbRes.json();
  if (!fbUsers) {
    console.log('No users found in Firebase RTDB or permission denied.');
    return;
  }
  const fbKeys = Object.keys(fbUsers);
  console.log(`Firebase RTDB Users count: ${fbKeys.length}`);

  const missingUids = fbKeys.filter(uid => !d1Uids.has(uid));
  console.log(`Users in Firebase but missing in D1: ${missingUids.length}`);
  for (const uid of missingUids) {
    console.log(`[Missing] ${uid}:`, JSON.stringify(fbUsers[uid]));
  }

  // Also check if there are other collections with new data: klips, likes, followers, bookmarks, comments
  console.log('\n3. Checking other collections in Firebase RTDB...');
  for (const col of ['klips', 'klipComments', 'userLikes', 'userBookmarks', 'followers', 'following']) {
    try {
      const colRes = await fetch(`${firebaseUrl}/${col}.json`);
      if (colRes.ok) {
        const colData = await colRes.json();
        const cnt = colData ? Object.keys(colData).length : 0;
        console.log(`Firebase ${col} count: ${cnt}`);
      }
    } catch (e) {
      console.log(`Could not fetch ${col}: ${e.message}`);
    }
  }
}

main().catch(console.error);
