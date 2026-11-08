// Tyro-Shelf storage screen (the idea is from Playnite's Storage diagnostics; written from scratch): every installed game with its
// size, where it comes from and where it lives, per drive, with how much of the drive the games, other files and free space take.
// Sizes Steam, Legendary and the shelf already know are used as they are; other folders are measured once (a background walk,
// at most 25 s each) and remembered for a day.
const fs = require('fs');
const path = require('path');

let file = '', memo = null;
function init(dir) { file = path.join(dir, 'storage-sizes.json'); }
const load = () => { if (memo) return memo; try { memo = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { memo = {}; } return memo; };
const save = () => { try { fs.writeFileSync(file, JSON.stringify(memo || {})); } catch {} };

async function dirSize(root, ms = 25000) {
  const t0 = Date.now(); let total = 0, n = 0; const stack = [root];
  while (stack.length) {
    if (Date.now() - t0 > ms || n > 600000) return { size: total, partial: true };
    const d = stack.pop(); let ents; try { ents = await fs.promises.readdir(d, { withFileTypes: true }); } catch { continue; }
    await Promise.all(ents.map(async e => { n++; const p = path.join(d, e.name); if (e.isDirectory()) { if (!e.isSymbolicLink()) stack.push(p); } else if (e.isFile()) { try { total += (await fs.promises.stat(p)).size; } catch {} } }));
  }
  return { size: total, partial: false };
}
const driveOf = p => { const m = /^([A-Za-z]:)/.exec(String(p || '')); return m ? m[1].toUpperCase() + '\\' : ''; };

// games: [{ id, name, source, dir, size? (bytes when already known), isFile? }]
async function scan(games, force) {
  const mem = load(), out = [], todo = [];
  for (const g of games) {
    if (!g.dir) continue;
    const e = { id: g.id, name: g.name, source: g.source, dir: g.dir, size: g.size > 0 ? g.size : null, drive: driveOf(g.dir) };
    if (e.size == null) { const m = mem[g.dir]; if (m && !force && Date.now() - m.at < 24 * 3600e3) e.size = m.size; else todo.push(e); }
    out.push(e);
  }
  let i = 0;
  const worker = async () => { while (i < todo.length) { const e = todo[i++]; let r; try { r = e.isFileDir ? null : await dirSize(e.dir); } catch { r = null; } if (r) { e.size = r.size; mem[e.dir] = { size: r.size, at: Date.now() }; } } };
  await Promise.all([worker(), worker(), worker()]); if (todo.length) save();
  // drives that hold games (plus the system drive)
  const letters = [...new Set(out.map(e => e.drive).filter(Boolean).concat(process.platform === 'win32' ? ['C:\\'] : []))].sort();
  const drives = [];
  for (const root of letters) {
    try { const s = await fs.promises.statfs(root); const total = s.blocks * s.bsize, free = s.bavail * s.bsize; let label = ''; drives.push({ root, total, free, games: out.filter(e => e.drive === root).reduce((a, e) => a + (e.size || 0), 0), label }); } catch {}
  }
  out.sort((a, b) => (b.size || 0) - (a.size || 0));
  return { entries: out, drives };
}
module.exports = { init, scan };
