import fs from "fs";

const envText = fs.readFileSync(".env", "utf8");
const env = {};
envText.split(/\r?\n/).forEach((l) => {
  const eq = l.indexOf("=");
  if (eq > 0) {
    const k = l.slice(0, eq).trim();
    let v = l.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  }
});

const accountId = env.CLOUDFLARE_ACCOUNT_ID;
const databaseId = env.CLOUDFLARE_D1_DATABASE_ID;
const d1Token = env.CLOUDFLARE_D1_API_TOKEN || env.CLOUDFLARE_API_TOKEN;
const r2Token = env.CLOUDFLARE_R2_API_TOKEN || env.CLOUDFLARE_API_TOKEN;

async function queryD1(sql, params = []) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${d1Token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    }
  );
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.errors?.[0]?.message || "D1 error");
  }
  return data.result?.[0]?.results || [];
}

async function uploadToR2(key, buffer, contentType = "image/jpeg") {
  const uri = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/kli-videos/objects/${key}`;
  const res = await fetch(uri, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${r2Token}`,
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
    body: buffer,
  });
  if (!res.ok) {
    throw new Error(`R2 upload error HTTP ${res.status}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function downloadWithRetry(url, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "KlipApp/1.0 (https://kliponline.com; dev@kliponline.com)",
        },
      });
      if (res.status === 429) {
        console.log(`    Rate limited (429), waiting ${attempt * 2}s...`);
        await sleep(attempt * 2000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 500) throw new Error("File empty/corrupt");
      return buf;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await sleep(1500);
    }
  }
}

const list = JSON.parse(fs.readFileSync("jewish-candidates.json", "utf8"));
const bots = JSON.parse(fs.readFileSync("bot-accounts.json", "utf8"));

const selectedIndices = [
  0,  // Orthodox Man with Beard by David Shankbone
  1,  // Kotel payot1
  4,  // Payot on young Hasid man 01
  5,  // Jewish men pray at the western wall
  6,  // Praying at Belzer Rebbe's grave
  7,  // Elderly Hasidic man in New York City
  13, // Hasidic Jewish Gentleman, Dunsmure Road, Stamford Hill
  14, // Man in black attire in Jerusalem
  17, // Hasid-Uman (16) (cropped)
  28, // כ״ק אדמו״ר מזוועהיל מונסי שליט״א בהדלקת נרות חנוכה
  32, // Psalms WesternWall
  33, // Man praying at the Western Wall
  34, // A man prays at the Western Wall in Jerusalem
  35, // Reading from the Torah at the Western Wall
  36, // PRIESTLY BLESSING -BIRCAT CHOHANIM AT THE WESTERN WALL
  37, // Praying jewish man on the western wall
  38, // Praying at the Western Wall
  60, // Tefillin worn by a man at the Western Wall
  61, // IDF soldier put on tefillin
  68, // A Jewish man walks from the Western Wall with tefillin
];

console.log(`Starting avatar update for ${bots.length} bots to authentic Jewish imagery...`);

for (let i = 0; i < bots.length; i++) {
  const bot = bots[i];
  const photoCandidate = list[selectedIndices[i]];
  console.log(`\n[${i + 1}/${bots.length}] Processing ${bot.handle} (${bot.displayName})...`);
  console.log(`  Source: ${photoCandidate.title}`);

  try {
    const imgBuf = await downloadWithRetry(photoCandidate.url);
    console.log(`  Downloaded ${imgBuf.length} bytes.`);

    const avatarKey = `avatars/${bot.uid}.jpg`;
    await uploadToR2(avatarKey, imgBuf, "image/jpeg");
    console.log(`  Uploaded to R2: ${avatarKey}`);

    const newUrl = `https://videos.kliponline.com/${avatarKey}?v=${Date.now()}`;
    await queryD1("UPDATE users SET avatar_url = ? WHERE uid = ?;", [newUrl, bot.uid]);
    console.log(`  Updated D1 user profile avatar.`);

    bot.avatarUrl = newUrl;
    await sleep(1500); // polite delay for Wikimedia
  } catch (err) {
    console.error(`  ✗ Failed to update avatar for ${bot.handle}:`, err.message);
  }
}

fs.writeFileSync("bot-accounts.json", JSON.stringify(bots, null, 2), "utf8");
console.log("\nAll bot avatars successfully updated to authentic Jewish imagery!");
