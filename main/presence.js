// Discord Rich Presence: shows "Playing <game>" on your Discord profile while a game started from Boxshelf is running.
// Talks to the Discord desktop app over its local IPC pipe (no network, no account sign-in, no extra packages).
// Needs a Discord "application" id: create one (free) at discord.com/developers/applications; its name is what
// Discord shows after "Playing". Off by default; nothing connects until a game starts. Every failure is silent
// (Discord closed, no id set): presence is a nicety and must never get in the way of a game.
const net = require('net');
const path = require('path');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const RETRY_MS = 15000;
const ID_RE = /^\d{15,25}$/;

let log = () => {};
let cfg = { enabled: false, clientId: '' };
let lastErr = '', lastSent = '', noImage = false, noName = false, gameId = ''; // gameId: the playing game's own Discord application, when it has one
const eff = () => gameId || cfg.clientId; // the application used right now
let sock = null, ready = false, connecting = false, buf = Buffer.alloc(0), want = null, retryT = null, nonce = 0, sockId = '';

// where Discord listens: a named pipe on Windows, a socket file elsewhere (the Flatpak and Snap builds keep theirs in a subfolder)
function pipePaths(i) {
  if (process.platform === 'win32') return [`\\\\?\\pipe\\discord-ipc-${i}`];
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
  const out = [path.join(base, `discord-ipc-${i}`)];
  if (process.platform === 'linux' && process.env.XDG_RUNTIME_DIR) out.push(path.join(base, 'app', 'com.discordapp.Discord', `discord-ipc-${i}`), path.join(base, 'snap.discord', `discord-ipc-${i}`));
  return out;
}

function frame(op, data) {
  const json = Buffer.from(JSON.stringify(data)), head = Buffer.alloc(8);
  head.writeInt32LE(op, 0); head.writeInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}

function tryConnect(p) {
  return new Promise(resolve => {
    const s = net.createConnection(p);
    const done = ok => { s.removeListener('error', onErr); s.removeListener('connect', onOk); if (!ok) s.destroy(); resolve(ok ? s : null); };
    const onErr = () => done(false), onOk = () => done(true);
    s.once('error', onErr); s.once('connect', onOk);
  });
}

function clearRetry() { if (retryT) { clearTimeout(retryT); retryT = null; } }
function scheduleRetry() { if (retryT || !want || !cfg.enabled) return; retryT = setTimeout(() => { retryT = null; connect(); }, RETRY_MS); retryT.unref(); }

function closeSock() {
  const s = sock; sock = null; ready = false; buf = Buffer.alloc(0); sockId = '';
  if (s) { try { s.destroy(); } catch {} }
}

function send(op, data) { if (sock) { try { sock.write(frame(op, data)); } catch {} } }

// SET_ACTIVITY with an activity shows it; without one it clears the profile line
function flush() {
  if (!sock || !ready) return;
  const act = want ? { ...want } : undefined;
  if (act && noImage) delete act.assets; // Discord turned the picture down once: leave it out so the rest still shows
  // the game's own name is the activity's name (the bold "Playing <game>" line). If Discord won't take a name of its own, the
  // title goes on the first line under the application's name instead, as before
  if (act && noName) { const sys = act.details; act.details = act.name; act.state = sys; delete act.name; delete act.status_display_type; }
  lastSent = act ? (act.name || act.details) : '';
  log('Discord presence: ' + (act ? 'showing "' + (act.name || act.details) + '"' + (act.assets ? ' with a picture' : '') : 'cleared'));
  send(OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: act }, nonce: String(++nonce) });
}

function onData(chunk) {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 8) {
    const op = buf.readInt32LE(0), len = buf.readInt32LE(4);
    if (len < 0 || len > 1 << 20) { closeSock(); return; }
    if (buf.length < 8 + len) return;
    let msg = null; try { msg = JSON.parse(buf.subarray(8, 8 + len).toString('utf8')); } catch {}
    buf = buf.subarray(8 + len);
    if (op === OP.PING) send(OP.PONG, msg || {});
    else if (op === OP.CLOSE) { log('Discord presence: Discord closed the connection', msg && msg.message ? '(' + msg.message + ')' : ''); closeSock(); scheduleRetry(); return; }
    else if (op === OP.FRAME && msg && msg.evt === 'READY') { ready = true; lastErr = ''; log('Discord presence: connected to Discord' + (msg.data && msg.data.user ? ' as ' + msg.data.user.username : '')); flush(); }
    else if (op === OP.FRAME && msg && msg.evt === 'ERROR') {
      lastErr = (msg.data && msg.data.message) || 'Discord refused the status'; log('Discord presence: Discord said:', lastErr, msg.data && msg.data.code ? '(code ' + msg.data.code + ')' : '');
      if (want && want.assets && !noImage) { noImage = true; log('Discord presence: trying again without the picture'); flush(); } // an image Discord won't take must not cost the whole status
      else if (want && want.name && !noName) { noName = true; log('Discord presence: trying again with the name under the application name'); flush(); }
    }
  }
}

