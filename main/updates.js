// Tyro-Shelf updates (replaces Boxshelf's "open the download page" notice).
//
// Releases live on the maintainer's GitHub (package.json "tyroRepo": "owner/repo"). A release is tagged with a whole
// number ("v17") and carries the portable exe as an asset named Tyro-Shelf-<n>.exe (see .github/workflows/release.yml).
// This build's own number is package.json "tyroBuild". A newer tag is announced on the shelf; "Install" downloads the exe
// next to the app data, checks it (size, SHA-256 when GitHub gives one, the "MZ" header), then a small hidden PowerShell
// waits for Tyro-Shelf to close, swaps the exe in place (the old one is kept as data\update\previous.exe) and starts it again.
// Nothing is installed without pressing Install. Offline, or with GitHub busy, it stays quiet.
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

let log = () => {}, opt = { dir: '', build: 0, repo: '' }, last = null, inflight = null, installing = false;
function init(logger, o) { if (logger) log = logger; if (o) opt = { ...opt, ...o }; }

const repoOk = r => /^[\w.-]+\/[\w.-]+$/.test(String(r || ''));
const links = () => { const page = `https://github.com/${opt.repo}`; return { page, releases: `${page}/releases`, issues: `${page}/issues` }; };
// "v17" / "17" → 17; anything else (a "v17-beta" tag, a name) isn't one of ours
const tagNum = t => { const m = /^v?(\d{1,6})$/.exec(String(t || '').trim()); return m ? +m[1] : null; };
const ua = () => `Tyro-Shelf/${opt.build}`;

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': ua(), Accept: 'application/vnd.github+json' } }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`GitHub answered ${res.statusCode}`)); }
      let b = ''; res.setEncoding('utf8');
      res.on('data', c => { b += c; if (b.length > 2e6) req.destroy(new Error('answer too big')); });
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch { reject(new Error('unreadable answer')); } });
      res.on('error', reject);
    });
    req.on('error', reject); req.setTimeout(15000, () => req.destroy(new Error('timed out')));
  });
}

// { current, latest, newer, url, notes, canInstall, asset, checkedAt } or { current, error } ('disabled' when no repository is set)
async function check(force = false) {
  const current = String(opt.build);
  if (!repoOk(opt.repo)) return { current, disabled: true, error: 'Updates are not set up in this build.' };
  if (!force && last && Date.now() - last.checkedAt < 6 * 3600e3) return last;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const list = await getJson(`https://api.github.com/repos/${opt.repo}/releases?per_page=15`);
      const best = (Array.isArray(list) ? list : []).filter(r => r && !r.draft && !r.prerelease && tagNum(r.tag_name) !== null)
        .sort((p, q) => tagNum(q.tag_name) - tagNum(p.tag_name))[0];
      const latest = best ? String(tagNum(best.tag_name)) : null;
      const asset = best && (best.assets || []).find(a => a && /^Tyro-Shelf-[\w.-]*\.exe$/i.test(a.name) && a.state === 'uploaded' && a.size > 1e6);
      last = { current, latest, newer: !!latest && +latest > opt.build, url: best ? best.html_url : links().releases,
        notes: best && typeof best.body === 'string' ? best.body.slice(0, 2000) : '', links: links(),
        canInstall: !!asset && process.platform === 'win32' && !!process.env.PORTABLE_EXECUTABLE_FILE,
        asset: asset ? { name: asset.name, size: asset.size, url: asset.browser_download_url, digest: typeof asset.digest === 'string' ? asset.digest : '' } : null,
        checkedAt: Date.now() };
      log('Update check:', latest ? `newest ${latest}${last.newer ? ' (newer than ' + current + ')' : ''}` : 'no releases yet');
      return last;
    } catch (e) {
      log('Update check failed:', e.message);
      return { current, error: e.message, checkedAt: Date.now() };
    } finally { inflight = null; }
  })();
  return inflight;
}

// the download follows GitHub's redirects, but only ever to GitHub's own hosts
function fetchFile(url, dest, onPct, hops = 0) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch { return reject(new Error('bad download link')); }
    if (u.protocol !== 'https:' || !(u.hostname === 'github.com' || u.hostname.endsWith('.github.com') || u.hostname.endsWith('.githubusercontent.com'))) return reject(new Error('the download is not on GitHub'));
    const req = https.get(u, { headers: { 'User-Agent': ua(), Accept: 'application/octet-stream' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume(); if (hops >= 5) return reject(new Error('too many redirects'));
        return resolve(fetchFile(new URL(res.headers.location, u).toString(), dest, onPct, hops + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`the download answered ${res.statusCode}`)); }
      const total = +res.headers['content-length'] || 0, h = crypto.createHash('sha256'); let got = 0, lastPct = -1;
      const out = fs.createWriteStream(dest);
      res.on('data', c => { got += c.length; h.update(c); if (total) { const p = Math.floor(got * 100 / total); if (p !== lastPct) { lastPct = p; try { onPct(p); } catch {} } } });
      res.on('error', reject); out.on('error', reject);
      out.on('finish', () => out.close(() => resolve({ size: got, sha256: h.digest('hex') })));
      res.pipe(out);
    });
    req.on('error', reject); req.setTimeout(30000, () => req.destroy(new Error('the download timed out')));
  });
}

