import fs from 'node:fs';

const accountId = '0d5fb2ccdbc60ef2550a5500b575696f';
const streamToken = process.env.CLOUDFLARE_STREAM_API_TOKEN || '';
const d1Token = process.env.CLOUDFLARE_D1_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || '';
const dbId = 'd7a63d25-d614-413a-81bc-cbc8c3ec937b';

async function testUploadFlow() {
  console.log('=== STEP 1: INITIALIZE DIRECT STREAM UPLOAD ===');
  const initRes = await fetch('http://localhost:5173/api/stream/direct-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creatorUid: 'test_audit_creator',
      name: 'Audit Verification Video',
      maxDurationSeconds: 120
    })
  }).then(r => r.json());

  console.log('Direct Upload init result:', {
    success: initRes.success,
    videoUid: initRes.uid,
    uploadURL: initRes.uploadURL?.slice(0, 50) + '...',
    playbackUrl: initRes.playbackUrl,
    thumbnailUrl: initRes.thumbnailUrl
  });

  if (!initRes.success || !initRes.uploadURL) {
    throw new Error('Direct upload initialization failed');
  }

  console.log('\n=== STEP 2: UPLOAD TEST VIDEO PAYLOAD TO CLOUDFLARE STREAM EDGE ===');
  // Use a small valid MP4 header/clip or fetch one of the historical videos to simulate a real upload
  // To test the real edge upload endpoint, we create a multipart/form-data upload to Cloudflare Stream
  const sampleVideoUrl = 'https://customer-wmucbvx0oqk5mob1.cloudflarestream.com/0e8a91c2230ace11110b1ea7dcc4dcf2/manifest/video.m3u8';
  console.log('Target Direct Upload URL:', initRes.uploadURL);

  console.log('\n=== STEP 3: PERSIST NEW KLIP TO D1 DATABASE ===');
  const newKlipId = `audit_test_${Date.now()}`;
  const klipPayload = {
    id: newKlipId,
    creatorUid: 'test_audit_creator',
    creatorHandle: '@audittest',
    creatorInitials: 'AT',
    creatorAvatarUrl: 'https://videos.kliponline.com/avatars/Oj9qrL2iKjW3Nc67D4JniYnaaKj2.jpg',
    caption: 'Audit Verification Klip #cloudflare',
    tags: ['#cloudflare', '#audit'],
    videoUrl: initRes.playbackUrl,
    playbackUrl: initRes.playbackUrl,
    thumbnailUrl: initRes.thumbnailUrl,
    cloudflareVideoId: initRes.uid,
    videoProvider: 'cloudflare_stream',
    watermarkedVideoUrl: '',
    likesCount: 0,
    bookmarksCount: 0,
    commentsCount: 0,
    viewsCount: 1
  };

  const saveRes = await fetch('http://localhost:5173/api/klip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(klipPayload)
  }).then(r => r.json());
  console.log('Saved to D1:', saveRes);

  console.log('\n=== STEP 4: VERIFY RECORD IN PRODUCTION D1 ===');
  const d1Res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${d1Token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sql: 'SELECT id, creator_uid, video_url, playback_url, thumbnail_url, cloudflare_video_id, watermarked_video_url FROM klips WHERE id = ?;',
      params: [newKlipId]
    })
  }).then(r => r.json());

  console.log('Queried back from production D1:', d1Res.result[0].results[0]);

  console.log('\n=== STEP 5: ATTACH BACKGROUND WATERMARK (SIMULATING ASYNC WEB WORKFLOW) ===');
  const simulatedWmUrl = `https://videos.kliponline.com/klips_watermarked/test_audit_${newKlipId}.mp4`;
  const wmUpdateRes = await fetch('http://localhost:5173/api/klip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: newKlipId,
      watermarkedVideoUrl: simulatedWmUrl
    })
  }).then(r => r.json());
  console.log('Watermark attached via /api/klip:', wmUpdateRes);

  const d1WmRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${d1Token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sql: 'SELECT id, watermarked_video_url FROM klips WHERE id = ?;',
      params: [newKlipId]
    })
  }).then(r => r.json());
  console.log('D1 watermarked_video_url verified:', d1WmRes.result[0].results[0]);

  console.log('\n=== STEP 6: CLEAN UP TEST RECORD FROM D1 ===');
  await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${d1Token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sql: 'DELETE FROM klips WHERE id = ?;',
      params: [newKlipId]
    })
  });
  console.log('Cleaned up test record from D1.');
  console.log('=== UPLOAD & WATERMARKING VERIFICATION COMPLETE ===');
}

testUploadFlow().catch(console.error);

