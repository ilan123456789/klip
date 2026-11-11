async function searchCommons(query) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=20&gsrsearch=${encodeURIComponent(query)}&prop=imageinfo&iiprop=url|mime|size`;
  const res = await fetch(url, { headers: { "User-Agent": "KlipBot/1.0" } });
  const data = await res.json();
  const pages = data.query?.pages || {};
  const results = [];
  for (const p of Object.values(pages)) {
    const info = p.imageinfo?.[0];
    if (info && info.url && (info.mime === "image/jpeg" || info.mime === "image/png")) {
      results.push({ title: p.title, url: info.url });
    }
  }
  return results;
}

const hasidic = await searchCommons("Hasidic man");
console.log("Hasidic man results:", hasidic.slice(0, 5));

const rabbi = await searchCommons("Rabbi portrait");
console.log("Rabbi portrait results:", rabbi.slice(0, 5));

const kotel = await searchCommons("Western wall praying man");
console.log("Western wall praying results:", kotel.slice(0, 5));

