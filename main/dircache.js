// Folder listings shared for one pass over the library: a manual or spreads pass over a few thousand games used to
// list the same big ROM / art folder once per game. Each run makes its own lister (nothing is kept between runs);
// forget(dir) after writing into a folder so the next look sees the new files.
const fs = require('fs');
const path = require('path');

function lister() {
  const m = new Map(), key = d => path.resolve(d).toLowerCase();
  return {
    // the folder's entry names as on disk; [] when it's missing or unreadable
    names(dir) { const k = key(dir); let v = m.get(k); if (!v) { try { v = fs.readdirSync(dir); } catch { v = []; } m.set(k, v); } return v; },
    forget(dir) { if (dir) m.delete(key(dir)); }
  };
}
// outside a run: a plain listing every time
const fresh = { names(dir) { try { return fs.readdirSync(dir); } catch { return []; } }, forget() {} };

module.exports = { lister, fresh };
