// Boxshelf — TV-style launcher for emulators, Steam and media apps.
const { app, BrowserWindow, ipcMain, dialog, protocol, shell, net, nativeImage, session, safeStorage, screen } = require('electron');
const crypto = require('crypto');
const { spawn } = require('child_process');
const url = require('url');
const fs = require('fs');
const path = require('path');

const paths = require('./main/paths');
const stremio = require('./main/stremio');
const music = require('./main/music'); // your own menu music (audio files in the Music folder)
const presence = require('./main/presence'); // Discord Rich Presence: "Playing <game>" on the player's profile (opt-in)
const commercials = require('./main/commercials');
// Portable: the app's own folder holds Dolphin\, Eden\, PPSPP\, ROMS\ and themes\.
// A portable exe unpacks itself into TEMP; PORTABLE_EXECUTABLE_DIR is where the real Boxshelf.exe sits
const linux = require('./main/linux'); // (Linux / Steam Deck only)
const steamdeck = require('./main/steamdeck'); // (beta.8) Steam Deck: where Boxshelf runs, Add Boxshelf to Steam
paths.setAppRoot(linux.isLinux ? linux.appRoot(app.isPackaged, __dirname) : app.isPackaged ? (process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath)) : __dirname);

const config = require('./main/config');
const { CONSOLES, APPS } = require('./main/systems');
const { detectAll, detectSystem } = require('./main/detect');
const { scanSystem: scanFolders, cleanTitle: scanTitle } = require('./main/scanner');
const arcadenames = require('./main/arcadenames');
// (beta.5) a game's own name (Details → Rename: cfg.games["<console>:<file>"].title) replaces the scanned one wherever main
// reads games: the shelf, box art and manual lookups, matching. fileTitle keeps the scanned one. Copies, never the
// scanner's own objects (a reset must bring the file's name back)
function scanSystem(def, sc) {
  const gs = scanFolders(def, sc), G = cfg && cfg.games; if (!G) return gs;
  return gs.map(g => { const o = G[def.id + ':' + g.file]; return o && o.title && o.title !== g.title ? { ...g, fileTitle: g.title, title: o.title } : g; });
}
const ownTitle = id => { const o = cfg && cfg.games && cfg.games[String(id)]; return o && o.title ? o.title : ''; }; // (PC games, by id)
const { scanSteam } = require('./main/steam');
const steamart = require('./main/steamart');
const legendary = require('./main/legendary'); // (Tyro-Shelf-19) Epic games through Legendary
const gscripts = require('./main/gamescripts'); // (Tyro-Shelf-19) scripts and programs opened along with a game
const pcgames = require('./main/pcgames'); // (beta.4) Epic, Quiver Launcher and games added by hand
const pccovers = require('./main/pccovers'); // (beta.5) choosing a PC game's cover (SteamGridDB, Steam's own, your own)
const wiiumanual = require('./main/wiiumanual');
const manualcoll = require('./main/manualcoll');
const manualstudio = require('./main/manualstudio'); // Manual Studio: every manual for a game side by side, per-game locks, per-console language / region
const launcher = require('./main/launcher');
const themes = require('./main/themes');
const customThemes = require('./main/customthemes'); // (1.76) picture themes the user makes: Custom themes\<name>\
const library = require('./main/library');
const archive = require('./main/archive');
const padwatch = require('./main/padwatch');
const homemenu = require('./main/homemenu');
const emucfg = require('./main/emucfg');
const emusetup = require('./main/emusetup'); // (beta.7) Set up for me
const racores = require('./main/racores'); // (beta.7) RetroArch cores downloaded, BIOS files checked
const previews = require('./main/previews'); // (beta.7) video previews
const ytclips = require('./main/ytclips'); // (beta.8) console trailers: YouTube trailers kept as short clips
const addgames = require('./main/addgames'); // (beta.7) Add games: several at once, a folder, Playnite
const x360 = require('./main/x360');
const n3ds = require('./main/n3ds');
const kyty = require('./main/kyty'); // PS5: Kyty's launch settings and the KytyJets preset
const nx2 = require('./main/nx2'); // Switch 2: unpacked games and their newest update
const wiimote = require('./main/wiimote'); // the Wii remote on the shelf (through a DolphinBar)
const padsense = require('./main/padsense'); // which real controllers are plugged in (button prompts)
const modelfind = require('./main/modelfind');
const icons = require('./main/icons');
const dolphin = require('./main/dolphin');
const covers = require('./main/covers');
const artstudio = require('./main/artstudio');
const manuals = require('./main/manuals');
const ra = require('./main/ra');
const companion = require('./main/companion');
const updates = require('./main/updates'); // (1.82) beta update notice: the public beta page's newest release

const WINDOWED = process.argv.includes('--windowed');
let win = null;

