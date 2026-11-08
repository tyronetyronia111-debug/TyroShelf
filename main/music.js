// Your own background music: audio files (mp3, ogg, wav, flac, m4a, opus) in <Boxshelf folder>\Music\ (sub-folders too).
// The Songs folder is looked in as well, so files dropped there before still count. The shelf plays them as its menu music
// (Settings → Sound → Menu music → Your music); this side only lists the folders and hands over the bytes of one file.
const path = require('path');
const fs = require('fs');
const { appRoot } = require('./paths');

const MAX_FILES = 500, MAX_BYTES = 120 << 20;
const EXT = /\.(mp3|ogg|oga|opus|wav|flac|m4a|aac|weba)$/i;
const DIRS = ['Music', 'Songs'];
const folder = () => path.join(appRoot(), DIRS[0]);
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

function list() {
  const out = [];
  for (const d of DIRS) {
    const root = path.join(appRoot(), d);
    if (d === DIRS[0]) { try { fs.mkdirSync(root, { recursive: true }); } catch {} }
    const walk = (dir, depth) => {
      let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      ents.sort((a, b) => natural(a.name, b.name));
      for (const e of ents) {
        if (out.length >= MAX_FILES || e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (depth < 3) walk(full, depth + 1); }
        else if (EXT.test(e.name)) out.push({ name: e.name.replace(EXT, '').replace(/[_]+/g, ' ').trim(), file: path.join(d, path.relative(root, full)) });
      }
    };
    walk(root, 0);
  }
  return out;
}
// file is as list() gives it (Music\… or Songs\…); never a path outside those folders
function read(file) {
  const full = path.resolve(appRoot(), String(file || ''));
  const ok = DIRS.some(d => { const root = path.join(appRoot(), d); return full.startsWith(root + path.sep); });
  if (!ok || !EXT.test(full)) throw new Error('Not a music file in the Music folder.');
  const st = fs.statSync(full); if (st.size > MAX_BYTES) throw new Error('That music file is too big.');
  return fs.readFileSync(full);
}
module.exports = { folder, list, read };
