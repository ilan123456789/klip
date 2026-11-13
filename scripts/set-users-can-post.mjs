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

const handles = [
  "Aron levi",
  "yourfavoriteyid",
  "Eisenberg",
  "אשוואר",
  "chaimdinovgmailcom",
  "Elieabenlovesilan",
  "rabbiraps",
  "ilanlev",
  "eli",
  "Dovibrody",
  "exploringcultureLDN",
  "Akiva801",
  "Preston",
  "torahvation",
  "nigger",
  "ezra",
  "abrahamschwartz",
  "Pharisee",
  "MoshehAkivaW"
];

async function main() {
  console.log(`Checking and updating can_post = 1 for ${handles.length} handles...`);

  for (const rawHandle of handles) {
    const clean = rawHandle.replace(/^@/, '').trim().toLowerCase();
    const handleWithAt = `@${clean}`;

    // Find user
    const users = await queryD1(
      "SELECT uid, handle, display_name, can_post FROM users WHERE LOWER(handle) = ? OR LOWER(handle) = ? OR LOWER(handle) = ?;",
      [handleWithAt, clean, rawHandle]
    );

    if (users.length === 0) {
      console.warn(`[NOT FOUND] @${rawHandle}`);
      continue;
    }

    for (const u of users) {
      if (u.can_post !== 1) {
        await executeD1("UPDATE users SET can_post = 1 WHERE uid = ?;", [u.uid]);
        console.log(`[UPDATED] ${u.handle} (UID: ${u.uid}) -> can_post set to 1`);
      } else {
        console.log(`[ALREADY 1] ${u.handle} (UID: ${u.uid}) -> can_post is 1`);
      }
    }
  }

  console.log("\nFinished updating users.");
}

main().catch(console.error);