// ---------- play history (per game: launches, last played, time in game) ----------
let history = null, histFile = null, histOpen = null;
// a map with no prototype: an id like "__proto__" from the page is just a key here
function loadHistory() {
  if (history) return history; histFile = path.join(app.getPath('userData'), 'history.json'); history = Object.create(null);
  let raw = null; try { raw = fs.readFileSync(histFile, 'utf8'); } catch {}
  if (raw != null) { try { const o = JSON.parse(raw); if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object') history[k] = { count: +v.count || 0, ms: +v.ms || 0, last: +v.last || 0 }; }
    catch (e) { try { fs.copyFileSync(histFile, histFile + '.corrupt-' + Date.now()); } catch {} log('history unreadable, kept a copy', e.message); } }
  return history;
}
// temp + rename: a crash or power cut mid-write can't wipe the play history
function saveHistory() { try { fs.writeFileSync(histFile + '.tmp', JSON.stringify(history)); fs.renameSync(histFile + '.tmp', histFile); } catch (e) { log('history save', e.message); } }
function historyStart(id) { id = String(id).slice(0, 1024); const h = loadHistory(); const e = h[id] = h[id] || { count: 0, ms: 0, last: 0 }; const prev = { count: e.count, last: e.last }; e.count++; e.last = Date.now(); histOpen = { id, at: Date.now(), prev }; saveHistory(); }
// the launch never started (the exe couldn't be run): take the play back off, "last played" included
function historyUndo() { if (!histOpen) return; const { id, prev } = histOpen, h = loadHistory(), e = h[id]; histOpen = null; if (!e || !prev) return; if (!prev.count && !e.ms) delete h[id]; else { e.count = prev.count; e.last = prev.last; } saveHistory(); }
function historyEnd() { if (!histOpen) return; const h = loadHistory(), e = h[histOpen.id]; if (e) { e.ms += Date.now() - histOpen.at; saveHistory(); } histOpen = null; }

// ---------- trailer window (YouTube embed from the LaunchBox link); Esc or the close button ends it ----------
let trailerWin = null, coverWindowed = false;
function openTrailer(url) {
  if (!/^https?:\/\//i.test(url)) return { external: true }; // only web links leave the app (the URL comes from database data)
  let id = null; try { const u = new URL(url); id = u.hostname.includes('youtu.be') ? u.pathname.slice(1) : u.searchParams.get('v'); } catch {}
  if (!id || !/^[\w-]{6,20}$/.test(id)) { shell.openExternal(url).catch(e => log('trailer open', e.message)); return { external: true }; }
  if (trailerWin) { try { trailerWin.close(); } catch {} }
  const b = win ? win.getBounds() : { x: 0, y: 0, width: 1280, height: 720 };
  trailerWin = new BrowserWindow({ parent: win || undefined, modal: false, fullscreen: !!(win && win.isFullScreen()), x: b.x, y: b.y, width: b.width, height: b.height, backgroundColor: '#000000', autoHideMenuBar: true, title: 'Trailer', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'trailer' } }); // its own session: YouTube's page can't reach Boxshelf's bsfile:// files
  trailerWin.setMenuBarVisibility(false);
  ytLoad(trailerWin.webContents, id, { muted: false }).catch(e => log('trailer load', e.message)); // (beta.7: inside a page of its own; a bare embed no longer plays)
  trailerWin.webContents.on('before-input-event', (e, input) => { if (input.type === 'keyDown' && (input.key === 'Escape' || input.key === 'Backspace')) { e.preventDefault(); try { trailerWin.close(); } catch {} } });
  trailerWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  trailerWin.webContents.on('will-navigate', e => e.preventDefault()); // (the player lives in its frame; the page itself never goes anywhere)
  const tw = trailerWin; tw.on('closed', () => { if (trailerWin === tw) trailerWin = null; if (alive() && trailerWin === null) win.focus(); if (trailerWin === null && cfg && cfg.ui.homeMenu === false && !launcher.isRunning()) padwatch.stop(); });
  // the trailer has the focus, so the shelf's own pad reading can't see the controller: the XInput helper closes it on B,
  // Back or Guide (with the Home menu off no helper runs on the shelf, so start one just for the trailer)
  if (!padwatch.isRunning()) { if (cfg && cfg.ui.homeMenu !== false) watchShelf(); else padwatch.start('none', 900, () => {}, { home: true, backHome: false, cmdFile: path.join(app.getPath('temp'), `boxshelf-pad-${process.pid}.txt`), onHome: () => closeTrailer(), onButton: (n, d) => { if (d && (n === 'b' || n === 'back')) closeTrailer(); } }); }
  return { external: false };
}
// (beta.7) YouTube only plays an embed that sits in a web page (a bare embed shows "Video player configuration error"):
// this little page, loaded as data with an https address of its own (nothing is fetched from that address), holds
// YouTube's player. preview: no controls, muted unless asked, looping, cropped past YouTube's title bar, faded in once
// it really plays; the page's title tells main how it went (yt-playing / yt-error).
function ytPage(id, o = {}) {
  const pv = { autoplay: 1, mute: o.muted === false ? 0 : 1, controls: o.preview ? 0 : 1, rel: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3, disablekb: o.preview ? 1 : 0, fs: o.preview ? 0 : 1, ...(o.preview ? { loop: 1, playlist: id } : {}) };
  const crop = o.preview ? 'top:-60px;height:calc(100% + 120px)' : 'top:0;height:100%';
  return `<!doctype html><meta charset="utf-8"><title>yt</title><style>html,body{margin:0;height:100%;overflow:hidden;background:transparent}#p{position:absolute;left:0;width:100%;${crop};border:0;opacity:0;transition:opacity .45s ease}#p.on{opacity:1}</style>
<div id="p"></div><script src="https://www.youtube.com/iframe_api"></script><script>
function onYouTubeIframeAPIReady(){new YT.Player('p',{videoId:${JSON.stringify(id)},host:'https://www.youtube-nocookie.com',playerVars:${JSON.stringify(pv)},
events:{onStateChange:function(e){if(e.data===1){document.getElementById('p').className='on';document.title='yt-playing'}},onError:function(){document.title='yt-error'}}})}
setTimeout(function(){if(document.title==='yt')document.title='yt-error'},15000);</script>`;
}
const ytLoad = (wc, id, o) => wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(ytPage(id, o)), { baseURLForDataURL: 'https://player.boxshelf.localhost/' });
// the Details preview: YouTube's player in a view of its own laid over the panel's video box (the renderer sends where);
// its own session like the trailer window, never keeps the keyboard, hidden whenever Details isn't showing it
let ytView = null, ytWant = null;
function ytEnsure() {
  if (ytView && !ytView.webContents.isDestroyed()) return ytView;
  const { WebContentsView } = require('electron');
  ytView = new WebContentsView({ webPreferences: { partition: 'trailer', sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try { ytView.setBackgroundColor('#00000000'); } catch {}
  const wc = ytView.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', e => e.preventDefault());
  wc.on('focus', () => { if (alive()) win.webContents.focus(); }); // (a click on the video must not take the controller's keys away from the shelf)
  wc.on('page-title-updated', (e, t) => { if (alive() && (t === 'yt-playing' || t === 'yt-error')) win.webContents.send('preview:yt', { id: ytWant, state: t.slice(3) }); });
  ytView.setVisible(false);
  win.contentView.addChildView(ytView);
  return ytView;
}
function ytBounds(r) { const z = alive() ? win.webContents.getZoomFactor() || 1 : 1; return { x: Math.round(r.x * z), y: Math.round(r.y * z), width: Math.max(1, Math.round(r.w * z)), height: Math.max(1, Math.round(r.h * z)) }; }
function ytStop() { ytWant = null; if (ytView && !ytView.webContents.isDestroyed()) { ytView.setVisible(false); ytView.webContents.loadURL('about:blank').catch(() => {}); } }
// true when there was a trailer to close (Guide and B close it before doing anything else)
function closeTrailer() { if (!trailerWin || trailerWin.isDestroyed()) return false; try { trailerWin.close(); } catch {} return true; }
let cfg = null;

// Keep settings next to the app so the whole folder can move between PCs.
app.setPath('userData', path.join(paths.appRoot(), 'data'));

// Write problems to data\\boxshelf.log so they can be looked at later.
const LOG = path.join(paths.appRoot(), 'data', 'boxshelf.log');
// the user's home folder is written as ~ (logs get shared for help); the log is rotated at 2 MB (one older copy kept)
const HOME_RE = (() => { const h = require('os').homedir(); return h ? new RegExp(h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') : null; })();
let logChecked = false, logWrites = 0;
function log(...a) {
  try {
    if (++logWrites % 500 === 0) logChecked = false; // a long session re-checks the size now and then (once at start grew without limit)
    if (!logChecked) { logChecked = true; fs.mkdirSync(path.dirname(LOG), { recursive: true }); try { if (fs.statSync(LOG).size > 2 * 1024 * 1024) fs.renameSync(LOG, LOG + '.old'); } catch {} }
    let line = a.join(' '); if (HOME_RE) line = line.replace(HOME_RE, '~');
    fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${line}\n`);
  } catch {}
}
process.on('uncaughtException', e => log('ERROR', e && e.stack || e));
process.on('unhandledRejection', e => log('ERROR', e && e.stack || e));
log('Starting Boxshelf', app.getVersion());
if (linux.isLinux) { steamdeck.init({ log }); const d = steamdeck.info(); log('Linux start:', d.deck ? 'Steam Deck' : 'PC', '| started by Steam:', d.steam, '| Game Mode:', d.gameMode, '| options:', d.flags.join(' ') || 'none'); }

// Only one Boxshelf at a time: a second launch brings the first one forward.
const firstInstance = app.requestSingleInstanceLock();
if (!firstInstance) { log('Already running, focusing the open window'); app.quit(); }
app.on('render-process-gone', (e, wc, d) => log('Screen process stopped:', d.reason, d.exitCode));
app.on('child-process-gone', (e, d) => log('Helper process stopped:', d.type, d.reason, d.exitCode));
process.on('exit', code => log('Exiting with code', code));
app.on('second-instance', (e, argv) => { const sid = launchArg(argv); if (sid && alive() && !launcher.isRunning()) { pendingShortcut = ''; win.webContents.send('shortcut:launch', sid); } else if (sid) log('Shortcut ignored: something is already running'); if (alive() && launcher.isRunning()) { padwatch.front(runKind === 'app'); return; } /* (a media app: leave the pad-driven pointer where it is) */ /* a game is on: keep it in front, don't half-show the shelf */ if (alive()) { if (win.isMinimized()) win.restore(); stepIn(); try { win.setOpacity(1); } catch {} win.show(); win.focus(); } });

// bsfile:// serves local images and videos (covers, Steam art, logos, boot videos).
// Chromium's web cache: downloads are saved by Boxshelf itself, so a small cache is plenty (it had grown to 360 MB)
app.commandLine.appendSwitch('disk-cache-size', String(64 * 1024 * 1024));
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
// Windows: Chromium stops drawing a window it believes is covered ("native window occlusion"). Boxshelf sits invisible
// under the fullscreen game while one runs, and after quick open/close runs Chromium sometimes missed it being uncovered
// again: the screen stayed black until a key was pressed. The shelf pauses its own loops while a game runs (run:aside:
// controller polling, the theme layer, music), so it doesn't need Chromium's guess.
let captureCompat = true; try { const j = JSON.parse(fs.readFileSync(path.join(paths.appRoot(), 'data', 'config.json'), 'utf8')); if (j && j.ui && j.ui.captureCompat === false) captureCompat = false; } catch {} // (Settings → System → Screen-recording compatibility)
if (process.platform === 'win32' && captureCompat) app.commandLine.appendSwitch('disable-direct-composition'); // (Tyro-Shelf: the window is presented the plain way, which NVIDIA / screen recorders capture without freezing on it)
if (process.platform === 'win32') app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,DirectCompositionVideoOverlays'); // (Tyro-Shelf: video overlays off, so NVIDIA / screen recorders keep seeing every frame of the screen)
protocol.registerSchemesAsPrivileged([{ scheme: 'bsfile', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: false } }]);

let rootsCache = null, rootsCfg = null;
function allowedRoots() {
  if (rootsCache && rootsCfg === cfg) return rootsCache; // rebuilt only when the settings object changes (config:save replaces it)
  rootsCfg = cfg; return (rootsCache = computeRoots());
}
function computeRoots() {
  if (!library._cacheSet) { library.setCacheRoot(path.join(app.getPath('userData'), 'library')); library._cacheSet = true; }
  const roots = [path.join(paths.appRoot(), 'themes'), path.join(paths.appRoot(), 'Custom themes'), path.join(app.getPath('userData'), 'custom-theme-cache'), icons.folder(), ...library.roots()].filter(Boolean); // (custom themes: their pictures, and the scaled copies of big ones)
  for (const s of Object.values(cfg.systems)) { roots.push(...(s.romDirs || [])); if (s.artDir) roots.push(paths.expand(s.artDir)); }
  roots.push(path.join(app.getPath('userData'), 'stremio-art'), path.join(app.getPath('userData'), 'commercials')); // the movie shelves' posters and art; the retro TV's ads
  if (paths.artLibrary()) roots.push(paths.artLibrary());
  if (artstudio.cacheDir()) roots.push(artstudio.cacheDir()); // Art Studio's downloaded candidates (the picker's thumbnails)
  if (manualstudio.cacheDir()) roots.push(manualstudio.cacheDir()); // Manual Studio's first-page previews and PDFs (also read by the PDF helper by address)
  if (cfg.steam.path) roots.push(path.join(cfg.steam.path, 'appcache', 'librarycache'), path.join(app.getPath('userData'), 'steam-art')); // Steam's art cache only, not its config files
  roots.push(path.join(app.getPath('userData'), 'steam-art'), path.join(app.getPath('userData'), 'pc-covers'), path.join(app.getPath('userData'), 'pc-cover-cache')); // (beta.5) Epic games' Steam art (even without Steam), chosen PC covers and the cover picker's thumbnails
  return roots.filter(Boolean).map(r => { r = path.resolve(r).toLowerCase(); return r.endsWith(path.sep) ? r : r + path.sep; });
}

const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream', json: 'application/json' };

// Covers are asked for at the size they're shown (bsfile://…?t=<height>): big scans (Steam's are 1200×1800) are
// scaled once, kept in data\thumbs and served from there, so the shelf never decodes or holds full-size images.
const THUMB_EXT = /\.(jpe?g|png)$/i; // (not webp: nativeImage can't decode it, so it was retried on every request)
let thumbQ = Promise.resolve(); const thumbTurn = () => { const p = thumbQ.then(() => new Promise(r => setTimeout(r, 4))); thumbQ = p; return p; };
let thumbTmpN = 0; const thumbOriginal = new Set(), thumbBusy = new Map(); // covers already small enough (no decode next time); decodes in flight
function thumbFor(file, stat, h) {
  const key = file + '|' + Math.floor(stat.mtimeMs) + '|' + stat.size + '|' + h;
  if (thumbOriginal.has(key)) return Promise.resolve(null);
  if (thumbBusy.has(key)) return thumbBusy.get(key); // two cases asking for the same cover share one decode
  const p = (async () => {
    const dir = path.join(app.getPath('userData'), 'thumbs');
    const out = path.join(dir, crypto.createHash('sha1').update(file + '|' + Math.floor(stat.mtimeMs) + '|' + h).digest('hex').slice(0, 24) + '.jpg');
    try { return await fs.promises.readFile(out); } catch {}
    // the size check reads only the file header; the decode + scale happens off this thread where Windows can (shell thumbnailer)
    const sz = spreads.sizeOf(file); if (sz && sz[1] <= h * 1.2) { if (thumbOriginal.size > 5000) thumbOriginal.clear(); thumbOriginal.add(key); return null; } // already about the right size: serve the original
    let img = null;
    if (process.platform === 'win32' && sz) { try { img = await nativeImage.createThumbnailFromPath(file, { width: Math.max(1, Math.round(sz[0] * h / sz[1])), height: h }); if (img && img.getSize().height < h * .9) img = null; /* a cached smaller shell thumbnail would look blurry */ } catch { img = null; } }
    if (!img || img.isEmpty()) await thumbTurn(); // decoding here blocks the app: one at a time, with a breath in between (a burst of new art used to hold it up)
    if (!img || img.isEmpty()) { img = nativeImage.createFromPath(file); const s2 = img.isEmpty() ? null : img.getSize(); if (!s2 || s2.height <= h * 1.2) { if (thumbOriginal.size > 5000) thumbOriginal.clear(); thumbOriginal.add(key); return null; } /* undecodable: serve the original from now on */ img = img.resize({ height: h, quality: 'best' }); }
    const buf = img.toJPEG(90);
    const tmp = out + '.' + process.pid + '-' + (++thumbTmpN) + '.tmp'; // temp + rename: a crash mid-write left a cut-off thumbnail that was served from then on
    fs.promises.mkdir(dir, { recursive: true }).then(() => fs.promises.writeFile(tmp, buf)).then(() => fs.promises.rename(tmp, out)).catch(() => { fs.promises.unlink(tmp).catch(() => {}); });
    return buf;
  })().finally(() => thumbBusy.delete(key));
  thumbBusy.set(key, p); return p;
}
async function serveFile(request) {
  try {
    const u = new URL(request.url);
    const file = path.resolve(decodeURIComponent(u.pathname.replace(/^\//, '')));
    const lower = file.toLowerCase();
    if (!allowedRoots().some(r => lower.startsWith(r)) && !previewOk.has(lower) && !lower.startsWith(path.join(app.getPath('userData'), 'previews').toLowerCase() + path.sep)) return new Response('Not allowed', { status: 403 }); // (beta.7: a preview video found for a game, the Steam clips)
    const stat = await fs.promises.stat(file);
    const type = MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';
    const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'max-age=3600' };
    const th = +u.searchParams.get('t');
    if (th >= 64 && th <= 4096 && THUMB_EXT.test(file)) { const b = await thumbFor(file, stat, Math.round(th)).catch(() => null); if (b) return new Response(b, { headers: { ...cors, 'Content-Type': 'image/jpeg', 'Content-Length': String(b.length) } }); }
    // Small files (covers, manual pages, PDFs) go out as one buffer: no Node→web stream bridging, nothing to break
    // when the page drops a request half-way. Big files (videos, 3D models) stream through Chromium's own file loader.
    if (stat.size <= 24 * 1024 * 1024 && !request.headers.get('range')) {
      return new Response(await fs.promises.readFile(file), { headers: { ...cors, 'Content-Length': String(stat.size) } });
    }
    const headers = {}; const range = request.headers.get('range'); if (range) headers.Range = range;
    const r = await net.fetch(url.pathToFileURL(file).toString(), { headers, bypassCustomProtocolHandlers: true });
    const h = {}; r.headers.forEach((v, k) => { h[k] = v; }); Object.assign(h, { 'Access-Control-Allow-Origin': '*', 'Content-Type': type, 'Accept-Ranges': 'bytes' });
    return new Response(r.body, { status: r.status, headers: h });
  } catch (e) {
    log('bsfile', e && e.message);
    return new Response('Not found', { status: 404 });
  }
}

const artVer = new Map(); // covers replaced this session (Box art): a new address, so nothing shows the old picture from memory
function fileUrl(p) { if (!p) return null; const v = artVer.get(path.resolve(p).toLowerCase()); return 'bsfile://local/' + encodeURIComponent(p) + (v ? '?v=' + v : ''); }
// A game file named by the screen must be one the scanner could have found: inside one of that system's games folders.
function gameFile(systemId, file) {
  const sc = cfg.systems[systemId]; if (!sc) throw new Error('Unknown system.');
  const f = path.resolve(String(file || '')).toLowerCase();
  if (!(sc.romDirs || []).some(d => paths.inDir(f, d))) throw new Error('That game is not in a games folder.');
  return { sc, file: String(file) };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 900, ...startBounds(), // Settings → Display: opens on the TV chosen there (the main display when it isn't connected)
    fullscreen: !WINDOWED && cfg.ui.startFullscreen,
    backgroundColor: '#07070c',
    show: false, // shown once its first frame (the logo) is painted: no empty or half-drawn window while it starts
    autoHideMenuBar: true, // (Tyro-Shelf: the menu is also removed below, so Alt no longer pops it up)
    title: 'Tyro-Shelf',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  require('electron').Menu.setApplicationMenu(null); try { win.setMenu(null); } catch {} // (no File / Edit / View menu; Alt did nothing useful and popped it up)
  win.once('ready-to-show', () => { if (alive() && !win.isVisible()) win.show(); });
  setTimeout(() => { if (alive() && !win.isVisible()) win.show(); }, 4000); // never left hidden
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('did-finish-load', () => { scaleSent = ''; applyScale(); });
  try { win.on('resize', applyScaleSoon); win.on('moved', applyScaleSoon); } catch {} // another screen, fullscreen on/off, a resized window
  try { screen.on('display-metrics-changed', applyScaleSoon); } catch {}
  win.webContents.on('will-navigate', e => e.preventDefault());
  // the shelf's page crashed (out of memory, a graphics driver reset): load it again rather than leave a dead screen on the
  // TV. Not while a game runs (it comes back once the game ends), and at most 3 times in 2 minutes (a page that crashes
  // straight away again shouldn't loop)
  const crashes = []; win.webContents.on('render-process-gone', (e, d) => {
    if (!d || d.reason === 'clean-exit') return; const now = Date.now(); while (crashes.length && now - crashes[0] > 120000) crashes.shift(); crashes.push(now);
    if (crashes.length > 3) { log('Screen crashed again: not reloading'); return; }
    const w0 = win, again = () => { if (win !== w0 || !alive()) return; if (launcher.isRunning()) { setTimeout(again, 2000); return; } log('Reloading the screen after a crash'); win.reload(); };
    setTimeout(again, 600);
  });
  // (beta.9) Right after a game closes, something else (the emulator's last window, Steam, Discord, the helper) can take the
  // focus back from the shelf. Chromium only gives controller input to a focused page, so the pad would go dead. For a few
  // seconds after the return, a blur that didn't go to another Boxshelf window is answered by taking the focus again.
  win.on('blur', () => {
    if (backGuardUntil && Date.now() <= backGuardUntil && !launcher.isRunning()) { try { padwatch.who(); } catch {} }
    if (!backGuardUntil || Date.now() > backGuardUntil || launcher.isRunning() || launching) return;
    setTimeout(() => {
      if (!alive() || Date.now() > backGuardUntil + 500 || launcher.isRunning() || launching || BrowserWindow.getFocusedWindow()) return;
      // (Tyro-Shelf) the Alt-Tab switcher, Search or the Start menu in front means YOU opened it: leave it alone (the guard used to
      // snatch the focus from it up to 8 times, which felt like the mouse and keys fighting back)
      const fg = padwatch.lastFg && padwatch.lastFg();
      if (fg && Date.now() - fg.at < 1500 && /Task Switching|Task View|SearchHost|StartMenuExperienceHost|ShellExperienceHost|Search/i.test(fg.text)) { backGuardUntil = 0; log('Focus guard: leaving the focus with', fg.text); return; }
      if (backGuardTries >= 3) return; backGuardTries++; try { padwatch.who(); } catch {} log('Focus guard: the shelf lost the focus after the game, taking it back (' + backGuardTries + ')');
      try { win.setAlwaysOnTop(true); win.focus(); win.webContents.focus(); win.moveTop(); } catch {}
      try { const b = win.getNativeWindowHandle(); padwatch.focusWindow(b.length >= 8 ? b.readBigUInt64LE(0).toString() : String(b.readUInt32LE(0))); } catch {}
      setTimeout(() => { try { if (alive() && !launcher.isRunning()) win.setAlwaysOnTop(false); } catch {} }, 700);
    }, 120);
  });
  win.on('closed', () => { log('Quit: the Boxshelf window was closed'); win = null; app.quit(); }); // hidden helper windows (Home overlay, manual renderer) must not keep Boxshelf alive
  // (beta.6) the taskbar hidden for a game comes back the moment you leave the fullscreen shelf: another app, the Start
  // menu, minimized, windowed (see taskbarBack)
  for (const ev of ['blur', 'leave-full-screen', 'minimize', 'hide']) win.on(ev, () => taskbarLeave(ev));
}
// (a blur that only went to one of Boxshelf's own windows, a trailer, isn't leaving: that window is watched instead)
function taskbarLeave(ev) {
  if (!tbHidden || launcher.isRunning() || launching) return;
  if (ev !== 'blur') { taskbarShow('left the shelf: ' + ev); return; }
  setTimeout(() => {
    if (!tbHidden || launcher.isRunning() || launching) return;
    const f = BrowserWindow.getFocusedWindow();
    if (f && !f.isDestroyed()) { if (f !== win && !f.bsTbWatch) { f.bsTbWatch = true; f.on('blur', () => taskbarLeave('blur')); } return; }
    taskbarShow('left the shelf: blur');
  }, 60);
}

const alive = () => win && !win.isDestroyed(); // the window can be gone already when Boxshelf quits while a game still runs
// Quitting a game: put Boxshelf's (black) screen in front *before* the emulator closes, so the Windows desktop never
// shows in between; the shelf then fades in as usual once the emulator has exited (onExit → bringBack).
function coverForQuit() {
  markEvent('coverForQuit'); quitAt = Date.now(); quitSeq++;
  if (!alive()) return;
  // quit while the loading screen was still up: its pending lift must not step Boxshelf aside in the middle of the quit
  if (coverTimer) { clearInterval(coverTimer.keep); clearTimeout(coverTimer); coverTimer = null; }
  try { win.webContents.send('run:quitting'); } catch {} // the shelf gets ready under a black cover while the game closes
  try {
    if (win.isMinimized()) win.restore();
    // Boxshelf never left the screen (see lift): it only turns opaque and comes to the front. No show() — Windows
    // animates a window that is shown, and the closing game's windows showed through that animation
    try { win.setOpacity(1); } catch {}
    win.setAlwaysOnTop(true, 'screen-saver'); if (!win.isVisible()) win.showInactive(); win.moveTop();
    padwatch.cover(true); // (beta.6) the helper keeps the cover over the closing game's windows too, every ~40 ms
    // A closing emulator can still pop windows up (it leaves fullscreen, shows its main window or a dialog): keep the
    // cover on top until it has really exited (onExit), like the start-up cover does
    clearQuitCover();
    const started = Date.now();
    quitCover = setInterval(() => {
      try {
        // (1.82) a Quit that came after the game had already exited: nothing will call onExit now, so let go of
        // always-on-top here too, or file pickers and browser windows open behind Boxshelf until the next launch
        if (!alive() || !launcher.isRunning()) { clearQuitCover(); if (alive() && !launcher.isRunning()) { try { win.setAlwaysOnTop(false); } catch {} } return; }
        if (Date.now() - started > 11000) { // still running well past the force-close: give the game the screen back, controller included
          clearQuitCover(); log('Quit: the game is still running, returning to it'); pendingPower = null; quitAt = 0; /* its exit later isn't "N ms after Quit" */
          win.setAlwaysOnTop(false); padwatch.cover(false); stepAside(); if (!padwatch.isRunning() && lastPadOpts) watchPad(lastPadOpts); padwatch.front(); setTimeout(() => { if (launcher.isRunning()) padwatch.front(); }, 1500); return; /* the helper may have just restarted */
        }
        win.setAlwaysOnTop(true, 'screen-saver'); win.moveTop(); coverFullSize();
      } catch {}
    }, 100);
  } catch {}
}
let quitCover = null, quitAt = 0, quitSeq = 0; // quitSeq: a timer set before a Quit must not step Boxshelf aside during it
// (beta.6) Chromium shrinks a fullscreen window that isn't the active one by a pixel (2560x1439 on a 1440p screen, while
// the emulator has the focus): the game showed through that row as a sliver at the bottom of the black cover, starting
// and quitting. While the cover is up it's stretched back (only that 1-2 px shrink; the helper does it too, every pass).
function coverFullSize() {
  try { if (!alive() || !win.isFullScreen()) return; const b = win.getBounds(), d = screen.getDisplayMatching(b).bounds;
    if ((b.width !== d.width || b.height !== d.height || b.x !== d.x || b.y !== d.y) && Math.abs(b.width - d.width) <= 2 && Math.abs(b.height - d.height) <= 2) win.setBounds(d); } catch {}
}
function clearQuitCover() { if (quitCover) { clearInterval(quitCover); quitCover = null; } goneCover = false; }
// (beta.6) Nothing but Boxshelf and the game on screen: the taskbar is hidden from just before an emulator starts until
// the shelf is back (an emulator's window that wasn't fullscreen yet, or any more, made Windows raise it over the black
// cover for a moment, starting and closing). A file marks it hidden: a watchdog process (padwatch.taskbarGuard) puts it
// back if Boxshelf crashes or is ended, and the next start does too. Settings → Display → Screen & motion turns it off.
let tbHidden = false;
const tbMark = () => path.join(app.getPath('userData'), 'taskbar-hidden');
const tbWanted = () => process.platform === 'win32' && cfg.ui.hideTaskbar !== false;
async function taskbarHide() {
  if (!tbWanted() || tbHidden) return;
  tbHidden = true; try { fs.writeFileSync(tbMark(), String(Date.now())); padwatch.taskbarGuard(process.pid, tbMark()); } catch {} // (the guard: back even if Boxshelf crashes)
  const t0 = Date.now(); const ok = await padwatch.taskbar(false); log('Taskbar hidden for the game', ok ? `(${Date.now() - t0} ms)` : '(no answer)');
}
// Back on the shelf after a game. Fullscreen and in front, Boxshelf would have the taskbar hidden by Windows anyway, so
// it stays hidden until you leave the shelf (the window's blur / leave-full-screen / minimize / hide, set up with the
// window). Showing it here instead left it over the fullscreen shelf until a mouse click: Windows only re-checks for a
// fullscreen app when the active window changes, and Boxshelf already was the active one. A windowed or unfocused shelf
// gets it back at once.
let windowedRun = false; // (Tyro-Shelf-16) the last game ran in "Windowed" mode: the taskbar was never hidden, so Windows never re-checked it
function taskbarBack(focused) {
  if (!tbHidden && windowedRun && !launcher.isRunning() && !launching) {
    // back on the fullscreen shelf after a windowed game: Windows doesn't hide the taskbar by itself (it only re-checks when the active
    // window changes, and the shelf was already the one), so it's hidden here; leaving the shelf shows it again (taskbarLeave)
    windowedRun = false;
    if (focused && tbWanted() && alive() && win.isFullScreen() && win.isVisible() && !win.isMinimized()) { log('Taskbar hidden again for the fullscreen shelf (after a windowed game)'); taskbarHide(); }
    return;
  }
  if (!tbHidden || launcher.isRunning() || launching) return;
  if (focused && alive() && win.isFullScreen() && win.isVisible() && !win.isMinimized()) { log('Taskbar stays hidden while the fullscreen shelf is in front'); return; }
  taskbarShow('back on the shelf');
}
function taskbarShow(why) {
  if (!tbHidden) return; tbHidden = false; try { fs.unlinkSync(tbMark()); } catch {}
  padwatch.taskbar(true).then(() => log('Taskbar back' + (why ? ' (' + why + ')' : '')));
  // (once more a moment later: the watchdog may have been in the middle of a pass when the marker went)
  setTimeout(() => { if (!tbHidden) padwatch.taskbar(true); }, 400);
}
// (beta.6) the game's window closed while the emulator is still running (quit from the emulator's own menu, or Esc): the
// black cover goes up at once, like a Quit from the Home menu; a window that comes back (the emulator only rebuilt it)
// gets the screen back
let goneCover = false;
function onGameWindow(back) {
  if (!back) {
    if (!launcher.isRunning() || quitCover || coverTimer || homemenu.isOpen()) return;
    log('Game window closed, the emulator still running: covering the screen until it exits'); coverForQuit(); goneCover = true; return;
  }
  if (!goneCover || !quitCover || !launcher.isRunning()) return;
  log('Game window back: stepping aside again'); clearQuitCover(); quitAt = 0;
  try { win.setAlwaysOnTop(false); } catch {} padwatch.cover(false); stepAside(); padwatch.front();
}
// While a game runs Boxshelf stays on screen, behind it, fully transparent: it can't be clicked or activated (so it
// never takes the focus from the game) and the page is told to stop drawing. Hiding the window instead meant Windows
// played its show animation when we came back, and the closing game's windows were visible through it.
function stepAside() {
  // (Linux: a see-through window isn't possible there, so Boxshelf hides while the game runs; bringBack shows it again)
  if (linux.isLinux) { try { win.webContents.send('run:aside', true); } catch {} try { win.hide(); } catch {} return; }
  try { win.setSkipTaskbar(true); } catch {} // (Tyro-Shelf-14) the see-through shelf was an Alt+Tab entry with a black picture: not listed while a game runs
  try { win.setOpacity(0); } catch {}
  try { win.setIgnoreMouseEvents(true); } catch {}
  try { win.setFocusable(false); } catch {}
  try { win.webContents.send('run:aside', true); } catch {}
}
function stepIn() {
  try { win.setSkipTaskbar(false); } catch {}
  try { win.setFocusable(true); } catch {}
  try { win.setIgnoreMouseEvents(false); } catch {}
  try { win.webContents.send('run:aside', false); } catch {}
}
// the game's window is fullscreen: lift the cover a beat later (its first frame), never sooner than 0.8 s in
function liftCover() {
  const t = coverTimer; if (!t || !t.lift) return;
  const wait = Math.max(350, (t.minMs || 800) - (Date.now() - t.at));
  setTimeout(() => { if (coverTimer === t) { log('game window ready: lifting the loading screen'); t.lift(); } }, wait);
}
let backKeep = null, backGuardUntil = 0, backGuardTries = 0;
function bringBack() {
  markEvent('bringBack'); backAt = Date.now(); backGuardUntil = backAt + 20000; backGuardTries = 0;
  if (!alive()) return;
  if (win.isMinimized()) win.restore();
  stepIn();
  if (!win.isVisible()) win.show();
  try { win.setOpacity(1); } catch {}
  win.setAlwaysOnTop(true);
  win.focus();
  // Windows often won't let a background app take the focus back: ask the controller helper to hand it over
  try { const b = win.getNativeWindowHandle(); padwatch.focusWindow(b.length >= 8 ? b.readBigUInt64LE(0).toString() : String(b.readUInt32LE(0))); } catch (e) { log('focus handoff', e.message); }
  // (beta.6) Stay on top until Windows has really given Boxshelf the focus (the helper's handoff comes when the shelf's
  // helper starts, ~1.5 s), at most 5 s. Letting go after 0.4 s left a gap: the closing game's focus went to the next
  // window in line (Discord, Explorer…), which then came up over the whole shelf. The taskbar returns after that.
  clearInterval(backKeep); const t0 = Date.now();
  backKeep = setInterval(() => {
    if (!alive() || launcher.isRunning()) { clearInterval(backKeep); backKeep = null; return; }
    const el = Date.now() - t0, focused = win.isFocused();
    if ((focused && el > 400) || el > 5000) {
      clearInterval(backKeep); backKeep = null; try { win.setAlwaysOnTop(false); win.moveTop(); } catch {}
      if (!focused) log('Back on the shelf without the focus (Windows refused it)');
      taskbarBack(focused);
      return; }
    try { if (!win.isAlwaysOnTop()) win.setAlwaysOnTop(true); win.moveTop(); } catch {}
  }, 100);
  // (and ask for a fresh frame now and a moment later, in case the window still isn't being drawn)
  const paint = () => { try { if (alive() && !launcher.isRunning()) win.webContents.invalidate(); } catch {} };
  paint(); setTimeout(paint, 300); setTimeout(paint, 1200);
}

// While an emulator boots, keep Boxshelf's black loading screen above it so its
// windowed start-up never shows. Then step aside so the game is in front.
let coverTimer = null;
let gameWinSeen = false;
function coverWhileStarting(seconds, o2) {
  gameWinSeen = false;
  if (coverTimer && coverTimer.keep) clearInterval(coverTimer.keep);
  clearTimeout(coverTimer);
  if (!win || !(seconds > 0)) return 0;
  // In a window, the emulator's windows show around our edges: go fullscreen for the cover, then back
  const wasWindowed = !win.isFullScreen();
  if (wasWindowed) { try { win.setFullScreen(true); } catch {} }
  coverWindowed = wasWindowed;
  win.setAlwaysOnTop(true, 'screen-saver');
  padwatch.cover(true); // (beta.6) and the helper puts it back over any of the game's windows within ~40 ms
  // Some emulators (Eden) create their window in two steps and can pop over us; keep re-asserting until the cover ends.
  const t0 = Date.now(); let lastTop = 0;
  const keep = setInterval(() => { try { if (!alive() || !coverTimer) return; coverFullSize(); const now = Date.now(); if (now - t0 > 2500 && now - lastTop < 1000) return; lastTop = now; if (!win.isAlwaysOnTop()) win.setAlwaysOnTop(true, 'screen-saver'); win.moveTop(); homemenu.raise(); } catch {} }, 100);
  const lift = () => {
    if (!coverTimer) return; clearTimeout(coverTimer);
    if (Date.now() - t0 >= seconds * 1000 - 50) log('Loading screen lifted on its timer: no fullscreen game window was seen in', seconds, 's (a slow start, or a windowed / borderless game)');
    coverTimer = null; clearInterval(keep); setTimeout(() => { if (launcher.isRunning()) dumpTopLevel('during game'); }, 6000);
    if (!alive()) return;
    // (a windowed Boxshelf stays fullscreen while hidden: switching back to a window here showed it popping up as a
    //  window for a moment before it hid. It goes back to a window when the game ends: see onExit)
    if (!launcher.isRunning()) { if (wasWindowed) { try { win.setFullScreen(false); } catch {} coverWindowed = false; } return; }
    win.webContents.send('run:ready'); // the loading screen fades to black (.28 s), then Boxshelf steps aside
    const qs = quitSeq; // Quit pressed in these 300 ms: the quit cover must stay opaque (stepAside made it see-through)
    setTimeout(() => {
    if (!alive() || !launcher.isRunning() || qs !== quitSeq) return;
    padwatch.cover(false); // (first: the helper must not pull the cover back over the game)
    win.setAlwaysOnTop(false);
    // the game straight to the front (no win.blur(): Windows hands a blurred window's focus to the next one in line,
    // usually the taskbar, which then showed over the fullscreen game until a click). The helper keeps the game in front
    // for a few seconds if the taskbar or desktop still ends up active; again a moment later in case its game window
    // appeared after the first one
    padwatch.front();
    // step aside without the minimize animation (the game is already fullscreen behind us); bringBack shows us again
    stepAside();
    homemenu.ready(); setTimeout(() => { if (launcher.isRunning()) { padwatch.front(); homemenu.raise(); } }, 1500);
    }, 300);
  };
  // lifts when the game's window is up and fullscreen (padwatch GAMEFS → liftCover), or after `seconds` at the latest
  // (Tyro-Shelf) a game that hasn't opened any window by then (a slow first start) keeps the cover up until its window shows, 40 s at most
  const baseMs = seconds * 1000, maxMs = Math.max(baseMs, ((o2 && o2.untilWindow) || 0) * 1000);
  coverTimer = setInterval(() => { const el = Date.now() - t0; if (el >= baseMs && (gameWinSeen || el >= maxMs || !launcher.isRunning())) lift(); }, 250);
  coverTimer.keep = keep; coverTimer.lift = lift; coverTimer.at = Date.now();
  return seconds;
}

function watchPad(opts) {
  opts = opts || {}; lastPadOpts = opts;
  // (the helper keeps Boxshelf's see-through window below the running game: above it, the taskbar showed over the game)
  try { if (alive()) { const b = win.getNativeWindowHandle(); padwatch.setSelf(b.length >= 8 ? b.readBigUInt64LE(0).toString() : String(b.readUInt32LE(0))); } } catch {}
  const home = cfg.ui.homeMenu !== false && !!opts.home;
  if (cfg.ui.quitCombo === false && !(opts.mouse || opts.fullscreenKey || home)) return;
  // with the quit combo turned off, use a mask no pad can press so only the other duties remain
  const combo = cfg.ui.quitCombo === false ? null : (cfg.ui.quitComboKeys || 'l3+r3');
  padwatch.start(combo || 'none', 900, () => { log('Quit combo: closing', launcher.isRunning() ? 'emulator' : 'nothing'); if (launcher.isRunning()) coverForQuit(); closeGame(); },
    { ...opts, home, nin: true, onGameWin: () => { gameWinSeen = true; }, taskbarHidden: tbHidden, onWindow: opts.appPid ? onGameWindow : undefined, cmdFile: path.join(app.getPath('temp'), `boxshelf-pad-${process.pid}.txt`), onHome: kind => { homemenu.setMeta({ glyphs: kind || shelfGlyphs }); /* the menu shows the buttons of the pad that opened it (an XInput pad: the shelf's last prompts) */ Promise.resolve(homemenu.open()).catch(e => log('home menu', e && e.message)); }, onButton: (b, d) => homemenu.button(b, d), isMenuOpen: () => homemenu.isOpen(), onFullscreen: opts.appPid ? liftCover : undefined });
}
function onExit(info) {
  if (scriptRun) { try { gscripts.afterExit(scriptRun.g, scriptRun.game, cfg.scripts); } catch (e) { log('Game scripts:', e.message); } scriptRun = null; }
  setTimeout(() => dumpWindows('after game'), 4000); setTimeout(() => dumpTopLevel('after game'), 5000);
  markEvent('game exited'); presence.stop(); clearQuitCover(); wiimote.resume(); // (the Wii remote back to the shelf, after Dolphin had it)
  // (1.82) a game's emulator that closed by itself within 5 s (a missing BIOS, keys or firmware, bad launch options) wasn't a
  // play: the shelf says which emulator closed instead of quietly coming back, and the history isn't touched
  const quick = !!(info && !info.failedToStart && info.code !== -1 && !quitAt && runKind === 'game' && lastLaunch && info.ms < 5000);
  if (quick) { const def = CONSOLES.find(c => c.id === lastLaunch.systemId); info = { ...info, quick: true, emulatorName: (def && def.emulatorName) || 'The emulator' }; log('Emulator closed right away:', info.emulatorName, 'code', info.code, info.ms + ' ms'); }
  if (quitAt) { log('game closed', Date.now() - quitAt, 'ms after Quit' + (Date.now() - quitAt > 2400 ? ' (had to be forced)' : '')); quitAt = 0; }
  padwatch.stop(); homemenu.end(); if (info && (info.failedToStart || info.quick)) historyUndo(); else historyEnd();
  if (coverTimer && coverTimer.keep) clearInterval(coverTimer.keep);
  // the emulator died inside the cover window: undo the temporary fullscreen too
  if (coverWindowed && alive()) { try { win.setFullScreen(false); } catch {} coverWindowed = false; }
  // Achievements earned during this session (RA needs a few seconds to register the last unlock)
  if (lastLaunch && ra.enabled() && ra.CONSOLE_ID[lastLaunch.systemId]) {
    const since = (Date.now() - lastLaunch.at) / 60000 + 2;
    setTimeout(() => ra.recent(since).then(list => { if (list.length && alive()) win.webContents.send('ra:unlocks', list); }).catch(e => log('RA recent', e.message)), 4000);
  }
  lastLaunch = null;
  clearTimeout(coverTimer); coverTimer = null;
  bringBack(); if (cfg.ui.homeMenu === false) focusOnlyHelper();
  // (beta.6) the taskbar comes back once the shelf has the focus again (bringBack)
  if (alive()) win.webContents.send('run:exited', info);
  if (pendingPower) { const p = pendingPower; pendingPower = null; if (Date.now() - p.at < 20000) { setTimeout(() => powerAction(p.kind), 800); setTimeout(() => { if (alive() && !launcher.isRunning()) watchShelf(); }, 15000); return; } /* a cancelled shutdown still needs Guide back */ log('Power: dropped a stale', p.kind); } // a game that took ages to close: don't shut the PC down out of the blue later
  setTimeout(watchShelf, 1500);
}

// Freeze watch: if the main process is blocked for more than a quarter second, log it with what was going on
// (a stall here freezes the shelf's input and window handling too)
let lagAt = Date.now(), lastEvent = 'start';
const markEvent = e => { lastEvent = e + ' @' + new Date().toISOString().slice(11, 19); };
setInterval(() => { const now = Date.now(), lag = now - lagAt - 100; lagAt = now; if (lag > 250) log('freeze watch: main process blocked', lag, 'ms (last:', lastEvent + ')'); }, 100).unref();
// ---------- library ----------
// An icon not extracted yet holds the scan up for at most 2.5 s; when it arrives later, the shelf rescans (cached then)
let iconLateT = null;
function iconQuick(exe) {
  const p = icons.iconFor(emuPath(exe)); let late = false, t;
  return Promise.race([p.then(v => { clearTimeout(t); return v; }), new Promise(r => { t = setTimeout(() => { late = true; r(null); }, 2500); })])
    .finally(() => { if (late) p.then(v => { if (v && !iconLateT) iconLateT = setTimeout(() => { iconLateT = null; if (alive()) win.webContents.send('library:changed', { icons: 1 }); }, 1000); }).catch(() => {}); });
}
// (beta.7) store games: real store titles, so their covers come from the Steam app with the same name (not Quiver's or
// hand-added programs: those often share a name with an unrelated game)
const STORE_SRC = new Set(['epic', 'gog', 'ubisoft', 'ea', 'xbox', 'hoyoplay']);
async function buildLibrary() {
  const shelves = [];
  for (const def of CONSOLES) {
    const sc = cfg.systems[def.id];
    if (!sc || !sc.enabled) continue;
    await new Promise(r => setImmediate(r)); // let covers and IPC through between shelves: a big folder scan shouldn't freeze everything
    if (!sc.emulator && !(sc.romDirs || []).length) continue;
    if (def.id === 'x360') { let t; try { await Promise.race([x360.ensureDb(), new Promise(r => { t = setTimeout(r, 15000); })]); } catch {} finally { clearTimeout(t); } }
    const games = scanSystem(def, sc).map(g => ({ ...g, info: covers.gameInfo(def.id, g.title), art: { front: fileUrl(g.art.front), hero: fileUrl(g.art.hero), back: fileUrl(g.art.back), madeBack: g.art.madeBack || undefined, spine: fileUrl(g.art.spine), madeSpine: g.art.madeSpine || undefined, disc: fileUrl(g.art.disc), manual: withCover(def.id, g, (g.art.manual || []).map(fileUrl)), manualPdf: fileUrl(g.art.manualPdf) } }));
    // (beta.7) arcade zips are named from FinalBurn Neo's list: fetched once in the background, then the shelf refreshes
    if (games.length && arcadenames.SYSTEMS.has(def.id) && !arcadenames.ready()) arcadenames.fetchNames().then(ok => { if (ok && alive()) win.webContents.send('library:changed', { arcade: 1 }); });
    shelves.push({ id: def.id, kind: 'console', name: def.name, emulatorName: def.emulatorName, hasEmulator: !!sc.emulator && paths.isFile(emuPath(sc.emulator)) /* (1.82) an uninstalled one gets no Open tile */, emulator: sc.emulator, emulatorIcon: fileUrl(await iconQuick(sc.emulator)), gameArgs: sc.gameArgs, bootOnLaunch: sc.bootOnLaunch !== false, useIpl: def.id === 'gc' && !!sc.useIpl, insertAnim: sc.insertAnim !== false, games });
  }
  let pcShelf = [];
  if (cfg.steam.enabled && cfg.steam.path) {
    // Steam's own cached art first, then anything Boxshelf fetched from the Steam store for games Steam has no cover for
    pcShelf = scanSteam(cfg.steam.path, { hideTools: cfg.steam.hideTools !== false }).map(g => { const l = steamart.local(g.appid); return { ...g, ...(ownTitle(g.id) ? { title: ownTitle(g.id), fileTitle: g.title } : {}), info: steamart.gameInfo(g.appid), art: { front: fileUrl(pccovers.cover(g.id) || g.art.front || l.front), hero: fileUrl(g.art.hero || l.hero) } }; }); // (beta.5: a cover chosen in the picker wins)
  }
  // (beta.4) Epic's installs join the PC shelf; Quiver Launcher's apps and games added by hand get the Custom shelf. They
  // are PC games with a source (kind 'steam' keeps every shelf feature); covers come from the Steam app their title
  // matched (pcgames.matchSteam, never an appid the screen could launch: Play goes through launch:pc by id)
  const pc = cfg.pc || {}, epic = [], mine = [];
  legendary.setPath(pc.legendaryPath);
  if (pc.epic !== false) try {
    const eg = pc.legendary !== false ? pcgames.legendaryGames(legendary) : [], lid = new Set(eg.map(g => g.id)); // Legendary's installs win over the Epic launcher's entry for the same game
    epic.push(...pcgames.epicGames().filter(g => !lid.has(g.id)), ...eg);
  } catch (e) { log('Epic library', e.message); }
  // (beta.7) GOG Galaxy, Ubisoft Connect, the EA app and Xbox / Game Pass join the PC shelf too, like Epic (store games)
  try { epic.push(...await pcgames.storeGames(pc)); } catch (e) { log('PC stores', e.message); }
  if (pc.quiver !== false) try { mine.push(...pcgames.quiverGames(pc.quiverPath)); } catch (e) { log('Quiver library', e.message); }
  try { mine.push(...pcgames.customGames(pc.custom)); } catch (e) { log('Custom games', e.message); }
  for (const g of [...epic, ...mine]) { const t = ownTitle(g.id); if (t) { g.fileTitle = g.title; g.title = t; } } // (beta.5: renamed in Details)
  pcgames.remember([...epic, ...mine]);
  // (Steam art by title only for Epic's store games: a recomp or a program added by hand often shares its name with an
  // unrelated Steam game, "Quarantine" got a puzzle game's cover; they keep the made-up case)
  const pcGame = g => { const sid = STORE_SRC.has(g.source) ? pcgames.steamIdOf(g.title) : null, l = sid ? steamart.local(sid) : {};
    return { kind: 'steam', source: g.source, id: g.id, title: g.title, ...(sid ? { info: steamart.gameInfo(sid) } : {}), art: { front: fileUrl(pccovers.cover(g.id) || l.front), back: fileUrl(pccovers.cover(g.id, 'back')) || undefined, spine: fileUrl(pccovers.cover(g.id, 'spine')) || undefined, hero: fileUrl(l.hero), icon: g.icon || undefined } }; };
  if (epic.length) pcShelf = pcShelf.concat(epic.map(pcGame)).sort((a, b) => String(a.title).localeCompare(String(b.title), undefined, { sensitivity: 'base' }));
  if (pcShelf.length) shelves.push({ id: 'pc', kind: 'steam', name: 'PC', games: pcShelf });
  if (mine.length) shelves.push({ id: 'custom', kind: 'steam', name: 'Custom', games: mine.map(pcGame).sort((a, b) => String(a.title).localeCompare(String(b.title), undefined, { sensitivity: 'base' })) });
  const apps = [];
  for (const a of APPS) { const c = cfg.apps[a.id]; if (!c || !c.enabled || !c.path) continue; apps.push({ kind: 'app', id: 'app-' + a.id, appId: a.id, title: a.name, path: c.path, art: { icon: fileUrl(await iconQuick(c.path)) } }); }
  if (apps.length) shelves.push({ id: 'media', kind: 'apps', name: 'Media', games: apps });
  covers.flushInfoCache();
  return shelves;
}

// ---------- IPC ----------
ipcMain.on('renderer:log', (e, msg) => log('[ui]', msg));
padwatch.init(log, app.getPath('userData'));
// (beta.6) the last Boxshelf ended with the taskbar hidden (a crash, a power cut, ended from Task Manager): put it back
try { if (fs.existsSync(tbMark())) { fs.unlinkSync(tbMark()); padwatch.taskbar(true).then(() => log('Taskbar back (left hidden by the last session)')); } } catch {}
customThemes.init({ root: path.join(paths.appRoot(), 'Custom themes'), cache: path.join(app.getPath('userData'), 'custom-theme-cache'), nativeImage, systems: CONSOLES.map(c => c.id).concat('home', 'media'), log });
homemenu.init({ padwatch, log, getWin: () => (alive() ? win : null), getUi: () => cfg.ui, getSound: () => ({ enabled: cfg.ui.sound !== false, theme: cfg.ui.soundTheme || 'aero', volume: cfg.ui.volume == null ? .7 : cfg.ui.volume, boot: cfg.ui.bootSound || 'chime' }),
  // quit the game; with a power action, run it once the emulator has really exited (onExit)
  onQuit: then => { log('Home menu: quit'); pendingPower = then ? { kind: then, at: Date.now() } : null; coverForQuit(); closeGame(); },
  onPower: kind => powerAction(kind),
  onShelf: action => {
    // power actions: hand the shelf back first, so after waking (or a cancelled shutdown) it takes input again
    if (['sleep', 'restart', 'shutdown'].includes(action)) { if (alive()) win.webContents.send('shelf:menu', { open: false, action: 'resume' }); return powerAction(action); }
    if (action === 'quitapp') { log('Quit: Exit Boxshelf chosen in the Home menu'); return app.quit(); }
    if (alive()) { win.webContents.send('shelf:menu', { open: false, action }); bringBack(); }
  } });
// Sleep / Restart / Shut down the PC from the couch
let pendingPower = null, lastPadOpts = null, runKind = null;
// Media apps close at once (and some only hide to the tray): force them sooner than emulators, which may be saving
function closeGame() { return launcher.closeRunning(runKind === 'app' ? 2500 : 8000, pid => log('Quit: had to force-close', pid)); }
// Interface size for TVs across the room (Settings → Display): the whole page is zoomed, layout scales with it
// The page is laid out for a 1080-tall screen. On a taller one (1440p, or a 4K TV at 100 % Windows scaling) everything
// is scaled up with it, so the shelf looks the same on any TV: 1080 → 1×, 1440 → 1.33×, 2160 → 2× (never below 1×).
// Interface size (Settings → Display) multiplies on top. The renderer is told the automatic part so the museum and
// Inspect keep drawing at the screen's full sharpness (their pixel caps are meant per 1080p-sized pixel).
let scaleSent = '';
function applyScale() {
  if (!alive()) return;
  const user = [1, 1.15, 1.3].includes(+cfg.ui.uiScale) ? +cfg.ui.uiScale : 1;
  let auto = 1; try { const [, h] = win.getContentSize(); if (h > 0) auto = Math.max(1, Math.min(2, Math.round(h / 1080 * 100) / 100)); } catch {}
  const z = Math.round(user * auto * 1000) / 1000;
  try { if (Math.abs(win.webContents.getZoomFactor() - z) > .001) win.webContents.setZoomFactor(z); } catch {}
  const sig = auto + '|' + z; if (sig !== scaleSent) { scaleSent = sig; try { win.webContents.send('ui:scale', { auto, zoom: z }); } catch {} }
}
let scaleT = null; const applyScaleSoon = () => { clearTimeout(scaleT); scaleT = setTimeout(applyScale, 150); };
function powerAction(kind) {
  log('Power:', kind);
  if (process.platform !== 'win32') return;
  try {
    if (kind === 'sleep') spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', "Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)"], { windowsHide: true, stdio: 'ignore', detached: true }).on('error', e => log('Power failed', e.message)).unref();
    else if (kind === 'restart' || kind === 'shutdown') spawn('shutdown.exe', [kind === 'restart' ? '/r' : '/s', '/t', '0'], { windowsHide: true, stdio: 'ignore', detached: true }).on('error', e => log('Power failed', e.message)).unref();
  } catch (e) { log('Power failed', e.message); }
}
// On the shelf the XInput helper still runs (lightly) so Guide can open the Home menu even though Chromium never sees it
function watchShelf() {
  if (cfg.ui.homeMenu === false || launcher.isRunning()) return;
  padwatch.start('none', 900, () => {}, { home: true, backHome: false, taskbarHidden: tbHidden /* (beta.6: kept hidden until you leave the shelf) */, stream: true, onPadState: s => { if (alive() && !launcher.isRunning()) { try { win.webContents.send('pad:state', s); } catch {} } }, cmdFile: path.join(app.getPath('temp'), `boxshelf-pad-${process.pid}.txt`),
    onHome: () => { if (!closeTrailer()) openShelfMenu(); }, onButton: (b, d) => { if (d && (b === 'b' || b === 'back') && !homemenu.isOpen() && closeTrailer()) return; homemenu.button(b, d); }, isMenuOpen: () => homemenu.isOpen() });
}
// With the Home menu off no shelf helper follows the game's, and Windows won't let Boxshelf take the focus back by
// itself: run a short-lived helper just to hand it over (bringBack's request is repeated by a new helper)
let focusOnlyT = null;
function focusOnlyHelper() {
  if (launcher.isRunning() || !padwatch.focusPending()) return;
  padwatch.start('none', 900, () => {}, { cmdFile: path.join(app.getPath('temp'), `boxshelf-pad-${process.pid}.txt`) });
  clearTimeout(focusOnlyT); focusOnlyT = setTimeout(() => { if (!launcher.isRunning() && cfg.ui.homeMenu === false) padwatch.stop(); }, 10000);
}
// from Guide: only when Boxshelf itself is what you're looking at; from the shelf's Home key: always
function openShelfMenu(fromKey) {
  if (!alive() || homemenu.isOpen() || launcher.isRunning() || (!fromKey && (!win.isFocused() || cfg.ui.homeMenu === false))) return;
  // Guide: ask the shelf first — it only accepts on the shelf or the details panel (not Inspect, museum, Settings, starting a game)
  if (!fromKey) { win.webContents.send('shelf:menuRequest'); return; }
  if (!padwatch.isRunning()) watchShelf(); // buttons inside the menu come from the helper
  if (homemenu.openShelf({ title: 'Home', system: 'Tyro-Shelf', subtitle: shelfSummary, accent: '#9d8cff', glyphs: shelfGlyphs, layout: cfg.ui.homeLayout === 'center' ? 'center' : 'side', confirmButton: shelfSwap ? 'b' : 'a', audioOut: typeof cfg.ui.audioOut === 'string' ? cfg.ui.audioOut : '' }))
    win.webContents.send('shelf:menu', { open: true });
}
// ---------- the Wii remote on the shelf (Windows) ----------
// A remote on a DolphinBar (Dolphin mode, never switched) points at the screen like on a Wii: the pointer drives the
// shelf as a mouse (hover, click, drag to scroll), A clicks where it points (or confirms the selection when it isn't
// pointing at the screen), and the other buttons reach the shelf as a controller (renderer: the virtual Wii pad). While
// the Home menu is open the remote drives that. Dolphin gets the remote for its games (pause / resume around them).
const wm = { b: 0, aMouse: false, sx: -1, sy: -1, seen: false, seenAt: 0, px: -1, py: -1, sentAt: 0, on: false }; let wmReady = false;
function wmGain() { const n = +cfg.ui.wmSpeed; return Number.isFinite(n) && n >= .8 && n <= 3 ? n : 1.5; }
function wmState(s) {
  if (!alive()) return;
  const B = wiimote.BTN, prevB = wm.b, now = Date.now(); wm.b = s.buttons;
  const press = k => (s.buttons & k) && !(prevB & k), lift = k => !(s.buttons & k) && (prevB & k);
  // a game owns the screen: Home opens Boxshelf's Home menu over it (the remote then drives the menu: Resume, Quit…).
  // (Dolphin's games have the remote themselves: there it's a held Home, from wmWatch)
  if (launcher.isRunning() || launching) { wm.aMouse = false; if (homemenu.isOpen()) wmMenu(press, lift); else if (press(B.home) && !launching) Promise.resolve((homemenu.setMeta({ glyphs: 'nintendo' }), homemenu.open())).catch(e => log('home menu', e && e.message)); return; }
  // the pointer: a central part of the camera's view covers the screen (wmSpeed), smoothed, a little still zone
  if (s.seen) {
    const g = wmGain(), cl = v => Math.max(0, Math.min(1, v)), tx = cl((s.x - .5) * g + .5), ty = cl((s.y - .5) * g + .5);
    if (wm.sx < 0 || !wm.seen) { wm.sx = tx; wm.sy = ty; } else { const d = Math.hypot(tx - wm.sx, ty - wm.sy), a = d > .03 ? .6 : d > .006 ? .35 : .12; wm.sx += (tx - wm.sx) * a; wm.sy += (ty - wm.sy) * a; }
    wm.seen = true; wm.seenAt = now;
  } else if (now - wm.seenAt > 250) wm.seen = false;
  const menu = homemenu.isOpen(), focused = win.isFocused();
  if (menu) {
    wmMenu(press, lift);
    if (wm.aMouse) { wm.aMouse = false; try { win.webContents.sendInputEvent({ type: 'mouseUp', x: wm.px, y: wm.py, button: 'left', clickCount: 1 }); } catch {} }
  } else if (focused) {
    const [w, h] = win.getContentSize(), px = Math.round(wm.sx * w), py = Math.round(wm.sy * h);
    if (wm.seen && (px !== wm.px || py !== wm.py)) { wm.px = px; wm.py = py; try { win.webContents.sendInputEvent({ type: 'mouseMove', x: px, y: py, modifiers: wm.aMouse ? ['leftButtonDown'] : [] }); } catch {} }
    // A: a click where it points (held: a drag); not pointing at the screen: the confirm button, through the virtual pad
    if (press(B.a) && wm.seen) { wm.aMouse = true; try { win.webContents.sendInputEvent({ type: 'mouseDown', x: wm.px, y: wm.py, button: 'left', clickCount: 1 }); } catch {} }
    if (lift(B.a) && wm.aMouse) { wm.aMouse = false; try { win.webContents.sendInputEvent({ type: 'mouseUp', x: wm.px, y: wm.py, button: 'left', clickCount: 1 }); } catch {} }
  }
  // the shelf: the hand cursor and the buttons (A left out while it's acting as the mouse)
  if (now - wm.sentAt >= 12 || s.buttons !== prevB) { wm.sentAt = now; win.webContents.send('wiimote', { x: wm.sx, y: wm.sy, seen: wm.seen && !menu, b: menu ? 0 : s.buttons & ~(wm.aMouse ? B.a : 0), hold: cfg.ui.wmHold === 'sideways' ? 'sideways' : 'upright' }); }
}
// the Home menu (on the shelf or over a game): the remote's buttons, as the controller helper reports a pad's
function wmMenu(press, lift) {
  const B = wiimote.BTN, side = cfg.ui.wmHold === 'sideways', dir = side ? { up: 'left', down: 'right', left: 'down', right: 'up' } : { up: 'up', down: 'down', left: 'left', right: 'right' };
  for (const [k, name] of [['up', dir.up], ['down', dir.down], ['left', dir.left], ['right', dir.right], ['a', 'a'], ['two', 'a'], ['b', 'b'], ['one', 'b'], ['home', 'home'], ['plus', 'start']]) {
    if (press(B[k])) homemenu.button(name, true); else if (lift(B[k])) homemenu.button(name, false);
  }
}
// During a Dolphin game the remote is Dolphin's: Boxshelf only listens (never sends it anything) for Home held about a
// second, which opens Boxshelf's Home menu (a tap stays the game's own Wii HOME menu); while that menu is open the
// remote drives it. buttons: the remote's bits as the game's own reports carry them
const wmW = { b: 0, homeAt: 0, fired: false };
function wmWatch(buttons) {
  const B = wiimote.BTN, prev = wmW.b; wmW.b = buttons;
  const press = k => (buttons & k) && !(prev & k), lift = k => !(buttons & k) && (prev & k);
  if (!launcher.isRunning()) return;
  if (homemenu.isOpen()) { wmMenu(press, lift); wmW.homeAt = 0; return; }
  if (press(B.home)) { wmW.homeAt = Date.now(); wmW.fired = false; const at = wmW.homeAt; setTimeout(() => { if (wmW.homeAt === at && (wmW.b & B.home) && !wmW.fired && launcher.isRunning() && !homemenu.isOpen()) { wmW.fired = true; log('Wii remote: Home held, Home menu'); homemenu.setMeta({ glyphs: 'nintendo' }); Promise.resolve(homemenu.open()).catch(e => log('home menu', e && e.message)); } }, 900); }
  if (lift(B.home)) wmW.homeAt = 0;
}
function wmStart() {
  if (process.platform !== 'win32' || cfg.ui.wiimote === false || wiimote.isRunning()) return;
  wiimote.start({ cacheDir: path.join(app.getPath('userData'), 'wiimote-cache'), log, onState: wmState, onWatch: wmWatch,
    onConnect: on => { wm.on = on; if (!on) { wm.seen = false; wm.b = 0; if (wm.aMouse && alive()) { wm.aMouse = false; try { win.webContents.sendInputEvent({ type: 'mouseUp', x: wm.px, y: wm.py, button: 'left', clickCount: 1 }); } catch {} } } if (alive()) win.webContents.send('wiimote', { on, seen: false, b: 0 }); } });
}
// the real controllers plugged in (the shelf's button prompts for XInput pads: main/padsense.js)
handle('pads:present', () => padsense.list());
ipcMain.on('wm:rumble', (e, ms) => { if (wm.on && !launcher.isRunning()) wiimote.rumble(Math.max(10, Math.min(80, +ms || 25))); });
// the shelf sends its live prompt style and confirm swap (Confirm "Match my controller" follows the pad in use)
let shelfSummary = '', shelfGlyphs = 'xbox', shelfSwap = false;
const glyphsOf = g => g === 'ps' || g === 'nintendo' ? g : 'xbox';
ipcMain.on('shelf:info', (e, i) => { if (i && typeof i === 'object') { shelfSummary = String(i.summary || '').slice(0, 120); shelfGlyphs = glyphsOf(i.glyphs); shelfSwap = !!i.swap; } });
// the shelf can open it too (Home key), and passes keys through while it's open
ipcMain.on('shelf:openMenu', () => openShelfMenu(true));
ipcMain.on('shelf:menuKey', (e, k) => { const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'ok', Escape: 'cancel', Backspace: 'cancel', Home: 'home' } /* keys mean select / back whichever face button confirms */; const b = map[k && k.key]; if (b) homemenu.button(b, !!k.down); });
// the overlay reports the chosen action; the shelf adds what it knows about the game (title, cover, colour, prompts)
const HOME_ACTIONS = ['resume', 'save', 'load', 'shot', 'quit', 'sleep', 'restart', 'shutdown', 'quitapp', 'shelfhome', 'museum', 'settings'];
ipcMain.on('home:act', (e, a) => homemenu.act(HOME_ACTIONS.includes(a) ? a : 'resume')); // anything unexpected still closes the menu properly
ipcMain.on('home:meta', (e, m) => { if (!m || typeof m !== 'object') return; const str = v => typeof v === 'string' ? v.slice(0, 4000000) : undefined;
  homemenu.setMeta({ title: str(m.title), cover: str(m.cover), accent: /^#[0-9a-f]{3,8}$/i.test(m.accent || '') ? m.accent : undefined, glyphs: glyphsOf(m.glyphs), layout: cfg.ui.homeLayout === 'center' ? 'center' : 'side' }); });
emucfg.init(log);
modelfind.init(log);
app.on('before-quit', () => { try { presence.shutdown(); } catch {} if (tbHidden) { tbHidden = false; try { fs.unlinkSync(tbMark()); } catch {} /* (Tyro-Shelf-11) marker first: the watchdog re-hid the taskbar every 100 ms while it existed, and the show below takes ~1 s */ padwatch.stop(); padwatch.taskbarSync(true); log('Taskbar back (Boxshelf quitting)'); } /* (beta.6) */ clearTimeout(scaleT); historyEnd(); companion.stop().catch(() => {}); /* the phone companion's server and its connections */ padwatch.stop(); wiimote.stop(); homemenu.end(); modelfind.stop(); clearQuitCover(); clearTimeout(focusOnlyT); if (coverTimer) { clearInterval(coverTimer.keep); clearTimeout(coverTimer); coverTimer = null; }
  romWatchers.forEach(w => { try { w.close(); } catch {} }); romWatchers = []; clearTimeout(romWatchT); clearTimeout(iconLateT); Object.values(retestT).forEach(clearTimeout); if (moving) clearTimeout(moving.t); });
function handle(name, fn) {
  ipcMain.handle(name, async (e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; }
    catch (err) { if ((/^(archive|library|reading):/.test(name) || name === 'art:games') && !err.cancelled) log('IPC', name, 'failed:', err.message || String(err)); return { ok: false, error: err.message || String(err) }; } // (the magazines finder used to fail without a trace)
  });
}

handle('config:get', () => ({ config: cfg, consoles: CONSOLES, apps: APPS, appRoot: paths.appRoot(), version: app.getVersion(), build: TYRO_BUILD, hasInfo: covers.hasInfo(), settingsBlocked: config.blocked() }));
// (1.82) Settings → About: the newest beta (force: ask GitHub now, not the answer from this start) and the page's links
// (Tyro-Shelf-17) updates from Tyro-Shelf's own GitHub releases (package.json tyroRepo): check, and Install (download, then the exe is swapped
// in once the app has closed: main/updates.js). Never contacts the original project's page.
const TYRO_PKG = (() => { try { return require('./package.json'); } catch { return {}; } })(), TYRO_BUILD = +TYRO_PKG.tyroBuild || 0;
handle('update:check', ({ force } = {}) => updates.check(!!force));
handle('update:install', async () => {
  if (launcher.isRunning()) throw new Error('Close the game first, then install the update.');
  const r = await updates.install(pct => { try { if (alive()) win.webContents.send('update:progress', pct); } catch {} });
  log('Update: installing', r.latest, '- closing so the new exe can start');
  setTimeout(() => { try { app.quit(); } catch { process.exit(0); } }, 700);
  return { ok: true, latest: r.latest };
});
handle('config:save', next => { if (!next || typeof next !== 'object' || !next.systems || !next.ui) throw new Error('Bad settings.'); return applyCfg({ ...next, art: cfg.art, games: cfg.games, emuSetup: { ...(next.emuSetup || {}), pending: (cfg.emuSetup || {}).pending || [] }, ui: { ...next.ui, sw2Last: cfg.ui.sw2Last } }); }); // Art Studio styles and locks change through art:* only: a Settings save with its older copy mustn't undo them. (beta.8) The same for what main itself keeps: each game's own name and emulator (Details → Rename / Emulator), Set up for me's waiting list and Switch 2's last build: a screen's older copy saved later used to undo a rename, or bring back a setup that was already done
// settings saved (or restored from a backup): store them and put every change into effect now
function applyCfg(next) { const prev = cfg, hadMenu = cfg.ui.homeMenu !== false; next = rememberEmus(prev, next); const x = o => o && o.systems && o.systems.x360 && o.systems.x360.emulator; if (x(next) !== x(prev)) next = fixXenia(next); /* (the folder walk only when that path changed) */ cfg = persistCfg(config.normalize(next)); applyArtLibrary(); applyScale(); setTimeout(watchRoms, 0); if (cfg.ui.wiimote === false) wiimote.stop(); else if (wmReady) wmStart(); /* (Settings → Controller → Wii remote, at once) */
  // Home menu switched on/off: start or stop the shelf's Guide watcher now (not after the next game)
  if (!launcher.isRunning() && hadMenu !== (cfg.ui.homeMenu !== false)) { if (cfg.ui.homeMenu === false) padwatch.stop(); else watchShelf(); }
  ra.setCredentials(cfg.ra && cfg.ra.enabled !== false ? cfg.ra.user : '', cfg.ra && cfg.ra.key);
  presence.configure({ enabled: cfg.ui.discordPresence, clientId: cfg.ui.discordClientId }, log);
  launcher.setPadSafe(cfg.ui.dolphinPadSafe);
  try { cfgChanged(prev, cfg); } catch (e) { log('settings change', e.message); }
  return cfg; }
handle('detect', () => detectAll());
// The last scan is kept on disk so the next launch can show the shelves immediately (as console UIs do) while a fresh
// scan runs behind them; the renderer only rebuilds if something actually changed.
// Wii U e-manuals start on their contents page: the box front goes first, so the booklet opens on a cover like a printed one
function withCover(sysId, g, pages) { return sysId === 'wiiu' && pages.length && g.art.front && wiiumanual.generated(g.title) && !manualstudio.chosen(sysId, g.file) /* a scanned manual picked in Manual Studio opens on its own cover */ ? [fileUrl(g.art.front), ...pages] : pages; }
const libCacheFile = () => path.join(app.getPath('userData'), 'library-cache.json');
// temp (own name per write: two scans can finish together) + rename: a crash mid-write never leaves a cut-off file behind
let atomicN = 0;
async function writeAtomic(file, data) { const tmp = `${file}.${process.pid}-${++atomicN}.tmp`; try { await fs.promises.writeFile(tmp, data); await fs.promises.rename(tmp, file); } catch (e) { fs.promises.unlink(tmp).catch(() => {}); throw e; } }
handle('library:cached', () => { try { return JSON.parse(fs.readFileSync(libCacheFile(), 'utf8')); } catch { return null; } });
// two scans asked for at once (startup + a background job finishing) share one
// …unless the settings changed after it started (that scan read the old ones): then a fresh one runs after it
// (compared by the settings a scan reads, not the object: an unrelated save such as the volume replaces cfg too)
let scanning = null, scanCfg = null, lastLib = null; // lastLib: the shelves of the last scan (Art Studio's game counts)
const scanSig = () => { try { return JSON.stringify([cfg.systems, cfg.steam, cfg.apps, cfg.ui && cfg.ui.artLibrary]); } catch { return String(Math.random()); } };
const scanOnce = () => {
  if (scanning && scanCfg === scanSig()) return scanning;
  const prev = scanning || Promise.resolve();
  const run = prev.catch(() => {}).then(() => { scanCfg = scanSig(); return buildLibrary(); });
  scanning = run.finally(() => { if (scanning === mine) scanning = null; }); const mine = scanning; scanCfg = scanSig();
  return scanning;
};
handle('library:scan', async (arg) => { const lib = await scanOnce(), json = JSON.stringify(lib); lastLib = lib; artstudio.forget();
  // ifChanged: the shelf already shows last session's library; when nothing changed, say so instead of sending the
  // whole library (about a megabyte) back for the screen to unpack and compare, which stalled the shelf as it appeared
  let same = false; if (arg && arg.ifChanged) { try { same = (await fs.promises.readFile(libCacheFile(), 'utf8')) === json; } catch {} }
  if (!same) writeAtomic(libCacheFile(), json).catch(() => {}); setTimeout(() => autoCovers(lib), 1500); setTimeout(() => steamFill(lib), 2500); setTimeout(() => wiiuManuals(lib), 3500); setTimeout(() => autoManuals(lib), 6000); return same ? { unchanged: true } : lib; });
// Wii U e-manuals: turn each game's built-in manual into reader pages (once per game, in a hidden window)
let wiiuBusy = false;
async function wiiuManuals(lib) {
  const wu = lib.find(s => s.id === 'wiiu'), sc = cfg.systems.wiiu; if (!wu || !sc || wiiuBusy) return;
  wiiuBusy = true; let made = 0;
  const artDirFor = g => paths.manualDirFor(sc, g.file);
  try { await wiiumanual.collect(wu.games, { artDirFor, baseFor: g => paths.artBase(g.file), render: renderWiiuManual, renderEpub: renderEpubManual, onDone: () => made++ }); }
  catch (e) { log('wiiu manuals', e.message); }
  finally { wiiuBusy = false; }
  if (made && alive()) win.webContents.send('library:changed', { manuals: made });
}
async function renderWiiuManual(model) { // on the shared background helper (one window, reused), like the other manual work
  const r = await helperJob('wiiu-manual.html', async () => model, 180000, true);
  if (r.err) log('wiiu manual render', r.err); if (r.err && !r.pages.length && /timed out|gone|did not load/.test(r.err)) return null;
  return r.pages.map(d => { const m = /^data:image\/jpeg;base64,(.+)$/.exec(String(d)); return m ? Buffer.from(m[1], 'base64') : null; }).filter(Boolean);
}

// Background image work (PDF pages, cutting scans in half, spines) runs in a hidden helper window: one per page type,
// reused job after job and closed after a quiet half minute. (Opening a fresh window for every scan started a new
// process and graphics context each time, and the shelf stuttered while manuals came in.) Background jobs also wait
// while you're pressing buttons, and carry on once you stop.
let uiBusyAt = 0; ipcMain.on('ui:busy', () => { uiBusyAt = Date.now(); });
async function uiQuiet() { const t0 = Date.now(); while (alive() && Date.now() - uiBusyAt < 1500 && Date.now() - t0 < 20000) await new Promise(r => setTimeout(r, 300)); }
const helpers = {};
function helperJob(page, makeMsg, ms, bg, key) { // key: a queue (and window) of its own for the same page
  const H = helpers[key || page] || (helpers[key || page] = { q: Promise.resolve(), w: null, ready: null, idleT: 0, cur: null });
  const run = () => new Promise(async resolve => { // eslint-disable-line no-async-promise-executor
    let msg; try { msg = await makeMsg(); } catch (e) { return resolve({ err: e.message, pages: [] }); }
    if (bg) await uiQuiet();
    clearTimeout(H.idleT);
    if (!H.w || H.w.isDestroyed()) {
      const w = H.w = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { preload: path.join(__dirname, 'preload-wum.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
      w.webContents.on('render-process-gone', () => { if (H.w === w) H.w = null; if (H.cur) H.cur({ err: 'helper window gone', pages: [] }); setImmediate(() => { if (!w.isDestroyed()) w.destroy(); }); }); // (a dead window left open was never freed)
      H.ready = new Promise(r => { w.webContents.once('did-finish-load', () => r(true)); setTimeout(() => r(false), 30000); });
      w.loadFile(path.join(__dirname, 'renderer', page)).catch(() => {});
    }
    const w = H.w; let finished = false;
    const finish = r => { if (finished) return; finished = true; H.cur = null; clearTimeout(t); ipcMain.removeListener('wum:done', onDone);
      H.idleT = setTimeout(() => { if (H.w && !H.w.isDestroyed()) H.w.destroy(); H.w = null; }, 30000); resolve(r); };
    const onDone = (e, err, pages) => { if (e.sender !== w.webContents) return; finish({ err, pages: Array.isArray(pages) ? pages : [] }); };
    const t = setTimeout(() => { if (H.w === w) { H.w = null; if (!w.isDestroyed()) w.destroy(); } finish({ err: 'timed out', pages: [] }); }, ms); // a stuck job: start the next one with a fresh window
    H.cur = finish; ipcMain.on('wum:done', onDone);
    if (!(await H.ready) || w.isDestroyed()) { if (H.w === w) H.w = null; if (!w.isDestroyed()) w.destroy(); return finish({ err: 'helper window did not load', pages: [] }); }
    w.webContents.send('wum:model', msg);
  });
  const p = H.q.then(run, run); H.q = p.then(() => {}, () => {}); return p; /* one job at a time per helper */
}
const jpegs = pages => pages.filter(d => /^data:image\/jpeg;base64,/.test(String(d)));
async function renderPdfPages(pdf, size, max, last, bg) {
  const r = await helperJob('pdf-pages.html', async () => { const data = await fs.promises.readFile(pdf); return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), max: max || 80, size: size || 1600, last: !!last }; }, 300000, bg);
  if (r.err) log('manual pdf', path.basename(pdf), r.err); return jpegs(r.pages);
}
// a reading-corner cover: its own helper window and queue (never behind a 300 s manual conversion), and the PDF is named
// by address, not read into memory and posted: pdf.js range-reads the few hundred KB page 1 needs, even from a 2 GB file
async function renderPdfCover(pdf, last) {
  const r = await helperJob('pdf-pages.html', async () => ({ url: fileUrl(pdf), max: 1, size: 900, last: !!last }), 60000, false, 'pdf-cover');
  if (!r.err) return jpegs(r.pages);
  log('library cover', path.basename(pdf), r.err);
  // range reading failed (an odd PDF): a file up to 64 MB is still drawn the old way, on the cover queue
  let size = 0; try { size = fs.statSync(pdf).size; } catch {} if (!size || size > 64 * 1048576) return [];
  const r2 = await helperJob('pdf-pages.html', async () => { const d = await fs.promises.readFile(pdf); return { data: new Uint8Array(d.buffer, d.byteOffset, d.length), max: 1, size: 900, last: !!last }; }, 60000, false, 'pdf-cover');
  if (r2.err) log('library cover (whole file)', path.basename(pdf), r2.err); return jpegs(r2.pages);
}
// scans uploaded as two-page spreads become single pages (Wii U pages are made here and are never spreads)
const spreads = require('./main/spreads');
// cut a scan into halves in a hidden window (decoding big scans here on the main thread froze the shelf)
async function cropBoth(file) {
  const r = await helperJob('img-tools.html', async () => { const b = await fs.promises.readFile(file); return { data: new Uint8Array(b.buffer, b.byteOffset, b.length) }; }, 60000, true);
  if (r.err) log('crop', path.basename(file), r.err);
  const b = r.pages.map(d => { const m = /^data:image\/jpeg;base64,(.+)$/.exec(String(d)); return m ? Buffer.from(m[1], 'base64') : null; });
  return b[0] && b[1] ? { left: b[0], right: b[1] } : null;
}
// Spine of a full box wrap, cut in the same hidden image window. Case shapes (front width and spine thickness, both
// relative to the case's height): DVD-style cases 135x190x14 mm, Wii U 135x190x11, Blu-ray 135x171x12, Switch
// 105x170x10, PSP 104x180x14, 3DS 136x121x13.5 (wider than tall)
const CASE = { gc: [.711, .074], wii: [.711, .074], ps2: [.711, .074], x360: [.711, .074], wiiu: [.711, .058], ps3: [.789, .07], ps4: [.789, .07], ps5: [.789, .07], sw: [.618, .059], sw2: [.618, .059], psp: [.578, .078], n3ds: [1.127, .112] };
async function spineCut(file, sysId, part) { // part 'back' (1.71): the back panel left of the spine, from the same fold search
  const [front, spine] = CASE[sysId] || CASE.gc;
  const r = await helperJob('img-tools.html', async () => { const b = await fs.promises.readFile(file); return { data: new Uint8Array(b.buffer, b.byteOffset, b.length), mode: 'spine', front, spine, part: part === 'back' ? 'back' : 'spine' }; }, 30000, true);
  if (r.err) log(part === 'back' ? 'back cut' : 'spine', path.basename(file), r.err);
  const m = /^data:image\/jpeg;base64,(.+)$/.exec(String(r.pages[0] || '')); return m ? Buffer.from(m[1], 'base64') : null;
}
covers.setSpineCutter(spineCut);
// a cartridge picture made from a Switch / 3DS game's front cover (1.73.5), in the same hidden image window: for the games no
// source has a cartridge photo of (Art Studio offers it last; automatic fetching uses it when nothing else was found)
async function cartMake(front, sysId) {
  const r = await helperJob('img-tools.html', async () => { const b = await fs.promises.readFile(front); return { data: new Uint8Array(b.buffer, b.byteOffset, b.length), mode: 'cart', sys: sysId }; }, 30000, true);
  if (r.err) log('cartridge from cover', path.basename(front), r.err);
  const m = /^data:image\/png;base64,(.+)$/.exec(String(r.pages[0] || '')); return m ? Buffer.from(m[1], 'base64') : null;
}
covers.setCartMaker(cartMake);
// crop(file, side): both halves come from one pass over the file
// each scan is cut once; its halves are let go once the right one has been taken (the cache used to keep every half of a whole run)
function makeCropper() { const cache = new Map(); return async (file, side) => { if (!cache.has(file)) cache.set(file, cropBoth(file)); const p = cache.get(file), r = await p; if (side === 'right' && cache.get(file) === p) cache.delete(file); return r ? r[side] : null; }; }
// Background manual work waits while a game runs (and for a few seconds after, so the shelf's fade-in stays smooth)
let backAt = 0;
async function gameIdle() { while (alive() && (launcher.isRunning() || Date.now() - backAt < 5000)) await new Promise(r => setTimeout(r, 1000)); }
const yieldNow = () => new Promise(r => setImmediate(r));
async function fixSpreads() {
  markEvent('fixSpreads');
  let n = 0; const ls = require('./main/dircache').lister();
  for (const { def, cfg: sc } of sysList(CONSOLES.map(c => c.id))) {
    if (def.id === 'wiiu') continue;
    let games = []; try { games = scanSystem(def, sc); } catch { continue; }
    for (const g of games) {
      if (!(g.art && (g.art.manual || []).length)) continue;
      await yieldNow(); await gameIdle(); // one game at a time: checking hundreds of manuals in one go froze the shelf ~0.5 s
      try { const k = await spreads.splitManual(paths.manualDirFor(sc, g.file), paths.artBase(g.file), makeCropper(), { ls }); if (k) { n++; log('Manual spreads split', path.basename(g.file), '->', k, 'pages'); } }
      catch (e) { log('Manual spreads', path.basename(g.file), e.message); }
    }
  }
  return n;
}
// every game whose manual is still a PDF (just downloaded, or left over from before): make its pages
async function convertPdfManuals(done) {
  markEvent('convertPdfManuals');
  let n = 0;
  for (const { def, cfg: sc } of sysList(CONSOLES.map(c => c.id))) {
    let games = []; try { games = scanSystem(def, sc); } catch { continue; }
    for (const g of games) {
      if (!g.art || !g.art.manualPdf || (g.art.manual || []).length || !alive()) continue;
      await gameIdle();
      const t0 = Date.now(), pages = await renderPdfPages(g.art.manualPdf, undefined, undefined, undefined, true);
      const saved = pages.length ? await manuals.savePages(sc, g.file, pages, true, pages.length < 80) : 0; // 80 = the page cap: a longer PDF is kept
      log('Manual pages from PDF', path.basename(g.file), saved, 'pages in', Date.now() - t0, 'ms');
      if (saved) n++; if (done) done.set(g.file, saved);
    }
  }
  return n;
}
// E-book manuals: each XHTML page is opened offscreen at GamePad width, measured, cut between paragraphs and pictures
// (the same cutter the layout manuals use) and captured. The window can read only the unpacked e-book: no network.
const EPUB_W = 854, EPUB_MIN_H = 480, EPUB_MAX_H = 12000;
const EPUB_MEASURE = `(() => { const H = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0), keep = [];
  for (const el of document.querySelectorAll('img,svg,video,canvas,p,li,h1,h2,h3,h4,h5,h6,tr,figure,dt,dd,table,span,a')) {
    const r = el.getBoundingClientRect(); if (r.height < 2 || r.width < 2) continue; const y = r.top + scrollY; keep.push([Math.round(y), Math.round(y + r.height)]); }
  return { H, keep }; })()`;
function renderEpubManual(root, pages) {
  return new Promise(resolve => {
    const ses = session.fromPartition('boxshelf-emanual'); // one shared, in-memory session (a new one per run was never freed)
    ses.webRequest.onBeforeRequest(null);
    const allowed = path.resolve(root).toLowerCase();
    ses.webRequest.onBeforeRequest((d, cb) => {
      let ok = false;
      try { if (d.url.startsWith('data:')) ok = true; else if (d.url.startsWith('file:')) ok = path.resolve(url.fileURLToPath(d.url)).toLowerCase().startsWith(allowed + path.sep); } catch {}
      cb({ cancel: !ok });
    });
    const w = new BrowserWindow({ show: false, width: EPUB_W, height: EPUB_MIN_H, useContentSize: true, webPreferences: { offscreen: true, session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, spellcheck: false } });
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', e => e.preventDefault());
    w.webContents.setAudioMuted(true);
    let done = false; const out = [];
    const finish = r => { if (done) return; done = true; clearTimeout(t); if (!w.isDestroyed()) w.destroy(); resolve(r); };
    const t = setTimeout(() => { log('wiiu e-book render timed out after', out.length, 'pages'); finish(out.length ? out : null); }, 60000 + pages.length * 20000);
    w.webContents.on('render-process-gone', (e, d) => { log('wiiu e-book renderer gone', d && d.reason); finish(null); });
    const wait = ms => new Promise(r => setTimeout(r, ms));
    (async () => {
      for (const file of pages) {
        if (done) return;
        try {
          w.setContentSize(EPUB_W, EPUB_MIN_H);
          await w.loadFile(file).catch(() => {});
          await w.webContents.insertCSS('*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;scroll-behavior:auto!important}');
          await wait(350);
          let m = await w.webContents.executeJavaScript(EPUB_MEASURE);
          if (m.H > EPUB_MIN_H) { w.setContentSize(EPUB_W, Math.min(m.H, EPUB_MAX_H)); await wait(300); m = await w.webContents.executeJavaScript(EPUB_MEASURE); }
          const H = Math.max(EPUB_MIN_H, Math.min(m.H, EPUB_MAX_H));
          if (H > EPUB_MIN_H) { w.setContentSize(EPUB_W, H); await wait(150); }
          const parts = H <= EPUB_MIN_H ? [[0, H]] : wiiumanual.splitPage(H, m.keep || []);
          const tall = w.getContentSize()[1] >= H - 2; /* if the window couldn't grow that tall, scroll each piece into view instead */
          if (!tall) { w.setContentSize(EPUB_W, Math.max(...parts.map(([a, b]) => b - a))); await wait(150); }
          for (const [a, b] of parts) {
            let y = a;
            if (!tall) { await w.webContents.executeJavaScript(`window.scrollTo(0, ${a}); window.scrollY`).then(sy => { y = a - sy; }); await wait(120); }
            const img = await w.webContents.capturePage({ x: 0, y, width: EPUB_W, height: Math.max(1, b - a) });
            if (!img.isEmpty()) out.push(img.toJPEG(88));
          }
        } catch (e) { log('wiiu e-book page', path.basename(file), e.message); }
      }
      finish(out);
    })();
  });
}
// Steam games missing a cover (or store info): fetch them in the background, then refresh the shelf once
let steamFilling = false;
async function steamFill(lib) {
  if (steamFilling || cfg.ui.autoCovers === false) return; const pcs = lib.filter(s => s.kind === 'steam'); if (!pcs.length) return;
  steamFilling = true;
  try {
    const all = pcs.flatMap(s => s.games); let games = all.filter(g => !g.source || g.source === 'steam'), matched = 0;
    // (beta.4) Epic / Quiver / hand-added games: their titles are matched to Steam apps (only with box art downloads turned
    // on in setup or Settings: it sends the titles to Steam's store search), then filled like Steam's own
    const others = all.filter(g => STORE_SRC.has(g.source)); // (only the stores' games: see buildLibrary's pcGame)
    if (others.length && cfg.ui.autoCovers === true) {
      matched = await pcgames.matchSteam(others.map(g => g.title));
      games = games.concat(others.map(g => { const id = pcgames.steamIdOf(g.title); return id ? { appid: String(id), title: g.title, art: { front: g.art.front, hero: g.art.hero } } : null; }).filter(Boolean));
    }
    const r = await steamart.fill(games); if ((r.covers || r.other || matched) && alive()) win.webContents.send('library:changed', { covers: r.covers });
  } /* heroes and store info: a quiet refresh, no toast */ catch (e) { log('steam art failed', e.message); } finally { steamFilling = false; }
}
let autoManualsDone = false, autoManualJob = null, manualSeen = null, manualAgain = false;
/* After covers: look up manuals for games that have none and take only confident English matches. Once per session,
   and again whenever games turn up that weren't there last time (added while Tyro-Shelf is open), just for those:
   games already looked at are remembered by the collections / search memos, so a re-run only costs the new ones */
const libGameIds = lib => { const ids = new Set(); (lib || []).forEach(s => (s.games || []).forEach(g => { if (g && (g.kind === 'rom' || !g.kind)) ids.add(s.id + '|' + (g.file || g.id)); })); return ids; };
// ---- the art library (Settings → Box art, or at setup): one folder holding every console's box art and manuals ----
// Choosing one copies the art that's beside the games into it (in the background, never moving or deleting anything);
// downloads wait for that, so nothing already on the PC is fetched again.
let artLibSet = null, artCopy = null;
function applyArtLibrary() { paths.setReadingLibrary(cfg && cfg.ui && typeof cfg.ui.readingLibrary === 'string' ? cfg.ui.readingLibrary : ''); rootsCache = null; /* Settings → Magazines & guides: Magazines\ and Guides\ live there (bsfile:// must reach it too) */ const want = (cfg && cfg.ui && cfg.ui.artLibrary) || '', roots = Object.values((cfg && cfg.systems) || {}).filter(sc => sc && !sc.artDir).flatMap(sc => sc.romDirs || []), sig = want + '\n' + roots.join('\n');
  if (sig === artLibSet) return; artLibSet = sig; paths.setArtLibrary(want, roots); if (want) { /* (again when games folders change: one that now shares a name gets its own library folder, filled from beside the games) */ const p = copyArtToLibrary().catch(e => { log('Art library copy failed', e.message); return 0; }); artCopy = p; p.finally(() => { if (artCopy === p) artCopy = null; }); } }
async function copyArtToLibrary() {
  const lib = paths.artLibrary(); if (!lib) return 0; let n = 0, k = 0; const t0 = Date.now(); log('Art library:', lib, '(copying the art from beside the games)');
  for (const id of CONSOLES.map(c => c.id)) { const sc = cfg.systems[id]; if (!sc || sc.artDir) continue; // a console with its own art folder keeps it
    for (const root of sc.romDirs || []) { const lf = paths.libFolder(root);
      for (const src of [path.join(root, 'covers'), path.join(root, 'media', 'covers'), path.join(root, 'boxart')]) {
        let ents; try { ents = await fs.promises.readdir(src, { withFileTypes: true }); } catch { continue; }
        for (const d of ents) { if (!d.isFile() || !/\.(jpe?g|png|webp|pdf)$/i.test(d.name)) continue;
          const dest = path.join(lf, /-manual(-\d+)?\.[a-z0-9]+$/i.test(d.name) ? 'manuals' : 'covers', d.name);
          try { await fs.promises.access(dest); continue; } catch {}
          try { await fs.promises.mkdir(path.dirname(dest), { recursive: true }); await fs.promises.copyFile(path.join(src, d.name), dest, fs.constants.COPYFILE_EXCL); artstudio.copied(path.join(src, d.name), dest); n++; } catch (e) { if (e.code !== 'EEXIST') log('Art library copy', d.name, e.message); }
          if (++k % 25 === 0) { await uiQuiet(); await gameIdle(); } await new Promise(r => setImmediate(r)); } } } }
  log('Art library: copied', n, 'files in', Math.round((Date.now() - t0) / 1000), 's');
  if (n && alive()) win.webContents.send('library:changed', { artCopied: n }); return n;
}
async function autoManuals(lib) {
  markEvent('autoManuals'); if (artCopy) { try { await artCopy; } catch {} }
  const ids = lib ? libGameIds(lib) : null;
  const fresh = ids && manualSeen ? [...ids].some(id => !manualSeen.has(id)) : false;
  if (manualsBusy) { if (fresh) manualAgain = true; return; } // one is running: go again when it's done
  if (autoManualsDone && !fresh) return;
  if (autoJob) { try { await autoJob; } catch {} }
  if (manualsBusy) { if (fresh) manualAgain = true; return; }
  if (ids) manualSeen = manualSeen ? new Set([...manualSeen, ...ids]) : ids;
  if (autoManualsDone) log('Auto manuals: new games since the last look, searching again');
  autoManualsDone = true; manualsBusy = true; let fin; autoManualJob = new Promise(r => { fin = r; });
  try {
    // the manual collections first (sharpest scans / official digital manuals; they also upgrade blurry manuals),
    // then the per-game search for whatever they don't have
    let coll = 0; const changed = [];
    if (cfg.ui.autoManuals !== false) { try { coll = await manualcoll.run(sysList(CONSOLES.map(c => c.id)), { renderPdf: (p, size) => renderPdfPages(p, size || 1600, undefined, undefined, true), crop: makeCropper(), cancelled: () => !alive(), idle: gameIdle, report: changed, skipSystem: d => manualstudio.prefFor(d.id) !== 'best', locked: (id, f) => manualstudio.isLocked(id, f) || manualstudio.picked(id, f) /* a picked manual: background passes leave it (1.73) */ }); } catch (e) { log('Manual collections failed', e.message); } }
    const r = cfg.ui.autoManuals === false ? { got: 0 } : await manuals.autoFetch(sysList(CONSOLES.map(c => c.id)), { skip: d => d.id === 'wiiu', cancelled: () => !alive(), idle: gameIdle, prefFor: id => manualstudio.prefFor(id), locked: (id, f) => manualstudio.isLocked(id, f) || manualstudio.picked(id, f) /* a picked manual: background passes leave it (1.73) */ }); // (Manual Studio: each console's language / region; hand-picked manuals left alone)
    const conv = await convertPdfManuals(), split = await fixSpreads();
    if ((coll || r.got || conv || split) && alive()) win.webContents.send('library:changed', { onlineManuals: Math.max(r.got, conv), manualUpdates: changed });
  } catch (e) { log('Auto manuals failed', e.message); }
  finally { manualsBusy = false; autoManualJob = null; fin(); if (manualAgain && alive()) { manualAgain = false; setTimeout(() => scanOnce().then(l => autoManuals(l)).catch(() => {}), 4000); } }
}
const autoTried = new Set(); let autoRunning = false;
let backMemo = null; const backFile = () => path.join(app.getPath('userData'), 'cover-checks.json');
function backDue(id) {
  if (!backMemo) { try { backMemo = JSON.parse(fs.readFileSync(backFile(), 'utf8')); } catch { backMemo = {}; } }
  if (backMemo[id] && Date.now() - backMemo[id] < 7 * 864e5) return false;
  backMemo[id] = Date.now(); return true; } /* saved once the cover run has finished (saveBackMemo): a run cut short must not skip these games for a week */
function saveBackMemo() { if (backMemo) writeAtomic(backFile(), JSON.stringify(backMemo)).catch(() => {});
}
// Games missing a front, back or spine get art fetched in the background (each game at most weekly, see backDue), then the shelf refreshes
async function autoCovers(lib) {
  markEvent('autoCovers'); if (artCopy) { try { await artCopy; } catch {} }
  if (cfg.ui.autoCovers === false || coversBusy || autoRunning || artstudio.busy()) return; // (a shelf being restyled: next scan)
  const ids = [], only = new Set();
  for (const sh of lib) {
    if (sh.kind !== 'console') continue;
    // backs and spines: checked weekly (a front alone, like Paper Mario, still wants its back and spine); a missing
    // front too, after its first look: one cover that doesn't exist anywhere mustn't send the console round every launch
    const missing = sh.games.filter(g => g.kind === 'rom' && !autoTried.has(g.id) && (!g.art.front || !g.art.back || g.art.madeBack || !g.art.spine || g.art.madeSpine) && backDue(g.id)); // (a made back or spine still wants a real scan)
    if (!missing.length) continue;
    missing.forEach(g => { autoTried.add(g.id); only.add(g.id); }); ids.push(sh.id);
  }
  if (!ids.length) return;
  const list = CONSOLES.filter(d => ids.includes(d.id) && cfg.systems[d.id] && (cfg.systems[d.id].romDirs || []).length).map(def => ({ def, cfg: cfg.systems[def.id] }));
  if (!list.length) return;
  autoRunning = true; coversBusy = true; let done; autoJob = new Promise(r => { done = r; });
  try {
    log('Auto covers for', ids.join(','));
    // (its progress goes to the page too, a few times a second at most: the first-run Done screen shows "Getting box art")
    let sentAt = 0; const tell = info => { const now = Date.now(); if (now - sentAt < 300 || !alive()) return; sentAt = now; try { win.webContents.send('covers:auto', { stage: String(info && info.stage || ''), done: +(info && info.done) || 0, total: +(info && info.total) || 0, system: String(info && info.system || '') }); } catch {} };
    const rep = await covers.downloadCovers(list, tell, ['front', 'back', 'spine', 'disc'], { only, region: cfg.ui.artRegion, hd: cfg.ui.artHD !== false, ...artOpts(false) }); // just the games that are due, not their whole consoles; "HD only" (Settings → Box art) applies here too; a console with an Art Studio style follows it, locked parts are left alone
    try { if (alive()) win.webContents.send('covers:auto', { end: true, got: (rep.systems || []).reduce((a, r) => a + (r.front || 0), 0) }); } catch {}
    artstudio.forget(); // the Studio's game lists show the new pictures (Settings may hold off the shelf's rescan)
    const n = (rep.systems || []).reduce((a, r) => a + (r.front || 0) + (r.back || 0) + (r.spine || 0) + (r.disc || 0) + (r.upgraded || 0), 0);
    // the toast counts games that got a front cover (one per game); backs, spines, discs and sharper copies only refresh the shelf
    if (n && alive()) win.webContents.send('library:changed', { covers: (rep.systems || []).reduce((a, r) => a + (r.front || 0), 0) });
  } catch (e) { log('Auto covers failed', e.message); try { if (alive()) win.webContents.send('covers:auto', { end: true, got: 0, failed: true }); } catch {} }
  finally { coversBusy = false; autoRunning = false; autoJob = null; saveBackMemo(); done(); setTimeout(() => makeBacks(ids).then(() => makeSpines(ids)), 3000); }
}
// Made backs: a game with a front but no scanned back anywhere (new consoles above all: hardly any Switch 2 backs are
// scanned yet) gets one drawn from its own pictures and LaunchBox's details (renderer/img-tools.js back()), saved as
// "<name>-backmade.jpg" beside its art. The scanner uses it only while there's no real back, and the weekly art check
// keeps looking for a real one. Settings → Box art → "Make backs for games without one" (ui.makeBacks).
const BACK_BAND = { sw2: ['#e60012', '#fff', 'Nintendo Switch 2'], sw: ['#e60012', '#fff', 'Nintendo Switch'], ps5: ['#f2f4f8', '#111318', 'PS5'], ps4: ['#1d4ed8', '#fff', 'PS4'], ps3: ['#141414', '#fff', 'PS3'], ps2: ['#1d3fb8', '#fff', 'PlayStation 2'], psp: ['#141414', '#fff', 'PSP'], wii: ['#f2f2f2', '#222', 'Wii'], wiiu: ['#1fa3d9', '#fff', 'Wii U'], gc: ['#3b2a7a', '#fff', 'GameCube'], n3ds: ['#cf0a2c', '#fff', 'Nintendo 3DS'], x360: ['#57b52d', '#fff', 'Xbox 360'] };
let backsBusy = false;
async function fetchImage(u) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 10000);
  try { const r = await net.fetch(u, { signal: ac.signal }); if (!r.ok) return null; const b = Buffer.from(await r.arrayBuffer()); return b.length > 1000 && b.length < 15e6 ? b : null; } catch { return null; } finally { clearTimeout(t); }
}
async function makeBacks(ids) {
  if (backsBusy || cfg.ui.makeBacks === false || !Array.isArray(ids) || !ids.length) return;
  backsBusy = true; let made = 0;
  try {
    for (const id of ids) {
      const def = CONSOLES.find(c => c.id === id), sc = cfg.systems[id]; if (!def || !sc || !(sc.romDirs || []).length) continue;
      let games = []; try { games = scanSystem(def, sc); } catch { continue; }
      for (const g of games) {
        if (!g.art || !g.art.front || (g.art.back && !g.art.madeBack) || g.art.madeBack) continue; // a real back, or one already made
        if (launcher.isRunning() || launching) return; // a game started: not now (the next art check carries on)
        const buf = await renderBack(id, g.title, g.art.front); if (!buf) continue;
        const dir = paths.artDirFor(sc, g.file); try { fs.mkdirSync(dir, { recursive: true }); await fs.promises.writeFile(path.join(dir, paths.artBase(g.file) + '-backmade.jpg'), buf); made++; } catch (e) { log('made back', g.title, e.message); }
      }
    }
  } finally { backsBusy = false; if (made) { log('Made backs:', made); if (alive()) win.webContents.send('library:changed', {}); } }
}
// Made spines: the same for a game no source has a spine of (Switch 2 above all), drawn in its console's style with the
// game's logo (SteamGridDB with the user's key, else LaunchBox's clear logo) or its title (renderer/img-tools.js
// madeSpine), saved as "<name>-spinemade.jpg". Used only while there's no real spine; the weekly art check keeps looking.
// Same setting as the made backs (ui.makeBacks).
let spinesBusy = false;
async function makeSpines(ids) {
  if (spinesBusy || cfg.ui.makeBacks === false || !Array.isArray(ids) || !ids.length) return;
  spinesBusy = true; let made = 0;
  try {
    for (const id of ids) {
      const def = CONSOLES.find(c => c.id === id), sc = cfg.systems[id]; if (!def || !sc || !(sc.romDirs || []).length || !CASE[id]) continue;
      let games = []; try { games = scanSystem(def, sc); } catch { continue; }
      for (const g of games) {
        if (!g.art || !g.art.front || g.art.spine) continue; // a real spine, or one already made
        if (launcher.isRunning() || launching) return; // a game started: not now (the next art check carries on)
        const buf = await renderSpine(id, g.title, g.art.front); if (!buf) continue;
        const dir = paths.artDirFor(sc, g.file); try { fs.mkdirSync(dir, { recursive: true }); await fs.promises.writeFile(path.join(dir, paths.artBase(g.file) + '-spinemade.jpg'), buf); made++; } catch (e) { log('made spine', g.title, e.message); }
      }
    }
  } finally { spinesBusy = false; if (made) { log('Made spines:', made); if (alive()) win.webContents.send('library:changed', {}); } }
}
// The two makers, shared by the background passes above and the Art Studio, which offers a made back and spine for
// every game as one more choice (ranked after every real scan). A JPEG Buffer, or null.
async function renderBack(id, title, front) {
  if (!front || !paths.isFile(front)) return null;
  const def = CONSOLES.find(c => c.id === id), info = covers.gameInfo(id, title) || {}, band = BACK_BAND[id] || ['#16161b', '#fff', def ? def.name : ''];
  const shots = []; for (const u of (info.shots || []).slice(0, 3)) { const b = await fetchImage(u); if (b) shots.push(b); }
  const bg = info.bg ? await fetchImage(Array.isArray(info.bg) ? info.bg[0] : info.bg) : null;
  const r = await helperJob('img-tools.html', async () => { const b = await fs.promises.readFile(front); return { mode: 'back', data: new Uint8Array(b.buffer, b.byteOffset, b.length), shots: shots.map(x => new Uint8Array(x.buffer, x.byteOffset, x.length)), bg: bg ? new Uint8Array(bg.buffer, bg.byteOffset, bg.length) : null,
    title, overview: info.overview || '', esrb: info.esrb || '', players: info.players || '', pub: info.pub || '', year: info.year || (info.release ? String(info.release).slice(0, 4) : ''), band: { bg: band[0], fg: band[1], label: band[2] } }; }, 30000, true);
  const m = /^data:image\/jpeg;base64,(.+)$/.exec(String((r.pages || [])[0] || ''));
  if (!m) { log('made back', title, r.err || 'nothing made'); return null; }
  return Buffer.from(m[1], 'base64');
}
async function renderSpine(id, title, front) {
  if (!front || !paths.isFile(front) || !CASE[id]) return null;
  const def = CONSOLES.find(c => c.id === id), info = covers.gameInfo(id, title) || {}, band = BACK_BAND[id] || ['#16161b', '#fff', def ? def.name : ''];
  let logo = null;
  try { const ls = await require('./main/steamgrid').logos({ title, names: covers.lookupNames(title) }, covers.sgMatch); for (const l of ls.slice(0, 2)) { logo = await fetchImage(l.url); if (logo) break; } } catch {}
  if (!logo && info.logo) logo = await fetchImage(info.logo);
  const r = await helperJob('img-tools.html', async () => { const b = await fs.promises.readFile(front); return { mode: 'madespine', data: new Uint8Array(b.buffer, b.byteOffset, b.length), logo: logo ? new Uint8Array(logo.buffer, logo.byteOffset, logo.length) : null,
    title, pub: info.pub || '', ratio: CASE[id][1], lightBody: !['ps2', 'ps3', 'ps4', 'psp', 'gc'].includes(id), band: { bg: band[0], fg: band[1], label: band[2] } }; }, 30000, true);
  const m = /^data:image\/jpeg;base64,(.+)$/.exec(String((r.pages || [])[0] || ''));
  if (!m) { log('made spine', title, r.err || 'nothing made'); return null; }
  return Buffer.from(m[1], 'base64');
}
artstudio.setMaker({ back: renderBack, spine: renderSpine });
handle('dialog:pick', async ({ kind, title, defaultPath, filters, multi }) => {
  const r = await dialog.showOpenDialog(win, {
    title, defaultPath,
    properties: kind === 'folder' ? ['openDirectory'] : multi ? ['openFile', 'multiSelections'] : ['openFile'], // (beta.7) multi: Add games → Add several programs
    // (Linux: programs have no .exe, so a "Programs" filter would hide every emulator: there it shows all files)
    filters: kind === 'folder' ? undefined : linux.isLinux && (!filters || filters.some(f => f && Array.isArray(f.extensions) && f.extensions.includes('exe'))) ? undefined : (filters || [{ name: 'Programs', extensions: ['exe'] }])
  });
  return r.canceled ? null : multi ? r.filePaths : r.filePaths[0];
});
// ---------- (beta.7) Add games (main/addgames.js): a folder of games scanned; Playnite's library read (experimental) ----------
handle('games:scanFolder', ({ root }) => { const r = addgames.scanFolder(String(root || '')); return { ...r, games: r.games.map(g => ({ ...g, title: g.title })) }; });
handle('games:titleFor', ({ exes }) => (Array.isArray(exes) ? exes : []).slice(0, 500).map(e => ({ exe: String(e), title: addgames.titleFor(String(e)) })));
let pnPlan = null;
handle('playnite:find', ({ dir } = {}) => process.platform === 'win32' ? addgames.find(dir ? String(dir) : '') : null);
handle('playnite:plan', async ({ dir } = {}) => {
  const found = addgames.find(dir ? String(dir) : ''); if (!found) throw new Error('Playnite wasn\'t found. Choose its folder (the one with Playnite.DesktopApp.exe).');
  const p = addgames.plan(await addgames.read(found), found); pnPlan = p; return { ...p, app: found.app, portable: found.portable };
});
// the emulator for a console inside a folder Playnite named (its own program names, two folders deep at most)
handle('games:emuIn', ({ dir, systemId }) => {
  const def = CONSOLES.find(c => c.id === systemId); if (!def || !dir) return null; const names = new Set((def.exeNames || []).map(n => n.toLowerCase())); let hit = null;
  const walk = (d, left) => { if (hit) return; let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) { if (hit) return; const p = path.join(d, e.name); if (e.isFile() && names.has(e.name.toLowerCase())) hit = p; else if (e.isDirectory() && left > 0) walk(p, left - 1); } };
  walk(String(dir), 2); return hit;
});
// covers for games just added: a Playnite cover picked from the last summary only (never any file the page names)
handle('games:covers', async ({ items }) => {
  const ok = new Set(pnPlan ? pnPlan.pc.flatMap(g => [g.cover, g.bg]).filter(Boolean).map(f => path.resolve(f).toLowerCase()) : []); let n = 0;
  const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'game';
  for (const it of (Array.isArray(items) ? items : []).slice(0, 2000)) { const f = it && String(it.file || ''); if (!f || !ok.has(path.resolve(f).toLowerCase())) continue;
    try { await pccovers.own('custom-' + slug(it.id), f); n++; } catch (e) { log('Imported cover', e.message); } }
  if (n && alive()) win.webContents.send('library:changed', { pcCover: 1 }); return n;
});
// Xenia Manager picked instead of Xenia itself: the setting switches to the real emulator. Done on the config as it is
// loaded and saved (never in place during a scan): Settings gets the fixed path back from its save, so its own copy
// can't keep writing the Manager path back, and a scan doesn't change the config under the next scan's check
function fixXenia(c) {
  const sc = c && c.systems && c.systems.x360; if (!sc || !sc.emulator) return c;
  const r = emucfg.resolveExe('x360', emuPath(sc.emulator)); return r.changed ? { ...c, systems: { ...c.systems, x360: { ...sc, emulator: r.exe } } } : c;
}
let launching = false; // a second Play while a .cia installs (or anything runs) must not copy into the same files / touch the emulator's settings
// ---- a game's own emulator (Details → Emulator) ----
// Builds that were set as a console's emulator before are kept in cfg.emuSeen, so a build made for one game (a
// shadPS4 fork with that game's settings in custom_configs\<title id>.json) can be offered for it later.
function rememberEmus(prev, next) {
  try { if (!prev || !next || !next.systems) return next; const seen = Array.isArray(next.emuSeen) ? next.emuSeen.slice() : (prev.emuSeen || []).slice();
    for (const [id, sc] of Object.entries(prev.systems || {})) { const was = sc && sc.emulator, now = next.systems[id] && next.systems[id].emulator; if (was && was !== now) seen.unshift(was); }
    for (const g of Object.values(next.games || {})) if (g && g.emulator) seen.unshift(g.emulator);
    return { ...next, emuSeen: [...new Set(seen)].slice(0, 20) }; } catch { return next; }
}
// an emulator path as the launcher reads it ({app}, %VAR%, pasted "quotes"): what sits beside the exe is looked up from this
const emuPath = p => p ? paths.expand(String(p).trim().replace(/^"(.*)"$/, '$1')) : p;
function gameEmuOverride(systemId, file) { const o = cfg.games && cfg.games[systemId + ':' + file]; return o && o.emulator ? paths.expand(o.emulator) : ''; }
// a build that ships settings for this game (custom_configs\<title id>.json beside it, or in its user files)
function emuMadeFor(exe, titleId) {
  if (!exe || !titleId) return false; const d = path.dirname(exe);
  return ['custom_configs', path.join('user-files', 'custom_configs'), path.join('user', 'custom_configs')].some(k => paths.isFile(path.join(d, k, titleId + '.json')));
}
function titleIdOf(systemId, file) { try { if (systemId === 'ps5') { const id = kyty.titleId(file); if (id) return id; } if (systemId === 'sw2') return nx2.titleId(file); /* (PS5: the game's own param.json; a folder's name can carry another region's id) */ const m = /\b([A-Z]{4}\d{5})\b/.exec(file); if (m) return m[1]; if (systemId === 'ps4') { const sfo = path.join(path.dirname(file), 'sce_sys', 'param.sfo'); const b = fs.readFileSync(sfo); const t = /([A-Z]{4}\d{5})/.exec(b.toString('latin1')); if (t) return t[1]; } } catch {} return ''; }
handle('game:emulator', async ({ id }) => {
  const m = /^([a-z0-9]+):(.+)$/i.exec(String(id || '')), def = m && CONSOLES.find(c => c.id === m[1]);
  if (!def) throw new Error('Only console games can have their own emulator.');
  const { sc } = gameFile(def.id, m[2]), file = m[2], cur = gameEmuOverride(def.id, file), tid = titleIdOf(def.id, file);
  const shelfExe = paths.expand(sc.emulator || ''), name = p => path.basename(path.dirname(p)) || path.basename(p);
  const made = [...new Set([shelfExe, ...(cfg.emuSeen || []).map(paths.expand)])].filter(p => p && p !== cur && emuMadeFor(p, tid) && paths.isFile(p));
  const sugg = made.find(p => p !== shelfExe) || '';
  const buttons = ['Choose an emulator…'], acts = ['pick'];
  if (sugg) { buttons.push(`Use ${name(sugg)} (made for this game)`); acts.push('sugg'); }
  if (cur) { buttons.push(`Use the shelf's ${def.emulatorName}`); acts.push('default'); }
  buttons.push('Cancel'); acts.push('cancel');
  const detail = (cur ? `This game runs in:\n${cur}` : `This game runs in the shelf's ${def.emulatorName}:\n${shelfExe || '(not set up)'}`) + '\n\nPick a different build just for this game, e.g. a fork tuned for it.';
  const r = await dialog.showMessageBox(alive() ? win : undefined, { type: 'question', title: 'Emulator for this game', message: 'Which emulator should this game use?', detail, buttons, defaultId: 0, cancelId: buttons.length - 1, noLink: true });
  const act = acts[r.response] || 'cancel'; let exe = '';
  if (act === 'cancel') return { ok: false, canceled: true, games: cfg.games };
  if (act === 'pick') { const f = await dialog.showOpenDialog(alive() ? win : undefined, { title: `Emulator for this game (${def.emulatorName} or a build of it)`, defaultPath: cur || shelfExe || undefined, properties: ['openFile'], filters: [{ name: 'Programs', extensions: ['exe'] }, { name: 'All files', extensions: ['*'] }] }); if (f.canceled || !f.filePaths || !f.filePaths[0]) return { ok: false, canceled: true, games: cfg.games }; exe = f.filePaths[0]; }
  if (act === 'sugg') exe = sugg;
  const games = { ...(cfg.games || {}) };
  if (act === 'default' || (exe && path.resolve(exe).toLowerCase() === path.resolve(shelfExe || '.').toLowerCase())) { const o = { ...(games[id] || {}) }; delete o.emulator; if (Object.keys(o).length) games[id] = o; else delete games[id]; } else games[id] = { ...(games[id] || {}), emulator: exe }; // (beta.8: the game's own name stays)
  applyCfg({ ...cfg, games });
  log('Game emulator:', id, '→', games[id] ? games[id].emulator : 'shelf default');
  return { ok: true, games: cfg.games };
});
// Switch 2: every Eglantine build in the emulator folders (people keep several forks; Play asks which one), the one to
// offer first for a game (its last pick, its Details → Emulator choice, then the shelf's), and whether the game is a .nup
// (beta.3) the folders and single builds added in Settings → Switch 2 → Builds (plain paths, at most 20 of each)
const sw2Added = k => { const v = (cfg.systems.sw2 || {})[k]; return Array.isArray(v) ? [...new Set(v.filter(x => typeof x === 'string' && x && x.length <= 1024))].slice(0, 20) : []; };
function sw2Roots() {
  const r = [path.join(paths.appRoot(), 'Switch 2 emu'), ...sw2Added('buildDirs')], e = emuPath((cfg.systems.sw2 || {}).emulator || '');
  // (beta.3) from the shelf's build up to the TOP folder that looks like a builds folder ("Switch 2 emu" above
  // "Selvet Forks\…\eglantine.exe"), six levels at most: three levels stopped one short, so a copy of Boxshelf kept away from
  // its builds found only the shelf's own fork. The widest folders come first, so builds are named from the top.
  if (e) { let d = path.dirname(e), top = null; for (let i = 0; i < 6 && path.dirname(d) !== d; i++) { if (/switch ?2|eglantine|forks?/i.test(path.basename(d))) top = d; d = path.dirname(d); } if (top) r.push(top); }
  const u = [...new Set(r.map(p => path.resolve(p).toLowerCase()))].map(k => r.find(p => path.resolve(p).toLowerCase() === k));
  return u.sort((a, b) => a.length - b.length);
}
// (1.82) the builds in the build folders, plus this game's own choice and the shelf's build when they sit elsewhere (the
// picker used to leave them out, and Play then turned them down); (beta.3) and the single builds added in Settings
async function sw2BuildList(file) {
  const list = await nx2.builds(sw2Roots()), low = p => path.resolve(p || '.').toLowerCase();
  for (const [exe, hint] of [[file ? gameEmuOverride('sw2', file) : '', "This game's"], [emuPath((cfg.systems.sw2 || {}).emulator || ''), 'Shelf'], ...sw2Added('buildExes').map(x => [x, 'Added'])]) {
    if (!exe || list.some(b => low(b.exe) === low(exe)) || !paths.isFile(exe)) continue;
    const b = await nx2.buildOf(exe, hint); if (b) list.push(b);
  }
  return list;
}
handle('sw2:builds', async ({ file }) => {
  const list = await sw2BuildList(file), id = 'sw2:' + file, low = p => path.resolve(p || '.').toLowerCase();
  const nup = /\.nup$/i.test(String(file || '')), ok = b => !nup || b.nup;
  const want = [((cfg.ui.sw2Last || {})[id]) || '', gameEmuOverride('sw2', file), emuPath((cfg.systems.sw2 || {}).emulator || '')].filter(Boolean).map(low);
  const first = want.map(w => list.find(b => low(b.exe) === w && ok(b))).find(Boolean) || list.filter(ok).sort((a, b) => b.date - a.date)[0];
  return { builds: list, nup, first: first ? first.exe : '' };
});
handle('launch:game', async ({ systemId, file, emulator }) => {
  let { sc } = gameFile(systemId, file);
  // Switch 2: the build chosen at Play (only one of the listed builds), remembered as this game's first offer next time
  if (systemId === 'sw2' && emulator) {
    const b = (await sw2BuildList(file)).find(x => path.resolve(x.exe).toLowerCase() === path.resolve(emulator).toLowerCase());
    if (!b) throw new Error(`That Switch 2 build isn't in the emulator folders any more (${emulator}).`);
    if (/\.nup$/i.test(file) && !b.nup) throw new Error(`${b.label} can't open .nup games. Choose a newer build.`);
    const last = { ...(cfg.ui.sw2Last || {}), ['sw2:' + file]: b.exe }; try { applyCfg({ ...cfg, ui: { ...cfg.ui, sw2Last: last } }); } catch (e) { log('Switch 2: last build not remembered:', e.message); } // (beta.8: only a preference: a locked settings file mustn't stop the game)
    log('Switch 2 build:', b.label); sc = { ...sc, emulator: b.exe };
  } else {
  // this game's own emulator build, when one was chosen for it
  const own = gameEmuOverride(systemId, file);
  if (own) { if (!paths.isFile(own)) throw new Error(`This game's own emulator isn't there any more (${own}). Choose another in its Details → Emulator, or go back to the shelf's.`); sc = { ...sc, emulator: own }; }
  else sc = { ...sc, emulator: emuPath(sc.emulator) }; // the real path for everything below (Azahar's SD card folder, Dolphin's settings), not "{app}\…" or "%VAR%\…"
  // (Switch 2 started without a choice, its shelf build gone: the newest build that can open the game)
  if (systemId === 'sw2' && !paths.isFile(sc.emulator)) { const b = (await nx2.builds(sw2Roots())).filter(x => !/\.nup$/i.test(file) || x.nup).sort((a, c) => c.date - a.date)[0]; if (b) sc = { ...sc, emulator: b.exe }; }
  }
  if (launching || launcher.isRunning()) throw new Error('Something is already running. Close it first.');
  launching = true; try {
    const gid = systemId + ':' + file; await scriptsBefore({ id: gid, title: path.basename(file, path.extname(file)), exe: sc.emulator, source: systemId });
    let r; try { r = await launchGameNow(systemId, file, sc); } catch (e) { scriptRun = null; throw e; } scriptsStarted(); return r;
  } finally { launching = false; }
});
// (beta.6) RetroArch's cores: <its folder>\cores\<core>_libretro.dll, or the folder its own settings name
// (retroarch.cfg's libretro_directory; ":" there means RetroArch's own folder)
const RA_CORE_NAME = { swanstation: 'SwanStation', mesen: 'Mesen', snes9x: 'Snes9x', mupen64plus_next: 'Mupen64Plus-Next', gambatte: 'Gambatte', mgba: 'mGBA', melondsds: 'melonDS DS', genesis_plus_gx: 'Genesis Plus GX', flycast: 'Flycast',
  mednafen_saturn: 'Beetle Saturn', mednafen_pce_fast: 'Beetle PCE Fast', fbneo: 'FinalBurn Neo', picodrive: 'PicoDrive', stella: 'Stella', handy: 'Handy', mednafen_wswan: 'Beetle Cygne', dosbox_pure: 'DOSBox Pure' };
function retroCore(exe, core) {
  const dir = path.dirname(exe), dirs = [path.join(dir, 'cores')];
  for (const cfgFile of [path.join(dir, 'retroarch.cfg'), path.join(process.env.APPDATA || '', 'RetroArch', 'retroarch.cfg')]) {
    let t = ''; try { t = fs.readFileSync(cfgFile, 'utf8'); } catch { continue; }
    const m = /^\s*libretro_directory\s*=\s*"([^"]*)"/m.exec(t); if (m && m[1] && m[1] !== 'default') dirs.unshift(m[1].replace(/^:[\\/]?/, dir + path.sep));
    break;
  }
  for (const d of dirs) { const f = path.join(d, core + '_libretro.dll'); if (paths.isFile(f)) return f; }
  return null;
}
async function launchGameNow(systemId, file, sc) {
  if (systemId === 'ps4' && /\.pkg$/i.test(file)) throw new Error('This PS4 game is still a .pkg package, which shadPS4 can\'t run. Extract it to a folder first (current shadPS4 builds no longer install packages themselves) with a PKG extractor such as PKG Editor or the ShadPS4Plus pkg_extractor, into a folder inside your PS4 games folder. Once that folder has an eboot.bin in it, the game shows up here as installed.');
  if (systemId === 'x360') sc.emulator = emucfg.resolveExe('x360', sc.emulator).exe; // (sc is this launch's copy: the saved setting is fixed on load / save)
  // (1.82) no emulator, or one that's gone: say which console and emulator, before anything is prepared for it (Dolphin's
  // settings, a 3DS .cia installed into Azahar's folder)
  { const def = CONSOLES.find(c => c.id === systemId), con = def ? def.name : systemId, emu = (def && def.emulatorName) || 'its emulator';
    if (!sc.emulator) throw new Error(`No emulator is set up for ${con} yet. Choose ${emu} in Settings → ${con} → Emulator.`);
    if (!paths.isFile(sc.emulator)) throw new Error(`${emu} isn't at ${sc.emulator} any more. Choose it again in Settings → ${con} → Emulator.`); }
  // GameCube startup sequence: tell Dolphin not to skip it, and lift the
  // loading screen early so the whole sequence is visible.
  const ipl = systemId === 'gc' && sc.useIpl;
  const extra = ipl ? ['-C', 'Dolphin.Core.SkipIPL=False'] : [];
  // Dolphin's warning pop-ups (e.g. "IPL file is not a known good dump") use its panic handlers.
  if (ipl && sc.hideDolphinWarnings) extra.push('-C', 'Dolphin.Interface.UsePanicHandlers=False');
  await setupPending(sc.emulator); // (beta.7) Set up for me, waiting for this emulator's settings file (made by its first run)
  emucfg.beforeLaunch(systemId, sc.emulator, { quitCombo: cfg.ui.quitCombo === false ? null : (cfg.ui.quitComboKeys || 'l3+r3') }); extra.push(...emucfg.launchArgs(systemId, sc.emulator)); // Dolphin: borderless + no stop question for this run only
  // 3DS .cia: installed into Azahar the first time (the boot slide shows how far), then the installed copy is booted
  let rom = systemId === 'n3ds' ? await n3ds.bootFile(file, sc.emulator, t => { if (alive()) win.webContents.send('launch:status', String(t)); }) : file;
  if (systemId === 'sw2') { rom = nx2.bootFile(file); log('Switch 2 launch:', path.basename(nx2.gameRoot(file)), rom !== file ? '(newest update)' : ''); } // (an unpacked game: its newest update's exefs\main)
  // PS5 (Kyty): the game's folder, with the Kyty launcher's settings, the game's patch file and the build's preset
  let env = null;
  // (PS5: Settings pointed at Kyty's launcher: the game itself starts in kyty_emulator.exe beside it; no emulator there = the launcher)
  if (systemId === 'ps5' && /^(kyty_)?launcher\.exe$/i.test(path.basename(sc.emulator || ''))) { const emu = path.join(path.dirname(sc.emulator), 'kyty_emulator.exe'); if (paths.isFile(emu)) sc.emulator = emu; else sc.viaLauncher = true; }
  // (PS5, "Start games through Kyty's launcher" on: the launcher itself, where the game is started; it takes no game to open)
  if (systemId === 'ps5' && sc.viaLauncher) { const ui = ['kyty_launcher.exe', 'launcher.exe'].map(n => path.join(path.dirname(sc.emulator || ''), n)).find(paths.isFile); if (!ui) throw new Error("Kyty's launcher (kyty_launcher.exe) isn't next to kyty_emulator.exe. Turn off \"Start games through Kyty's launcher\" in Settings → PS5, or check the emulator path."); log('PS5 launch: through the launcher'); sc.emulator = ui; sc.gameArgs = ''; sc.coverSeconds = 1; extra.length = 0; } // (the launcher applies the preset itself)
  else if (systemId === 'ps5') { const k = kyty.spec(sc.emulator, file); extra.push(...k.args); env = k.env; rom = k.dir; log('PS5 launch:', path.basename(rom), k.args.filter(x => /^--/.test(x)).join(' '), env ? '(preset)' : ''); }
  // (beta.8) Switch through Ryujinx (EmuDeck's usual pick): its own options, not Eden's / Citron's "-f -g" (an edited
  // command line is left as it is)
  if (systemId === 'sw' && /ryujinx|ryubing/i.test(path.basename(sc.emulator || '')) && /^\s*-f\s+-g\s+"\{rom\}"\s*$/.test(sc.gameArgs || '')) { sc = { ...sc, gameArgs: '--fullscreen "{rom}"' }; log('Switch launch: Ryujinx options'); }
  // (beta.6) RetroArch: this console's core from RetroArch's cores folder, fullscreen; a core that isn't downloaded yet is
  // said plainly (RetroArch itself would just open its menu)
  { const def = CONSOLES.find(c => c.id === systemId);
    if (def && def.raCore && (linux.isLinux ? linux.isRetroArch(sc.emulator) : /^retroarch\.exe$/i.test(path.basename(sc.emulator || '')))) {
      let core = linux.isLinux ? linux.retroCore(sc.emulator, def.raCore) : retroCore(sc.emulator, def.raCore); const nm = RA_CORE_NAME[def.raCore] || def.raCore;
      // (beta.7) a missing core is downloaded now, from the same place RetroArch's Online Updater gets it (Windows)
      if (!core && process.platform === 'win32') { const say = t => { if (alive()) win.webContents.send('launch:status', t); }; say(`Getting RetroArch's ${nm} core…`);
        try { core = await racores.get(sc.emulator, def.raCore, p => say(`Getting RetroArch's ${nm} core… ${p}%`)); } catch (e) { log('Core download failed:', def.raCore, e.message); throw new Error(`RetroArch doesn't have the ${nm} core for ${def.name} yet, and it couldn't be downloaded (${e.message}). In RetroArch: Main Menu → Online Updater → Core Downloader → ${nm}, then press Play again.`); } }
      if (!core) throw new Error(`RetroArch doesn't have the ${nm} core for ${def.name} yet. In RetroArch: Main Menu → Online Updater → Core Downloader → ${nm}, then press Play again.`);
      sc.gameArgs = `-f -L "${core}" "{rom}"`; log('RetroArch launch:', def.id, path.basename(core)); } }
  // Dolphin: the Wii remote is let go first, so Dolphin finds it as it always does
  if (systemId === 'gc' || systemId === 'wii' || /dolphin/i.test(path.basename(sc.emulator || ''))) await wiimote.pause();
  await taskbarHide(); // (beta.6) gone before the emulator's first window can show
  let r; try { r = launcher.launchGame(sc, rom, onExit, extra, env); } catch (e) { wiimote.resume(); taskbarShow('the game did not start'); throw e; } runKind = 'game'; pendingPower = null;
  // (Dolphin: once it has the remote, Boxshelf listens alongside for a held Home; listening only, nothing is sent)
  if (systemId === 'gc' || systemId === 'wii' || /dolphin/i.test(path.basename(sc.emulator || ''))) setTimeout(() => { if (launcher.isRunning()) wiimote.watch(); }, 4000);
  lastLaunch = { systemId, at: Date.now() }; historyStart(systemId + ':' + file);
  const def = CONSOLES.find(c => c.id === systemId);
  try { const own = (cfg.games && cfg.games[systemId + ':' + file] || {}).discord || {}; presence.play({ title: own.name || ownTitle(systemId + ':' + file) || scanTitle(file).title, system: def ? def.name : systemId, systemId, hide: own.hide === true, image: own.image || '', clientId: own.appId || '', startedAt: Date.now() }); } catch (e) { log('Discord presence:', e.message); }
  if (cfg.ui.homeMenu !== false) homemenu.begin({ systemId, exe: sc.emulator, systemName: def ? def.name : systemId, hotkeys: sc.hotkeys });
  const base = ipl ? (sc.iplCoverSeconds ?? 2.5) : (+sc.coverSeconds || 0);
  // the loading screen now lifts the moment the game's window is up and fullscreen; the per-console seconds (plus a
  // margin for slow starts) are only the latest it waits
  watchPad({ appPid: r.pid, home: true });
  // the +3 s margin only when the helper is running (it lifts the cover early); without it the configured time is used
  // the boot slide (GameCube's too, since it lost its own insert animation) stays a fixed time so its progress line always
  // fills. When this console's boot video played instead (its switch on, a video added, no IPL), there is no slide to wait for.
  // The real GameCube startup (IPL) isn't held back either: the cover lifts as soon as Dolphin is up, so the whole sequence shows
  const vid = sc.bootOnLaunch !== false && !ipl && !!(themes.list([systemId])[systemId] || {}).boot;
  const slide = sc.insertAnim !== false && !vid && !ipl, minMs = slide ? 3500 : 800;
  const want = base > 0 ? base + (padwatch.isRunning() ? 3 : 0) : 0;
  const cover = coverWhileStarting(slide ? Math.max(want, minMs / 1000 + .5) : want);
  if (coverTimer) coverTimer.minMs = minMs;
  // no launch cover: still make sure the game ends up in front once its window exists
  const seq = ++noCoverSeq; // a quick quit and relaunch must not let this launch's timers act on the next game
  const qs = quitSeq; // (nor during a Quit: the game must not be pulled over the quit cover)
  if (!(cover > 0)) for (const ms of [2500, 4500]) setTimeout(() => { if (seq === noCoverSeq && qs === quitSeq && launcher.isRunning()) { padwatch.front(); homemenu.ready(); homemenu.raise(); } }, ms);
  return { ...r, cover };
}
// (busy check first: a .cia still installing, or a game running, must not have its emulator's settings rewritten under it)
const busyCheck = () => { if (launching || launcher.isRunning()) throw new Error('Something is already running. Close it first.'); };
handle('launch:emulator', async ({ systemId }) => { let sc = cfg.systems[systemId]; if (!sc) throw new Error('Unknown system.'); busyCheck(); sc = { ...sc, emulator: emuPath(sc.emulator) }; const wii = systemId === 'gc' || systemId === 'wii' || /dolphin/i.test(path.basename(sc.emulator || '')); if (wii) { launching = true; try { await wiimote.pause(); } finally { launching = false; } } /* (beta.8: a second press while the Wii remote lets go is refused, as for games) */ /* (Dolphin: the Wii remote is its) */ if (systemId === 'ps5') { const ui = ['kyty_launcher.exe', 'launcher.exe'].map(n => path.join(path.dirname(sc.emulator || ''), n)).find(paths.isFile); if (ui) sc.emulator = ui; } /* (PS5: kyty_emulator needs a game; the emulator on its own is Kyty's launcher) */ emucfg.beforeLaunch(systemId, sc.emulator, { quitCombo: cfg.ui.quitCombo === false ? null : (cfg.ui.quitComboKeys || 'l3+r3') }); let r; try { r = launcher.launchEmulator(sc, onExit); } catch (e) { if (wii) wiimote.resume(); throw e; } /* (1.82: a missing exe no longer leaves the remote paused) */ runKind = 'emulator'; pendingPower = null; watchPad(); return r; });
handle('launch:app', async ({ appId, link }) => {
  const a = cfg.apps[appId]; if (!a) throw new Error('Unknown app.'); busyCheck();
  const args = appId === 'stremio' && /^stremio:\/\/\/detail\/[^\s"]+$/.test(String(link || '')) ? [String(link)] : []; // a title from the museum's movie shelves opens on its page
  if (a.fullscreen !== false) { launching = true; try { await taskbarHide(); } finally { launching = false; } } // (beta.6; an app kept in a window keeps the taskbar. launching: a second press meanwhile is refused)
  let r; try { r = launcher.launchApp(a.path, onExit, args); } catch (e) { taskbarShow('the app did not start'); throw e; } runKind = 'app'; pendingPower = null;
  // Media apps don't speak controller: drive the pointer from the pad and press the fullscreen key once the window is up.
  const meta = APPS.find(x => x.id === appId);
  if (cfg.ui.homeMenu !== false) homemenu.begin({ systemId: 'media', exe: a.path, systemName: 'Media', title: meta ? meta.name : appId, hotkeys: {} });
  watchPad({ mouse: a.padMouse === true, appPid: r.pid, fullscreenKey: a.fullscreen === false ? null : (a.fullscreenKey || 'F11'), home: true });
  // Same loading screen as the games: it stays in front while the app's window opens (windowed at first) and goes
  // fullscreen, and lifts as soon as the app is fullscreen (padwatch GAMEFS); the seconds are only the latest it waits
  const cover = coverWhileStarting(a.fullscreen === false ? 4 : (+a.coverSeconds || 15));
  return { ...r, cover };
});
handle('launch:steam', ({ appid }) => launcher.launchSteam(appid));
// (beta.4) a PC game that isn't Steam's, named by id only: Epic's go through its launcher's link; Quiver's and the ones
// added by hand start their own program in its own folder (recomps read their files from there), with the Home menu and
// the quit buttons like any app
const srcLabel = (g, other) => g.source === 'quiver' ? 'Quiver' : g.source === 'gog' ? 'GOG' : g.source === 'hoyoplay' ? 'HoYoPlay' : g.source === 'epic' ? 'Epic' : other;
// ---- (Tyro-Shelf-19) scripts and companion programs around a game (main/gamescripts.js)
let scriptRun = null;
async function scriptsBefore(g) { const game = ((cfg.games || {})[g.id] || {}).scripts; scriptRun = { g: { id: g.id, title: g.title, exe: g.exe, source: g.source }, game }; try { await gscripts.before(scriptRun.g, game, cfg.scripts); } catch (e) { log('Game scripts:', e.message); } }
function scriptsStarted() { if (scriptRun) try { gscripts.afterStart(scriptRun.g, scriptRun.game, cfg.scripts); } catch (e) { log('Game scripts:', e.message); } }
handle('launch:pc', async ({ id }) => {
  const g = pcgames.byId(id); if (!g) throw new Error("That game isn't on the shelf any more. The shelf is refreshing; try again in a moment.");
  // through its store's launcher (Epic, and from beta.7 Ubisoft Connect and the EA app: their sign-in, cloud saves, overlay)
  const leg = g.legendary && (cfg.pc || {}).legendary !== false ? legendary.find() : '';
  if (!leg && g.uri && /^(com\.epicgames\.launcher|uplay|origin2):\/\//i.test(g.uri)) { busyCheck(); log('PC launch:', g.source, g.title); return shell.openExternal(g.uri).then(() => ({ external: true })); }
  // (beta.7) an Xbox / Game Pass game is a Windows app: started as one (its package family and app id, from pcgames.xboxGames)
  if (g.shellApp) { if (!/^[\w.-]+_[a-z0-9]+![\w.-]+$/i.test(g.shellApp)) throw new Error("Couldn't start that Xbox game."); busyCheck(); log('PC launch: Xbox,', g.title);
    const p = spawn('explorer.exe', ['shell:AppsFolder\\' + g.shellApp], { detached: true, stdio: 'ignore' }); p.on('error', e => log('Xbox launch', e.message)); p.unref(); return { external: true }; }
  if (!leg && !paths.isFile(g.exe)) throw new Error(`${g.title} isn't at ${g.exe} any more. ${g.source === 'quiver' ? 'Check it in Quiver Launcher.' : g.source === 'gog' ? 'Check it in GOG Galaxy.' : g.source === 'hoyoplay' ? 'Check it in HoYoPlay.' : g.source === 'epic' ? 'Check it in Legendary or the Epic Games Launcher.' : 'Remove it in Settings → Custom games and add it again.'}`);
  busyCheck();
  const winMode = ((cfg.games && cfg.games[g.id]) || {}).window || ''; // (Tyro-Shelf-15) '', 'borderless' or 'windowed'
  if (winMode !== 'windowed') { launching = true; try { await taskbarHide(); } finally { launching = false; } } // (beta.6; a game kept in a window keeps the taskbar)
  log('PC launch window mode:', winMode || 'the game\'s own');
  windowedRun = winMode === 'windowed';
  launching = true; try { await scriptsBefore(g); } finally { launching = false; }
  let r; try { r = leg ? launcher.launchApp(leg, onExit, ['launch', g.legendary]) : launcher.launchApp(g.exe, onExit, launcher.buildArgs(g.args || '', '')); } catch (e) { scriptRun = null; taskbarShow('the game did not start'); throw e; } runKind = 'app'; pendingPower = null; log('PC launch:', g.source, g.title, leg ? '(through Legendary)' : ''); scriptsStarted();
  try { const own = (cfg.games && cfg.games[g.id] || {}).discord || {}; presence.play({ title: own.name || g.title, system: srcLabel(g, 'PC'), systemId: 'pc', hide: own.hide === true, image: own.image || '', clientId: own.appId || '', startedAt: Date.now() }); } catch (e) { log('Discord presence:', e.message); }
  if (cfg.ui.homeMenu !== false) homemenu.begin({ systemId: 'pc', exe: g.exe, systemName: srcLabel(g, 'Custom'), title: g.title, hotkeys: {} });
  watchPad({ mouse: false, appPid: r.pid, fullscreenKey: null, home: true, winMode });
  return { ...r, cover: coverWhileStarting(winMode === 'windowed' ? 4 : 10, { untilWindow: 40 }) };
});
// (beta.5) a PC game's cover picker (main/pccovers.js): the page names the game by id and an option by key only
const pcLookup = id => { id = String(id || ''); const m = /^steam-(\d{1,10})$/.exec(id); if (m) return { id, appid: m[1], title: '' }; const g = pcgames.byId(id); return g ? { id, title: g.title } : null; };
const pcGameOf = id => { const g = pcLookup(id); if (!g) throw new Error("That game isn't on the shelf any more."); return g; };
const pcCoverChanged = () => { if (alive()) win.webContents.send('library:changed', { pcCover: 1 }); };
const pcPart = x => (x === 'back' || x === 'spine') ? x : 'front';
handle('pccover:options', ({ id, term, part }) => { const g = pcGameOf(id), t = String(term || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return pccovers.options(t ? { id: g.id, title: t } : g, pcPart(part)); }); // (beta.5: term = Search by name, a title instead of the game's own / its Steam app)
handle('pccover:use', async ({ id, key, part }) => { pcGameOf(id); await pccovers.use(id, key, pcPart(part)); pcCoverChanged(); return { ok: true }; });
handle('pccover:own', async ({ id, part }) => {
  pcGameOf(id);
  const r = await dialog.showOpenDialog(alive() ? win : undefined, { title: 'Choose a picture', properties: ['openFile'], filters: [{ name: 'Pictures', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
  await pccovers.own(id, r.filePaths[0], pcPart(part)); pcCoverChanged(); return { ok: true };
});
handle('pccover:reset', ({ id, part }) => { pcGameOf(id); pccovers.reset(id, pcPart(part)); pcCoverChanged(); return { ok: true }; });
// (beta.5) Details → Rename: a console game by its console and file (it must be one the scanner could find), a PC game by
// id. An empty name (or the file's own) goes back to the scanned one. The shelf rescans; art and manuals look it up by
// the new name from then on
handle('game:rename', ({ systemId, file, id, title }) => {
  let key;
  if (systemId && file) { const def = CONSOLES.find(c => c.id === systemId); if (!def || !cfg.systems[def.id]) throw new Error('Unknown console.'); gameFile(def.id, file); key = def.id + ':' + file; }
  else { pcGameOf(id); key = String(id); }
  const t = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const games = { ...(cfg.games || {}) }, cur = { ...(games[key] || {}) };
  if (t) cur.title = t; else delete cur.title;
  if (Object.keys(cur).length) games[key] = cur; else delete games[key];
  applyCfg({ ...cfg, games }); log('Game renamed:', key.split(':')[0], t ? 'to a name of its own' : 'back to its file name');
  if (systemId) { try { artstudio.forget(systemId); } catch {} }
  return { ok: true, title: t };
});
// a game's own Discord status (Details → Discord): { hide, name, image } kept in cfg.games[<game id>].discord
handle('presence:status', () => presence.status());
handle('game:discord', ({ systemId, file, id, discord }) => {
  let key;
  if (systemId && file) { const def = CONSOLES.find(c => c.id === systemId); if (!def || !cfg.systems[def.id]) throw new Error('Unknown console.'); gameFile(def.id, file); key = def.id + ':' + file; }
  else { pcGameOf(id); key = String(id); }
  const d = config.cleanDiscord(discord), games = { ...(cfg.games || {}) }, cur = { ...(games[key] || {}) };
  if (d) cur.discord = d; else delete cur.discord;
  if (Object.keys(cur).length) games[key] = cur; else delete games[key];
  applyCfg({ ...cfg, games }); log('Game Discord status:', key.split(':')[0], d ? (d.hide ? 'hidden' : 'own details') : 'default');
  return { ok: true, games: cfg.games, discord: d };
});
// (Tyro-Shelf-15) a PC game's own window mode (Details → Window): '' = as the game does it, 'borderless' = Tyro-Shelf strips its frame and
// stretches it over the screen, 'windowed' = left as a window with the taskbar kept. cfg.games[<game id>].window
handle('game:window', ({ id, window: mode }) => {
  pcGameOf(id); const key = String(id), m = mode === 'borderless' || mode === 'windowed' ? mode : '';
  const games = { ...(cfg.games || {}) }, cur = { ...(games[key] || {}) };
  if (m) cur.window = m; else delete cur.window;
  if (Object.keys(cur).length) games[key] = cur; else delete games[key];
  applyCfg({ ...cfg, games }); log('Game window mode:', key, m || 'the game\'s own');
  return { ok: true, games: cfg.games, window: m };
});
handle('pc:status', async () => { const pc = cfg.pc || {}; let epic = null; try { epic = pcgames.epicGames().length; } catch {}
  // (beta.7) each store's installed games, counted whether its switch is on or not (Settings says what it would add)
  const n = async f => { try { return (await f()).length; } catch { return null; } };
  const [gog, ubisoft, ea, xbox, hoyoplay] = await Promise.all([n(pcgames.gogGames), n(pcgames.ubisoftGames), n(pcgames.eaGames), n(pcgames.xboxGames), n(pcgames.hoyoGames)]);
  legendary.setPath(pc.legendaryPath); let leg = null; try { leg = pcgames.legendaryGames(legendary).length; } catch {}
  return { quiver: pcgames.quiverRoots(pc.quiverPath)[0] || '', epic, gog, ubisoft, ea, xbox, hoyoplay, legendary: leg, legendaryExe: legendary.find() }; });
// ---- (Tyro-Shelf-19) Legendary (main/legendary.js): find / download, sign in with the code from Epic's page, sign out
handle('legendary:status', async () => { legendary.setPath((cfg.pc || {}).legendaryPath); return legendary.status(); });
handle('legendary:download', async () => { const r = await legendary.download(); if (r.ok && alive()) win.webContents.send('library:changed', { legendary: 1 }); return r; });
handle('legendary:login', () => { shell.openExternal(legendary.LOGIN_URL); return { ok: true }; });
handle('legendary:code', async ({ code }) => { const r = await legendary.authCode(code); if (r.ok && alive()) win.webContents.send('library:changed', { legendary: 1 }); return r; });
handle('legendary:logout', () => legendary.logout());
// ---- (Tyro-Shelf-19) a game's scripts and programs (Details → Scripts); the screen sends the whole set, config.js cleans it
handle('game:scripts', ({ id, scripts }) => {
  const key = String(id || ''); if (!key || key.length > 2048) throw new Error('Unknown game.');
  const games = { ...(cfg.games || {}) }, cur = { ...(games[key] || {}) };
  if (scripts) cur.scripts = scripts; else delete cur.scripts;
  if (Object.keys(cur).length) games[key] = cur; else delete games[key];
  applyCfg({ ...cfg, games }); return { ok: true, scripts: (cfg.games[key] || {}).scripts || null };
});
// ---- (Tyro-Shelf-19) desktop shortcuts: a .lnk that starts Tyro-Shelf with --tyro-launch=<game id>; a running Tyro-Shelf is told
// to start that game, else the game starts as soon as the shelf is up (the screen collects it with shortcut:take)
const launchArg = argv => { const a = (argv || []).find(x => /^--tyro-launch=/.test(x)); if (!a) return ''; try { return Buffer.from(a.slice(14), 'base64url').toString('utf8').slice(0, 2048); } catch { return ''; } };
let pendingShortcut = launchArg(process.argv);
handle('shortcut:take', () => { const v = pendingShortcut; pendingShortcut = ''; return v; });
handle('shortcut:create', ({ id, title }) => {
  id = String(id || ''); title = String(title || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!id || !title) throw new Error('Unknown game.');
  const self = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, pg = pcgames.byId(id);
  const file = path.join(app.getPath('desktop'), title + '.lnk');
  const ok = shell.writeShortcutLink(file, 'create', { target: self, args: '--tyro-launch=' + Buffer.from(id, 'utf8').toString('base64url'), cwd: path.dirname(self), description: 'Play ' + title + ' in Tyro-Shelf', icon: pg && pg.exe && paths.isFile(pg.exe) ? pg.exe : self, iconIndex: 0 });
  if (!ok) throw new Error("Couldn't write the shortcut to the desktop.");
  log('Desktop shortcut:', file); return { ok: true, file };
});
handle('pc:findQuiver', () => { const t0 = Date.now(), d = pcgames.quiverFind(); log('Find Quiver:', d ? 'found' : 'not found', Date.now() - t0, 'ms'); return d || ''; });
// the reading corner: your Magazines\ and Guides\ folders (the screen only ever names items by id)
handle('library:list', () => { try { library.setCacheRoot(path.join(app.getPath('userData'), 'library')); return library.list().map(i => ({ id: i.id, kind: i.kind, type: i.type, title: i.title, series: i.series || '', pages: i.pages || 0 })); } catch (e) { log('library', e.message); return []; } });
handle('library:cover', async ({ id, side }) => { const f = await library.cover(id, async (pdf, last) => { const p = await renderPdfCover(pdf, last); return p && p[0] ? Buffer.from(p[0].split(',')[1], 'base64') : null; }, side === 'back' ? 'back' : 'front').catch(e => { log('library cover', e.message); return null; }); if (!f) return null; try { return fileUrl(f) + '?v=' + Math.floor(fs.statSync(f).mtimeMs); } catch { return fileUrl(f); } });
// the museum's movie shelves: your Stremio library, read from Stremio's own storage on this PC
handle('stremio:library', async () => { const a = cfg.apps && cfg.apps.stremio; if (!a || a.enabled === false) return []; try { return await stremio.library(a.path); } catch (e) { log('Stremio library', e.message); return []; } });
handle('stremio:poster', async ({ id, url }) => { const f = await stremio.poster(String(id || ''), String(url || '')); if (!f) return null; try { return fileUrl(f) + '?v=' + Math.floor(fs.statSync(f).mtimeMs); } catch { return null; } });
handle('stremio:details', async ({ type, id }) => { const d = await stremio.details(String(type || 'movie'), String(id || '')).catch(e => { log('stremio details', e.message); return null; }); if (!d) return null; const u = f => { if (!f) return null; try { return fileUrl(f) + '?v=' + Math.floor(fs.statSync(f).mtimeMs); } catch { return null; } }; return Object.assign({}, d, { files: { background: u(d.files.background), logo: u(d.files.logo), disc: u(d.files.disc) } }); });
async function fanartTest(key) {
  try { const r = await net.fetch(`https://webservice.fanart.tv/v3/movies/tt0111161?api_key=${encodeURIComponent(String(key))}`); if (r.status === 401 || r.status === 403) return { ok: false, error: 'not accepted' }; const j = await r.json(); return j && j.name ? { ok: true } : { ok: false, error: j && j['error message'] || 'unexpected answer' }; } catch (e) { return { ok: false, error: e.message }; } }
// the museum's retro TV: ads looked up in the background (only once the TV is on), fetched when one plays
let tvScanning = false;
handle('tv:scan', async () => { if (tvScanning) return false; tvScanning = true;
  try { const games = [];
    // the shelves as last scanned (a full re-scan of every games folder here blocked the main process on each museum visit)
    if (lastLib) { for (const s of lastLib) if (s && s.kind === 'console' && Array.isArray(s.games)) s.games.forEach(g => games.push({ sysId: s.id, file: g.file, title: g.title })); }
    else for (const { def, cfg: sc } of sysList(CONSOLES.map(c => c.id))) { let gs = []; try { gs = scanSystem(def, sc); } catch {} gs.forEach(g => games.push({ sysId: def.id, file: g.file, title: g.title })); }
    const n = await commercials.scan(games, { cancelled: () => !alive(), idle: async () => { await uiQuiet(); await gameIdle(); } }); if (n && alive()) win.webContents.send('tv:found', { n }); return true; }
  catch (e) { log('TV ads scan', e.message); return false; } finally { tvScanning = false; } });
handle('tv:list', () => commercials.list());
handle('tv:adFor', ({ systemId, file }) => commercials.adFor(String(systemId || ''), String(file || '')));
// only an ad Boxshelf itself found (matched by its key), never an id / file the page made up
handle('tv:local', async ({ ad }) => { const k = ad && typeof ad.key === 'string' ? ad.key : ''; const real = k && commercials.list().find(a => a.key === k); const f = real ? await commercials.local(real) : null; return f ? fileUrl(f) : null; });
handle('library:pages', async ({ id }) => { const p = await library.pages(id); return p.type === 'pdf' ? { type: 'pdf', url: fileUrl(p.file) } : { type: 'images', urls: p.files.map(fileUrl) }; });
handle('archive:search', ({ text, kind, page, plain }) => archive.search(text, kind === 'guide' ? 'guide' : 'magazine', page, !!plain));
handle('archive:check', ({ ids }) => archive.check(ids));
handle('archive:download', async ({ id, kind, title, series }) => {
  const k = kind === 'guide' ? 'guide' : 'magazine';
  const r = await archive.download(id, k, { title: typeof title === 'string' ? title : '', series: typeof series === 'string' ? series : '' }, (n, t, unit) => { if (alive()) win.webContents.send('archive:progress', { id, bytes: n, total: t, unit: unit || 'bytes' }); });
  return { existed: r.existed, name: path.basename(r.file), count: r.count || 0 };
});
handle('archive:cancel', ({ id }) => archive.cancel(String(id || ''))); // the download rejects with "Cancelled." and removes its half file
// Settings → Magazines & guides: the full paths, and magazines left in an earlier Boxshelf folder (copied, never moved)
handle('reading:where', () => ({ root: paths.readingRoot(), custom: !!cfg.ui.readingLibrary, magazines: library.folder('magazine'), guides: library.folder('guide') }));
const oldReading = () => paths.findOldReading({ current: paths.readingRoot(), logFile: LOG, known: (cfg.ui.installs || []).filter(x => typeof x === 'string'), home: require('os').homedir() });
handle('reading:old', () => oldReading());
let readingCopy = null;
handle('reading:import', async ({ root }) => {
  const offer = oldReading().find(o => o.root.toLowerCase() === String(root || '').toLowerCase()); // only a folder Boxshelf itself offered
  if (!offer) throw new Error('That folder has no magazines or guides to bring over.');
  if (readingCopy) throw new Error('Already copying.');
  readingCopy = { stop: false }; log('Reading: copying', offer.files, 'files from', offer.root, 'to', paths.readingRoot());
  try {
    const r = await paths.copyReading(offer.root, paths.readingRoot(), p => { if (alive()) win.webContents.send('reading:import', p); }, () => readingCopy.stop);
    log('Reading: copied', r.copied, 'skipped', r.skipped, 'failed', r.failed, r.lastError || '', r.cancelled ? '(stopped)' : '');
    if (r.copied && alive()) win.webContents.send('library:changed', { reading: r.copied });
    return r;
  } finally { readingCopy = null; }
});
handle('reading:importStop', () => { if (readingCopy) readingCopy.stop = true; return true; });
handle('library:open', ({ kind }) => { const d = library.folder(kind); fs.mkdirSync(d, { recursive: true }); return shell.openPath(d); });
handle('themes:list', () => {
  const ids = [...CONSOLES.map(c => c.id), 'pc', 'media'];
  const raw = themes.list(ids);
  const out = {};
  // theme files keep the same name when replaced, so the URL carries the file's mtime: a new file is a new URL (serveFile ignores the query)
  const vurl = p => { const u = fileUrl(p); if (!u) return null; try { return u + '?v=' + Math.floor(fs.statSync(p).mtimeMs); } catch { return u; } };
  for (const [id, t] of Object.entries(raw)) {
    out[id] = { logoPrev: !!themes.prevLogo(id), logo: vurl(t.logo), boot: vurl(t.boot), console: vurl(t.console), model: vurl(t.model), modelOpts: t.modelOpts || null, controller: vurl(t.controller), media: vurl(t.media), mediaOpts: t.mediaOpts || null };
    // a heavy 3D model is shown from its light copy once Boxshelf has made one (see models:saveOptimized); until then the
    // original is used and the screen is told it's worth optimizing
    for (const k of ['model', 'controller', 'media']) { const p = t[k]; if (!p || !/\.glb$/i.test(p)) continue; let st; try { st = fs.statSync(p); } catch { continue; } if (st.size < MODEL_HEAVY) continue;
      const op = optimizedPath(p, st); if (fs.existsSync(op)) out[id][k] = vurl(op); else (out[id].heavy = out[id].heavy || []).push(k); }
  }
  return out;
});
// the light copy of a heavy model, next to it in themes\<system>\.optimized\, named after the original's size and
// date so a replaced or edited model gets a fresh one (the original is never changed)
const MODEL_HEAVY = 8 * 1048576;
let noCoverSeq = 0;
// a model replaced or removed: its light copies go too (they'd never be used again)
function dropOptimized(systemId, kind) { try { const t = themes.list([systemId])[systemId], p = t && t[kind]; if (!p || !/\.(glb|gltf)$/i.test(p)) return; const dir = path.join(path.dirname(p), '.optimized'), base = path.basename(p, path.extname(p)).toLowerCase() + '-';
  for (const f of fs.readdirSync(dir)) if (f.toLowerCase().startsWith(base)) fs.unlinkSync(path.join(dir, f)); } catch {} }
function optimizedPath(p, st) { st = st || fs.statSync(p); return path.join(path.dirname(p), '.optimized', `${path.basename(p, path.extname(p))}-${st.size}-${Math.floor(st.mtimeMs)}.glb`); }
handle('models:saveOptimized', ({ systemId, kind, bytes }) => {
  if (!['model', 'controller', 'media'].includes(kind)) throw new Error('Unknown model.');
  const t = themes.list([systemId])[systemId], p = t && t[kind]; if (!p) throw new Error('No model.');
  const b = Buffer.from(bytes && bytes.buffer ? new Uint8Array(bytes.buffer, bytes.byteOffset || 0, bytes.byteLength) : bytes || []);
  const st = fs.statSync(p);
  if (b.length < 1024 || b.toString('latin1', 0, 4) !== 'glTF' || b.length >= st.size) throw new Error('Not a usable model.');
  const op = optimizedPath(p, st), dir = path.dirname(op), base = path.basename(p, path.extname(p)).toLowerCase() + '-';
  fs.mkdirSync(dir, { recursive: true });
  try { for (const f of fs.readdirSync(dir)) if (f.toLowerCase().startsWith(base) && path.join(dir, f) !== op) fs.unlinkSync(path.join(dir, f)); } catch {} // older copies of this model
  fs.writeFileSync(op + '.tmp', b); fs.renameSync(op + '.tmp', op);
  log('3D model optimized:', systemId, kind, Math.round(st.size / 1048576) + ' MB ->', Math.round(b.length / 1048576) + ' MB');
  return true;
});
handle('themes:set', ({ systemId, kind, file }) => { if (['model', 'controller', 'media'].includes(kind)) dropOptimized(systemId, kind); themes.set(systemId, kind, file); return true; });
handle('themes:fit', ({ systemId, patch }) => themes.saveFit(systemId, patch));
handle('themes:remove', ({ systemId, kind }) => { if (['model', 'controller', 'media'].includes(kind)) dropOptimized(systemId, kind); themes.remove(systemId, kind); return true; });
// Customize → Logo → Find a logo (main/logofind.js: a hand-picked list of official logos on Wikimedia Commons, no account). The
// console id must be one of Boxshelf's own, the key one this console's own cached list offered (logofind.file looks it up); the
// picture goes in through the same theme path and extension check as a logo you pick yourself, and the one it replaces is moved
// aside (Restore brings it back). Errors come back as words for the screen: never a credential, never an address.
const logoDir = () => path.join(app.getPath('userData'), 'logo-find');
let logofindReady = false;
const logofind = () => { const L = require('./main/logofind'); if (!logofindReady) { logofindReady = true; L.init({ log }); } return L; };
const logoSys = id => { if (typeof id !== 'string' || !CONSOLES.some(c => c.id === id) || !logofind().ids().includes(id)) throw new Error('Unknown system.'); return id; };
handle('themes:findLogos', async ({ systemId }) => {
  const id = logoSys(systemId), L = logofind(), r = await L.list(id);
  // previews: each file fetched once (then cached a week) and handed over as a data: address, so the screen never sees a source's URL
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
  const out = await Promise.all(r.list.map(async c => { try { const f = await L.file(id, c.key, logoDir()); return { ...c, preview: `data:${mime[f.ext] || 'image/png'};base64,` + (await fs.promises.readFile(f.file)).toString('base64') }; } catch { return null; } }));
  const got = out.filter(Boolean); return { ok: true, list: got, offline: !got.length && r.list.length > 0 };
});
handle('themes:useLogo', async ({ systemId, key }) => {
  const id = logoSys(systemId); if (typeof key !== 'string' || !/^cm-[a-z0-9-]{1,64}$/i.test(key)) throw new Error('Unknown logo.');
  let f; try { f = await logofind().file(id, key, logoDir()); } catch (e) { return { ok: false, error: String((e && e.message) || "Couldn't get that logo").slice(0, 200) }; }
  themes.setLogoKeepingOld(id, f.file); log('Logo set for', id, 'from', f.source); return { ok: true };
});
handle('themes:restoreLogo', ({ systemId }) => { themes.restoreLogo(logoSys(systemId)); return true; });
// (1.76) custom themes: the list (pictures as bsfile addresses), one made from a picture, the folder opened
handle('customThemes:list', () => customThemes.list().map(t => ({ ...t, bg: fileUrl(t.bg), sys: Object.fromEntries(Object.entries(t.sys).map(([k, v]) => [k, fileUrl(v)])) })));
handle('customThemes:create', ({ file, name }) => customThemes.create(file, name));
handle('customThemes:open', () => { customThemes.ensureExamples(); fs.mkdirSync(customThemes.root(), { recursive: true }); return shell.openPath(customThemes.root()); });
handle('themes:open', ({ systemId }) => { fs.mkdirSync(themes.dir(systemId), { recursive: true }); return shell.openPath(themes.dir(systemId)); });
handle('dolphin:ipl', ({ systemId }) => dolphin.findIpl(emuPath((cfg.systems[systemId || 'gc'] || {}).emulator)));
handle('dolphin:iplFolder', async ({ systemId, region }) => { const d = dolphin.ensureIplFolder(emuPath((cfg.systems[systemId || 'gc'] || {}).emulator), region); await shell.openPath(d); return d; });
let coversBusy = false, autoJob = null;
// the screen's list of console ids: a real array of strings (a plain string would match by substring: "gcwii".includes("gc"))
const idList = v => (Array.isArray(v) ? v : []).filter(x => typeof x === 'string');
handle('covers:download', async ({ systemIds, types, hd }) => {
  systemIds = idList(systemIds);
  // the quiet background download may be running: wait for it (it shares the same files) rather than refusing
  coversUserCancel = false;
  if (autoRunning && autoJob) { if (alive()) win.webContents.send('covers:progress', { stage: 'Finishing the background cover download first…' }); await autoJob; }
  if (coversUserCancel) return { systems: [], hd: !!hd, cancelled: true }; // Cancel pressed while it waited for the background run
  if (coversBusy) throw new Error('Covers are already downloading.');
  coversBusy = true;
  try {
    const list = CONSOLES.filter(d => systemIds.includes(d.id) && cfg.systems[d.id] && (cfg.systems[d.id].romDirs || []).length)
      .map(def => ({ def, cfg: cfg.systems[def.id] }));
    if (!list.length) throw new Error('Add a games folder first.');
    log('Download covers for', list.map(x => x.def.id).join(','));
    await artstudio.ready(); // the record of which pictures Boxshelf wrote (first start of 1.68): an HD upgrade asks it
    const rep = await covers.downloadCovers(list, info => { if (alive()) win.webContents.send('covers:progress', info); }, types, { hd: !!hd, region: cfg.ui.artRegion, ...artOpts(true) });
    const got = (rep.systems || []).reduce((a, r) => a + r.front + r.back + r.spine + r.disc + (r.upgraded || 0), 0);
    if (got && alive()) win.webContents.send('library:changed', { covers: 0 }); // the shelf picks the new pictures up
    if (got) artstudio.forget(); // …and so do the Studio's game lists
    return rep;
  } finally { coversBusy = false; }
});
let coversUserCancel = false;
handle('covers:cancel', () => { coversUserCancel = true; covers.cancel(); return true; });
handle('covers:coverage', () => { const ids = CONSOLES.map(c => c.id); return covers.coverage(sysList(ids)); });
// New games while Boxshelf is open: watch the game folders, and once nothing has changed in them for 8 s (a big copy is
// finished) tell the shelf to look again. A new game then shows up on the shelf, and in the museum it arrives as a parcel.
// Never during a game (it waits), and at most one rescan per quiet spell.
let romWatchers = [], romWatchT = 0, romWatchKey = null;
function watchRoms() {
  const dirs = new Set(); Object.values(cfg.systems || {}).forEach(s => { if (s && s.enabled !== false) (s.romDirs || []).forEach(d => dirs.add(d)); });
  // only when the watched folders really changed (every settings save calls this); a pending rescan (romWatchT) stays due
  const key = [...dirs].sort().join('\n'); if (key === romWatchKey) return; romWatchKey = key;
  romWatchers.forEach(w => { try { w.close(); } catch {} }); romWatchers = [];
  const poke = () => { clearTimeout(romWatchT); romWatchT = setTimeout(function fire() { if (launcher.isRunning()) { romWatchT = setTimeout(fire, 15000); return; } if (alive()) win.webContents.send('library:changed', { watch: 1 }); }, 8000); };
  for (const d of dirs) { try { const w = fs.watch(d, { recursive: true }, (ev, name) => { if (name && /(^|[\\/])(covers|\.optimized|\.manual-originals)([\\/]|$)|-manual-|\.(png|jpe?g|json|txt|ini|tmp|part)$/i.test(name)) return; poke(); }); w.on('error', () => {}); romWatchers.push(w); } catch {} }
}
const sysList = ids => CONSOLES.filter(d => ids.includes(d.id) && cfg.systems[d.id] && (cfg.systems[d.id].romDirs || []).length).map(def => ({ def, cfg: cfg.systems[def.id] }));
let manualsBusy = false, findToken = null;
handle('manuals:recent', () => manualcoll.recent(30));
handle('manuals:coverage', () => manuals.coverage(sysList(CONSOLES.map(c => c.id))));
handle('manuals:find', async ({ systemIds }) => {
  systemIds = idList(systemIds);
  if (autoManualJob) { if (alive()) win.webContents.send('covers:progress', { stage: 'Finishing the background manual download first…' }); await autoManualJob; }
  if (manualsBusy) throw new Error('Already searching for manuals.');
  manualsBusy = true; const token = findToken = { cancelled: false };
  try { const list = sysList(systemIds); if (!list.length) throw new Error('Add a games folder first.'); log('Manual search for', systemIds.join(',')); return await manuals.findAll(list, info => { if (alive()) win.webContents.send('covers:progress', info); }, token); }
  finally { manualsBusy = false; if (findToken === token) findToken = null; }
});
// ---------- RetroAchievements ----------
let lastLaunch = null;
handle('ra:progress', ({ systemId, title, force }) => ra.progress(systemId, title, !!force));
handle('ra:shelf', ({ systemId, titles }) => ra.shelfProgress(systemId, titles || []));
handle('ra:profile', () => ra.profile());
handle('ra:enabled', () => ({ enabled: ra.enabled(), systems: Object.keys(ra.CONSOLE_ID) }));
handle('models:find', ({ systemId, name, site }) => modelfind.start(systemId, name, site, r => { if (alive()) win.webContents.send('models:installed', r); }));
handle('history:get', () => loadHistory());
handle('history:touch', ({ id }) => { const open = histOpen; historyStart(String(id)); histOpen = open; return true; }); // Steam / app launches: count the launch, no duration
handle('trailer:open', ({ url }) => openTrailer(String(url || '')));
// ---------- start with Windows ----------
const STARTUP_LNK = () => path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Boxshelf.lnk');
function psRun(script) {
  return new Promise((resolve, reject) => {
    const enc = Buffer.from("$ProgressPreference = 'SilentlyContinue'\n" + script, 'utf16le').toString('base64');
    require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], { windowsHide: true, timeout: 20000 }, (err, out, errOut) => err ? reject(new Error((paths.psError(errOut) || err.message).slice(0, 300))) : resolve(String(out)));
  });
}
const loginItem = () => ({ path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, args: WINDOWED ? ['--windowed'] : [] });
handle('autostart:get', () => {
  if (process.platform !== 'win32') return { enabled: false, how: 'unsupported' };
  if (app.isPackaged) return { enabled: !!app.getLoginItemSettings(loginItem()).openAtLogin, how: 'exe' };
  return { enabled: fs.existsSync(STARTUP_LNK()), how: 'shortcut' };
});
handle('autostart:set', async ({ enabled }) => {
  if (process.platform !== 'win32') throw new Error('Only on Windows.');
  // the exe: Windows' own start-up entry; a shortcut left by the folder version is removed so only one Boxshelf starts
  if (app.isPackaged) { try { fs.unlinkSync(STARTUP_LNK()); } catch {} app.setLoginItemSettings({ openAtLogin: !!enabled, ...loginItem() }); return { enabled: !!enabled, how: 'exe' }; }
  const lnk = STARTUP_LNK();
  if (!enabled) { try { fs.unlinkSync(lnk); } catch {} return { enabled: false, how: 'shortcut' }; }
  const bat = path.join(paths.appRoot(), 'Start Boxshelf.bat');
  if (!fs.existsSync(bat)) throw new Error('Start Boxshelf.bat was not found next to the app.');
  const q = v => `'${String(v).replace(/['‘’‚‛]/g, m => m + m)}'`; // (beta.8: PowerShell also ends a quoted string at curly quotes, as in a folder named with one; doubling makes any of them literal)
  await psRun(`$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${q(lnk)}); $s.TargetPath = ${q(bat)}; $s.WorkingDirectory = ${q(paths.appRoot())}; $s.WindowStyle = 7; $s.Description = 'Tyro-Shelf'; $s.Save()`);
  log('Autostart shortcut created', lnk);
  return { enabled: true, how: 'shortcut' };
});
handle('app:openFolder', () => shell.openPath(paths.appRoot()));
const songs = require('./main/songs');
handle('music:list', () => music.list());
handle('music:read', ({ file }) => new Uint8Array(music.read(file)));
handle('music:open', () => { fs.mkdirSync(music.folder(), { recursive: true }); return shell.openPath(music.folder()); });
handle('songs:list', () => songs.list());
handle('songs:read', ({ file }) => new Uint8Array(songs.read(file)));
handle('songs:open', () => { fs.mkdirSync(songs.folder(), { recursive: true }); return shell.openPath(songs.folder()); });
// links from the page (e.g. a cover's source page) open in the default browser: https only
handle('app:openExternal', ({ url: u }) => { let x; try { x = new URL(String(u)); } catch { throw new Error('Bad link.'); } if (x.protocol !== 'https:') throw new Error('Only https links open.'); return shell.openExternal(x.toString()); });
// put back the emulator settings files Boxshelf changed (each was backed up once as <file>.boxshelf-bak)
// ---------- (beta.7) Video previews (main/previews.js) ----------
// what a game's preview is: a video file you have, Steam's trailer (joined into a small clip, kept), or YouTube's
// trailer (the LaunchBox link). Files found are let through bsfile one by one (previewOk), never whole folders.
const previewOk = new Set();
const previewOpts = sc => ({ dirs: (cfg.ui.previewDirs || []).map(d => paths.expand(d)), artDirs: paths.artDirsFor ? paths.artDirsFor(sc) : [], launchbox: covers.LAUNCHBOX });
handle('preview:find', async ({ systemId, file, title, id, youtube }) => {
  if ((cfg.ui.previews || 'off') === 'off') return null;
  let r = null;
  if (systemId && file) {
    const def = CONSOLES.find(c => c.id === systemId); const { sc } = gameFile(systemId, file);
    const f = def ? previews.findFile(def, sc, { file, title }, previewOpts(sc)) : null;
    if (f) { previewOk.add(path.resolve(f).toLowerCase()); return { type: 'file', url: fileUrl(f) }; }
  }
  const m = /^steam-(\d+)$/.exec(String(id || ''));
  if (m) { const f = await previews.steamClip(m[1]); if (f) return { type: 'file', url: fileUrl(f), steam: true }; }
  const yid = youtube ? previews.youtubeId(youtube) : null;
  // (beta.8) console trailers: the clip if it's kept; else it's made in the background and the renderer is told when
  // it's ready (preview:clip), while YouTube's player covers the Media tab in the meantime
  if (yid && cfg.ui.previewClips !== false && ytclips.supported()) {
    const f = ytclips.cached(yid); if (f) return { type: 'file', url: fileUrl(f), yt: yid };
    if (ytclips.helperState().have) { ytclips.clip(yid).then(c => { if (c && alive()) win.webContents.send('preview:clip', { id: yid, url: fileUrl(c) }); }); if (cfg.ui.previewYoutube !== false) r = { type: 'youtube', id: yid, pending: true }; else r = { type: 'pending', id: yid }; return r; }
  }
  if (cfg.ui.previewYoutube !== false && yid) r = { type: 'youtube', id: yid };
  return r;
});
// (beta.8) console trailers: the helper, how many clips are kept, clearing them
handle('ytclip:status', () => ytclips.status());
handle('ytclip:helper', async () => { const ok = await ytclips.getHelper(p => { if (alive()) win.webContents.send('ytclip:progress', { pct: p }); }); if (alive()) win.webContents.send('ytclip:progress', { done: true, ok }); return ok; });
handle('ytclip:clear', () => { ytclips.clear(); return true; });
// (beta.8) Steam Deck: where Boxshelf runs (the shelf's Desktop Mode card, Settings), and Add Boxshelf to Steam
handle('deck:info', () => ({ ...steamdeck.info(), inSteam: linux.isLinux && process.env.APPIMAGE ? steamdeck.inSteam(process.env.APPIMAGE) : false }));
handle('deck:addToSteam', ({ closeSteam } = {}) => steamdeck.addToSteam({ exe: process.env.APPIMAGE || '', iconSrc: path.join(__dirname, 'renderer', 'app-icon.png'), dataDir: app.getPath('userData'), closeSteam: !!closeSteam }));
handle('preview:yt', ({ id, rect, muted }) => {
  if (!alive() || !/^[\w-]{6,20}$/.test(String(id || '')) || !rect) return false;
  const v = ytEnsure(); ytWant = id; v.setBounds(ytBounds(rect)); v.setVisible(true);
  ytLoad(v.webContents, id, { preview: true, muted: muted !== false }).catch(() => {});
  return true;
});
handle('preview:ytMove', ({ rect, show }) => { if (!ytView || ytView.webContents.isDestroyed() || !ytWant) return; if (rect) ytView.setBounds(ytBounds(rect)); ytView.setVisible(show !== false); });
handle('preview:ytStop', () => ytStop());
// Settings / the first run: how many games have a video file, per console; the Steam clips' size; forget / clear
handle('preview:count', async () => {
  previews.forget(); const out = []; let total = 0;
  for (const def of CONSOLES) { const sc = cfg.systems[def.id]; if (!sc || sc.enabled === false || !(sc.romDirs || []).length) continue;
    await new Promise(r => setImmediate(r)); let games = []; try { games = scanSystem(def, sc); } catch {}
    const n = previews.countFiles(def, sc, games, previewOpts(sc)); if (n) out.push({ id: def.id, name: def.name, n, of: games.length }); total += n; }
  return { total, systems: out, steamBytes: previews.steamSize(), clips: ytclips.status() };
});
handle('preview:clearSteam', () => { previews.clearSteam(); return true; });
// ---------- (beta.7) Set up for me (main/emusetup.js): Windows for now (the emulators' Linux settings live elsewhere) ----------
let gpuPreset = null;
async function setupOpts() {
  const g = cfg.emuSetup && cfg.emuSetup.graphics;
  if (g && g !== 'auto') return { graphics: g };
  if (!gpuPreset) { let info = null; try { info = await app.getGPUInfo('basic'); } catch {} gpuPreset = emusetup.presetFor(info); }
  return { graphics: gpuPreset };
}
const setupOn = () => process.platform === 'win32';
function setupExe(systemId) { const sc = cfg.systems[systemId]; if (!sc || !sc.emulator) throw new Error('Choose this console\'s emulator first.'); return emuPath(sc.emulator); }
const samePath = (a, b) => path.resolve(String(a)).toLowerCase() === path.resolve(String(b)).toLowerCase();
async function setupPending(exe) {
  const P = cfg.emuSetup && cfg.emuSetup.pending; if (!setupOn() || !P || !P.some(p => samePath(emuPath(p), exe))) return;
  const st = emusetup.status(exe); if (!st.supported || !st.ready) return;
  try { const r = emusetup.apply(exe, { resume: cfg.emuSetup.resume }, await setupOpts()); log('Set up at launch:', st.name, r.ok ? (r.applied || []).join(', ') : r.why); } catch (e) { log('Set up at launch failed', e.message); }
  cfg.emuSetup.pending = P.filter(p => !samePath(emuPath(p), exe)); try { persistCfg(cfg); } catch {}
}
handle('emusetup:status', async ({ systemId }) => {
  const sc = cfg.systems[systemId]; if (!sc || !sc.emulator) return { supported: false, none: true };
  if (!setupOn()) return { supported: false, why: 'Windows only for now' };
  const exe = emuPath(sc.emulator), s = emusetup.status(exe), def = CONSOLES.find(c => c.id === systemId);
  // (beta.7) RetroArch: this console's core (there or not), and the BIOS files it wants, checked in RetroArch's system folder
  // and the shared one (Neo Geo: the games folder too). Other emulators: whether their BIOS folder has anything in it.
  let core = null, bios = null;
  if (s.kind === 'retroarch' && def && def.raCore) {
    core = { id: def.raCore, name: RA_CORE_NAME[def.raCore] || def.raCore, installed: !!retroCore(exe, def.raCore) };
    try { bios = await racores.bios(systemId, [emusetup.biosDirOf('retroarch', exe), emusetup.sharedBiosDir(), ...(systemId === 'neogeo' ? sc.romDirs || [] : [])]); } catch {}
  } else if (s.kind === 'duckstation' || s.kind === 'pcsx2') {
    const dirs = [emusetup.biosDirOf(s.kind, exe)].filter(Boolean), re = s.kind === 'pcsx2' ? /^(scph|ps2|bios).*\.bin$/i : /\.bin$/i;
    let any = false; for (const d of dirs) { try { if (fs.readdirSync(d).some(n => re.test(n))) any = true; } catch {} }
    bios = { need: 'any', ok: any, files: [], dir: dirs[0] || '' };
  }
  if (bios) bios.dir = bios.dir || emusetup.biosDirOf(s.kind, exe) || emusetup.sharedBiosDir();
  return { ...s, preset: (await setupOpts()).graphics, pending: (cfg.emuSetup.pending || []).some(p => samePath(emuPath(p), exe)), sharedBios: emusetup.sharedBiosDir(), core, bios };
});
// (beta.7) Get this core (Settings → a RetroArch console → Set up for me), with its progress on the row
handle('racore:get', async ({ systemId }) => {
  const sc = cfg.systems[systemId], def = CONSOLES.find(c => c.id === systemId); if (!sc || !sc.emulator || !def || !def.raCore) throw new Error('This console doesn\'t use a RetroArch core.');
  const exe = emuPath(sc.emulator); if (!/^retroarch\.exe$/i.test(path.basename(exe))) throw new Error('This console doesn\'t run in RetroArch.');
  const f = await racores.get(exe, def.raCore, p => { if (alive()) win.webContents.send('racore:progress', { systemId, pct: p }); });
  return { ok: true, file: f, name: RA_CORE_NAME[def.raCore] || def.raCore };
});
// Opens the folder this console's emulator reads its BIOS files from (made if it isn't there yet)
handle('bios:open', async ({ systemId }) => {
  const sc = cfg.systems[systemId]; if (!sc || !sc.emulator) throw new Error('Choose this console\'s emulator first.');
  const exe = emuPath(sc.emulator), k = emusetup.kindOf(exe), d = (k && emusetup.biosDirOf(k, exe)) || emusetup.sharedBiosDir();
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
  const e = await shell.openPath(d); if (e) throw new Error(e); return d;
});
handle('emusetup:plan', async ({ systemId }) => {
  if (!setupOn()) return { ok: false, why: 'Windows only for now', changes: [] };
  const exe = setupExe(systemId), k = emusetup.kindOf(exe); if (!k) return { ok: false, why: 'not one Tyro-Shelf can set up yet', changes: [] };
  const p = emusetup.plan(k, exe, await setupOpts());
  return { ...p, changes: (p.changes || []).map(c => ({ group: c.group, file: c.file, key: (c.section ? `[${c.section}] ` : '') + c.key, value: c.value })) };
});
handle('emusetup:apply', async ({ systemId, on }) => {
  if (!setupOn()) return { ok: false, why: 'Windows only for now' }; busyCheck();
  const o = on && typeof on === 'object' ? Object.fromEntries(emusetup.GROUPS.filter(g => on[g] != null).map(g => [g, !!on[g]])) : {};
  if (o.resume == null) o.resume = cfg.emuSetup.resume;
  return emusetup.apply(setupExe(systemId), o, await setupOpts());
});
handle('emusetup:undo', ({ systemId }) => { if (!setupOn()) return { ok: false }; busyCheck(); return emusetup.undo(setupExe(systemId)); });
// The first run's "Set up my emulators for me": each emulator the picked consoles use, once. New ones are set up now (or
// at their next launch, if they haven't been opened yet); ones you've used before are left as they are and listed.
handle('emusetup:auto', async () => {
  const out = { done: [], later: [], left: [] }; if (!setupOn()) return out;
  const seen = new Set(), opts = await setupOpts();
  for (const [id, sc] of Object.entries(cfg.systems)) {
    if (!sc || sc.enabled === false || !sc.emulator) continue; const exe = emuPath(sc.emulator), key = path.resolve(exe).toLowerCase(); if (seen.has(key)) continue; seen.add(key);
    const st = emusetup.status(exe); if (!st.supported || st.done) continue;
    if (st.used) { out.left.push(st.name); continue; }
    if (!st.ready) { if (!cfg.emuSetup.pending.some(p => samePath(emuPath(p), exe))) cfg.emuSetup.pending.push(sc.emulator); out.later.push(st.name); continue; }
    try { const r = emusetup.apply(exe, { resume: cfg.emuSetup.resume }, opts); if (r.ok) out.done.push(st.name); else log('Set up for me:', st.name, r.why); } catch (e) { log('Set up for me failed', st.name, e.message); }
  }
  try { persistCfg(cfg); } catch {}
  out.emuSetup = cfg.emuSetup; // (the wizard keeps its own copy of the settings: it takes this one, so its next save keeps the list)
  return out;
});handle('emucfg:restore', () => emucfg.restoreBackups(Object.fromEntries(Object.entries(cfg.systems).map(([k, v]) => [k, v && emuPath(v.emulator)])))); // the real path: a portable "{app}\…" one finds its User\Config backups
handle('manuals:cancel', () => { if (findToken) findToken.cancelled = true; return true; });
handle('manuals:download', async ({ choices }) => {
  // every target must be a game the scanner could have found (inside that system's games folders)
  choices = (Array.isArray(choices) ? choices : []).filter(c => { try { return c && typeof c.id === 'string' && !!gameFile(c.systemId, c.file); } catch { return false; } });
  if (autoManualJob) await autoManualJob;
  if (manualsBusy) throw new Error('Already downloading manuals.');
  manualsBusy = true;
  try {
    const rep = await manuals.downloadChosen(sysList(CONSOLES.map(c => c.id)), choices, info => { if (alive()) win.webContents.send('covers:progress', info); });
    if (rep.some(x => x.pages === -1)) { if (alive()) win.webContents.send('covers:progress', { stage: 'Turning PDF manuals into pages…' }); const made = new Map(); await convertPdfManuals(made); rep.forEach(x => { if (x.pages === -1) { x.pages = made.get(x.file) || 0; if (!x.pages) x.error = 'the PDF could not be turned into pages'; } }); }
    try { manuals.noteChosen(choices, rep); } catch {}
    await fixSpreads();
    return rep;
  }
  finally { manualsBusy = false; }
});
handle('manuals:reject', async ({ systemId, file }) => {
  const gf = gameFile(systemId, file);
  if (autoManualJob) await autoManualJob;
  if (manualsBusy) throw new Error('Already downloading manuals.');
  manualsBusy = true;
  try {
    const key = systemId + '|' + gf.file.toLowerCase(), collSrc = manualcoll.forget(key);
    const r = await manuals.rejectManual(sysList(CONSOLES.map(c => c.id)), systemId, gf.file, { collSrc, progress: info => { if (alive()) win.webContents.send('covers:progress', info); } });
    if (r.pdf) { const made = new Map(); await convertPdfManuals(made); r.got = made.get(gf.file) || 0; }
    await fixSpreads();
    if (alive()) win.webContents.send('library:changed', { manuals: 1 });
    return r;
  } finally { manualsBusy = false; }
});
handle('fs:check', list => (list || []).map(p => ({ path: p, file: paths.isFile(paths.expand(p)), dir: paths.isDir(paths.expand(p)) })));
handle('app:quit', o => { log('Quit: asked by the shelf (' + String((o && o.why) || 'no reason given').slice(0, 60) + ')'); app.quit(); }); // (why: the quick menu's Exit, or the quit combo held on the shelf)
handle('app:power', kind => { if (['sleep', 'restart', 'shutdown'].includes(kind)) powerAction(kind); return true; }); // the Quick Shelf's Power card
// Box art (quick menu → Box art): an image you pick becomes this game's front cover. It's copied into the game's art
// folder under the name the scanner looks for; the cover it replaces is moved to a "replaced" folder there, not deleted.
handle('art:choose', async ({ id }) => {
  const m = /^([a-z0-9]+):(.+)$/i.exec(String(id || '')), def = m && CONSOLES.find(c => c.id === m[1]), sc = def && cfg.systems[def.id];
  if (!def || !sc) throw new Error('Box art can only be changed for console games.');
  const file = gameFile(def.id, m[2]).file; // a game the scanner could have found: the art can't be written (or old art moved) anywhere else
  const r = await dialog.showOpenDialog(alive() ? win : undefined, { title: 'Choose box art', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
  const src = r.filePaths[0], ext = path.extname(src).slice(1).toLowerCase();
  if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext)) throw new Error('Pick a JPG, PNG or WebP image.');
  const dir = paths.artDirFor(sc, file), base = paths.artBase(file);
  await fs.promises.mkdir(dir, { recursive: true });
  const dest = path.join(dir, `${base}.${ext}`), same = path.resolve(dest).toLowerCase() === path.resolve(src).toLowerCase();
  // copied in first (under a name the scanner ignores): a failed copy (disk full, file gone) leaves the old cover where it was;
  // then the old covers move to replaced\ (stamped to the millisecond) and the new one is renamed in; any failure puts them back
  // in the game's Art Studio turn (a restyle step or a Studio pick on this game waits), locked before the turn ends
  await artstudio.serial(def.id, file, async () => {
    const tmp = path.join(dir, `${base}.incoming-pick.${ext}`); if (same) { await covers.placeArt(dir, base, '', dest, '.' + ext, 'own'); /* the file already in place: kept; a front of another type (.png beside .jpg) moves aside so this one shows */ } else {
      try { await fs.promises.copyFile(src, tmp); } catch (e) { await fs.promises.unlink(tmp).catch(() => {}); throw e; }
      try { await covers.placeArt(dir, base, '', tmp, '.' + ext, 'own'); } catch (e) { await fs.promises.unlink(tmp).catch(() => {}); throw e; } }
    artVer.set(path.resolve(dest).toLowerCase(), Date.now());
    setArtLock(def.id, file, 'front', { look: 'exact', key: 'chosen', at: Date.now() }); // your pick: background auto-fetch leaves it alone (a shelf style change replaces it unless the game is locked); the time keeps a restyle already running from undoing it
  });
  artstudio.forget(def.id); // the Studio's list for this console shows the new cover
  log('Box art: set', dest);
  if (alive()) win.webContents.send('library:changed', { artChosen: 1 });
  return { ok: true };
});
// ---------- Art Studio (Settings → Art & manuals): every version of each part, shelf styles, per-game locks ----------
function setArtLock(sysId, file, part, val) { const a = cfg.art || { styles: {}, locks: {} }, k = artstudio.lockKey(sysId, file), locks = { ...(a.locks || {}) }, e = { ...(locks[k] || {}) }; if (val) e[part] = val; else delete e[part]; if (Object.keys(e).length) locks[k] = e; else delete locks[k]; saveArt({ ...a, locks }); }
function saveArt(art) { cfg = persistCfg(config.normalize({ ...cfg, art })); }
// what every cover download hands covers.js: the console's style, and the parts locked per game
// A console nobody has given a style keeps the old auto-fetch exactly (styleFor → null: the old Box art region / Prefer HD
// order); its derived default style is only what the Studio shows and what its own Shelf-style picks use.
// mayReplace: an HD upgrade replaces only a picture Boxshelf wrote (explicit = "Download box art now", which may also upgrade
// pictures from before 1.68); a locked game or part is never touched (lockedFor)
const artOpts = explicit => ({ styleFor: id => (cfg.art && cfg.art.styles && cfg.art.styles[id] ? artstudio.styleFor(cfg, id) : null), lockedFor: (id, file) => artstudio.lockedFor(id, file), serial: (id, file, fn) => artstudio.serial(id, file, fn), mayReplace: f => artstudio.mayReplace(f, !!explicit), isPoster: f => artstudio.isPoster(f) });
let artChangedT = null;
function initArtStudio() {
  artstudio.init({ dataDir: app.getPath('userData'), log, getCfg: () => cfg, setArt: saveArt, consoles: () => sysList(CONSOLES.map(c => c.id)).map(x => ({ def: x.def, sc: x.cfg })), scan: (def, sc) => scanSystem(def, sc),
    count: id => { const sh = lastLib && lastLib.find(x => x.id === id && x.kind === 'console'); return sh ? sh.games.length : null; },
    gameFile, fileUrl, send: (ch, d) => { if (alive()) win.webContents.send(ch, d); },
    placed: dest => { artVer.set(path.resolve(dest).toLowerCase(), Date.now()); },
    // one shelf refresh for a burst of changes (a Use, then another a second later)
    changed: info => { clearTimeout(artChangedT); artChangedT = setTimeout(() => { if (alive()) win.webContents.send('library:changed', { artStudio: 1, ...info }); }, 300); },
    idle: gameIdle, coversBusy: () => coversBusy,
    // "Use my own picture…": main opens the picker; the screen never sends a path
    pickImage: async ({ title }) => { const r = await dialog.showOpenDialog(alive() ? win : undefined, { title, properties: ['openFile'], filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] }); return r.canceled || !r.filePaths || !r.filePaths[0] ? null : r.filePaths[0]; } });
}
handle('art:studio', () => artstudio.studio());
handle('art:games', async a => { const t0 = Date.now(), r = await artstudio.games(a), ms = Date.now() - t0; if (ms > 3000) log('Art games list slow:', a && a.systemId, ms, 'ms'); return r; }); // (beta.3: a report of the page stuck on "Loading…")
handle('art:style', a => artstudio.setStyle(a));
handle('art:cands', a => artstudio.cands(a));
handle('art:use', a => artstudio.use(a));
handle('art:mix', a => artstudio.mix(a));
handle('art:undo', a => artstudio.undo(a));
handle('art:sets', a => artstudio.sets(a)); // matching sets for one game (1.72)
handle('art:useSet', a => artstudio.useSet(a));
handle('art:undoSet', a => artstudio.undoSet(a));
handle('art:cancel', a => artstudio.cancel(a));
handle('art:lock', a => artstudio.lockGame(a)); // the whole game locked as it is / back on the shelf style
handle('art:own', a => artstudio.own(a)); // your own picture for one part (main opens the picker)
handle('art:release', a => artstudio.release(a)); // a console's kept pictures handed to its shelf style
// "LaunchBox index not built yet": build it now (the same one-time download Download box art now does), progress on covers:progress
let artIndexing = null, artRefreshing = null;
// Settings → Art & manuals → Refresh art database (1.71): a forced rebuild of the index (newer picture types appear), through
// covers' single-build guard; progress { phase, pct, got, total } on art:indexProgress; art:refreshCancel stops it, old index kept
handle('art:refreshIndex', () => { if (!artRefreshing && coversBusy) throw new Error('Box art is downloading right now. Try again when it finishes.'); if (!artRefreshing) artRefreshing = covers.refreshIndex(p => { if (alive()) win.webContents.send('art:indexProgress', p); }).then(() => { artstudio.forget(); return covers.indexInfo(); }).finally(() => { artRefreshing = null; }); return artRefreshing; });
handle('art:refreshCancel', () => ({ cancelled: covers.cancelRefresh() }));
handle('art:indexInfo', () => covers.indexInfo());
// ---------- Manual Studio (Settings → Art & manuals → Manuals; Details → Choose manual…; the Art Studio's Manual part) ----------
function initManualStudio() {
  manualstudio.init({ dataDir: app.getPath('userData'), log, consoles: () => sysList(CONSOLES.map(c => c.id)).map(x => ({ def: x.def, sc: x.cfg })), scan: (def, sc) => scanSystem(def, sc), gameFile, fileUrl,
    send: (ch, d) => { if (alive()) win.webContents.send(ch, d); }, idle: gameIdle,
    changed: info => { if (alive()) win.webContents.send('library:changed', info); },
    renderPdf: p => renderPdfPages(p, 1600), renderFirst: async p => { const d = (await renderPdfCover(p))[0]; const m = /^data:image\/jpeg;base64,(.+)$/.exec(String(d || '')); return m ? Buffer.from(m[1], 'base64') : null; },
    crop: makeCropper(),
    // "My PDF…": main opens the picker; the screen never sends a path
    pickPdf: async ({ title }) => { const r = await dialog.showOpenDialog(alive() ? win : undefined, { title, properties: ['openFile'], filters: [{ name: 'PDF manuals', extensions: ['pdf'] }] }); return r.canceled || !r.filePaths || !r.filePaths[0] ? null : r.filePaths[0]; } });
}
handle('manual:studio', () => manualstudio.studio());
handle('manual:games', a => manualstudio.games(a));
handle('manual:cands', a => manualstudio.cands(a));
handle('manual:use', a => manualstudio.use(a));
handle('manual:undo', a => manualstudio.undo(a));
handle('manual:lock', a => manualstudio.lock(a));
handle('manual:own', a => manualstudio.own(a));
handle('manual:pref', a => manualstudio.setPref(a));
handle('manual:cancel', a => manualstudio.cancel(a));
handle('art:index', () => { if (!artIndexing && coversBusy) throw new Error('Box art is downloading right now: it builds the index too. Try again when it finishes.'); if (!artIndexing) artIndexing = covers.buildIndex(info => { if (alive()) win.webContents.send('covers:progress', info); }).then(() => { artstudio.forget(); return { index: covers.indexState() }; }).finally(() => { artIndexing = null; }); return artIndexing; });
// the smoothness test (1.73.5): full screen, a maximized window, or a window half the screen's size, to tell whether full-screen
// presentation or the number of pixels is what costs frames. { mode } → whether it's full screen now
handle('app:winMode', async ({ mode } = {}) => {
  if (!alive()) return false;
  if (mode === 'full') { if (win.isMaximized()) win.unmaximize(); if (!win.isFullScreen()) win.setFullScreen(true); }
  else if (mode === 'max' || mode === 'half') { if (win.isFullScreen()) { win.setFullScreen(false); await new Promise(r => setTimeout(r, 600)); }
    if (mode === 'max') win.maximize(); else { if (win.isMaximized()) win.unmaximize(); const a = screen.getDisplayMatching(win.getBounds()).workArea; win.setBounds({ x: a.x + Math.round(a.width / 4), y: a.y + Math.round(a.height / 4), width: Math.round(a.width / 2), height: Math.round(a.height / 2) }); } }
  return win.isFullScreen();
});
handle('app:fullscreen', () => { if (alive()) win.setFullScreen(!win.isFullScreen()); return alive() && win.isFullScreen(); });

// The RetroAchievements key is kept encrypted for this Windows user (DPAPI via safeStorage), not as plain text in
// config.json: a copied or shared Boxshelf folder doesn't carry a usable key
// personal API keys (Settings → Connections) are kept encrypted too, the same way
function sealKeys(c) { if (!c || !c.keys || !Object.values(c.keys).some(Boolean)) return c; try { if (!safeStorage.isEncryptionAvailable()) return c; const enc = {}; for (const [k, v] of Object.entries(c.keys)) enc[k] = v ? safeStorage.encryptString(String(v)).toString('base64') : ''; return { ...c, keys: Object.fromEntries(Object.keys(c.keys).map(k => [k, ''])), keysEnc: enc }; } catch (e) { log('API keys: encryption failed, kept as before', e.message); return c; } }
function unsealKeys(c) { if (c && c.keysEnc) { c.keys = c.keys || {}; for (const [k, v] of Object.entries(c.keysEnc)) { if (v && !c.keys[k]) { try { c.keys[k] = safeStorage.decryptString(Buffer.from(v, 'base64')); } catch { log('API key', k, 'could not be unlocked here (moved to another PC?): enter it again'); } } } delete c.keysEnc; } return c; }
function sealed(c) {
  c = sealKeys(c);
  if (!c || !c.ra || !c.ra.key) return c;
  try { if (!safeStorage.isEncryptionAvailable()) return c; } catch { return c; }
  try { return { ...c, ra: { ...c.ra, key: '', keyEnc: safeStorage.encryptString(String(c.ra.key)).toString('base64') } }; } catch (e) { log('RetroAchievements key: encryption failed, kept as before', e.message); return c; }
}
function unsealed(c) {
  unsealKeys(c);
  if (c && c.ra && c.ra.keyEnc && !c.ra.key) { try { c.ra.key = safeStorage.decryptString(Buffer.from(c.ra.keyEnc, 'base64')); } catch (e) { log('RetroAchievements key could not be unlocked here (moved to another PC?): enter it again'); } }
  if (c && c.ra) delete c.ra.keyEnc; return c;
}
function persistCfg(next) { config.save(sealed(next)); return next; }
// What changed in a save that main has to act on: the display, Steam's tools, the accounts (re-checked on their own)
function cfgChanged(prev, next) {
  if (!prev || !next) return;
  const pu = prev.ui || {}, nu = next.ui || {};
  if (nu.display && nu.display !== pu.display) setTimeout(() => { try { moveToDisplay(nu.display); } catch (e) { log('display move', e.message); } }, 0);
  if ((prev.steam && prev.steam.hideTools !== false) !== (next.steam && next.steam.hideTools !== false) && alive()) win.webContents.send('library:changed', { steam: 1 });
  const ra0 = prev.ra || {}, ra1 = next.ra || {};
  if (String(ra0.user || '') !== String(ra1.user || '') || String(ra0.key || '') !== String(ra1.key || '')) retestSoon('ra');
  if (String((prev.keys || {}).fanart || '') !== String((next.keys || {}).fanart || '')) retestSoon('fanart');
  if (String((prev.keys || {}).steamgriddb || '') !== String((next.keys || {}).steamgriddb || '')) { retestSoon('steamgriddb'); artstudio.forget(); } // the Art Studio's lists gain (or lose) its posters
  if (['ssUser', 'ssPass', 'ssDevId', 'ssDevPass'].some(k => String((prev.keys || {})[k] || '') !== String((next.keys || {})[k] || ''))) { require('./main/screenscraper').credsChanged(); retestSoon('screenscraper'); artstudio.forget(); } // ScreenScraper (1.71): the same, for its sign-in
}

// ---------- displays (Settings → Display) ----------
const scr = () => { try { return screen && typeof screen.getAllDisplays === 'function' ? screen : null; } catch { return null; } };
function displaysList() {
  const S = scr(); if (!S) return [];
  const all = S.getAllDisplays(), prim = S.getPrimaryDisplay();
  let cur = null; try { if (alive()) cur = S.getDisplayMatching(win.getBounds()); } catch {}
  return all.map((d, i) => { const sf = d.scaleFactor || 1, w = Math.round(d.size.width * sf), h = Math.round(d.size.height * sf), primary = !!prim && d.id === prim.id;
    return { id: String(d.id), label: `Display ${i + 1} — ${w}×${h}` + (primary ? ' (main)' : ''), primary, current: cur ? d.id === cur.id : primary, width: w, height: h }; });
}
function displayById(id) { const S = scr(); if (!S || id == null || id === '') return null; return S.getAllDisplays().find(d => String(d.id) === String(id)) || null; }
// where the window opens: centred in the chosen display's work area (the OS picks the main display when nothing is chosen)
function startBounds() {
  try { const d = displayById(cfg && cfg.ui && cfg.ui.display); if (!d) return {}; const wa = d.workArea, w = Math.min(1600, wa.width), h = Math.min(900, wa.height);
    return { x: wa.x + Math.round((wa.width - w) / 2), y: wa.y + Math.round((wa.height - h) / 2), width: w, height: h }; } catch { return {}; }
}
// move the window to another display now; a fullscreen window leaves fullscreen, moves, and goes fullscreen there again
let moving = null;
function moveToDisplay(id) {
  if (!alive()) return false; const d = displayById(id); if (!d) return false;
  // a move to this display is already under way (Settings moves live, then the save asks again): let it finish
  if (moving && moving.id === String(d.id)) return true;
  const S = scr(); if (!moving) { try { const cur = S.getDisplayMatching(win.getBounds()); if (cur && cur.id === d.id) return true; } catch {} }
  // another move still leaving fullscreen: take it over, and go fullscreen again at the end as it would have
  const wasFull = moving ? moving.wasFull : win.isFullScreen(), wa = d.workArea;
  if (moving) { clearTimeout(moving.t); moving = null; }
  const place = () => { if (!alive()) return; const b = win.getBounds(), w = Math.min(b.width, wa.width), h = Math.min(b.height, wa.height);
    win.setBounds({ x: wa.x + Math.round((wa.width - w) / 2), y: wa.y + Math.round((wa.height - h) / 2), width: w, height: h });
    if (wasFull) win.setFullScreen(true); log('Moved to display', String(d.id)); };
  if (!wasFull) { place(); return true; }
  const m = moving = { t: null, id: String(d.id), wasFull: true }; let done = false;
  const go = () => { if (done || moving !== m) return; done = true; moving = null; clearTimeout(m.t); place(); };
  win.once('leave-full-screen', () => setTimeout(go, 50)); m.t = setTimeout(go, 800); // never stuck if the event doesn't come
  if (win.isFullScreen()) win.setFullScreen(false);
  return true;
}
handle('display:list', () => displaysList());
handle('display:move', ({ id } = {}) => moveToDisplay(String(id == null ? '' : id)));

// ---------- secrets out: backups and problem reports never carry keys, tokens or passwords ----------
const SECRET_NAME = /(key|token|password|passwd|secret)(enc)?$/i, NOT_SECRET = new Set(['fullscreenKey']); // a keyboard key, not a secret
function stripSecrets(v, depth = 0) {
  if (depth > 20) return undefined;
  if (Array.isArray(v)) return v.map(x => stripSecrets(x, depth + 1));
  if (!v || typeof v !== 'object') return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) { if (depth === 0 && (k === 'keys' || k === 'keysEnc')) continue; if (SECRET_NAME.test(k) && !NOT_SECRET.has(k)) continue; out[k] = stripSecrets(x, depth + 1); }
  return out;
}
// the values themselves, to blank out of any text that goes out (the log)
function secretValues() { const out = []; const add = x => { if (typeof x === 'string' && x.length >= 6) out.push(x); };
  try { add(cfg.ra && cfg.ra.key); for (const x of Object.values(cfg.keys || {})) add(x); } catch {} return out; }
function scrubText(t) { for (const x of secretValues()) t = t.split(x).join('[removed]'); if (HOME_RE) t = t.replace(HOME_RE, '~'); return t; }
const isPlain = v => !!v && typeof v === 'object' && !Array.isArray(v);
function deepMerge(base, over) { if (!isPlain(base) || !isPlain(over)) return over === undefined ? base : over; const out = { ...base }; for (const [k, v] of Object.entries(over)) out[k] = isPlain(v) && isPlain(base[k]) ? deepMerge(base[k], v) : v; return out; }
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
function freeName(dir, name, ext) { for (let i = 1; i < 100; i++) { const f = path.join(dir, name + (i > 1 ? ` (${i})` : '') + ext); if (!fs.existsSync(f)) return f; } return path.join(dir, `${name} ${Date.now()}${ext}`); }

// ---------- settings backup / restore ----------
const BACKUP_V = 1;
handle('settings:backup', async () => {
  let dir; try { dir = app.getPath('documents'); } catch { dir = require('os').homedir(); }
  const r = await dialog.showSaveDialog(alive() ? win : undefined, { title: 'Back up Tyro-Shelf settings', defaultPath: freeName(dir, `Tyro-Shelf settings ${stamp()}`, '.json'), filters: [{ name: 'Tyro-Shelf settings', extensions: ['json'] }] });
  if (!r || r.canceled || !r.filePath) return { ok: false, canceled: true };
  const h = loadHistory(), hist = {}; for (const [k, v] of Object.entries(h)) hist[k] = { count: v.count, ms: v.ms, last: v.last };
  const data = { app: 'Tyro-Shelf', version: app.getVersion(), backup: BACKUP_V, at: new Date().toISOString(), config: stripSecrets(cfg), history: hist };
  try { await fs.promises.writeFile(r.filePath + '.tmp', JSON.stringify(data, null, 1)); await fs.promises.rename(r.filePath + '.tmp', r.filePath); }
  catch (e) { try { await fs.promises.unlink(r.filePath + '.tmp'); } catch {} log('settings backup failed', e.message); return { ok: false, error: e.message }; }
  log('Settings backed up'); return { ok: true, file: r.filePath };
});
// checks a parsed backup; returns the reason it can't be used, or ''
function badBackup(b) {
  if (!isPlain(b) || (b.app !== 'Tyro-Shelf' && b.app !== 'Boxshelf')) return 'That isn\'t a Tyro-Shelf settings backup.';
  if (typeof b.version !== 'string' || !/^\d+(\.\d+)*/.test(b.version)) return 'That backup has no Tyro-Shelf version.';
  if (!isPlain(b.config) || !isPlain(b.config.ui) || !isPlain(b.config.systems)) return 'That backup has no settings in it.';
  if (b.history != null && !isPlain(b.history)) return 'The play history in that backup is damaged.';
  return '';
}
// the backup's settings over today's; today's keys and accounts stay (a backup never has them)
function restoredConfig(cur, b) {
  const next = deepMerge(cur, stripSecrets(b.config)); delete next.keysEnc;
  next.keys = { ...(cur.keys || {}) };
  next.ra = { ...(next.ra || {}), key: (cur.ra && cur.ra.key) || '' }; delete next.ra.keyEnc;
  if (cur.ra && cur.ra.key && cur.ra.user) next.ra.user = cur.ra.user; // the key belongs to this account
  return next;
}
// play history: per game the larger count / time and the later date, so nothing played since the backup is lost
function mergeHistory(h, add) {
  let n = 0; for (const [k0, v] of Object.entries(add || {})) { if (!isPlain(v)) continue; const k = String(k0).slice(0, 1024), e = h[k] || { count: 0, ms: 0, last: 0 };
    h[k] = { count: Math.max(e.count, Math.max(0, +v.count || 0)), ms: Math.max(e.ms, Math.max(0, +v.ms || 0)), last: Math.max(e.last, Math.max(0, +v.last || 0)) }; n++; }
  return n;
}
handle('settings:restore', async () => {
  const r = await dialog.showOpenDialog(alive() ? win : undefined, { title: 'Restore Tyro-Shelf settings', properties: ['openFile'], filters: [{ name: 'Tyro-Shelf settings', extensions: ['json'] }] });
  if (!r || r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
  let b; try { const st = await fs.promises.stat(r.filePaths[0]); if (st.size > 32 * 1024 * 1024) return { ok: false, error: 'That file is too big to be a settings backup.' }; b = JSON.parse(await fs.promises.readFile(r.filePaths[0], 'utf8')); }
  catch (e) { return { ok: false, error: 'That file couldn\'t be read as a settings backup.' }; }
  const why = badBackup(b); if (why) return { ok: false, error: why };
  applyCfg(restoredConfig(cfg, b));
  if (b.history) { const n = mergeHistory(loadHistory(), b.history); if (n) saveHistory(); }
  log('Settings restored from a backup made with', String(b.version).slice(0, 20));
  if (alive()) { win.webContents.send('library:changed', { restored: 1 }); win.webContents.send('history:changed', { restored: 1 }); }
  return { ok: true };
});

// ---------- play history: forget it all ----------
handle('history:clear', () => { const h = loadHistory(); for (const k of Object.keys(h)) delete h[k]; saveHistory(); log('Play history cleared');
  if (alive()) { win.webContents.send('history:changed', { cleared: 1 }); win.webContents.send('library:changed', { history: 1 }); } return { ok: true }; });

// ---------- problem report (a zip on the Desktop to send when asking for help) ----------
function zipFolder(src, dest) {
  return new Promise(resolve => {
    if (process.platform === 'win32') {
      // paths go in through the environment, never into the command text
      execFileQ('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Compress-Archive -LiteralPath (Get-ChildItem -LiteralPath $env:BS_SRC).FullName -DestinationPath $env:BS_ZIP -Force'], { env: { ...process.env, BS_SRC: src, BS_ZIP: dest } }, ok => resolve(ok && fs.existsSync(dest)));
    } else execFileQ('zip', ['-j', '-q', dest, ...fs.readdirSync(src).map(n => path.join(src, n))], {}, ok => resolve(ok && fs.existsSync(dest)));
  });
}
function execFileQ(cmd, args, opts, cb) { try { require('child_process').execFile(cmd, args, { windowsHide: true, timeout: 60000, ...opts }, err => cb(!err)); } catch { cb(false); } }
async function reportInfo() {
  const os = require('os'), L = [];
  L.push(`Tyro-Shelf ${app.getVersion()}`, `Electron ${process.versions.electron}  Chrome ${process.versions.chrome}  Node ${process.versions.node}`);
  L.push(`OS: ${os.type()} ${os.release()} ${os.arch()}${typeof os.version === 'function' ? ' (' + os.version() + ')' : ''}`, `CPU: ${(os.cpus()[0] || {}).model || '?'} × ${os.cpus().length}`, `Memory: ${Math.round(os.totalmem() / 1073741824)} GB (${Math.round(os.freemem() / 1073741824)} GB free)`);
  L.push(`Packaged: ${app.isPackaged ? 'yes' : 'no'}  Windowed: ${WINDOWED ? 'yes' : 'no'}  Fullscreen now: ${alive() && win.isFullScreen() ? 'yes' : 'no'}`);
  // (1.82) how much memory Boxshelf itself uses, per process (the shelf, the GPU, helpers), to tell from a report whether
  // Boxshelf is what fills a PC's RAM
  L.push('', 'Tyro-Shelf memory (working set):');
  try { let total = 0; for (const m of app.getAppMetrics()) { const mb = Math.round(((m.memory && m.memory.workingSetSize) || 0) / 1024); total += mb; L.push(`  ${m.type}${m.serviceName ? ' ' + m.serviceName : ''}: ${mb} MB`); }
    L.push(`  total: ${total} MB${launcher.isRunning() ? ' (a game is running)' : ''}`); } catch (e) { L.push('  ' + e.message); }
  L.push('', 'Displays:'); try { for (const d of displaysList()) L.push(`  ${d.label}${d.current ? ' ← Tyro-Shelf' : ''}`); } catch {}
  L.push('', 'Graphics:');
  try { let t; const gpu = await Promise.race([app.getGPUInfo('basic'), new Promise(r => { t = setTimeout(() => r(null), 5000); })]); clearTimeout(t);
    if (gpu) { for (const g of (gpu.gpuDevice || [])) L.push(`  ${g.active ? '* ' : '  '}vendor ${g.vendorId} device ${g.deviceId}${g.driverVersion ? ' driver ' + g.driverVersion : ''}${g.description ? ' ' + g.description : ''}`); if (gpu.auxAttributes) L.push('  ' + JSON.stringify(gpu.auxAttributes).slice(0, 2000)); } else L.push('  (no answer)'); } catch (e) { L.push('  ' + e.message); }
  try { L.push('  features: ' + JSON.stringify(app.getGPUFeatureStatus())); } catch {}
  return L.join('\r\n') + '\r\n';
}
let reporting = null;
handle('app:reportProblem', () => reporting || (reporting = makeReport().finally(() => { reporting = null; })));
async function makeReport() {
  let desk; try { desk = app.getPath('desktop'); } catch {} if (!desk || !fs.existsSync(desk)) desk = require('os').homedir();
  const name = `Boxshelf problem report ${stamp()}`, tmp = await fs.promises.mkdtemp(path.join(require('os').tmpdir(), 'boxshelf-report-'));
  try {
    for (const [f, n] of [[LOG, 'boxshelf.log'], [LOG + '.old', 'boxshelf.log.old']]) { try { await fs.promises.writeFile(path.join(tmp, n), scrubText(await fs.promises.readFile(f, 'utf8'))); } catch {} }
    const c = stripSecrets(cfg); if (c.ra) delete c.ra.user; // the account name isn't needed to help
    await fs.promises.writeFile(path.join(tmp, 'config.json'), scrubText(JSON.stringify(c, null, 2)));
    await fs.promises.writeFile(path.join(tmp, 'info.txt'), scrubText(await reportInfo()));
    const zip = freeName(desk, name, '.zip');
    if (await zipFolder(tmp, zip)) { log('Problem report written'); return { ok: true, file: zip }; }
    try { await fs.promises.unlink(zip); } catch {}
    const dir = freeName(desk, name, ''); await fs.promises.mkdir(dir, { recursive: true }); // no zip tool: the files in a folder instead
    for (const n of await fs.promises.readdir(tmp)) await fs.promises.copyFile(path.join(tmp, n), path.join(dir, n));
    log('Problem report written (folder)'); return { ok: true, file: dir, folder: true };
  } catch (e) { log('problem report failed', e.message); return { ok: false, error: e.message }; }
  finally { fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}

// ---------- account / API status (Settings → Accounts & services) ----------
const API_SERVICES = ['ra', 'fanart', 'steamgriddb', 'screenscraper'];
let apiStat = null; const apiStatFile = () => path.join(app.getPath('userData'), 'api-status.json');
function apiStatusLoad() { if (apiStat) return apiStat; apiStat = {}; try { const j = JSON.parse(fs.readFileSync(apiStatFile(), 'utf8')); if (isPlain(j)) for (const s of API_SERVICES) if (isPlain(j[s])) apiStat[s] = j[s]; } catch {} return apiStat; }
function apiConfigured(s) { return s === 'ra' ? !!(cfg.ra && cfg.ra.user && cfg.ra.key) : s === 'fanart' || s === 'steamgriddb' ? !!(cfg.keys && cfg.keys[s]) : s === 'screenscraper' ? require('./main/screenscraper').configured() : false; }
// what the screen shows: the last result, or 'none' while there's no account / key (a stale ok must not show for a removed key)
function apiStatusView() { const st = apiStatusLoad(), out = {}; for (const s of API_SERVICES) out[s] = apiConfigured(s) ? (st[s] || { state: 'none', at: 0, msg: 'Not checked yet' }) : { state: 'none', at: 0, msg: 'Not set up' }; return out; }
function apiStatusSave() { writeAtomic(apiStatFile(), JSON.stringify(apiStat)).catch(e => log('api status save', e.message)); } // (both services re-tested at once used to share one .tmp)
const apiRuns = {};
function testApi(s) {
  if (!API_SERVICES.includes(s)) throw new Error('Unknown service.');
  if (apiRuns[s]) return apiRuns[s];
  return apiRuns[s] = (async () => {
    let res;
    if (!apiConfigured(s)) res = { state: 'none', at: Date.now(), msg: 'Not set up' };
    else if (s === 'ra') {
      const user = cfg.ra.user, key = cfg.ra.key;
      try { const p = await ra.test(user, key); res = { state: 'ok', at: Date.now(), msg: 'Connected', user: String(p.user || user), points: +p.points || 0 }; }
      catch (e) { res = { state: 'fail', at: Date.now(), msg: scrubText(String(e && e.message || e)).slice(0, 300), user: String(user) }; }
    } else if (s === 'screenscraper') { // (the account's answer carries today's quota: shown on the Test toast)
      const r = await require('./main/screenscraper').test();
      res = r.ok ? { state: 'ok', at: Date.now(), msg: 'Working', ...(r.left != null ? { left: r.left } : {}) } : { state: 'fail', at: Date.now(), msg: scrubText(String(r.error || 'not accepted')).slice(0, 300) };
    } else {
      const r = s === 'steamgriddb' ? await require('./main/steamgrid').test(cfg.keys.steamgriddb) : await fanartTest(cfg.keys.fanart);
      res = r.ok ? { state: 'ok', at: Date.now(), msg: 'Key works' } : { state: 'fail', at: Date.now(), msg: scrubText(String(r.error || 'not accepted')).slice(0, 300) };
    }
    apiStatusLoad()[s] = res; apiStatusSave();
    return res;
  })().finally(() => { apiRuns[s] = null; });
}
const retestT = {};
function retestSoon(s) {
  clearTimeout(retestT[s]);
  retestT[s] = setTimeout(async () => { retestT[s] = null;
    try { if (apiRuns[s]) await apiRuns[s].catch(() => {}); await testApi(s); } catch (e) { log('API check', s, e.message); }
    if (alive()) win.webContents.send('api:status', apiStatusView()); }, 1500);
}
handle('api:status', () => apiStatusView());
// per console: are achievements on and signed in inside its emulator? (reads the emulators' own settings; never tokens)
handle('ra:emulators', () => require('./main/raemu').check({ ...cfg, systems: Object.fromEntries(Object.entries(cfg.systems).map(([k, v]) => [k, v ? { ...v, emulator: emuPath(v.emulator) } : v])) }, ra.CONSOLE_ID)); // real paths ({app}, %VAR%, quotes), as a launch uses
handle('api:test', async ({ service } = {}) => { const s = String(service || ''); if (retestT[s]) { clearTimeout(retestT[s]); retestT[s] = null; } /* tested now: the re-test the save queued isn't needed */ await testApi(s); const v = apiStatusView()[s]; if (alive()) win.webContents.send('api:status', apiStatusView()); return v; });
// temp folders a crash or power cut left behind (manual downloads, e-book unpacking)
function sweepTemp() {
  const tmp = require('os').tmpdir(), old = Date.now() - 864e5;
  fs.promises.readdir(tmp).then(names => { for (const n of names) if (/^boxshelf-(manual|emanual)/i.test(n)) { const f = path.join(tmp, n); fs.promises.stat(f).then(st => { if (st.mtimeMs < old) return fs.promises.rm(f, { recursive: true, force: true }); }).catch(() => {}); } }).catch(() => {});
}
// data\thumbs: small copies of covers for the shelf. Old ones (covers since replaced, games removed) are cleared out:
// anything not used for 60 days, and the oldest beyond 300 MB
async function pruneThumbs() {
  const dir = path.join(app.getPath('userData'), 'thumbs'); let names = []; try { names = await fs.promises.readdir(dir); } catch { return; }
  const list = []; for (const n of names) { try { const st = await fs.promises.stat(path.join(dir, n)); list.push({ f: path.join(dir, n), t: Math.max(st.atimeMs, st.mtimeMs), s: st.size }); } catch {} }
  list.sort((a, b) => b.t - a.t); let total = 0, gone = 0; const old = Date.now() - 60 * 864e5;
  for (const x of list) { total += x.s; if (x.t < old || total > 300 * 1024 * 1024) { try { await fs.promises.unlink(x.f); gone++; } catch {} } }
  if (gone) log('Thumbnails: cleared', gone, 'old ones');
}
// ---------- Phone companion (main/companion.js): a phone on the home Wi-Fi browses the library, starts games, reads
// manuals and works as a remote. Off until switched on in Settings → Phone companion.
// Its buttons: into the Home menu while that's open (a window of its own); Home opens the menu (over the game, or the
// shelf's, which the shelf accepts only on the shelf / Details); everything else reaches the shelf as one more controller
// (renderer/companion/tv-input.js). While a game runs only Home does something: the game has the controller.
function companionInput(m) {
  if (!m || typeof m !== 'object') return;
  if (m.text != null || m.key) { if (alive() && !homemenu.isOpen() && !launcher.isRunning()) win.webContents.send('companion:input', m); return; }
  const b = String(m.b || ''), down = !!m.d;
  if (homemenu.isOpen()) { if (['up', 'down', 'left', 'right', 'a', 'b', 'start', 'home'].includes(b)) homemenu.button(b, down); return; }
  if (b === 'home') { if (!down || cfg.ui.homeMenu === false) return; if (launcher.isRunning()) Promise.resolve(homemenu.open()).catch(e => log('home menu', e && e.message)); else if (alive()) win.webContents.send('shelf:menuRequest'); return; }
  if (launcher.isRunning() || !alive()) return;
  win.webContents.send('companion:input', { b, d: down });
}
function initCompanion() {
  companion.init({ log, dataDir: app.getPath('userData'), webDir: path.join(__dirname, 'renderer', 'companion'), fontDir: path.join(__dirname, 'renderer', 'fonts'), version: app.getVersion(),
    library: () => { if (lastLib) return lastLib; try { return lastLib = JSON.parse(fs.readFileSync(libCacheFile(), 'utf8')); } catch { return []; } }, // the shelves as last scanned
    hidden: () => (Array.isArray(cfg.ui.hidden) ? cfg.ui.hidden : []), glyphs: () => ({ style: shelfGlyphs, swap: shelfSwap }), homeMenu: () => cfg.ui.homeMenu,
    running: () => (launching || launcher.isRunning() ? { id: histOpen && histOpen.id, kind: runKind } : null),
    // Play goes through the shelf's own launch (boot video / slide, history, Home menu), as pressing A on that box would
    play: p => { if (!alive()) return false; win.webContents.send('companion:input', { play: p }); return true; },
    quit: async () => { if (!launcher.isRunning()) return; log('Phone companion: quit'); pendingPower = null; coverForQuit(); closeGame(); },
    input: companionInput, thumb: (f, st, h) => thumbFor(f, st, h),
    raFor: sys => ra.enabled() && !!ra.CONSOLE_ID[sys], achievements: (sys, title) => (ra.enabled() && ra.CONSOLE_ID[sys] ? ra.progress(sys, title, false) : null),
    changed: st => { if (alive()) win.webContents.send('companion:state', st); } });
}
handle('companion:state', () => companion.state());
handle('companion:set', o => companion.set(o && typeof o === 'object' ? { enabled: o.enabled, port: o.port } : {}));
handle('companion:forget', ({ id } = {}) => companion.forget(String(id || '')));
handle('companion:pin', () => companion.renewPin());
// No page Boxshelf shows ever needs the camera, microphone, location, notifications…: refuse them all, everywhere
function denyPermissions(ses) { try { ses.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'fullscreen')); ses.setPermissionCheckHandler((wc, perm) => perm === 'fullscreen'); } catch {} }
app.on('session-created', denyPermissions);
if (firstInstance) app.whenReady().then(() => { try { startUp(); } catch (e) {
  // something on this PC stops Boxshelf from starting (a read-only folder, a damaged file): say so, don't hang invisibly
  log('ERROR starting', e && e.stack || e);
  try { dialog.showErrorBox('Tyro-Shelf could not start', `${e && e.message || e}\n\nDetails are in data\\boxshelf.log. Tyro-Shelf needs to be able to write to its own folder.`); } catch {}
  try { app.exit(1); } catch { process.exit(1); }
} });
// (Tyro-Shelf-10) Diagnostic for the "several icon-only Tyro-Shelf entries in Alt+Tab" issue: writes every window and process
// this app has to data\boxshelf.log (8 s after start, and 4 s after each game closes). Compare the counts with Alt+Tab.
function dumpWindows(tag) {
  try {
    const ws = BrowserWindow.getAllWindows().map(w => {
      let s = '"' + (w.isDestroyed() ? '(destroyed)' : w.getTitle()) + '"';
      if (!w.isDestroyed()) s += ` visible=${w.isVisible()} min=${w.isMinimized()} focusable=${w.isFocusable()} top=${w.isAlwaysOnTop()} parent=${w.getParentWindow() ? 'yes' : 'no'} ${w.getBounds().width}x${w.getBounds().height}`;
      return s;
    });
    const procs = app.getAppMetrics().map(m => m.type + (m.name ? `(${m.name})` : '') + '#' + m.pid);
    log(`windows[${tag}]: ${ws.length} -> ${ws.join(' | ')}`);
    log(`processes[${tag}]: ${procs.length} -> ${procs.join(', ')}; captureCompat(disable-direct-composition)=${captureCompat}`);
  } catch (e) { log('dumpWindows failed', e && e.message); }
}
// (Tyro-Shelf-13) The same, at the Windows level: every top-level window owned by this app's processes (what Alt+Tab is built from),
// with class, title, styles (ex=0x80 tool window, 0x8000000 no-activate, 0x40000 app window), owner, size, cloaked state.
const WD_CS = 'using System; using System.Text; using System.Runtime.InteropServices; public static class WD { delegate bool EP(IntPtr h, IntPtr l); [DllImport("user32.dll")] static extern bool EnumWindows(EP cb, IntPtr l); [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h); [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h); [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i); [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n); [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n); [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint c); [StructLayout(LayoutKind.Sequential)] struct R { public int A, B, C, D; } [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out R r); [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int n); public static string Run(int[] pids) { StringBuilder o = new StringBuilder(); int hidden = 0; EnumWindows((h, l) => { uint pid; GetWindowThreadProcessId(h, out pid); bool mine = Array.IndexOf(pids, (int)pid) >= 0; StringBuilder t = new StringBuilder(128); GetWindowText(h, t, 128); if (!mine && (!IsWindowVisible(h) || t.ToString().IndexOf("Tyro", StringComparison.OrdinalIgnoreCase) < 0)) return true; if (!IsWindowVisible(h)) { hidden++; return true; } StringBuilder c = new StringBuilder(128); GetClassName(h, c, 128); string pn = "?"; try { pn = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch (Exception) { } R r; GetWindowRect(h, out r); int cl = 0; DwmGetWindowAttribute(h, 14, out cl, 4); o.Append((mine ? "" : "OTHER PROCESS ") + "pid=" + pid + " (" + pn + ") class=" + c + " title=[" + t + "] ex=0x" + GetWindowLong(h, -20).ToString("x") + " owner=" + (GetWindow(h, 4) != IntPtr.Zero) + " iconic=" + IsIconic(h) + " cloaked=" + cl + " " + (r.C - r.A) + "x" + (r.D - r.B) + Environment.NewLine); return true; }, IntPtr.Zero); o.Append("(invisible windows: " + hidden + ")"); return o.ToString(); } }';
function dumpTopLevel(tag) {
  if (process.platform !== 'win32') return;
  try {
    const pids = [process.pid, process.ppid, ...app.getAppMetrics().map(m => m.pid)].filter((v, i, a) => v > 0 && a.indexOf(v) === i);
    const ps = `$ErrorActionPreference = 'Stop'; Add-Type -TypeDefinition '${WD_CS}'; [WD]::Run([int[]]@(${pids.join(',')}))`;
    require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { windowsHide: true, timeout: 20000 }, (err, out, errOut) => {
      if (err) { log(`top-level[${tag}] failed:`, String(errOut || err.message).slice(0, 300)); return; }
      const lines = String(out).split(/\r?\n/).filter(Boolean);
      log(`top-level[${tag}] for pids ${pids.join(',')}: ${lines.length - 1} visible`); lines.forEach(l => log(`  ${l}`));
    });
  } catch (e) { log('dumpTopLevel failed', e && e.message); }
}
function startUp() {
  setTimeout(() => dumpWindows('start'), 8000); setTimeout(() => dumpTopLevel('start'), 9000);
  if (session && session.defaultSession) denyPermissions(session.defaultSession);
  config.init(app.getPath('userData'), log);
  arcadenames.init(app.getPath('userData'), log); // (beta.7) arcade game names, main/arcadenames.js
  emusetup.init({ log, dataDir: app.getPath('userData'), appRoot: paths.appRoot() }); racores.init({ log }); previews.init({ log, dataDir: app.getPath('userData'), appRoot: paths.appRoot() }); ytclips.init({ log, dataDir: app.getPath('userData') }); addgames.init({ log });
  cfg = unsealed(config.load()); { const fx = fixXenia(cfg); if (fx !== cfg) { cfg = fx; try { persistCfg(cfg); } catch {} } } applyArtLibrary();
  presence.configure({ enabled: cfg.ui.discordPresence, clientId: cfg.ui.discordClientId }, log);
  launcher.setPadSafe(cfg.ui.dolphinPadSafe);
  { const here = paths.appRoot(), L = Array.isArray(cfg.ui.installs) ? cfg.ui.installs.filter(x => typeof x === 'string') : []; if (!L.some(x => x.toLowerCase() === here.toLowerCase())) { cfg.ui.installs = [here, ...L].slice(0, 6); try { persistCfg(cfg); } catch {} } } // where Boxshelf has run from: a later move can offer the magazines left here
  // consoles added in an update (PS5): found once, as setup would have (an emulator or games folder set by hand is kept)
  { const known = Array.isArray(cfg.ui.knownSystems) ? cfg.ui.knownSystems : [], add = ['ps5', 'sw2'].filter(id => !known.includes(id) && cfg.systems[id]);
    if (add.length) { for (const id of add) { const c = cfg.systems[id]; if (cfg.setupDone && !c.emulator && !(c.romDirs || []).length) { const d = detectSystem(id); if (d) { if (d.emulator) c.emulator = d.emulator; if (d.romDirs.length) c.romDirs = d.romDirs; log('New console', id, d.emulator ? 'emulator found' : 'no emulator', d.romDirs.length + ' games folder(s)'); } } }
      cfg.ui.knownSystems = [...known, ...add]; try { persistCfg(cfg); } catch {} } }
  // Switch 2: builds come and go (forks get swapped often); a shelf build that's gone points at the newest one there is
  { const e = cfg.systems.sw2 && cfg.systems.sw2.emulator; if (e && !paths.isFile(emuPath(e))) nx2.builds(sw2Roots()).then(l => { const b = l.sort((a, c) => c.date - a.date)[0]; if (b && cfg.systems.sw2 && !paths.isFile(emuPath(cfg.systems.sw2.emulator))) { log('Switch 2: shelf build gone, now', b.label); applyCfg({ ...cfg, systems: { ...cfg.systems, sw2: { ...cfg.systems.sw2, emulator: b.exe } } }); } }).catch(() => {}); }
  if (cfg.ra && cfg.ra.key) { try { const raw = JSON.parse(fs.readFileSync(config.file(), 'utf8')); if (raw && raw.ra && raw.ra.key) persistCfg(cfg); } catch {} } // an older plain-text key: encrypt it now
  covers.init(app.getPath('userData'), log); require('./main/steamgrid').init({ dataDir: app.getPath('userData'), log, key: () => (cfg && cfg.keys && cfg.keys.steamgriddb) || '' }); require('./main/screenscraper').init({ dataDir: app.getPath('userData'), log, creds: () => { const k = (cfg && cfg.keys) || {}; return { user: k.ssUser || '', pass: k.ssPass || '', devId: k.ssDevId || '', devPass: k.ssDevPass || '' }; } }); initArtStudio(); initManualStudio(); // (SteamGridDB: the Art Studio's optional poster source)
  commercials.init({ log, dir: path.join(app.getPath('userData'), 'commercials'), memoFile: path.join(app.getPath('userData'), 'commercials.json'), fetchBuf: async url => { const r = await net.fetch(url); if (r.status === 404) return null; if (!r.ok) throw new Error('archive.org answered ' + r.status); return Buffer.from(await r.arrayBuffer()); }, // (busy / down: a failure, so no game is noted as "no ad" for a month)
    // url → file, streamed; resolves to the bytes written (0: not found), rejects past max bytes
    fetchFile: async (url, dest, max) => { const r = await net.fetch(url); if (!r.ok || !r.body) return 0; let n = 0;
      const { Readable, Transform } = require('stream');
      await require('stream/promises').pipeline(Readable.fromWeb(r.body), new Transform({ transform(c, e, cb) { n += c.length; cb(n > max ? new Error('too big') : null, c); } }), fs.createWriteStream(dest));
      return n; } });
  stremio.init({ log, fanartKey: () => (cfg && cfg.keys && cfg.keys.fanart) || '', artDir: path.join(app.getPath('userData'), 'stremio-art'), fetchBuf: async url => { const r = await net.fetch(url); if (r.status === 404) return null; if (!r.ok) throw new Error('HTTP ' + r.status); return Buffer.from(await r.arrayBuffer()); } }); // null = really not there; other failures throw, so nothing "missing" is cached for them
  icons.init(app.getPath('userData'), log);
  x360.init(app.getPath('userData'), log);
  steamart.init(app.getPath('userData'), log); pcgames.init(app.getPath('userData'), log); gscripts.init(log); legendary.init(log, path.join(app.getPath('userData'), 'legendary')); legendary.setPath(cfg && cfg.pc && cfg.pc.legendaryPath); pccovers.init({ dataDir: app.getPath('userData'), log, placed: d => artVer.set(path.resolve(d).toLowerCase(), Date.now()), fileUrl, fetchImage, steamgrid: require('./main/steamgrid'), steamCover: id => steamart.local(id).front, match: covers.sgMatch });
  wiiumanual.init(app.getPath('userData'), log);
  ra.init(app.getPath('userData'), log); ra.setCredentials(cfg.ra && cfg.ra.enabled !== false ? cfg.ra.user : '', cfg.ra && cfg.ra.key);
  manuals.init(log); archive.init(log); manuals.setStore(path.join(app.getPath('userData'), 'manual-auto.json')); manuals.setRejectStore(path.join(app.getPath('userData'), 'manual-rejects.json'));
  manualcoll.init({ cacheDir: path.join(app.getPath('userData'), 'boxart-cache'), memoFile: path.join(app.getPath('userData'), 'manual-collections.json'), log });
  protocol.handle('bsfile', serveFile);
  createWindow();
  initCompanion(); // (after the window: what it reports goes to Settings there)
  setTimeout(watchShelf, 4000);
  setTimeout(() => { wmReady = true; wmStart(); }, 3000); // the Wii remote (Settings → Controller → Wii remote)
  nx2.setMemoFile(path.join(app.getPath('userData'), 'sw2-builds.json'));
  setTimeout(() => makeBacks(CONSOLES.map(c => c.id)).then(() => makeSpines(CONSOLES.map(c => c.id))), 90000); // backs and spines for games the art checks found none for (a few at most, after the busy start)
  // Switch 2: the build list ready before the first Play (each build's .nup check reads its 40-60 MB program once, then it's remembered)
  setTimeout(() => { if ((cfg.systems.sw2 || {}).emulator || (cfg.systems.sw2 || {}).romDirs) nx2.builds(sw2Roots()).catch(() => {}); }, 20000);
  setTimeout(watchRoms, 6000); // after the busy start
  // (1.82) a newer beta on the public page: the shelf says so once (Settings → About → Check for new betas turns it off)
  updates.init(log, { dir: path.join(app.getPath('userData'), 'update'), build: TYRO_BUILD, repo: TYRO_PKG.tyroRepo || '' });
  // (Tyro-Shelf-17) a newer release on GitHub: the shelf says so once (Settings → About → Check for updates automatically turns it off)
  setTimeout(() => { if (cfg.ui.autoUpdate === false) return; updates.check(false).then(r => { if (r && r.newer && alive()) win.webContents.send('app:update', r); }).catch(() => {}); }, 25000);
  setTimeout(sweepTemp, 20000);
  // once: empty the web cache an older version let grow (the 64 MB limit keeps it small from here on)
  setTimeout(() => { try { const mark = path.join(app.getPath('userData'), '.cache-trimmed'); if (fs.existsSync(mark)) return; session.defaultSession.clearCache().then(() => { fs.writeFileSync(mark, ''); log('Web cache emptied'); }).catch(() => {}); } catch {} }, 25000);
  setTimeout(pruneThumbs, 30000);
}

app.on('window-all-closed', () => app.quit());
