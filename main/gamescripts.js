// Tyro-Shelf: scripts and companion programs around a game, the idea from Playnite's Edit Game → Scripts tab (Playnite is MIT).
// Each game can have PowerShell scripts that run before it starts, after it started and after it exited, each with its own
// "also run the global script" switch, and a list of programs to open along with it (optionally closed when the game ends).
// Written from scratch for Tyro-Shelf. Scripts are the player's own text, run only on their own PC, hidden, as themselves.
// The scripts see the game as environment variables: TYRO_GAME_NAME, TYRO_GAME_ID, TYRO_GAME_EXE, TYRO_GAME_DIR, TYRO_GAME_SOURCE.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let log = () => {}, started = []; // started: companion programs still open { pid, close, name }
function init(logger) { if (logger) log = logger; }

const clean = (s, n) => typeof s === 'string' ? s.replace(/\r\n?/g, '\n').slice(0, n) : '';
const prog = p => { const exe = clean(p && p.exe, 1024).trim(); return exe ? { exe, args: clean(p.args, 1000).replace(/\n/g, ' ').trim(), close: p.close === true } : null; };
// the stored shape; used by config.js
function sanitize(v) {
  if (!v || typeof v !== 'object') return null;
  const o = { pre: clean(v.pre, 20000), started: clean(v.started, 20000), post: clean(v.post, 20000),
    gPre: v.gPre !== false, gStarted: v.gStarted !== false, gPost: v.gPost !== false,
    programs: (Array.isArray(v.programs) ? v.programs : []).map(prog).filter(Boolean).slice(0, 20) };
  const empty = !o.pre.trim() && !o.started.trim() && !o.post.trim() && !o.programs.length && o.gPre && o.gStarted && o.gPost;
  return empty ? null : o;
}
const sanitizeGlobal = v => ({ pre: clean(v && v.pre, 20000), started: clean(v && v.started, 20000), post: clean(v && v.post, 20000) });

const psq = s => String(s).replace(/'/g, "''");
function envOf(g) {
  const exe = String(g.exe || '');
  return { TYRO_GAME_NAME: String(g.title || ''), TYRO_GAME_ID: String(g.id || ''), TYRO_GAME_EXE: exe, TYRO_GAME_DIR: exe ? path.dirname(exe) : '', TYRO_GAME_SOURCE: String(g.source || '') };
}
// runs one script hidden; resolves when it ends (or after `ms`: a stuck script must never hold the game back)
function runScript(text, g, ms) {
  return new Promise(res => {
    if (!text || !text.trim() || process.platform !== 'win32') return res(false);
    let done = false; const fin = v => { if (!done) { done = true; res(v); } };
    try {
      const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from("$ErrorActionPreference = 'Continue'\n" + text, 'utf16le').toString('base64')],
        { windowsHide: true, stdio: 'ignore', env: { ...process.env, ...envOf(g) }, cwd: g.exe ? path.dirname(g.exe) : undefined });
      const t = setTimeout(() => { log('Game script took longer than', ms / 1000, 's, going on'); fin(false); try { p.kill(); } catch {} }, ms);
      p.on('error', e => { log('Game script:', e.message); clearTimeout(t); fin(false); });
      p.on('exit', code => { clearTimeout(t); if (code) log('Game script ended with code', code); fin(true); });
    } catch (e) { log('Game script:', e.message); fin(false); }
  });
}
// the scripts that apply for a hook: the global one first when the game asks for it, then the game's own
function pick(when, game, globalCfg) {
  const own = game && game[when] || '', glob = globalCfg && globalCfg[when] || '';
  const useGlobal = !game || game[when === 'pre' ? 'gPre' : when === 'started' ? 'gStarted' : 'gPost'] !== false;
  return [useGlobal ? glob : '', own].filter(s => s && s.trim());
}
async function before(g, game, globalCfg) { // blocks the launch (up to 60 s)
  for (const s of pick('pre', game, globalCfg)) await runScript(s, g, 60000);
}
function afterStart(g, game, globalCfg) { // fire and forget, then the companion programs
  (async () => { for (const s of pick('started', game, globalCfg)) await runScript(s, g, 120000); })();
  for (const p of (game && game.programs) || []) openProgram(p, g);
}
function openProgram(p, g) {
  const exe = String(p.exe || '');
  try {
    if (!path.isAbsolute(exe) && !/^[\w.-]+$/.test(exe)) { log('Companion program skipped (not a full path):', exe); return; }
    if (path.isAbsolute(exe) && !fs.existsSync(exe)) { log('Companion program not found:', exe); return; }
    const args = []; const re = /"([^"]*)"|(\S+)/g; let m; while ((m = re.exec(p.args || ''))) args.push(m[1] !== undefined ? m[1] : m[2]);
    const c = spawn(exe, args.filter(a => a !== ''), { cwd: path.isAbsolute(exe) ? path.dirname(exe) : undefined, detached: true, stdio: 'ignore', windowsHide: false, env: { ...process.env, ...envOf(g) } });
    c.on('error', e => log('Companion program:', exe, e.message));
    if (c.pid) started.push({ pid: c.pid, close: p.close === true, name: path.basename(exe) });
    c.unref(); log('Opened along with the game:', path.basename(exe));
  } catch (e) { log('Companion program:', e.message); }
}
function afterExit(g, game, globalCfg) {
  const mine = started; started = [];
  for (const c of mine) if (c.close && process.platform === 'win32') { try { const k = spawn('taskkill', ['/PID', String(c.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); k.on('error', () => {}); } catch {} log('Closed with the game:', c.name); }
  (async () => { for (const s of pick('post', game, globalCfg)) await runScript(s, g, 120000); })();
}
module.exports = { init, sanitize, sanitizeGlobal, before, afterStart, afterExit };
