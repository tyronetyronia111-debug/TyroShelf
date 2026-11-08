// Tyro-Shelf download manager for Epic games (the idea is from Playnite's Unified Download Manager add-on, MIT; written from
// scratch). A queue of `legendary install` runs, one at a time: each shows its progress, speed and time left, and can be paused
// (the process stops; Legendary keeps what it downloaded and carries on when resumed), stopped, moved or removed.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

let log = () => {}, legendary = null, file = '', onChange = () => {}, onDone = () => {}, items = [], cur = null, child = null, seq = 0;
function init(o) { log = o.log || log; legendary = o.legendary; file = path.join(o.dir, 'downloads.json'); onChange = o.onChange || onChange; onDone = o.onDone || onDone; load(); }
function load() { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); items = (Array.isArray(j) ? j : []).slice(-200).map(i => ({ ...i, status: i.status === 'running' ? 'paused' : i.status, speed: 0, eta: '' })); seq = items.reduce((m, i) => Math.max(m, +i.id || 0), 0); } catch { items = []; } }
let saveT = null;
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(items)); } catch {} }, 400); };
const push = () => { save(); try { onChange(list()); } catch {} };
const list = () => items.map(i => ({ ...i }));

const goodApp = a => /^[\w.-]{1,120}$/.test(String(a || ''));
const goodDir = d => typeof d === 'string' && d.length > 2 && d.length < 500 && !/[<>"|?*\x00-\x1f]/.test(d.replace(/^[A-Za-z]:/, ''));

// the room on the drive that holds dir (its nearest folder that exists)
async function freeSpace(dir) {
  let d = path.resolve(String(dir || '.'));
  for (let i = 0; i < 12 && !fs.existsSync(d); i++) d = path.dirname(d);
  try { const s = await fs.promises.statfs(d); return { free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch { return { free: null, total: null }; }
}
async function info({ app, dir }) {
  if (!goodApp(app)) throw new Error('Unknown game.');
  const [sz, sp] = await Promise.all([legendary.sizes(app), freeSpace(dir)]);
  return { download: sz.download, install: sz.install, free: sp.free };
}

function add({ app, title, dir, opts }) {
  if (!goodApp(app)) throw new Error('Unknown game.');
  if (!goodDir(dir)) throw new Error('Choose a folder to install into.');
  if (!legendary.find()) throw new Error('Legendary was not found (Settings → PC).');
  if (items.some(i => i.app === app && ['queued', 'running', 'paused'].includes(i.status))) throw new Error('That game is already in the download manager.');
  const o = opts || {}, n = v => Math.max(0, Math.min(64, parseInt(v, 10) || 0));
  const it = { id: String(++seq), app, title: String(title || app).slice(0, 120), dir: String(dir), status: 'queued', pct: 0, downloaded: '', speed: 0, eta: '', size: +o.size || 0, dlSize: +o.dlSize || 0, added: Date.now(), completed: 0, error: '',
    opts: { dlcs: o.dlcs === true, ignoreSpace: o.ignoreSpace === true, reorder: o.reorder === true, workers: n(o.workers), memory: Math.max(0, Math.min(65536, parseInt(o.memory, 10) || 0)) } };
  items.push(it); push(); pump(); return it.id;
}
const find = id => items.find(i => i.id === String(id));

function pump() {
  if (cur) return;
  const it = items.find(i => i.status === 'queued'); if (!it) return;
  const exe = legendary.find(); if (!exe) { it.status = 'error'; it.error = 'Legendary was not found.'; return push(); }
  const a = ['install', it.app, '--base-path', it.dir, '-y', it.opts.dlcs ? '--with-dlcs' : '--skip-dlcs'];
  if (it.opts.ignoreSpace) a.push('--ignore-free-space'); if (it.opts.reorder) a.push('--enable-reordering');
  if (it.opts.workers) a.push('--max-workers', String(it.opts.workers)); if (it.opts.memory) a.push('--max-shared-memory', String(it.opts.memory));
  try { fs.mkdirSync(it.dir, { recursive: true }); } catch {}
  it.status = 'running'; it.error = ''; cur = it; push(); log('Download manager: starting', it.app);
  let tail = '';
  try { child = spawn(exe, a.filter(Boolean), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }); } catch (e) { it.status = 'error'; it.error = e.message; cur = null; child = null; push(); return pump(); }
  const feed = buf => {
    const t = String(buf); tail = (tail + t).slice(-600);
    for (const line of t.split(/\r?\n/)) {
      let m;
      if ((m = /Progress:\s*([\d.]+)%.*?ETA:\s*([\d:]+)/.exec(line))) { it.pct = Math.min(100, +m[1]); it.eta = m[2]; }
      if ((m = /Downloaded:\s*([\d.]+\s*\w+)/.exec(line))) it.downloaded = m[1];
      if ((m = /Download\s*-\s*([\d.]+)\s*(\w+)\/s/.exec(line))) it.speed = (+m[1]) * ({ B: 1, KiB: 1024, MiB: 1048576, GiB: 1073741824 }[m[2]] || 1);
    }
    throttle();
  };
  child.stdout.on('data', feed); child.stderr.on('data', feed);
  const me = child;
  child.on('error', e => { if (child !== me) return; it.status = 'error'; it.error = e.message; end(); });
  child.on('exit', code => {
    if (child !== me) return;
    if (it.status === 'running') { if (code === 0) { it.status = 'done'; it.pct = 100; it.completed = Date.now(); it.eta = ''; it.speed = 0; try { onDone(it); } catch {} } else { it.status = 'error'; it.error = (tail.replace(/\s+/g, ' ').match(/(?:ERROR|CRITICAL)[^]*$/) || [tail.replace(/\s+/g, ' ')])[0].slice(-200).trim() || ('Legendary stopped (code ' + code + ')'); } }
    end();
  });
}
let thr = 0; const throttle = () => { const n = Date.now(); if (n - thr > 700) { thr = n; push(); } };
function end() { cur = null; child = null; push(); setTimeout(pump, 300); }
const killChild = () => { if (!child) return; const pid = child.pid; if (process.platform === 'win32' && pid) { try { const k = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); k.on('error', () => {}); } catch {} } else { try { child.kill('SIGTERM'); } catch {} } };

function pause(id) { const it = find(id); if (!it) return; if (it.status === 'running') { it.status = 'paused'; it.speed = 0; it.eta = ''; killChild(); } else if (it.status === 'queued') it.status = 'paused'; push(); }
function resume(id) { const it = find(id); if (!it || !['paused', 'error', 'canceled'].includes(it.status)) return; it.status = 'queued'; it.error = ''; push(); pump(); }
function stop(id) { const it = find(id); if (!it) return; const was = it.status; if (['running', 'queued', 'paused'].includes(was)) { it.status = 'canceled'; it.speed = 0; it.eta = ''; if (was === 'running') killChild(); } push(); }
function remove(id) { const it = find(id); if (!it) return; if (it.status === 'running') { it.status = 'canceled'; killChild(); } items = items.filter(i => i !== it); push(); }
function move(id, d) { const i = items.findIndex(x => x.id === String(id)); const j = i + d; if (i < 0 || j < 0 || j >= items.length) return; [items[i], items[j]] = [items[j], items[i]]; push(); }
function clearDone() { items = items.filter(i => !['done', 'canceled'].includes(i.status)); push(); }
function stopAll() { for (const it of items) if (it.status === 'running') { it.status = 'paused'; killChild(); } }
module.exports = { init, list, info, add, pause, resume, stop, remove, move, clearDone, stopAll, freeSpace };
