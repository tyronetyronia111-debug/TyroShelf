// Tyro-Shelf: Epic Games through Legendary (https://github.com/derrod/legendary, GPL-3.0; the fork by hawkeye116477 is what
// the Playnite plugin uses). Legendary is a command line program: it signs in to Epic, lists what is installed and starts a game
// with the sign-in Epic wants, without the Epic Games Launcher running. Nothing of it is bundled: Settings can download its
// exe from GitHub (GitHub hosts only) or use one you already have. Sign-in is yours: the code from Epic's login page is
// handed to `legendary auth --code`; Tyro-Shelf never sees or stores your password or token (Legendary keeps them in
// ~/.config/legendary).
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execFile } = require('child_process');

let log = () => {}, dir = '', custom = '';
function init(logger, dataDir) { if (logger) log = logger; dir = dataDir || ''; }
const setPath = p => { custom = String(p || ''); };
const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const exeName = process.platform === 'win32' ? 'legendary.exe' : 'legendary';
// where Legendary keeps user.json / installed.json: its own setting, ~/.config/legendary, or (other builds) the app-data folders
function cfgDirs() { const e = process.env, l = [e.LEGENDARY_CONFIG_PATH, path.join(os.homedir(), '.config', 'legendary'), e.APPDATA && path.join(e.APPDATA, 'legendary'), e.LOCALAPPDATA && path.join(e.LOCALAPPDATA, 'legendary'), e.XDG_CONFIG_HOME && path.join(e.XDG_CONFIG_HOME, 'legendary')]; return l.filter(Boolean); }
function cfgDir() { const l = cfgDirs(); for (const f of ['user.json', 'installed.json']) { const d = l.find(x => isFile(path.join(x, f))); if (d) return d; } return l[0]; }

// the exe to use: the one chosen in Settings, the one Tyro-Shelf downloaded, one on PATH
function find() {
  const c = [];
  if (custom) c.push(custom, path.join(custom, exeName));
  if (dir) c.push(path.join(dir, exeName));
  for (const d of String(process.env.PATH || '').split(path.delimiter)) if (d) c.push(path.join(d, exeName));
  return c.find(isFile) || '';
}
const run = (args, ms = 30000) => new Promise(res => {
  const exe = find(); if (!exe) return res({ ok: false, out: 'Legendary was not found.' });
  try { execFile(exe, args, { windowsHide: true, timeout: ms, maxBuffer: 16 << 20, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }, (err, so, se) => res({ ok: !err, out: String(so || '') + String(se || ''), stdout: String(so || '') })); } catch (e) { res({ ok: false, out: e.message }); }
});

// installed.json: { <app_name>: { title, install_path, executable, launch_parameters, is_dlc, ... } }
function installed() {
  let j; try { j = JSON.parse(fs.readFileSync(path.join(cfgDir(), 'installed.json'), 'utf8').replace(/^﻿/, '')); } catch { return []; }
  const out = [];
  for (const [k, v] of Object.entries(j || {})) {
    if (!v || typeof v !== 'object' || v.is_dlc) continue;
    const app = String(v.app_name || k), title = String(v.title || '').trim(), base = String(v.install_path || '');
    if (!app || !title || !base) continue;
    try { if (!fs.statSync(base).isDirectory()) continue; } catch { continue; }
    out.push({ app, title, exe: v.executable ? path.join(base, String(v.executable).replace(/\//g, path.sep)) : '', args: String(v.launch_parameters || '').slice(0, 1000) });
  }
  return out;
}
// signed in? user.json is what Legendary writes after a successful login; `status` only adds the account name
async function status() {
  const exe = find(); if (!exe) return { found: false };
  let signedIn = signedInFile(); log('Legendary status: exe', exe, '| config', cfgDir(), '| signed in', signedIn);
  let acct = '';
  if (true) { const r = await run(['status', '--json', '--offline'], 20000); try { acct = String(JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))).account || ''); } catch {} if (/not logged|^<.*>$/i.test(acct)) acct = ''; }
  return { found: true, exe, signedIn: signedIn || !!acct, account: acct };
}
const authCode = async code => {
  code = String(code || '').trim().replace(/^"|"$/g, '');
  const m = /"(?:authorizationCode|sid)"\s*:\s*"([^"]+)"/.exec(code); if (m) code = m[1]; // the whole page's answer pasted
  if (!/^[\w-]{16,128}$/.test(code)) return { ok: false, error: 'That does not look like the code from Epic\'s page.' };
  const r = await run(['auth', '--code', code], 60000);
  log('Legendary auth:', r.ok ? 'ok' : 'failed', String(r.out).replace(/\s+/g, ' ').slice(0, 300));
  return r.ok ? { ok: true } : { ok: false, error: 'Legendary said: ' + (String(r.out).replace(/\s+/g, ' ').trim().slice(-160) || 'nothing') + ' (the code works once, for a minute; open the login page again)' };
};
const logout = async () => { const r = await run(['auth', '--delete'], 20000); return { ok: r.ok }; };
const LOGIN_URL = 'https://legendary.gl/epiclogin';

