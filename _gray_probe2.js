#!/usr/bin/env node
/* 一次性诊断 2：扫描 RG（描边）与 sc/scn 形态的 0.67 灰 + 邻近文本（用后即删） */
'use strict';
const { render } = require('./05-audit/print-gate.js');
const zlib = require('zlib');

(async () => {
  const { pdf } = await render('http://127.0.0.1:8000/09-assets/icons/demo.html', 'light');
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  const grayStroke = /0\.6[0-9]+ 0\.6[0-9]+ 0\.6[0-9]+ RG/g;
  const grayFill = /0\.6[0-9]+ 0\.6[0-9]+ 0\.6[0-9]+ (?:sc|scn|SCN)\b/g;
  const grayG = /(^|[^0-9.])0\.6[0-9]+ g\b/g;
  let m, stats = { strokeGray: 0, fillGraySC: 0, grayG: 0, textNear: [] };
  const ctxOf = (t, pos) => t.slice(Math.max(0, pos - 200), pos + 300)
    .replace(/[^\x20-\x7e]/g, '.');
  while ((m = re.exec(pdf))) {
    let s;
    try { s = zlib.inflateSync(Buffer.from(m[1], 'binary')).toString('latin1'); } catch (e) { continue; }
    let g;
    while ((g = grayStroke.exec(s))) { stats.strokeGray++; if (stats.textNear.length < 4) stats.textNear.push(ctxOf(s, g.index)); }
    while ((g = grayFill.exec(s))) { stats.fillGraySC++; if (stats.textNear.length < 8) stats.textNear.push(ctxOf(s, g.index)); }
    while ((g = grayG.exec(s))) { stats.grayG++; if (stats.textNear.length < 8) stats.textNear.push(ctxOf(s, g.index)); }
  }
  console.log('描边 0.67 灰:', stats.strokeGray, '| scn 0.67 灰:', stats.fillGraySC, '| DeviceGray 0.67:', stats.grayG);
  console.log('上下文样例:', JSON.stringify(stats.textNear, null, 1).slice(0, 1200));
})().catch((e) => console.log('ERR', String(e).slice(0, 200)));