function attach(s) {
  sock = s; ready = false; buf = Buffer.alloc(0); sockId = eff();
  s.on('data', onData);
  s.on('error', () => {});
  s.on('close', () => { if (sock === s) { sock = null; ready = false; sockId = ''; scheduleRetry(); } });
  s.write(frame(OP.HANDSHAKE, { v: 1, client_id: sockId }));
  // no READY within 10 s (not really Discord, or it's busy starting): let go and try again later
  const t = setTimeout(() => { if (sock === s && !ready) { closeSock(); scheduleRetry(); } }, 10000); t.unref();
}

async function connect() {
  if (sock || connecting || !cfg.enabled || !ID_RE.test(eff()) || !want) return;
  connecting = true;
  try {
    for (let i = 0; i < 10 && !sock; i++) for (const p of pipePaths(i)) { const s = await tryConnect(p); if (s) { attach(s); break; } }
  } finally { connecting = false; }
  if (!sock) { if (!lastErr || !/open/.test(lastErr)) log('Discord presence: the Discord app was not found (is it open on this PC?). Trying again in a moment.'); lastErr = 'Discord app not found: open it on this PC'; scheduleRetry(); }
  else if (!want) closeSock(); // the game ended while connecting
}

const clip = (v, n) => { v = String(v || '').replace(/\s+/g, ' ').trim().slice(0, n); return v.length === 1 ? v + '​' : v; }; // Discord wants 2 to 128 characters

// settings: { enabled, clientId }. Called at start-up and whenever Settings are saved.
function configure(c, logger) {
  if (logger) log = logger;
  const next = { enabled: !!(c && c.enabled === true), clientId: String((c && c.clientId) || '').trim() };
  const changed = next.enabled !== cfg.enabled || next.clientId !== cfg.clientId;
  cfg = next;
  if (!changed) return;
  if (!cfg.enabled) { clearRetry(); if (sock && ready && want) { const keep = want; want = null; flush(); want = keep; } closeSock(); return; }
  if (sock && sockId !== eff()) closeSock(); // another application id: start a new conversation
  if (want) connect();
}

// A game started. info: { title, system, systemId, startedAt }
function play(info) {
  if (!info || !info.title) return;
  if (info.hide) { log('Discord presence: this game is set to stay off Discord'); stop(); return; } // this game is kept off Discord
  noImage = false; noName = false;
  const own = String(info.clientId || '').trim(); gameId = ID_RE.test(own) ? own : '';
  if (sock && sockId !== eff()) closeSock(); // this game has its own application (or the last one did): talk to the right one
  want = {
    name: clip(info.title, 128), // "Playing <game>": the game's name, not the Discord application's
    status_display_type: 0, // the member list and profile say Playing <name>
    details: clip(info.system ? 'on ' + info.system : 'Playing', 128),
    timestamps: { start: Math.floor((info.startedAt || Date.now()) / 1000) },
    // the game's own picture link when it has one; else the Discord application's art asset named after the console id (if uploaded)
    assets: info.image ? { large_image: String(info.image).slice(0, 256), large_text: clip(info.title, 128) } : info.systemId ? { large_image: String(info.systemId).slice(0, 32), large_text: clip(info.system || 'Tyro-Shelf', 128) } : undefined
  };
  if (!cfg.enabled || !ID_RE.test(eff())) { log('Discord presence: not shown (' + (!cfg.enabled ? 'turned off in Settings → System → Discord' : 'no valid Discord application ID set, in Settings → System → Discord or in this game\'s Discord page') + ')'); return; }
  if (sock && ready) flush(); else connect();
}

// The game closed: clear the profile line and let go of Discord a moment later
function stop() {
  want = null; gameId = ''; clearRetry();
  const s = sock;
  if (s && ready) { flush(); const t = setTimeout(() => { if (!want && sock === s) closeSock(); }, 500); t.unref(); }
  else if (s) closeSock();
}

// for Settings → System → Discord → Check
function status() {
  if (!cfg.enabled) return { state: 'off', text: 'Turned off' };
  if (!ID_RE.test(eff())) return { state: 'noid', text: 'Needs your Discord application ID (a number of 15 to 25 digits), here or on each game' };
  if (sock && ready) return { state: 'ok', text: lastSent ? 'Connected · showing "' + lastSent + '"' : 'Connected · nothing playing' };
  if (lastErr) return { state: 'err', text: lastErr };
  return { state: 'idle', text: 'Ready: connects when a game starts' };
}
function shutdown() { want = null; clearRetry(); if (sock && ready) flush(); closeSock(); }

module.exports = { configure, play, stop, shutdown, status, ID_RE };