// download Legendary's exe from GitHub's releases (GitHub hosts only; the first release with a Windows exe)
function getJson(url) { return new Promise((resolve, reject) => { const q = https.get(url, { headers: { 'User-Agent': 'Tyro-Shelf', Accept: 'application/vnd.github+json' } }, res => { if (res.statusCode !== 200) { res.resume(); return reject(new Error('GitHub answered ' + res.statusCode)); } let b = ''; res.setEncoding('utf8'); res.on('data', c => { b += c; if (b.length > 3e6) q.destroy(); }); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { reject(new Error('unreadable answer')); } }); }); q.on('error', reject); q.setTimeout(15000, () => q.destroy(new Error('timed out'))); }); }
function fetchTo(url, dest, hops = 0) { return new Promise((resolve, reject) => {
  let u; try { u = new URL(url); } catch { return reject(new Error('bad link')); }
  if (u.protocol !== 'https:' || !(u.hostname === 'github.com' || u.hostname.endsWith('.github.com') || u.hostname.endsWith('.githubusercontent.com'))) return reject(new Error('not a GitHub link'));
  const q = https.get(u, { headers: { 'User-Agent': 'Tyro-Shelf', Accept: 'application/octet-stream' } }, res => {
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) { res.resume(); if (hops > 5) return reject(new Error('too many redirects')); return resolve(fetchTo(new URL(res.headers.location, u).toString(), dest, hops + 1)); }
    if (res.statusCode !== 200) { res.resume(); return reject(new Error('download answered ' + res.statusCode)); }
    const out = fs.createWriteStream(dest); res.pipe(out); out.on('finish', () => out.close(() => resolve())); out.on('error', reject); res.on('error', reject);
  }); q.on('error', reject); q.setTimeout(60000, () => q.destroy(new Error('timed out'))); }); }
async function download() {
  if (process.platform !== 'win32') return { ok: false, error: 'Legendary downloads are for Windows. Install it with pip or your package manager.' };
  if (!dir) return { ok: false, error: 'No place to save it.' };
  const tried = [];
  for (const repo of ['hawkeye116477/legendary', 'derrod/legendary']) {
    try {
      const rel = (await getJson(`https://api.github.com/repos/${repo}/releases?per_page=8`)).find(r => r && !r.draft && (r.assets || []).some(a => /\.exe$/i.test(a.name) && /legendary/i.test(a.name)));
      const a = rel && rel.assets.find(x => /\.exe$/i.test(x.name) && /legendary/i.test(x.name) && !/linux|mac/i.test(x.name));
      if (!a) { tried.push(repo + ': no Windows exe'); continue; }
      fs.mkdirSync(dir, { recursive: true });
      const part = path.join(dir, exeName + '.part'); await fetchTo(a.browser_download_url, part);
      const fd = fs.openSync(part, 'r'), b = Buffer.alloc(2); fs.readSync(fd, b, 0, 2, 0); fs.closeSync(fd);
      if (b.toString('latin1') !== 'MZ' || fs.statSync(part).size < 1e6) { try { fs.unlinkSync(part); } catch {} tried.push(repo + ': not a program'); continue; }
      fs.renameSync(part, path.join(dir, exeName)); log('Legendary downloaded from', repo, a.name);
      return { ok: true, from: repo };
    } catch (e) { tried.push(repo + ': ' + e.message); }
  }
  log('Legendary download failed:', tried.join('; '));
  return { ok: false, error: "Couldn't download Legendary (" + tried.join('; ') + '). Download legendary.exe from github.com/derrod/legendary/releases yourself and choose it in Settings.' };
}

