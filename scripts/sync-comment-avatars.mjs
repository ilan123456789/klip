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
  console.log('1. Checking existing comments and user avatars in D1...');
  const comments = await queryD1(`
    SELECT 
      c.id, c.user_uid, c.user_handle, c.user_avatar_url,
      u.avatar_url as latest_user_avatar,
      u.is_male
    FROM klip_comments c
    LEFT JOIN users u ON u.uid = c.user_uid;
  `);

  console.log(`Found ${comments.length} total comments in D1.`);
  
  let mismatchCount = 0;
  for (const c of comments) {
    const expectedAvatar = (c.is_male !== 0 && c.latest_user_avatar) ? c.latest_user_avatar : '';
    if ((c.user_avatar_url || '') !== expectedAvatar) {
      mismatchCount++;
      console.log(`Mismatch on comment ${c.id} by ${c.user_handle}: current "${c.user_avatar_url}" -> latest "${expectedAvatar}"`);
    }
  }

  console.log(`\n2. Updating all klip_comments with latest avatars from users table...`);
  await queryD1(`
    UPDATE klip_comments
    SET user_avatar_url = COALESCE(
      (SELECT CASE WHEN u.is_male = 0 THEN '' ELSE NULLIF(u.avatar_url, '') END FROM users u WHERE u.uid = klip_comments.user_uid),
      user_avatar_url,
      ''
    ),
    user_handle = COALESCE(
      (SELECT NULLIF(u.handle, '') FROM users u WHERE u.uid = klip_comments.user_uid),
      user_handle
    ),
    user_initials = COALESCE(
      (SELECT NULLIF(u.initials, '') FROM users u WHERE u.uid = klip_comments.user_uid),
      user_initials
    );
  `);

  console.log('3. Verifying update...');
  const verified = await queryD1(`
    SELECT 
      c.id, c.user_uid, c.user_handle, c.user_avatar_url,
      u.avatar_url as latest_user_avatar
    FROM klip_comments c
    LEFT JOIN users u ON u.uid = c.user_uid
    WHERE u.avatar_url IS NOT NULL AND u.avatar_url != '' AND u.is_male = 1;
  `);

  console.log(`Comments by users with avatars: ${verified.length}`);
  verified.slice(0, 5).forEach(v => {
    console.log(`- Comment ${v.id} by ${v.user_handle}: avatar_url = ${v.user_avatar_url}`);
  });

  console.log('Finished successfully.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

