import fs from 'node:fs';
import path from 'node:path';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split('\n')
    .filter(l => l.includes('='))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const accountId = env.CLOUDFLARE_ACCOUNT_ID || '0d5fb2ccdbc60ef2550a5500b575696f';
const dbId = env.CLOUDFLARE_D1_DATABASE_ID || 'd7a63d25-d614-413a-81bc-cbc8c3ec937b';
const token = env.CLOUDFLARE_API_TOKEN;
const r2Token = env.CLOUDFLARE_R2_API_TOKEN || token;
const bucketName = env.CLOUDFLARE_R2_BUCKET || 'kli-videos';
const customerSubdomain = env.CLOUDFLARE_CUSTOMER_SUBDOMAIN || 'customer-wmucbvx0oqk5mob1.cloudflarestream.com';
const r2Domain = 'videos.kliponline.com';

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
  return data.result[0].results || data.result[0].meta;
}

async function uploadToR2(targetKey, buffer, contentType) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}/objects/${encodeURIComponent(targetKey)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${r2Token}`,
      'Content-Type': contentType,
    },
    body: buffer,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`R2 upload failed: HTTP ${res.status}: ${errText}`);
  }
  return `https://${r2Domain}/${targetKey}`;
}

async function main() {
  const exportPath = 'c:/Users/ilanl/Downloads/gevaldig-portal-default-rtdb-export (1).json';
  const data = JSON.parse(fs.readFileSync(exportPath, 'utf8'));

  console.log('=== 1. MIGRATING AVATARS TO R2 ===');
  const user1 = data.users['Vv07KRa2ikezHe42muBzRwOO0Gj1'];
  let user1AvatarR2 = '';
  if (user1 && user1.AvatarUrl && user1.AvatarUrl.startsWith('https://firebasestorage')) {
    console.log('Downloading exploringcultureLDN avatar from Firebase Storage...');
    const imgRes = await fetch(user1.AvatarUrl);
    if (imgRes.ok) {
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const r2Key = `avatars/Vv07KRa2ikezHe42muBzRwOO0Gj1_1794345715.jpg`;
      user1AvatarR2 = await uploadToR2(r2Key, buf, 'image/jpeg');
      console.log('Uploaded to R2:', user1AvatarR2);
    }
  }

  console.log('\n=== 2. INSERTING NEW USERS INTO D1 ===');
  const now = Math.floor(Date.now() / 1000);

  // exploringcultureLDN
  if (user1) {
    console.log('Inserting @exploringcultureLDN...');
    await executeD1(
      `INSERT INTO users (
        uid, handle, display_name, email, initials, bio, avatar_url,
        gender, is_male, can_post, followers_count, following_count,
        shkoyach_count, likes_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(uid) DO UPDATE SET
        handle = excluded.handle,
        display_name = excluded.display_name,
        email = excluded.email,
        avatar_url = excluded.avatar_url,
        updated_at = excluded.updated_at;`,
      [
        user1.Uid,
        user1.Handle || '@exploringcultureLDN',
        user1.DisplayName || 'Exploring Culture London',
        user1.Email || 'exploringcultureldn@gmail.com',
        user1.Initials || 'EC',
        user1.Bio || 'Sharing Jewish life & simchas on Klip ✡',
        user1AvatarR2 || user1.AvatarUrl || '',
        user1.Gender || 'Male',
        1,
        1,
        0,
        0,
        0,
        0,
        now,
        now
      ]
    );
    console.log('Inserted @exploringcultureLDN successfully!');
  }

  // Akiva Schechter
  const user2 = data.users['p758n3qIejfeIC88MUOKGlani2k1'];
  if (user2) {
    console.log('Inserting @Akiva801...');
    await executeD1(
      `INSERT INTO users (
        uid, handle, display_name, email, initials, bio, avatar_url,
        gender, is_male, can_post, followers_count, following_count,
        shkoyach_count, likes_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(uid) DO UPDATE SET
        handle = excluded.handle,
        display_name = excluded.display_name,
        email = excluded.email,
        updated_at = excluded.updated_at;`,
      [
        user2.Uid,
        user2.Handle || '@Akiva801',
        user2.DisplayName || 'Akiva Schechter',
        user2.Email || 'akiva801@gmail.com',
        user2.Initials || 'AS',
        user2.Bio || 'Sharing Jewish life & simchas on Klip ✡',
        user2.AvatarUrl || '',
        user2.Gender || 'Male',
        1,
        1,
        0,
        0,
        0,
        0,
        now,
        now
      ]
    );
    console.log('Inserted @Akiva801 successfully!');
  }

  console.log('\n=== 3. MIGRATING NEW KLIP TO CLOUDFLARE STREAM ===');
  const klipId = '355ac9f304004b9ab4f679fb25ded634';
  const newKlip = data.klips[klipId];
  if (newKlip) {
    console.log('Found new Klip:', klipId, newKlip.Caption);
    console.log('Calling Cloudflare Stream /copy API...');
    const streamCopyRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/copy`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: newKlip.VideoUrl,
        meta: {
          name: `${newKlip.Caption || 'Akiva Concert'} (${klipId})`,
          klipId: klipId,
          creatorUid: newKlip.CreatorUid
        }
      })
    });
    const streamCopyData = await streamCopyRes.json();
    console.log('Stream Copy Response:', streamCopyData.success, streamCopyData.result?.uid);

    let cfUid = streamCopyData.result?.uid || '';
    let playbackUrl = cfUid ? `https://${customerSubdomain}/${cfUid}/manifest/video.m3u8` : '';
    let thumbnailUrl = cfUid ? `https://${customerSubdomain}/${cfUid}/thumbnails/thumbnail.jpg` : '';

    console.log('\n=== 4. INSERTING NEW KLIP INTO D1 ===');
    const tagsJson = JSON.stringify(newKlip.Tags || ['#Simcha', '#Torah', '#Niggun', '#Kosher']);
    await executeD1(
      `INSERT INTO klips (
        id, creator_uid, creator_handle, creator_initials, creator_avatar_url,
        caption, tags, video_url, watermarked_video_url, thumbnail_url,
        photo_urls, video_provider, cloudflare_video_id, playback_url, playback_status,
        sound_id, sound_title, sound_audio_url, sound_start_time, sound_end_time,
        is_female_only, audience, gender, color_hex,
        likes_count, views_count, bookmarks_count, comments_count, shares_count,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        playback_url = excluded.playback_url,
        cloudflare_video_id = excluded.cloudflare_video_id,
        thumbnail_url = excluded.thumbnail_url;`,
      [
        klipId,
        newKlip.CreatorUid || 'p758n3qIejfeIC88MUOKGlani2k1',
        newKlip.CreatorHandle || '@Akiva801',
        newKlip.CreatorInitials || 'AS',
        newKlip.CreatorAvatarUrl || '',
        newKlip.Caption || '',
        tagsJson,
        playbackUrl || newKlip.VideoUrl || '',
        '',
        thumbnailUrl || '',
        '[]',
        'cloudflare',
        cfUid,
        playbackUrl,
        'ready',
        newKlip.SoundId || `sound_${klipId}`,
        newKlip.SoundTitle || 'Original Sound - @Akiva801',
        newKlip.SoundAudioUrl || '',
        0,
        0,
        0,
        'general',
        'Male',
        '#1E293B',
        0,
        Number(newKlip.ViewsCount || 0),
        0,
        0,
        '0',
        Number(newKlip.CreatedAtUnix || now),
        now
      ]
    );
    console.log('Inserted Klip into D1 successfully!');
  }

  console.log('\n=== 5. VERIFYING COUNTS IN D1 ===');
  const d1UserCount = await executeD1('SELECT COUNT(*) as c FROM users;');
  console.log('Total D1 Users count:', d1UserCount[0]?.c);
  const d1KlipCount = await executeD1('SELECT COUNT(*) as c FROM klips;');
  console.log('Total D1 Klips count:', d1KlipCount[0]?.c);
}

main().catch(console.error);