// the games the account owns (`legendary list --json`), kept in a small cache so the shelf can show what isn't installed yet
const ownedFile = () => path.join(dir || os.tmpdir(), 'owned.json');
const signedInFile = () => cfgDirs().some(d => { try { return fs.statSync(path.join(d, 'user.json')).size > 20; } catch { return false; } });
function owned() { try { const j = JSON.parse(fs.readFileSync(ownedFile(), 'utf8')); return { at: +j.at || 0, games: Array.isArray(j.games) ? j.games : [] }; } catch { return { at: 0, games: [] }; } }
let refreshing = null;
function refreshOwned() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    if (!find()) return false;
    const r = await run(['list', '--json'], 180000); log('Legendary list: finished', r.ok ? 'ok' : 'with an error', String(r.stdout || '').length, 'bytes of answer');
    let arr; try { const t = r.stdout, i = t.search(/\[\s*(\{|\])/); arr = JSON.parse(t.slice(i)); } catch { log('Legendary list: unreadable answer', String(r.out).replace(/\s+/g, ' ').slice(0, 300)); return false; }
    if (!Array.isArray(arr)) { log('Legendary list: not a list', String(r.out).replace(/\s+/g, ' ').slice(0, 300)); return false; }
    const games = [];
    for (const g of arr) {
      if (!g || typeof g !== 'object') continue;
      const md = g.metadata || {}, app = String(g.app_name || md.id || ''), title = String(g.app_title || md.title || '').trim();
      if (!app || !title || md.mainGameItem || /^UE_|^Fortnite_/i.test(app) && false) continue; // (mainGameItem: a DLC of another game)
      const cats = Array.isArray(md.categories) ? md.categories.map(c => String(c && c.path || c)) : null;
      if (cats && cats.length && !cats.some(c => /^games/i.test(c))) continue; // plugins, engine parts, add-ons
      games.push({ app, title });
    }
    fs.mkdirSync(path.dirname(ownedFile()), { recursive: true });
    fs.writeFileSync(ownedFile(), JSON.stringify({ at: Date.now(), games }));
    log('Legendary: the account owns', games.length, 'games');
    return true;
  })().catch(e => { log('Legendary list:', e.message); return false; }).finally(() => { refreshing = null; });
  return refreshing;
}
// a visible console window for the things Legendary asks you about (sign in, install): a small .bat that pauses at the end
function consoleRun(args, name) {
  const exe = find(); if (!exe) return false;
  if (!args.every(a => /^[\w.=:-]+$/.test(a))) return false;
  const f = path.join(dir || os.tmpdir(), name + '.bat'); fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `@echo off\r\ntitle Legendary\r\n"${exe}" ${args.join(' ')}\r\necho.\r\npause\r\n`);
  require('electron').shell.openPath(f); return true;
}

// ---- finding games already on disk (Playnite's Legendary plugin does the same): a folder you choose holds the games; a game folder
// there (named like the game, with Epic's .egstore inside) is registered with `legendary import`, which makes it "installed"
const normT = t => String(t || '').toLowerCase().replace(/[™®©]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
function findInstall(root, title) {
  const want = normT(title); if (!want || !root) return '';
  const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  const cands = [root]; try { for (const e of fs.readdirSync(root, { withFileTypes: true })) if (e.isDirectory() && !e.name.startsWith('.')) cands.push(path.join(root, e.name)); } catch { return ''; }
  for (const d of cands) { const n = normT(path.basename(d)); if (n && (n === want || (n.length >= 5 && (want.includes(n) || n.includes(want)))) && isDir(path.join(d, '.egstore'))) return d; }
  return '';
}
async function importGame(app, dirPath) {
  if (!/^[\w.-]+$/.test(String(app))) return false;
  const r = await run(['import', '--disable-check', app, dirPath], 120000);
  log('Legendary import:', app, r.ok ? 'ok' : 'failed', String(r.out).replace(/\s+/g, ' ').slice(-200));
  return r.ok;
}
// download and install sizes for a game (`legendary info --json`), or nulls when this build doesn't say
async function sizes(app) {
  if (!/^[\w.-]+$/.test(String(app))) return { download: null, install: null };
  const r = await run(['info', app, '--json'], 60000); let j; try { j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))); } catch { return { download: null, install: null }; }
  let dl = null, inst = null; const walk = (o, d) => { if (!o || typeof o !== 'object' || d > 4) return; for (const [k, v] of Object.entries(o)) { if (typeof v === 'number') { if (/download.?size/i.test(k) && dl == null) dl = v; else if (/(disk|install).?size/i.test(k) && inst == null) inst = v; } else walk(v, d + 1); } };
  walk(j, 0); return { download: dl, install: inst };
}
// installed games with the size Legendary recorded (for the Storage screen)
function installedSizes() { try { const j = JSON.parse(fs.readFileSync(path.join(cfgDir(), 'installed.json'), 'utf8')); return Object.values(j || {}).filter(v => v && !v.is_dlc).map(v => ({ app: String(v.app_name), size: +v.install_size || 0, dir: String(v.install_path || '') })); } catch { return []; } }

module.exports = { findInstall, importGame, sizes, installedSizes, run, normT, owned, refreshOwned, signedInFile, consoleRun, init, setPath, find, installed, status, authCode, logout, download, LOGIN_URL, exeName };
