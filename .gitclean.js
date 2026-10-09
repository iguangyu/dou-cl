const fs = require('fs');
const p = require('path');
(function walk(d) {
  let names;
  try { names = fs.readdirSync(d); } catch (e) { return; }
  for (const n of names) {
    const f = p.join(d, n);
    let s;
    try { s = fs.statSync(f); } catch (e) { continue; }
    if (s.isDirectory()) walk(f);
    else if (/\.lock$/.test(n)) { try { fs.unlinkSync(f); } catch (e) { /* ignore */ } }
  }
})('.git');
