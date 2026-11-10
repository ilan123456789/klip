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

const ghostIds = [
  '2d09b75241b6438c8ce2f43250a1ba7d',
  '33835eed233a47e68a2996b623de31f6',
  '5b680aedb6d748b18ea083142208160a',
  '7a760398e97f489d9b5947684518a1cc',
  'd592f364cab24fd8be83e3c4c35beabc'
];

async function run() {
  const placeholders = ghostIds.map(() => '?').join(',');

  console.log('1. Deleting ghost likes...');
  await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql: `DELETE FROM klip_likes WHERE klip_id IN (${placeholders});`, params: ghostIds })
  });

  console.log('2. Deleting ghost bookmarks...');
  await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql: `DELETE FROM klip_bookmarks WHERE klip_id IN (${placeholders});`, params: ghostIds })
  });

  console.log('3. Deleting ghost comments...');
  await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql: `DELETE FROM comments WHERE klip_id IN (${placeholders});`, params: ghostIds })
  });

  console.log('4. Deleting ghost klips...');
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      sql: `DELETE FROM klips WHERE id IN (${placeholders}) AND (playback_url = '' OR playback_url IS NULL) AND (video_url = '' OR video_url IS NULL);`, 
      params: ghostIds 
    })
  });
  const data = await res.json();
  console.log('Deletion result:', data.success, data.result?.[0]?.meta);

  const ids = ['4e303126905c418b9ff78bfd67be1028', '579e7d8c7a324c90b27e13a320ebd994', '5c9dcc20436d452c974f5f9828b9b030', 'c3a848ab3b3d48d4bad064269d240cb2', 'e499ce57315443c9b5364c9ed1f46e76', 'fd0610b94c1f49dca52f0837b37fcad7'];
  const checkRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      sql: `SELECT id, creator_handle, caption, video_url, playback_url, photo_urls FROM klips WHERE id IN (${ids.map(()=>'?').join(',')});`,
      params: ids
    })
  });
  const checkData = await checkRes.json();
  console.log(JSON.stringify(checkData.result[0].results, null, 2));
}

run().catch(console.error);
