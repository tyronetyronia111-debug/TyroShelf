// Starts emulators, Steam games and media apps, and reports when they close.
const { spawn } = require('child_process');
const path = require('path');
const { shell } = require('electron');
const fs = require('fs');
const { isFile, expand } = require('./paths');

let running = null;
// a program whose manifest asks for administrator (requireAdministrator) can't be started by a normal process: Windows refuses
// it. Only looked for after such a refusal; the program is then started through PowerShell's -Verb RunAs (the UAC prompt)
function needsAdmin(exe) { try { if (fs.statSync(exe).size > 600e6) return false; return fs.readFileSync(exe).includes('requireAdministrator'); } catch { return false; } }

// Split an options string like  -b -e "{rom}"  into arguments, filling in {rom}.
function buildArgs(template, rom) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(template || ''))) out.push((m[1] !== undefined ? m[1] : m[2]).replace(/\{rom\}/g, () => rom || '')); // a function: a path like Ca$$h\game.iso must not be read as a replacement pattern
  return out.filter(a => a !== '');
}

// Emulators built on SDL (Dolphin, Eden, Yuzu forks…) switch a Bluetooth DualSense/DualShock into its own report mode and leaves it there; the shelf's controller
// then goes quiet after the game until the pad is reconnected. Telling SDL not to use rumble, player LEDs or the extended reports
// (the things that make it switch the mode) leaves the pad as it was while Dolphin still reads it. (Dolphin games played with a PlayStation pad keep working through Windows' own driver,
// but their button mapping in Dolphin may need choosing again: the setting in Settings → Controllers turns this off.)
let padSafe = true;
const setPadSafe = on => { padSafe = on !== false; };
function start(exe, args, onExit, env, isEmu) { // env: the emulator's own environment (PS5: the KytyJets preset); else Boxshelf's
  exe = exe && expand(String(exe).trim().replace(/^"(.*)"$/, '$1')); // same rules as the Settings check: %VAR%, {app}, pasted "quotes"
  if (!exe || !isFile(exe)) throw new Error(`Can't find ${exe || 'the program'}. Check its path in Settings.`);
  if (running) throw new Error('Something is already running. Close it first.');
  // detached: on Windows a normal child sits in Node's kill-on-close job object, so a Boxshelf crash or update restart
  // would take the emulator (and its unsaved game) with it. Not unref'd: the 'exit' event must still reach us.
  if (padSafe && isEmu) { env = Object.assign({}, env || process.env, { SDL_JOYSTICK_HIDAPI_PS5_RUMBLE: '0', SDL_JOYSTICK_HIDAPI_PS4_RUMBLE: '0', SDL_JOYSTICK_HIDAPI_PS5_PLAYER_LED: '0', SDL_JOYSTICK_ENHANCED_REPORTS: '0' }); }
  const child = spawn(exe, args, Object.assign({ cwd: path.dirname(exe), windowsHide: false, stdio: 'ignore', detached: true }, env ? { env } : {}));
  running = child;
  const started = Date.now(); let done = false, spawned = false;
  const finish = info => { if (done) return; done = true; running = null; onExit({ ...info, ms: Date.now() - started }); };
  child.on('spawn', () => { spawned = true; });
  // failedToStart: the program never ran (EACCES, a bad exe, blocked by antivirus), so it wasn't a play
  child.on('error', err => {
    if (!spawned && process.platform === 'win32' && !isEmu && ['UNKNOWN', 'EACCES'].includes(err.code) && needsAdmin(exe)) {
      const q = s => "'" + String(s).replace(/'/g, "''") + "'";
      const ps = `$p = Start-Process -FilePath ${q(exe)} -WorkingDirectory ${q(path.dirname(exe))} -Verb RunAs ${args && args.length ? '-ArgumentList @(' + args.map(q).join(',') + ') ' : ''}-PassThru; $p.WaitForExit()`;
      try {
        const el = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'ignore' });
        running = el; spawned = true;
        el.on('error', e => finish({ code: -1, error: e.message, failedToStart: true }));
        el.on('exit', code => finish({ code, failedToStart: code !== 0 && Date.now() - started < 4000 }));
        return;
      } catch {}
    }
    finish({ code: -1, error: err.message, failedToStart: !spawned });
  });
  child.on('exit', code => finish({ code }));
  return { pid: child.pid, args };
}

function launchGame(sysCfg, rom, onExit, extraArgs = [], env = null) {
  return start(sysCfg.emulator, [...extraArgs, ...buildArgs(sysCfg.gameArgs, rom)], onExit, env, true);
}

function launchEmulator(sysCfg, onExit) {
  return start(sysCfg.emulator, buildArgs(sysCfg.emulatorArgs, ''), onExit, undefined, true);
}

function launchApp(exe, onExit, args) { return start(exe, Array.isArray(args) ? args : [], onExit); }

function launchSteam(appid) {
  if (!/^\d+$/.test(String(appid))) throw new Error('Unknown Steam game.');
  return shell.openExternal(`steam://rungameid/${appid}`);
}

function isRunning() { return !!running; }
function stopRunning() { if (running) { try { running.kill(); } catch {} } }
// a helper spawn (taskkill) that can't be found or started must not become an uncaught 'error' event
function quiet(cmd, args) { try { const c = spawn(cmd, args, { windowsHide: true, stdio: 'ignore' }); c.on('error', () => {}); return c; } catch { return null; } }
let forceTimer = null;
// Ask the emulator to close like a click on its X (saves, settings and Dolphin's batch mode all behave),
// and force it if it's still there forceAfterMs later: Cemu, RPCS3 and Xenia can take several seconds to flush saves
// and shader caches, so the default is a generous 8 s. onForce(pid) is called if the force kill was needed.
// Returns false when nothing is running, else true (same as before).
function closeRunning(forceAfterMs = 8000, onForce) {
  if (!running) return false;
  const pid = running.pid, child = running;
  if (process.platform === 'win32') quiet('taskkill', ['/PID', String(pid)]);
  // (Linux: the whole process group, which detached started: a Flatpak's launcher, an AppImage's runtime and the emulator
  // itself all get the request, not just the first process)
  else { try { process.kill(-pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} } }
  if (!forceTimer) { // pressed again while waiting: ask again, but keep the first deadline
    const ms = Number.isFinite(+forceAfterMs) && +forceAfterMs >= 0 ? +forceAfterMs : 8000;
    forceTimer = setTimeout(() => {
      forceTimer = null;
      if (running !== child || child.exitCode !== null || child.signalCode !== null) return;
      // a "really quit?" dialog (or anything else) is holding it open: end the whole tree
      if (process.platform === 'win32') quiet('taskkill', ['/PID', String(pid), '/T', '/F']); else { try { process.kill(-pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } }
      if (typeof onForce === 'function') { try { onForce(pid); } catch {} }
    }, ms);
    child.once('exit', () => { clearTimeout(forceTimer); forceTimer = null; });
  }
  return true;
}

module.exports = { setPadSafe, buildArgs, launchGame, launchEmulator, launchApp, launchSteam, isRunning, stopRunning, closeRunning };
