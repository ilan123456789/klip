import { getDb, queryAll, queryFirst, execute } from "../../utils/d1.js";

const KOSHER_COMMENTS = [
  "Mamash geshmak! 🔥",
  "Shkoyach!! 🙌",
  "So nice! 👏",
  "Beautiful! ❤️",
  "Mazel Tov! 🎉",
  "Love this, keep them coming!",
  "Chazak u'baruch! ✡️",
  "Pure simcha right here! 🌟",
  "Gehinnom of a clip! 😂",
  "Gold!! 🏆",
  "The talent on this app is unbelievable 🎵",
  "Brings so much joy!",
  "What a voice! 🎤",
  "Nostalgic and sweet 🎶",
  "So inspiring, shkoyach!",
  "Good vibes always ✨",
  "Mitzvah gedola lehiyot besimcha! 🕺",
  "Awesome execution 💯",
  "Top tier kosher content 👍",
  "Can't stop watching this! 👏",
  "Absolute fire! 🔥🔥",
  "Keep up the amazing work! 🙌",
  "Simchas Hashem hi ma'uzchem! 💫",
  "Geshmak to the max! 🎸",
];

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateId() {
  return "gen_" + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

/**
 * Cloudflare Pages Function: Bot Engagement Engine
 * Route: GET /api/bots/cron
 * Route: POST /api/bots/cron
 */
export async function onRequest(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const db = getDb(context.env);
    const now = Math.floor(Date.now() / 1000);

    // 1. Fetch our 20 active bot accounts
    const bots = await queryAll(
      db,
      "SELECT uid, handle, display_name, initials, avatar_url FROM users WHERE uid LIKE 'bot_%' LIMIT 30;"
    );

    if (!bots || bots.length === 0) {
      return new Response(JSON.stringify({ success: false, error: "No bot accounts found." }), {
        status: 404,
        headers,
      });
    }

    // 2. Fetch the most recent klips (latest 20)
    const klips = await queryAll(
      db,
      "SELECT id, creator_uid, caption FROM klips ORDER BY created_at DESC LIMIT 20;"
    );

    if (!klips || klips.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No klips available to engage with." }), {
        status: 200,
        headers,
      });
    }

    let totalViewsAdded = 0;
    let totalLikesAdded = 0;
    let totalCommentsAdded = 0;

    for (const klip of klips) {
      // A. Add realistic views (2 to 6 views per cycle)
      const viewsToAdd = randomInt(2, 6);
      await execute(db, "UPDATE klips SET views_count = views_count + ? WHERE id = ?;", viewsToAdd, klip.id);
      totalViewsAdded += viewsToAdd;

      // Filter out bots that shouldn't engage with their own klip
      const eligibleBots = bots.filter((b) => b.uid !== klip.creator_uid);
      if (eligibleBots.length === 0) continue;

      // B. Add Shkoyach ♥ (Likes)
      // Pick 1 to 3 random bots to consider liking
      const shuffledBots = [...eligibleBots].sort(() => Math.random() - 0.5);
      const candidatesToLike = shuffledBots.slice(0, randomInt(1, 3));

      for (const bot of candidatesToLike) {
        const existingLike = await queryFirst(
          db,
          "SELECT 1 FROM klip_likes WHERE user_uid = ? AND klip_id = ?;",
          bot.uid,
          klip.id
        );

        if (!existingLike) {
          await execute(
            db,
            "INSERT OR IGNORE INTO klip_likes (user_uid, klip_id, created_at) VALUES (?, ?, ?);",
            bot.uid,
            klip.id,
            now
          );
          await execute(db, "UPDATE klips SET likes_count = likes_count + 1 WHERE id = ?;", klip.id);
          if (klip.creator_uid) {
            await execute(
              db,
              "UPDATE users SET shkoyach_count = shkoyach_count + 1 WHERE uid = ?;",
              klip.creator_uid
            );

            // Send notification to creator
            const notifId = generateId();
            await execute(
              db,
              `INSERT INTO notifications (
                id, recipient_uid, from_uid, from_handle, from_initials,
                from_avatar_url, type, klip_id, message, is_read, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, 'like', ?, ?, 0, ?);`,
              notifId,
              klip.creator_uid,
              bot.uid,
              bot.handle,
              bot.initials || "KL",
              bot.avatar_url || "",
              klip.id,
              `${bot.handle} gave your Klip a Shkoyach ♥`,
              now
            );
          }
          totalLikesAdded++;
        }
      }

      // C. Add Comment (35% probability per klip per cycle)
      if (Math.random() < 0.35) {
        // Pick 1 bot that hasn't commented on this klip yet
        for (const bot of shuffledBots) {
          const existingComment = await queryFirst(
            db,
            "SELECT 1 FROM klip_comments WHERE user_uid = ? AND klip_id = ? LIMIT 1;",
            bot.uid,
            klip.id
          );

          if (!existingComment) {
            const commentText = randomChoice(KOSHER_COMMENTS);
            const commentId = generateId();

            await execute(
              db,
              `INSERT INTO klip_comments (
                id, klip_id, user_uid, user_handle, user_initials, user_avatar_url,
                text, parent_comment_id, reply_to_uid, reply_to_handle, likes_count, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0, ?);`,
              commentId,
              klip.id,
              bot.uid,
              bot.handle,
              bot.initials || "KL",
              bot.avatar_url || "",
              commentText,
              now
            );

            await execute(db, "UPDATE klips SET comments_count = comments_count + 1 WHERE id = ?;", klip.id);

            if (klip.creator_uid) {
              const notifId = generateId();
              await execute(
                db,
                `INSERT INTO notifications (
                  id, recipient_uid, from_uid, from_handle, from_initials,
                  from_avatar_url, type, klip_id, comment_id, comment_text, message, is_read, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'comment', ?, ?, ?, ?, 0, ?);`,
                notifId,
                klip.creator_uid,
                bot.uid,
                bot.handle,
                bot.initials || "KL",
                bot.avatar_url || "",
                klip.id,
                commentId,
                commentText,
                `${bot.handle} commented: "${commentText}"`,
                now
              );
            }

            totalCommentsAdded++;
            break; // Max 1 new comment per klip per cron cycle
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        klipsEngaged: klips.length,
        totalViewsAdded,
        totalLikesAdded,
        totalCommentsAdded,
        timestamp: now,
      }),
      { status: 200, headers }
    );
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers,
    });
  }
}