const psq = s => String(s).replace(/'/g, "''");

// Downloads and checks the newest exe, then starts the helper that swaps it in once Tyro-Shelf has closed. Resolves when the
// helper is running: the caller then quits the app. Throws a plain-language message on any problem (nothing is changed then).
async function install(onPct) {
  if (installing) throw new Error('An update is already being installed.');
  installing = true;
  try {
    const exe = process.env.PORTABLE_EXECUTABLE_FILE;
    if (process.platform !== 'win32' || !exe || !fs.existsSync(exe)) throw new Error('Updating works from the portable Tyro-Shelf.exe. Download the new one from the Releases page instead.');
    const r = await check(true);
    if (r.error) throw new Error(`Couldn't reach GitHub (${r.error}). Try again later.`);
    if (!r.newer) throw new Error('You already have the newest version.');
    if (!r.asset || !r.asset.url) throw new Error("That release has no Tyro-Shelf exe attached yet. Try again in a few minutes.");
    fs.mkdirSync(opt.dir, { recursive: true });
    const name = r.asset.name.replace(/[^\w.-]/g, '_'), final = path.join(opt.dir, name), part = final + '.part';
    try { fs.unlinkSync(part); } catch {}
    log('Update: downloading', r.asset.name, r.asset.size, 'bytes');
    let got; try { got = await fetchFile(r.asset.url, part, onPct || (() => {})); } catch (e) { try { fs.unlinkSync(part); } catch {} throw new Error(`The download failed (${e.message}).`); }
    const bad = why => { try { fs.unlinkSync(part); } catch {} log('Update: rejected the download:', why); throw new Error('The downloaded file did not check out, so nothing was changed. Try again.'); };
    if (r.asset.size && got.size !== r.asset.size) bad(`size ${got.size} instead of ${r.asset.size}`);
    if (/^sha256:[0-9a-f]{64}$/i.test(r.asset.digest) && got.sha256.toLowerCase() !== r.asset.digest.slice(7).toLowerCase()) bad('SHA-256 does not match');
    { const fd = fs.openSync(part, 'r'), b = Buffer.alloc(2); fs.readSync(fd, b, 0, 2, 0); fs.closeSync(fd); if (b.toString('latin1') !== 'MZ') bad('not a Windows program'); }
    try { fs.unlinkSync(final); } catch {}
    fs.renameSync(part, final);
    log('Update: downloaded and checked', name, '- swapping after this app closes');

    const bak = path.join(opt.dir, 'previous.exe'), ulog = path.join(opt.dir, 'update.log');
    const pids = [process.pid, process.ppid].filter(n => n > 4);
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$new = '${psq(final)}'; $dst = '${psq(exe)}'; $bak = '${psq(bak)}'; $lg = '${psq(ulog)}'`,
      "function L($m) { try { Add-Content -LiteralPath $lg -Value ('[' + (Get-Date -Format s) + '] ' + $m) } catch {} }",
      "L 'waiting for Tyro-Shelf to close'",
      `foreach ($id in @(${pids.join(',')})) { try { Wait-Process -Id $id -Timeout 90 } catch {} }`,
      "$free = $false; for ($i = 0; $i -lt 60 -and -not $free; $i++) { try { $s = [IO.File]::Open($dst, 'Open', 'ReadWrite', 'None'); $s.Close(); $free = $true } catch { Start-Sleep -Milliseconds 500 } }",
      "try { Copy-Item -LiteralPath $dst -Destination $bak -Force; Move-Item -LiteralPath $new -Destination $dst -Force; L 'replaced the exe' } catch { L ('FAILED: ' + $_); try { if (Test-Path -LiteralPath $bak) { Copy-Item -LiteralPath $bak -Destination $dst -Force; L 'put the old exe back' } } catch {} }",
      "Start-Process -FilePath $dst"
    ].join('\n');
    // started through a short-lived PowerShell (Start-Process) so the helper isn't taken down with this app's process group
    const step = `Start-Process -FilePath powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${Buffer.from(script, 'utf16le').toString('base64')}'`;
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(step, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'ignore', detached: true });
    p.on('error', e => log('Update helper:', e.message)); p.unref();
    return { ok: true, latest: r.latest };
  } finally { installing = false; }
}

module.exports = { init, check, install, tagNum };
