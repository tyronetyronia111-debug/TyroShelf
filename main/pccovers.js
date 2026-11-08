// (beta.5) Choosing a PC game's cover: Steam, Epic, Quiver and games added by hand (console games have the Art Studio).
// The options: SteamGridDB's posters (with the player's own SteamGridDB key, Settings → Accounts & services), Steam's own
// cover for a Steam game, and a picture of your own. The chosen one is kept as data\pc-covers\<game id>.<ext> and wins over
// every automatic cover (cover(id)); Reset goes back to the automatic one.
// The page may only show local files, so the posters' thumbnails are fetched here into data\pc-cover-cache (by address,
// a few at a time) and handed back as bsfile: addresses. The page only ever names a game id and an option's key: the
// addresses stay here (last options per game).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let o = { dataDir: '', log: () => {} };
const EXTS = ['jpg', 'png', 'webp'];
const safeId = id => String(id || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 120);
const PARTS = ['front', 'back', 'spine'], partOf = x => PARTS.includes(x) ? x : 'front';
const dir = () => path.join(o.dataDir, 'pc-covers'), cacheDir = () => path.join(o.dataDir, 'pc-cover-cache');
const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const sha = s => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 24);
const extOf = (u, buf) => { if (buf && buf[0] === 0x89 && buf[1] === 0x50) return 'png'; if (buf && buf.slice(8, 12).toString() === 'WEBP') return 'webp'; const m = /\.(png|webp|jpe?g)(?:$|\?)/i.exec(String(u || '')); return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg'; };

function init(opts) { o = Object.assign(o, opts || {}); }

// the chosen cover of a game, or null
function cover(id, part) { const b = path.join(dir(), safeId(id) + (partOf(part) === 'front' ? '' : '__' + part)); for (const e of EXTS) if (isFile(b + '.' + e)) return b + '.' + e; return null; }
function clear(id, part) { const b = path.join(dir(), safeId(id) + (partOf(part) === 'front' ? '' : '__' + part)); for (const e of EXTS) { try { fs.unlinkSync(b + '.' + e); } catch {} } }
async function save(id, buf, ext, part) {
  fs.mkdirSync(dir(), { recursive: true });
  const dest = path.join(dir(), safeId(id) + (partOf(part) === 'front' ? '' : '__' + part) + '.' + ext), tmp = dest + '.tmp';
  await fs.promises.writeFile(tmp, buf); clear(id, part); await fs.promises.rename(tmp, dest); if (o.placed) try { o.placed(dest); } catch {} return dest;
}

// a thumbnail, fetched once into the cache (three at a time); null when it couldn't be fetched
let slots = 3; const waiting = [];
async function slot(fn) { if (slots > 0) slots--; else await new Promise(r => waiting.push(r)); try { return await fn(); } finally { const n = waiting.shift(); if (n) n(); else slots++; } }
async function thumb(url) {
  if (!url) return null;
  const f = path.join(cacheDir(), sha(url));
  for (const e of EXTS) if (isFile(f + '.' + e)) return f + '.' + e;
  return slot(async () => { const b = await o.fetchImage(url); if (!b) return null; fs.mkdirSync(cacheDir(), { recursive: true }); const p = f + '.' + extOf(url, b); await fs.promises.writeFile(p, b); return p; });
}

// the options for one game: { list: [{ key, thumb, source, label, sub }], sgdb: has a SteamGridDB key, current: chosen? }
const last = new Map(); // game id → { key → full address }
async function options(game, part) {
  part = partOf(part);
  const id = String(game.id), keys = {}, list = [];
  const mine = cover(id, part); if (mine) list.push({ key: 'current', thumb: o.fileUrl(mine), source: 'yours', label: 'Your choice now', sub: 'Chosen before' });
  if (part === 'front' && game.appid) { const s = o.steamCover(game.appid); if (s) { keys.steam = { file: s }; list.push({ key: 'steam', thumb: o.fileUrl(s), source: 'steam', label: "Steam's cover", sub: 'From your Steam library' }); } }
  const sgdb = !!(o.steamgrid && o.steamgrid.enabled && o.steamgrid.enabled()) && part !== 'spine'; // (SteamGridDB has no spines: a spine is a picture of yours)
  if (sgdb) {
    let posters = [];
    try { posters = await o.steamgrid.posters(game.appid ? { appid: game.appid, title: game.title } : { title: game.title, names: [game.title] }, o.match, { animated: true }); } catch (e) { o.log('PC cover: SteamGridDB', e.message); }
    const got = await Promise.all([...posters.filter(p => !p.anim).slice(0, 20), ...posters.filter(p => p.anim).slice(0, 8)].map(async (p, i) => ({ p, i, t: await thumb(p.thumbUrl || p.url) })));
    for (const { p, i, t } of got) { if (!t) continue; const k = 'sg' + i; keys[k] = { url: p.url }; list.push({ key: k, anim: !!p.anim, thumb: o.fileUrl(t), source: 'steamgriddb', label: (p.anim ? 'SteamGridDB · Animated' : 'SteamGridDB') + (p.styleName ? ` · ${p.styleName}` : ''), sub: p.author ? 'by ' + p.author : '' }); }
  }
  last.set(id + '|' + part, keys);
  return { list, sgdb, current: !!mine };
}
// use one of the last options (by key) as the game's cover
async function use(id, key, part) {
  id = String(id); part = partOf(part); const k = (last.get(id + '|' + part) || {})[String(key || '')]; if (!k) throw new Error('That cover isn\'t in the list any more. Open the picker again.');
  let buf = null, ext = 'jpg';
  if (k.file) { buf = await fs.promises.readFile(k.file); ext = extOf(k.file, buf); }
  else if (k.url) { buf = await o.fetchImage(k.url); if (!buf) throw new Error("Couldn't download that cover. Check the connection and try again."); ext = extOf(k.url, buf); }
  const dest = await save(id, buf, ext, part); o.log('PC ' + part + ' chosen:', id, key.startsWith('sg') ? 'SteamGridDB' : key); return dest;
}
// a picture of your own (a file the player picked in the dialog)
async function own(id, file, part) {
  const ext = String(path.extname(file)).slice(1).toLowerCase().replace('jpeg', 'jpg'); if (!EXTS.includes(ext)) throw new Error('Pick a JPG, PNG or WebP picture.');
  const st = await fs.promises.stat(file); if (st.size > 25e6) throw new Error('That picture is too big (over 25 MB).');
  return save(String(id), await fs.promises.readFile(file), ext, part);
}

module.exports = { init, cover, options, use, own, reset: (id, part) => clear(String(id), part), PARTS };
