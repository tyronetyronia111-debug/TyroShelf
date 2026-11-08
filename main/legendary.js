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
const cfgDir = () => process.env.LEGENDARY_CONFIG_PATH || path.join(os.homedir(), '.config', 'legendary');

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
  try { execFile(exe, args, { windowsHide: true, timeout: ms, maxBuffer: 16 << 20, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }, (err, so, se) => res({ ok: !err, out: String(so || '') + String(se || '') })); } catch (e) { res({ ok: false, out: e.message }); }
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
  let signedIn = false; try { signedIn = fs.statSync(path.join(cfgDir(), 'user.json')).size > 20; } catch {}
  let acct = '';
  if (signedIn) { const r = await run(['status', '--json', '--offline'], 20000); try { acct = String(JSON.parse(r.out.slice(r.out.indexOf('{'))).account || ''); } catch {} if (/not logged|^<.*>$/i.test(acct)) acct = ''; }
  return { found: true, exe, signedIn, account: acct };
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

module.exports = { init, setPath, find, installed, status, authCode, logout, download, LOGIN_URL, exeName };
