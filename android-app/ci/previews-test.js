// Device test pass "previews" (beta.7), run by web-device-test.js: the demo page as Windows on a 1920x1080 TV.
//   Node side (main/previews.js): a game's video is found in ES-DE / EmuDeck / RetroBat / LaunchBox / your own folders,
//   by file name then title; Steam's DASH manifest becomes the first ~20 s of its 480p video; YouTube links are read.
//   Page: previews are off until chosen; in Details a preview opens under the title only once it plays, and is gone
//   the moment Details closes; a YouTube trailer is laid over the same box (and steps aside while the panel scrolls);
//   nothing starts while the shelf is busy; "Details and shelf" plays softly behind the cases and stops when you move;
//   Settings has the Video previews rows; the first run offers previews with box art. Screenshots: previews-*.png.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const ROOT = path.join(__dirname, '..', '..');

module.exports = async function previewsPass({ browser, base, check, OUT }) {
  // ---------- node side ----------
  { const P = require(path.join(ROOT, 'main', 'previews'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-pv-')), put = p => { const f = path.join(home, ...p.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'v'); return f; };
    const oldUP = process.env.USERPROFILE, oldH = process.env.HOME; process.env.USERPROFILE = home; process.env.HOME = home;
    P.init({ dataDir: path.join(home, 'data'), appRoot: path.join(home, 'Boxshelf') });
    const snes = { id: 'snes', romFolderNames: ['snes', 'sfc'] }, md = { id: 'megadrive', romFolderNames: ['megadrive', 'genesis'] }, gc = { id: 'gc', romFolderNames: ['gamecube', 'gc'] };
    const rb = path.join(home, 'RetroBat', 'roms', 'snes'); put('RetroBat/roms/snes/Super Metroid (USA).sfc'); const f1 = put('RetroBat/roms/snes/videos/Super Metroid (USA)-video.mp4');
    const es = put('ES-DE/downloaded_media/genesis/videos/Sonic the Hedgehog (USA, Europe).mp4'); // (ES-DE calls Mega Drive "genesis")
    const ed = path.join(home, 'Emulation', 'roms', 'gc'); const f3 = put('Emulation/tools/downloaded_media/gc/videos/Pikmin (USA).mp4'); fs.mkdirSync(ed, { recursive: true });
    const lb = put('LaunchBox/Videos/Nintendo GameCube/Wind Waker-01.mp4');
    const own = path.join(home, 'My videos'); const f5 = put('My videos/snes/Chrono Trigger.webm');
    const r1 = P.findFile(snes, { romDirs: [rb] }, { file: path.join(rb, 'Super Metroid (USA).sfc'), title: 'Super Metroid' });
    const r2 = P.findFile(md, { romDirs: [path.join(home, 'roms', 'md')] }, { file: path.join(home, 'roms', 'md', 'Sonic the Hedgehog (USA, Europe).md'), title: 'Sonic the Hedgehog' });
    const r3 = P.findFile(gc, { romDirs: [ed] }, { file: path.join(ed, 'Pikmin (USA).rvz'), title: 'Pikmin' });
    const r4 = P.findFile(gc, { romDirs: [ed] }, { file: path.join(ed, 'zelda-ww.rvz'), title: 'Wind Waker' }, { launchbox: { gc: 'Nintendo GameCube' } });
    const r5 = P.findFile(snes, { romDirs: [rb] }, { file: path.join(rb, 'Chrono Trigger (USA).sfc'), title: 'Chrono Trigger' }, { dirs: [own] });
    const r6 = P.findFile(snes, { romDirs: [rb] }, { file: path.join(rb, 'Nothing Here.sfc'), title: 'Nothing Here' }, { dirs: [own] });
    process.env.USERPROFILE = oldUP; process.env.HOME = oldH;
    check('Previews: a game\'s video is found in RetroBat, ES-DE, EmuDeck, LaunchBox and your own folders (by file name, then title); a game without one has none',
      r1 === f1 && r2 === es && r3 === f3 && r4 === lb && r5 === f5 && r6 === null, JSON.stringify([r1, r2, r3, r4, r5, r6].map(x => x && path.relative(home, x))));
    const mpd = '<MPD><Period><AdaptationSet contentType="video"><Representation id="0" height="528"><SegmentTemplate timescale="1000000" duration="3000000" initialization="dash_h264/init-stream$RepresentationID$.m4s" media="dash_h264/chunk-stream$RepresentationID$-$Number%05d$.m4s" startNumber="1"></SegmentTemplate></Representation><Representation id="1" height="480"><SegmentTemplate timescale="1000000" duration="3000000" initialization="dash_h264/init-stream$RepresentationID$.m4s" media="dash_h264/chunk-stream$RepresentationID$-$Number%05d$.m4s" startNumber="1"></SegmentTemplate></Representation></AdaptationSet><AdaptationSet contentType="audio"></AdaptationSet></Period></MPD>';
    const plan = P.dashPlan(mpd, 'https://video.akamai.steamstatic.com/store_trailers/1/2/abc/3/dash_h264.mpd?t=9');
    check('Previews: Steam\'s trailer manifest becomes its 480p video\'s first pieces (about 20 seconds)',
      plan && /init-stream1\.m4s\?t=9$/.test(plan.init) && plan.media.length === 7 && /chunk-stream1-00001\.m4s/.test(plan.media[0]) && /chunk-stream1-00007\.m4s/.test(plan.media[6]), JSON.stringify(plan && { init: plan.init.slice(-30), n: plan.media.length }));
    check('Previews: YouTube links (watch, youtu.be, embed) give the video; other sites none',
      P.youtubeId('https://www.youtube.com/watch?v=abcdefghijk') === 'abcdefghijk' && P.youtubeId('https://youtu.be/abcdefghijk') === 'abcdefghijk' && P.youtubeId('https://www.youtube-nocookie.com/embed/abcdefghijk') === 'abcdefghijk' && P.youtubeId('https://example.com/watch?v=abcdefghijk') === null);
    fs.rmSync(home, { recursive: true, force: true }); }

  // ---------- (beta.8) console trailers: main/ytclips.js with a made-up trailer stream and a pretend helper ----------
  { const Y = require(path.join(ROOT, 'main', 'ytclips')), P = require(path.join(ROOT, 'main', 'previews'));
    const box = (type, ...parts) => { const body = Buffer.concat(parts.map(p => Buffer.isBuffer(p) ? p : Buffer.alloc(p))); const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length); h.write(type, 4, 'latin1'); return Buffer.concat([h, body]); };
    // a fragmented MP4 like YouTube's 480p stream: ftyp, moov, sidx (12 fragments of 3 s), then moof + mdat pairs
    const frags = Array.from({ length: 12 }, (_, i) => Buffer.concat([box('moof', 24), box('mdat', 4000 + i * 10)]));
    const sx = Buffer.alloc(24 + 12 * frags.length); sx.writeUInt32BE(1, 4); sx.writeUInt32BE(1000, 8); sx.writeUInt16BE(frags.length, 22);
    frags.forEach((f, i) => { sx.writeUInt32BE(f.length, 24 + i * 12); sx.writeUInt32BE(3000, 28 + i * 12); sx.writeUInt32BE(0x90000000, 32 + i * 12); });
    const head = Buffer.concat([box('ftyp', Buffer.from('dash0000iso6mp41')), box('moov', box('mvhd', 100))]), sidxBox = box('sidx', sx), stream = Buffer.concat([head, sidxBox, ...frags]);
    const pl = Y.plan(stream), want = frags.slice(0, 7).reduce((a, f) => a + f.length, 0);
    check('Console trailers: the stream\'s fragment index gives the first ~20 seconds (whole fragments, header kept, index dropped)',
      !!pl && pl.headEnd === head.length && pl.from === head.length + sidxBox.length && pl.to - pl.from === want && pl.seconds === 21, JSON.stringify(pl));
    // the whole flow: helper asked for the stream, two ranged reads, one file; asked again = the same file, no new reads
    const dd = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-yt-')); Y.init({ dataDir: dd }); P.init({ dataDir: dd }); Y._force(true);
    fs.mkdirSync(path.join(dd, 'tools'), { recursive: true }); fs.writeFileSync(path.join(dd, 'tools', 'yt-dlp.exe'), Buffer.alloc(1.2e6));
    const asked = [], reads = [];
    Y._setRun(async args => { asked.push(args.join(' ')); const u = args[args.length - 1]; if (/v=gone/.test(u)) throw new Error('ERROR: [youtube] gone: Video unavailable'); return JSON.stringify({ url: 'https://rr1---sn-test.googlevideo.com/videoplayback?id=1', http_headers: { 'User-Agent': 'test' } }); });
    Y._fetch(async url => { const m = /range=(\d+)-(\d+)/.exec(url); reads.push(m && m[0]); return m ? stream.subarray(+m[1], +m[2] + 1) : Buffer.alloc(0); });
    const st0 = Y.status(); const f1 = await Y.clip('abcdefghijk'); const n1 = reads.length; const f2 = await Y.clip('abcdefghijk'); const bad = await Y.clip('gone0000000'); const bad2 = await Y.clip('gone0000000');
    const out = f1 && fs.readFileSync(f1), st1 = Y.status();
    check('Console trailers: a clip is the header plus those fragments, made once and kept (a removed video is not asked again)',
      st0.helper && !!f1 && f1 === f2 && reads.length === n1 && n1 === 2 && out.length === head.length + want && out.subarray(0, head.length).equals(head) && /-f 135\[protocol=https\]\/134/.test(asked[0]) && /watch\?v=abcdefghijk$/.test(asked[0]) && bad === null && bad2 === null && asked.filter(a => /gone/.test(a)).length === 1 && st1.n === 1 && Y.cached('abcdefghijk') === f1,
      JSON.stringify({ helper: st0.helper, f1: !!f1, same: f1 === f2, reads, size: out && out.length, want: head.length + want, bad, asked: asked.length, kept: st1.n }));
    // offline is not "gone": nothing is marked, clips pause for a while instead of asking again on every rest
    Y._reset(); const asked2 = [];
    Y._setRun(async args => { asked2.push(args[args.length - 1].slice(-11)); throw new Error('ERROR: [youtube] off0000000a: Unable to download webpage: <urlopen error [Errno 11001] getaddrinfo failed>'); });
    const o1 = await Y.clip('off0000000a'), o2 = await Y.clip('off0000000b');
    const offOk = o1 === null && o2 === null && asked2.length === 1 && !fs.existsSync(path.join(dd, 'previews', 'youtube', 'off0000000a.none'));
    // the queue: the newest ask goes first, at most 3 wait (the oldest waiting one is dropped)
    Y._reset(); const order = []; let release; const gate = new Promise(r => { release = r; });
    Y._setRun(async args => { const id = args[args.length - 1].slice(-11); order.push(id); if (id === 'qqqqqqqqqq1') await gate; throw new Error('ERROR: [youtube] ' + id + ': Video unavailable'); });
    const qs = ['qqqqqqqqqq1', 'qqqqqqqqqq2', 'qqqqqqqqqq3', 'qqqqqqqqqq4', 'qqqqqqqqqq5'].map(id => Y.clip(id)); await new Promise(r => setTimeout(r, 50)); release(); await Promise.all(qs);
    check('Console trailers: offline marks nothing and pauses clips (no retry on every rest); the newest ask is made first, at most 3 wait',
      offOk && order.join() === 'qqqqqqqqqq1,qqqqqqqqqq5,qqqqqqqqqq4,qqqqqqqqqq3', JSON.stringify({ offOk, asked: asked2.length, order }));
    Y._reset(); Y._force(false); fs.rmSync(dd, { recursive: true, force: true }); }

  // ---------- the page ----------
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  ctx.setDefaultTimeout(90000);
  await ctx.addInitScript({ content: 'window.__TRAILERS = true; window.__previewUrl = "/__test/preview.webm";' });
  // a real clip from the test's own folder (the page no longer has to record one: deterministic on every machine)
  await ctx.route('**/__test/preview.webm', r => r.fulfill({ path: path.join(__dirname, 'fixtures', 'preview.webm'), contentType: 'video/webm' }));
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  const pause = ms => page.waitForTimeout(ms);
  const ready = async q => { await page.goto(base + q); await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf._lib, null, { timeout: 90000, polling: 250 }); await pause(1500); };
  const toGame = async () => { for (let i = 0; i < 6; i++) { if (await page.evaluate(() => { const g = Shelf._lib.cur(); return !!g && g.kind === 'rom'; })) return; await page.keyboard.press('ArrowRight'); await pause(500); } };
  const media = () => page.evaluate(() => { const b = document.getElementById('dMedia'), v = document.getElementById('dVideo'), bv = document.getElementById('pvBack'), app = document.getElementById('app');
    return { cls: b.className, src: !!v.getAttribute('src'), t: v.currentTime, bg: app.classList.contains('pv-det'), bgSrc: !!bv.getAttribute('src'), bgT: bv.currentTime, tab: document.querySelector('#details .d-body').dataset.show,
      yt: !!window.__ytOn, rect: window.__ytRect || null, stops: window.__ytStops || 0, mode: Shelf.getMode() }; });
  try {
    // off by default
    await ready('?platform=windows&shelf=1'); await toGame(); await page.keyboard.press('i'); await pause(3500);
    const off = await media(); await page.keyboard.press('Escape'); await pause(500);
    check('Previews: off until you choose them (Details stays as it was)', !/\bon\b/.test(off.cls) && !off.src && !off.yt, JSON.stringify(off));

    // Details: a file preview, then a YouTube one
    await ready('?platform=windows&shelf=1&previews=details'); await toGame();
    // (Details redone: a video file plays behind the case on Overview and moves into the Media tab's box; YouTube plays in
    // Media only)
    let file = null, yt = null; const seen = [];
    for (let i = 0; i < 8 && !(file && yt); i++) {
      await page.keyboard.press('i'); await pause(1500); // (the rest delay is 1 s here)
      for (let w = 0; w < 25; w++) { const m = await media(); if (m.bg) break; await pause(400); } // (the page records its pretend clip the first time: slow on a build machine)
      let m = await media(); seen.push([m.tab, m.bg, m.bgSrc, m.cls, (await page.evaluate(() => { const g = Shelf._lib.cur(); return g && g.title; }))].join('/'));
      if (!file && m.bg && m.bgSrc && m.tab === 'overview') { file = m; await page.screenshot({ path: path.join(OUT, 'previews-details.png') }); await pause(600); file.t2 = (await media()).bgT;
        await page.keyboard.press('e'); await pause(1200); const mm = await media(); file.inBox = mm.tab === 'media' && /\bready\b/.test(mm.cls) && mm.src && !mm.bg; await page.screenshot({ path: path.join(OUT, 'previews-media-tab.png') });
        await page.keyboard.press('q'); await pause(1200); file.backBehind = (await media()).bg; }
      else if (!yt && !m.bg) { await page.keyboard.press('e'); await pause(1400); m = await media();
        if (/\byt\b/.test(m.cls) && m.yt) { yt = m; const d = await page.evaluate(() => { const r = document.getElementById('details').getBoundingClientRect(); return { l: r.left, r: r.right }; }); yt.inPanel = m.rect && m.rect.x >= d.l - 1 && m.rect.x + m.rect.w <= d.r + 1 && m.rect.w > 200;
          const canScroll = await page.evaluate(() => { const d = document.getElementById('details'); d.scrollTop = 120; return d.scrollTop > 0; }); await pause(60); yt.hidWhileScrolling = !canScroll || !(await media()).yt; /* (a short Media tab can't scroll: nothing to step aside for) */ await pause(400); yt.back = (await media()).yt;
          await page.evaluate(() => { document.getElementById('details').scrollTop = 0; }); await pause(400);
          await page.keyboard.press('q'); await pause(500); yt.leftWithTab = !(await media()).yt; await page.keyboard.press('e'); await pause(900); } }
      await page.keyboard.press('Escape'); await pause(700);
      const after = await media(); if (file && !file.closed) file.closed = !after.src && !after.bgSrc && !after.bg; if (yt && !yt.closed) yt.closed = !after.yt && after.stops > 0;
      await page.keyboard.press('ArrowRight'); await pause(700);
    }
    check('Previews in Details: a video plays behind the case once it has a picture, moves into the Media tab\'s box and back, and stops the moment Details closes',
      !!file && file.t2 !== file.bgT && file.inBox && file.backBehind && file.closed, JSON.stringify(file ? { t: file.bgT, t2: file.t2, inBox: file.inBox, back: file.backBehind, closed: file.closed } : seen));
    check('Previews in Details: a YouTube trailer plays in the Media tab\'s box, steps aside while the panel scrolls or the tab changes, and is gone after Details',
      !!yt && yt.inPanel && yt.hidWhileScrolling && yt.back && yt.leftWithTab && yt.closed, JSON.stringify(yt && { inPanel: yt.inPanel, hid: yt.hidWhileScrolling, back: yt.back, tab: yt.leftWithTab, closed: yt.closed }));
    // Details' layout: Play and three small buttons, the rest in More (opened and closed with the keyboard and B / Esc)
    await page.keyboard.press('i'); await pause(1200);
    const lay = await page.evaluate(() => { const bar = [...document.querySelectorAll('#details .d-actions > button')].filter(b => !b.hidden).map(b => b.id), menu = [...document.querySelectorAll('#dMenu button')].filter(b => !b.hidden).map(b => b.id);
      return { bar, menu, tabs: [...document.querySelectorAll('#dTabs button')].filter(b => !b.hidden).map(b => b.dataset.tab), stats: document.querySelectorAll('#dStats .d-stat').length }; });
    await page.click('#dMoreBtn'); await pause(400); const open = await page.evaluate(() => !document.getElementById('dMenu').hidden && document.querySelector('#dMenu .pad-focus') !== null);
    await page.keyboard.press('Escape'); await pause(400); const shut = await page.evaluate(() => document.getElementById('dMenu').hidden && Shelf.getMode() === 'details');
    await page.keyboard.press('Escape'); await pause(500);
    check('Details: Play with Manual, Inspect and More beside it; the rest in More (Esc closes More first, then Details); tabs and a stats strip',
      JSON.stringify(lay.bar) === JSON.stringify(['dPlay', 'dManual', 'dInspect', 'dMoreBtn']) && lay.menu.includes('dBoxArt') && lay.menu.includes('dRename') && lay.menu.includes('dCols') && lay.tabs.join() === 'overview,media,copy' && lay.stats === 3 && open && shut, JSON.stringify({ ...lay, open, shut }));

    // nothing starts while the shelf is busy
    await page.evaluate(() => { window.__busy = window.BS_BUSY; window.BS_BUSY = () => true; });
    await page.keyboard.press('i'); await pause(3500); const busy = await media(); // (the clip is recorded by now: the wait below is the rest delay only)
    await page.evaluate(() => { window.BS_BUSY = window.__busy; }); await pause(4000); const free = await media();
    await page.keyboard.press('Escape'); await pause(500);
    check('Previews: nothing starts while the shelf is busy; it starts once it\'s still', !/\bon\b/.test(busy.cls) && !busy.bg && (/\bon\b/.test(free.cls) || free.bg), JSON.stringify({ busy: [busy.cls, busy.bg], free: [free.cls, free.bg] }));

    // Details and shelf: behind the cases, gone when you move
    await ready('?platform=windows&shelf=1&previews=shelf'); await toGame();
    let back = false; for (let i = 0; i < 6 && !back; i++) { await pause(4200); back = await page.evaluate(() => document.getElementById('app').classList.contains('pv-on')); if (!back) { await page.keyboard.press('ArrowRight'); } }
    if (back) await page.screenshot({ path: path.join(OUT, 'previews-shelf.png') });
    await page.keyboard.press('ArrowRight'); await pause(150);
    const moved = await page.evaluate(() => document.getElementById('app').classList.contains('pv-on'));
    check('Previews behind the shelf: soft video behind the cases after a rest, gone as soon as you move', back && !moved, JSON.stringify({ back, moved }));

    // (beta.8) console trailers: a console game with only a YouTube trailer plays its clip behind the shelf once it's made,
    // and straight away the next time; in Details it plays behind the case
    await ready('?platform=windows&shelf=1&previews=shelf&clips=1&helper=1'); await toGame();
    const cg = await page.evaluate(() => Shelf._lib.cur().title);
    let cb = false; for (let w = 0; w < 30 && !cb; w++) { await pause(400); cb = await page.evaluate(() => document.getElementById('app').classList.contains('pv-on')); }
    const made = await page.evaluate(() => window.__clipsMade || 0);
    await page.keyboard.press('ArrowRight'); await pause(900); await page.keyboard.press('ArrowLeft'); await pause(900);
    let again = false, t0 = Date.now(); for (let w = 0; w < 20 && !again; w++) { await pause(300); again = await page.evaluate(() => document.getElementById('app').classList.contains('pv-on')); }
    const againMs = Date.now() - t0, made2 = await page.evaluate(() => window.__clipsMade || 0);
    await page.keyboard.press('i'); let dc = false; for (let w = 0; w < 25 && !dc; w++) { await pause(400); dc = await page.evaluate(() => document.getElementById('app').classList.contains('pv-det')); }
    await page.screenshot({ path: path.join(OUT, 'previews-console-clip.png') }); await page.keyboard.press('Escape'); await pause(600);
    check('Console trailers: a console game\'s clip plays behind the shelf once it\'s made, is reused the next time (not made again), and plays behind the case in Details',
      cb && made === 1 && again && made2 === 1 && dc, JSON.stringify({ game: cg, shelf: cb, made, again, againMs, made2, details: dc }));

    // (beta.8) no helper yet: a card on the shelf says so once, and its button gets it
    await ready('?platform=windows&shelf=1&previews=shelf&clips=1');
    let card = ''; for (let w = 0; w < 50 && !card; w++) { await pause(400); card = await page.evaluate(() => { const c = document.querySelector('.note-card.on'); return c ? c.innerText : ''; }); }
    if (card) { await page.screenshot({ path: path.join(OUT, 'previews-helper-card.png') }); await page.keyboard.press('Enter'); }
    let hs = null; for (let w = 0; w < 20 && !(hs && hs.helper); w++) { await pause(300); hs = await page.evaluate(() => window.boxshelf.clipStatus()); }
    check('Console trailers: with no helper yet, a card on the shelf says so once and its button gets it',
      /Console games can play their trailers too/.test(card) && /Get the helper/.test(card) && !!hs && hs.helper, JSON.stringify({ card: card.split('\n').slice(0, 3), helper: hs && hs.helper }));

    // Settings → Video previews: a section of its own in the side list (no longer inside Box art & manuals)
    await ready('?platform=windows&shelf=1&previews=shelf&clips=1');
    await page.evaluate(() => Setup.open({ page: 'art' })); await pause(1500);
    const artRows = await page.evaluate(() => ((document.querySelector('.bss-scroll') || {}).innerText || '').split('\n').filter(l => /^Video previews$/.test(l.trim())).length);
    const side = await page.evaluate(() => [...document.querySelectorAll('.bss-side .bss-nav')].map(e => e.textContent.trim()));
    await page.locator('.bss-side .bss-nav', { hasText: 'Video previews' }).first().click(); // (as a person would: the side list)
    const list =() => page.evaluate(() => ((document.querySelector('.bss-scroll') || {}).innerText || ''));
    let st = ''; for (let w = 0; w < 20 && !/Console trailers/.test(st); w++) { await pause(300); st = await list(); }
    const getBtn = page.getByText(/^Get the trailer helper/).first(); let got = '';
    if (await getBtn.count()) { await getBtn.click(); for (let w = 0; w < 20 && !/Console trailer clips/.test(got); w++) { await pause(300); got = await list(); } }
    check('Settings: Video previews is its own section under Library (after Box art & manuals): where they play, Console trailers with its helper, sound, start after, YouTube, the videos found',
      artRows === 0 && side.includes('Video previews') && side.indexOf('Video previews') > side.indexOf('Box art & manuals') && side.indexOf('Video previews') < side.indexOf('Magazines & guides') &&
      /Play previews/.test(st) && /Console trailers/.test(st) && /Get the trailer helper/.test(st) && /Play previews with sound/.test(st) && /Start a preview after/.test(st) && /YouTube.s player in the Media tab/.test(st) && /23 games|Found/i.test(st) && /Console trailer clips/.test(got),
      JSON.stringify({ artRows, side: side.filter(s => /Box art|Video|Magazines/.test(s)), rows: st.split('\n').filter(l => /video|preview|trailer|helper/i.test(l)).slice(0, 9), helperAfter: /Console trailer clips/.test(got) }));

    // first run: box art yes → previews offered, on, with what was found
    await page.goto(base + '?platform=windows&retro=1'); await page.waitForSelector('#setup.on', { timeout: 90000 }); await pause(800);
    await page.getByRole('button', { name: 'Find my emulators and games' }).click(); await pause(1800);
    await page.getByRole('button', { name: 'Next' }).click(); await pause(800);
    await page.getByRole('button', { name: 'Next' }).click(); await pause(800);
    await page.getByRole('button', { name: 'Yes, download box art' }).click(); await pause(2000);
    const fr = await page.evaluate(() => ({ on: !!(document.getElementById('wz2-pv') || {}).checked, clips: !!(document.getElementById('wz2-pvclip') || {}).checked, found: ((document.querySelector('.wz2-pvfound') || {}).textContent || '') }));
    await page.screenshot({ path: path.join(OUT, 'previews-first-run.png') });
    check('First run: saying yes to box art offers video previews, on (shelf and Details), console trailers ticked, with the videos already found', fr.on && fr.clips && /Found videos for 23/.test(fr.found), JSON.stringify(fr));
    check('Previews pass: no page errors', !errors.length, errors.slice(0, 3).join(' | '));
  } catch (e) { check('Previews pass ran to the end', false, e.message.split('\n')[0]); try { await page.screenshot({ path: path.join(OUT, 'previews-fail.png') }); } catch {} }
  await ctx.close();
};
