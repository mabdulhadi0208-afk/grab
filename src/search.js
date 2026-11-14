'use strict';
// Fast in-memory ranking over the catalog. Items: { id, name, desc, boost }.

function norm(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, ''); }
function squash(s) { return norm(s).replace(/[^a-z0-9]+/g, ''); }

function prepare(items) {
  for (const it of items) {
    it._n = norm(it.name);
    it._ns = squash(it.name);
    it._i = norm(it.id);
    it._is = squash(it.id);
    it._d = norm(it.desc);
    it._a = norm(it.aka);
    it._as = it._a ? it._a.split('|').map(squash).filter(Boolean) : [];
  }
  return items;
}

function score(it, q, qs, words) {
  let s = 0;
  if (it._n === q || it._ns === qs) s += 1000;
  else if (it._is === qs || it._i === q) s += 900;
  else if (it._as.includes(qs)) s += 800;
  else if (it._n.startsWith(q) || it._ns.startsWith(qs)) s += 500 - Math.min(200, it._n.length);
  else if (it._i.startsWith(q) || it._is.startsWith(qs)) s += 400 - Math.min(200, it._i.length);
  else if (it._as.some(a => a.startsWith(qs))) s += 420;
  else if (qs.length >= 2 && (it._ns.includes(qs) || it._is.includes(qs))) s += 250 - Math.min(150, it._n.length);
  else {
    // every word must appear somewhere
    let hit = 0;
    for (const w of words) {
      if (it._n.includes(w)) hit += 3;
      else if (it._a.includes(w)) hit += 2;
      else if (it._i.includes(w)) hit += 2;
      else if (w.length >= 3 && it._d.includes(w)) hit += 1;
      else return 0;
    }
    s += 40 + hit * 10;
  }
  // prefer stable/canonical entries over @beta, nightly, previews
  if (/[@](beta|nightly|dev|canary|preview|alpha|insider|edge)/.test(it._i) || /\.(beta|nightly|dev|canary|preview|insiders?)$/.test(it._i)) s -= 120;
  if (it.boost) s += it.boost;
  if (it.deprecated) s -= 300;
  return s;
}

function search(items, query, limit = 60) {
  const q = norm(query).trim();
  if (!q) return [];
  const qs = squash(q);
  const words = q.split(/\s+/).filter(Boolean);
  const res = [];
  for (const it of items) {
    const s = score(it, q, qs, words);
    if (s > 0) res.push([s, it]);
  }
  res.sort((a, b) => b[0] - a[0] || a[1].name.length - b[1].name.length);
  return res.slice(0, limit).map(r => r[1]);
}

module.exports = { prepare, search, norm };
