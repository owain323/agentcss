#!/usr/bin/env node
/* 一次性诊断 3：CMYK k 算子 + 灰填充邻域文本（用后即删） */
'use strict';
const { render } = require('./05-audit/print-gate.js');
const zlib = require('zlib');

(async () => {
  const { pdf } = await render('http://127.0.0.1:8000/09-assets/icons/demo.html', 'light');
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  const kGray = /0 0 0 (?:0\.2[0-9]|0\.3[0-9]) k\b/g;
  const scnGray = /(^|[^0-9.])0\.6[0-9]+ scn\b/g;
  let m, stats = { kGray: 0, scnGray: 0, textNear: [] };
  const ctxOf = (t, pos) => t.slice(Math.max(0, pos - 120), pos + 400)
    .replace(/[^\x20-\x7e]/g, '.');
  while ((m = re.exec(pdf))) {
    let s;
    try { s = zlib.inflateSync(Buffer.from(m[1], 'binary')).toString('latin1'); } catch (e) { continue; }
    let g;
    while ((g = kGray.exec(s))) {
      stats.kGray++;
      if (stats.textNear.length < 5) stats.textNear.push(ctxOf(s, g.index));
    }
    while ((g = scnGray.exec(s))) {
      stats.scnGray++;
      if (stats.textNear.length < 5) stats.textNear.push(ctxOf(s, g.index));
    }
  }
  console.log('CMYK 灰 k 算子:', stats.kGray, '| scn 单值 0.67:', stats.scnGray);
  console.log('邻域:', JSON.stringify(stats.textNear, null, 1).slice(0, 1600));
})().catch((e) => console.log('ERR', String(e).slice(0, 200)));
