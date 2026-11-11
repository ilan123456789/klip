import fs from "fs";
import crypto from "crypto";

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

const botConfigs = [
  {
    handle: "@yossigoldstein",
    displayName: "Yossi Goldstein",
    initials: "YG",
    bio: "Living for simchas, kumzitz, and good Jewish music 🎸",
    photoId: "photo-1507003211169-0a1dd7228f2d",
  },
  {
    handle: "@mendel_rubin",
    displayName: "Mendel Rubin",
    initials: "MR",
    bio: "Crown Heights • Chassidus • Good energy ✨",
    photoId: "photo-1500648767791-00dcc994a43e",
  },
  {
    handle: "@shloimy_b",
    displayName: "Shloime Bernath",
    initials: "SB",
    bio: "Boro Park boy • Wedding photographer & clip lover 📸",
    photoId: "photo-1472099645785-5658abf4ff4e",
  },
  {
    handle: "@chaim_music",
    displayName: "Chaim Miller",
    initials: "CM",
    bio: "Keyboard & Jewish simcha vibes 🎹🎶",
    photoId: "photo-1519085360753-af0119f7cbe7",
  },
  {
    handle: "@dovid_katz",
    displayName: "Dovid Katz",
    initials: "DK",
    bio: "Bnei Brak vibes • Torah & simcha always 📖",
    photoId: "photo-1506794778202-cad84cf45f1d",
  },
  {
    handle: "@avi_cohen_live",
    displayName: "Avi Cohen",
    initials: "AC",
    bio: "Jerusalem nights & acoustic kumzitz 🕊️",
    photoId: "photo-1522075469751-3a6694fb2f61",
  },
  {
    handle: "@moshe_fried",
    displayName: "Moshe Fried",
    initials: "MF",
    bio: "Flatbush • Big fan of Jewish clips & choir 🎼",
    photoId: "photo-1560250097-0b93528c311a",
  },
  {
    handle: "@ari_stern",
    displayName: "Ari Stern",
    initials: "AS",
    bio: "Williamsburg / Lakewood • Always smiling 🙂",
    photoId: "photo-1566492031773-4f4e44671857",
  },
  {
    handle: "@yehuda_w",
    displayName: "Yehuda Weiss",
    initials: "YW",
    bio: "Simchas & good times • Hashem is good 🌟",
    photoId: "photo-1539571696357-5a69c17a67c6",
  },
  {
    handle: "@berel_k",
    displayName: "Berel Klein",
    initials: "BK",
    bio: "Chassidish & proud • Sharing good kosher content 🙌",
    photoId: "photo-1501196354995-cbb51c65aaea",
  },
  {
    handle: "@nachman_green",
    displayName: "Nachman Green",
    initials: "NG",
    bio: "Uman Rosh Hashanah • Mitzvah gedola lehiyot besimcha 🕺",
    photoId: "photo-1508214751196-bcfd4ca60f91",
  },
  {
    handle: "@shmuel_levy",
    displayName: "Shmuel Levy",
    initials: "SL",
    bio: "Music enthusiast • Shabbos songs & Chazzanus 🎵",
    photoId: "photo-1492562080023-ab3db95bfbce",
  },
  {
    handle: "@yaakov_sofer",
    displayName: "Yaakov Sofer",
    initials: "YS",
    bio: "Yerushalmi • Coffee, Torah, and beautiful Klips ☕",
    photoId: "photo-1528892952291-009c663ce843",
  },
  {
    handle: "@benny_fogel",
    displayName: "Benny Fogel",
    initials: "BF",
    bio: "Lakewood • Event planning & Jewish simchas 🎊",
    photoId: "photo-1513956589380-bad6acb9b9d4",
  },
  {
    handle: "@akiva_deutsch",
    displayName: "Akiva Deutsch",
    initials: "AD",
    bio: "Toronto to NY • Keeping it kosher & inspiring 💫",
    photoId: "photo-1504257432389-52343af06ae3",
  },
  {
    handle: "@motti_schwartz",
    displayName: "Motti Schwartz",
    initials: "MS",
    bio: "Singing & kumzitz lover • Only good vibes 🎤",
    photoId: "photo-1521119989659-a83eee488004",
  },
  {
    handle: "@sruly_p",
    displayName: "Sruly Perl",
    initials: "SP",
    bio: "Monsey resident • Always looking for great talent 🌟",
    photoId: "photo-1542909168-82c3e7fdca5c",
  },
  {
    handle: "@yitzchok_kramer",
    displayName: "Yitzchok Kramer",
    initials: "YK",
    bio: "London / Golders Green • Jewish culture enthusiast 🇬🇧",
    photoId: "photo-1534493872551-856c2bb2279f",
  },
  {
    handle: "@zalman_berger",
    displayName: "Zalman Berger",
    initials: "ZB",
    bio: "Crown Heights • Farbrengens & niggunim 🕯️",
    photoId: "photo-1506277886164-e25aa3f4ef7f",
  },
  {
    handle: "@pinny_gross",
    displayName: "Pinny Gross",
    initials: "PG",
    bio: "Simcha guitarist & audio producer 🎸🔊",
    photoId: "photo-1496345875659-11f7dd282d1d",
  },
];

