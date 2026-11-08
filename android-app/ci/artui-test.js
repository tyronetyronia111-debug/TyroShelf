// Device test pass "box art screens" (1.80), run by web-device-test.js. Checks results, never speed. The demo page as Windows:
//   Settings → Box art & manuals opens with Art Studio first and a cover summary in its heading; a console's games grid has the
//   No cover filter, part pictures with a mark (✓ ! × •) instead of letters, a key in the console's own word for the disc (UMD
//   on PSP) and the strip under the grid naming the highlighted game; a game's page has its parts as tabs across the top,
//   left / right move along them, down goes into the versions, and trying another version shows "Trying" with the
//   picture in use now beside it.
'use strict';
const path = require('path');

module.exports = async function artUiPass({ browser, base, check, newPage, OUT }) {
  const { ctx, page, errors } = await newPage(browser, null);
  try {
    await page.goto(base + '?platform=windows&shelf=1');
    await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && window.Setup, null, { timeout: 90000, polling: 250 });
    await page.waitForTimeout(1500);

    // the Box art page
    const pg = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms));
      Setup.open({ page: 'art' }); for (let i = 0; i < 40 && !document.querySelector('#bss.on .bss-row'); i++) await w(150);
      let head = ''; for (let i = 0; i < 30; i++) { await w(200); const h = document.querySelector('#bss .bss-head em'); head = h ? h.textContent : ''; if (/cover/.test(head)) break; }
      const rows = [...document.querySelectorAll('#bss .bss-row .nm')].map(e => e.textContent);
      return { title: document.querySelector('#bss .bss-title').textContent, head, first: rows[0], rows }; });
    check('Box art (Windows): the page is "Box art & manuals", Art Studio is its first row, and its heading sums up the covers',
      pg.title === 'Box art & manuals' && pg.first === 'Art Studio' && /games have a cover/.test(pg.head) && pg.rows.includes('Download missing art now'), JSON.stringify(pg).slice(0, 300));

    // PSP's games grid
    const gr = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms));
      if (window.Settings && Settings.isOpen && Settings.isOpen()) { await Settings.close(); await w(900); } // (Setup.open does nothing while Settings is open)
      Setup.open({ page: 'artstudio', systemId: 'psp' }); for (let i = 0; i < 40 && !document.querySelector('.bsa-tile'); i++) await w(200); await w(600);
      const pills = [...document.querySelectorAll('.bsa-pill')].map(p => p.textContent.replace(/\s+/g, ' ').trim());
      const t = document.querySelector('.bsa-tile'), sl = t ? [...t.querySelectorAll('.sl')] : [];
      return { pills, key: document.querySelector('.bsa-legend .pk') ? document.querySelector('.bsa-legend .pk').textContent : '', icons: sl.filter(s => s.querySelector('svg')).length,
        marks: sl.map(s => (s.querySelector('b') || {}).textContent).join(''), strip: (document.querySelector('.bsa-gi') || {}).textContent || '' }; });
    check('Box art (Windows): the games grid has a No cover filter, part pictures with marks (not letters), the UMD named on PSP, and the highlighted game in the strip',
      gr.pills.some(p => /^No cover/.test(p)) && /UMD/.test(gr.key) && gr.icons === 4 && /^[✓!×•]{4}$/.test(gr.marks) && /Front .* · Back .* · Spine .* · UMD /.test(gr.strip), JSON.stringify(gr).slice(0, 400));

    // a GameCube game's page
    const gp = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), out = {};
      const key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      if (window.Settings && Settings.isOpen && Settings.isOpen()) { await Settings.close(); await w(900); }
      const g = (await window.boxshelf.artGames({ systemId: 'gc' }))[0];
      Setup.open({ page: 'artgame', systemId: 'gc', file: g.file, title: g.title });
      for (let i = 0; i < 50 && document.querySelectorAll('.bsa-card').length < 3; i++) await w(200); await w(800);
      const pk = document.querySelector('.bsa-pk'), parts = document.querySelector('.bsa-parts');
      out.tabs = !!(pk && pk.classList.contains('ptabs')) && !!parts && parts.getBoundingClientRect().height < 120 && parts.getBoundingClientRect().width > 600;
      out.round = pk ? getComputedStyle(pk).borderRadius : '';
      const h3 = () => document.querySelector('.bsa-ch h3').textContent;
      out.start = h3(); key('ArrowRight'); await w(500); out.right = h3(); key('ArrowLeft'); await w(500);
      key('ArrowDown'); await w(500); out.inCards = !pk.classList.contains('inparts');
      out.badge = [...document.querySelectorAll('.bsa-card .use.on')].map(u => u.textContent).join(',');
      key('ArrowRight'); await w(700); out.k = document.querySelector('.bsa-pv .k').textContent; out.now = document.querySelector('.bsa-now').classList.contains('on');
      key('ArrowUp'); await w(400); out.backUp = pk.classList.contains('inparts');
      return out; });
    await page.screenshot({ path: path.join(OUT, 'art-game-page.png') });
    check('Box art (Windows): a game\'s page has the parts as tabs across the top; right / left change part, down goes into the versions, up comes back',
      gp.tabs && gp.round === '0px' && gp.start === 'Front cover' && gp.right === 'Back cover' && gp.inCards && gp.backUp, JSON.stringify(gp).slice(0, 400));
    check('Box art (Windows): the version in use is badged; trying another says "Trying" and shows the picture in use now beside it',
      /In use/.test(gp.badge) && /^Trying/.test(gp.k) && gp.now, JSON.stringify(gp).slice(0, 400));
    check('Box art pass (Windows page): no script errors', !errors.length, errors.slice(0, 3).join(' | '));
  } catch (e) { check('Box art pass (Windows page) ran to the end', false, e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e); }
  await ctx.close();
};
