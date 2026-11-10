import fs from 'node:fs';

const content = fs.readFileSync('js/firebase.js', 'utf8');

const methodRegex = /async\s+([a-zA-Z0-9_]+)\s*\([^)]*\)\s*\{/g;
let match;
const methodNames = [];
while ((match = methodRegex.exec(content)) !== null) {
  methodNames.push({ name: match[1], index: match.index });
}

console.log(`Found ${methodNames.length} async methods in js/firebase.js.`);

const results = [];
for (let i = 0; i < methodNames.length; i++) {
  const current = methodNames[i];
  const nextIndex = i + 1 < methodNames.length ? methodNames[i + 1].index : content.length;
  const body = content.slice(current.index, nextIndex);

  const callsCfApi = body.includes('/api/');
  const callsDbFetch = body.includes('this._dbFetch') || body.includes('_dbFetch(');
  const callsStorage = body.includes('firebasestorage');
  const callsR2 = body.includes('_r2UploadAsync') || body.includes('/api/storage/upload');
  const callsAuth = body.includes('identitytoolkit.googleapis.com') || body.includes('securetoken.googleapis.com');

  results.push({
    name: current.name,
    callsCfApi,
    callsDbFetch,
    callsStorage,
    callsR2,
    callsAuth
  });
}

console.log('Method Breakdown:');
for (const r of results) {
  const tags = [];
  if (r.callsCfApi) tags.push('Cloudflare D1/Stream API');
  if (r.callsR2) tags.push('Cloudflare R2');
  if (r.callsDbFetch) tags.push('RTDB (_dbFetch)');
  if (r.callsStorage) tags.push('Firebase Storage');
  if (r.callsAuth) tags.push('Firebase Auth');
  console.log(`- ${r.name}: ${tags.join(', ') || 'Internal / Local'}`);
}

