/* Your own menu music: the audio files in the Music folder, played one after another in a shuffled order under the shelf
   (Settings → Sound → Menu music → Your music). One file is read at a time. ambient() in app.js starts and stops it exactly
   like the built-in menu music, so it goes quiet when a game starts, in the museum, and while the window is hidden. */
window.UserMusic = (() => {
  const MIME = { mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', weba: 'audio/webm' };
  let held = false, hist = [], starting = false, api = null, list = [], order = [], pos = -1, au = null, url = '', want = false, level = .4, tok = 0, cur = null, fadeT = 0, fails = 0, loaded = false, loading = null;
  const clamp = v => Math.max(0, Math.min(1, +v || 0));
  function ensure() {
    if (au) return au;
    au = new Audio(); au.preload = 'auto';
    au.addEventListener('ended', () => { if (want) next(); });
    au.addEventListener('error', () => { if (!want || !cur) return; if (++fails > Math.max(2, list.length)) { want = false; return; } next(); });
    return au;
  }
  const ping = () => { try { window.dispatchEvent(new Event('usermusic')); } catch {} }; // the track or its paused state changed: an open menu repaints its name
  function fade(to, ms, then) {
    clearInterval(fadeT); fadeT = 0; if (!au) return then && then();
    const from = au.volume, t0 = performance.now(); if (ms <= 0 || from === to) { au.volume = to; return then && then(); }
    fadeT = setInterval(() => { const k = Math.min(1, (performance.now() - t0) / ms); try { au.volume = from + (to - from) * k; } catch {} if (k >= 1) { clearInterval(fadeT); fadeT = 0; then && then(); } }, 40);
  }
  async function load(a) {
    if (a) api = a; if (!api || !api.music) { list = []; return { tracks: 0 }; }
    if (loading) return loading;
    loading = (async () => { try { list = (await api.music()) || []; } catch { list = []; } loaded = true; order = []; pos = -1;
      if (cur && !list.some(t => t.file === cur.file)) { cur = null; if (au) { au.pause(); } }
      return { tracks: list.length }; })();
    try { return await loading; } finally { loading = null; }
  }
  function shuffled() { const o = list.map((_, i) => i); for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } return o; }
  async function playFile(item) {
    if (!item || !api) return; const my = ++tok;
    let bytes; try { bytes = await api.musicRead(item.file); } catch { if (my === tok && want && ++fails <= list.length) next(); return; }
    if (my !== tok || !want) return;
    const ext = (/\.([a-z0-9]+)$/i.exec(item.file) || [])[1] || 'mp3';
    const blob = new Blob([bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)], { type: MIME[ext.toLowerCase()] || 'audio/mpeg' });
    const old = url; url = URL.createObjectURL(blob); const a = ensure(); if (cur && cur.file !== item.file) { hist.push(cur); if (hist.length > 30) hist.shift(); } cur = item; ping(); a.src = url; a.volume = 0;
    if (old) setTimeout(() => URL.revokeObjectURL(old), 2000);
    try { await a.play(); fails = 0; fade(level, 900); } catch { if (my === tok && want && ++fails <= list.length) next(); }
  }
  function next() {
    if (!list.length) return;
    if (pos + 1 >= order.length) { order = shuffled(); pos = -1; if (order.length > 1 && cur && list[order[0]].file === cur.file) order.push(order.shift()); } // (not the same song twice in a row)
    return playFile(list[order[++pos]]);
  }
  async function start(lv) {
    want = true; level = clamp(lv); if (held || starting) return; // (held: paused from the quick menu: it stays paused until Play)
     starting = true; // (ambient() asks again and again: one start at a time)
    try {
      if (!loaded) await load();
      if (!want || !list.length) return;
      if (au && au.src && cur && au.paused && !au.ended) { try { await au.play(); fade(level, 900); } catch {} return; } // (it was only paused: carry on where it was)
      if (au && !au.paused) { fade(level, 200); return; }
      await next();
    } finally { starting = false; }
  }
  function stop() { want = false; tok++; if (au && !au.paused) fade(0, 450, () => { if (!want && au) au.pause(); }); }
  function setLevel(lv) { level = clamp(lv); if (au && want && !au.paused) fade(level, 120); }
  function skip() { if (!list.length) return; want = true; held = false; fails = 0; if (au) { au.pause(); } next(); }
  function prev() { const p = hist.pop(); if (!p || !list.some(t => t.file === p.file)) { if (au && au.src) { try { au.currentTime = 0; } catch {} } return; } want = true; held = false; fails = 0; if (au) au.pause(); const keep = cur; playFile(p).then(() => { if (keep && hist.length && hist[hist.length - 1].file === keep.file) hist.pop(); }); } // (back to the one before; or the start of this one when there's none)
  function togglePause() { if (!au || !cur) return false; if (held) { held = false; want = true; au.play().then(() => fade(level, 400)).catch(() => {}); } else { held = true; fade(0, 300, () => { if (held && au) au.pause(); }); } ping(); return held; }
  function playIndex(i) { if (!list[i]) return; want = true; held = false; fails = 0; order = []; pos = -1; if (au) au.pause(); playFile(list[i]); }
  return { load, start, stop, setLevel, skip, prev, togglePause, isHeld: () => held, playIndex, tracks: () => list.slice(), count: () => list.length, current: () => cur, playing: () => !!(au && !au.paused && want && !held) };
})();