console.log(`Starting generation of ${botConfigs.length} bot accounts...`);

const now = Math.floor(Date.now() / 1000);
const TARGET_FOLLOWS = [
  "V8RxXltwj7NxJisVpS8UP6q71fM2", // @ilanlev
  "HKWH1GK0oPWhWX3z42Ob1vfibDi2", // @Elieabenlovesilan
];

const createdBots = [];

for (let i = 0; i < botConfigs.length; i++) {
  const bot = botConfigs[i];
  const uid = `bot_${bot.handle.replace("@", "")}_${crypto.randomBytes(3).toString("hex")}`;
  const avatarKey = `avatars/${uid}.jpg`;
  const avatarUrl = `https://videos.kliponline.com/${avatarKey}`;
  const photoUrl = `https://images.unsplash.com/${bot.photoId}?w=400&h=400&fit=crop&crop=face&auto=format&q=80`;

  console.log(`[${i + 1}/${botConfigs.length}] Downloading photo for ${bot.handle}...`);
  try {
    const imgRes = await fetch(photoUrl);
    if (!imgRes.ok) throw new Error(`Failed to download photo HTTP ${imgRes.status}`);
    const imgBuf = Buffer.from(await imgRes.arrayBuffer());

    console.log(`  Uploading avatar to R2: ${avatarKey} (${imgBuf.length} bytes)...`);
    await uploadToR2(avatarKey, imgBuf, "image/jpeg");

    console.log(`  Inserting user into D1: ${bot.displayName} (${bot.handle})...`);
    await queryD1(
      `INSERT INTO users (
        uid, handle, display_name, email, initials, bio, avatar_url,
        gender, is_male, can_post, followers_count, following_count,
        shkoyach_count, likes_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(uid) DO UPDATE SET
        avatar_url = excluded.avatar_url,
        bio = excluded.bio;`,
      [
        uid,
        bot.handle,
        bot.displayName,
        `${bot.handle.replace("@", "")}@kliponline.com`,
        bot.initials,
        bot.bio,
        avatarUrl,
        "Male",
        1,
        1,
        0,
        TARGET_FOLLOWS.length,
        0,
        0,
        now,
        now,
      ]
    );

    // Follow target accounts
    for (const followedUid of TARGET_FOLLOWS) {
      await queryD1(
        "INSERT OR IGNORE INTO follows (follower_uid, followed_uid, created_at) VALUES (?, ?, ?);",
        [uid, followedUid, now]
      );
    }

    createdBots.push({ uid, handle: bot.handle, displayName: bot.displayName, avatarUrl });
    console.log(`  ✓ Successfully created ${bot.handle}`);
  } catch (err) {
    console.error(`  ✗ Error creating ${bot.handle}:`, err.message);
  }
}

// Update target followers counts
for (const followedUid of TARGET_FOLLOWS) {
  await queryD1(
    `UPDATE users 
     SET followers_count = (SELECT COUNT(*) FROM follows WHERE followed_uid = ?) 
     WHERE uid = ?;`,
    [followedUid, followedUid]
  );
}

// Save created bots to a JSON file for the engagement cron to use
fs.writeFileSync("bot-accounts.json", JSON.stringify(createdBots, null, 2), "utf8");
console.log(`\nAll done! Successfully created ${createdBots.length} bot accounts.`);
console.log(`Saved credentials & metadata to bot-accounts.json`);
