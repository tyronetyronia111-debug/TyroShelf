// Tyro-Shelf: the Steam games you own but haven't installed (and, optionally, games shared by family members), like Playnite's
// Steam library. Uses Steam's public Web API (GetOwnedGames) with YOUR OWN Steam Web API key (free: steamcommunity.com/dev/apikey)
// and Steam ID; nothing is built in. The key lives in your settings file (data\config.json), is sent only to api.steampowered.com,
// and is never logged. Family sharing: add the Steam IDs of family members (their game details must be public); the games they
// own that you don't are listed as "family shared". The lists are cached in data\steam-owned.json and refreshed in the background.
const fs = require('fs');
const path = require('path');
const https = require('https');

let log = () => {}, file = '', refreshing = null;
function init(logger, dataDir) { if (logger) log = logger; file = path.join(dataDir, 'steam-owned.json'); }

// the Steam account that signed in last (Steam\config\loginusers.vdf)
function detectId(steamPath) {
  try {
    const t = fs.readFileSync(path.join(steamPath, 'config', 'loginusers.vdf'), 'utf8'), re = /"(\d{17})"\s*\{([^}]*)\}/g; let m, any = '';
    while ((m = re.exec(t))) { any = any || m[1]; if (/"MostRecent"\s+"1"/.test(m[2])) return m[1]; }
    return any;
  } catch { return ''; }
}
const NOISE = /soundtrack|\bost\b|dedicated server|\bsdk\b|benchmark|playtest|\bdemo\b|wallpaper engine: |\bdlc\b|artbook|art book/i;

function owned(key, id) {
  return new Promise(resolve => {
    const u = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(key)}&steamid=${encodeURIComponent(id)}&include_appinfo=1&include_played_free_games=1&format=json`;
    const req = https.get(u, { headers: { 'User-Agent': 'Tyro-Shelf' } }, res => {
      if (res.statusCode === 401 || res.statusCode === 403) { res.resume(); return resolve({ error: 'Steam did not accept the API key.' }); }
      if (res.statusCode !== 200) { res.resume(); return resolve({ error: 'Steam answered ' + res.statusCode }); }
      let b = ''; res.setEncoding('utf8'); res.on('data', c => { b += c; if (b.length > 30e6) req.destroy(); });
      res.on('end', () => { try { const r = JSON.parse(b).response || {}; resolve(Array.isArray(r.games) ? { games: r.games.map(g => ({ appid: String(g.appid), name: String(g.name || ''), minutes: +g.playtime_forever || 0, last: +g.rtime_last_played || 0 })) } : { error: "No games came back: the profile's game details are probably private (Steam → Profile → Edit → Privacy)." }); } catch { resolve({ error: 'unreadable answer' }); } });
    });
    req.on('error', e => resolve({ error: e.message })); req.setTimeout(30000, () => req.destroy(new Error('timed out')));
  });
}
const cache = () => { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return { at: +j.at || 0, id: String(j.id || ''), own: Array.isArray(j.own) ? j.own : [], shared: Array.isArray(j.shared) ? j.shared : [] }; } catch { return { at: 0, id: '', own: [], shared: [] }; } };
const ids = s => [...new Set(String(s || '').split(/[\s,;]+/).filter(x => /^\d{17}$/.test(x)))].slice(0, 12);

// opts: { key, steamId, family }. Resolves { ok, error?, own, shared }
function refresh(opts) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const key = String(opts.key || '').trim(), id = String(opts.steamId || '').trim();
    if (!/^[0-9A-Fa-f]{32}$/.test(key)) return { ok: false, error: 'Add your Steam Web API key first (Settings → PC → Steam).' };
    if (!/^\d{17}$/.test(id)) return { ok: false, error: 'No Steam ID: it is read from Steam when you are signed in there, or type it in Settings.' };
    const mine = await owned(key, id); if (mine.error) { log('Steam owned games:', mine.error); return { ok: false, error: mine.error }; }
    const have = new Set(mine.games.map(g => g.appid)), shared = new Map();
    for (const f of ids(opts.family)) {
      if (f === id) continue;
      const r = await owned(key, f); if (r.error) { log('Steam family member', f.slice(0, 5) + '…:', r.error); continue; }
      for (const g of r.games) if (!have.has(g.appid) && !shared.has(g.appid)) shared.set(g.appid, { appid: g.appid, name: g.name });
    }
    const clean = l => l.filter(g => g.name && !NOISE.test(g.name));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const out = { at: Date.now(), id, own: clean(mine.games), shared: clean([...shared.values()]) };
    fs.writeFileSync(file, JSON.stringify(out)); log('Steam: you own', out.own.length, 'games,', out.shared.length, 'more shared by family');
    return { ok: true, own: out.own.length, shared: out.shared.length };
  })().catch(e => ({ ok: false, error: e.message })).finally(() => { refreshing = null; });
  return refreshing;
}
module.exports = { init, detectId, cache, refresh };
