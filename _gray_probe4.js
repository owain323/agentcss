#!/usr/bin/env node
/* 一次性诊断 4：枚举 PDF 内容流全部颜色操作符形态 + 灰色载体（用后即删） */
'use strict';
const { render } = require('./05-audit/print-gate.js');
const zlib = require('zlib');

(async () => {
  const { pdf } = await render('http://127.0.0.1:8000/09-assets/icons/demo.html', 'light');
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  const colors = {};
  const grayCtx = [];
  let m;
  while ((m = re.exec(pdf))) {
    let s;
    try { s = zlib.inflateSync(Buffer.from(m[1], 'binary')).toString('latin1'); } catch (e) { continue; }
    const ops = [
      /(?:^|[\s>])([\d.]+) ([\d.]+) ([\d.]+) rg\b/g,
      /(?:^|[\s>])([\d.]+) ([\d.]+) ([\d.]+) RG\b/g,
      /(?:^|[\s>])([\d.]+) scn\b/g,
      /(?:^|[\s>])([\d.]+) sc\b/g,
      /(?:^|[\s>])([\d.]+) g\b/g,
      /(?:^|[\s>])([\d.]+) G\b/g,
      /(?:^|[\s>])([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) k\b/g,
      /(?:^|[\s>])([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) K\b/g,
    ];
    for (const op of ops) {
      let c;
      while ((c = op.exec(s))) {
        const parts = c.slice(1).map(Number);
        const isGray = parts.length >= 1 && parts.every((v) => v > 0.6 && v < 0.7);
        const key = c[0].trim() + ' @' + (parts.length === 1 ? 'single' : parts.length + 'comp');
        colors[key] = (colors[key] || 0) + 1;
        if (isGray && grayCtx.length < 6) {
          grayCtx.push(c[0].trim() + ' ⇒ ' + s.slice(c.index, c.index + 260).replace(/[^\x20-\x7e]/g, '.').slice(0, 220));
        }
      }
    }
  }
  console.log('全部色操作符（含计数）:', JSON.stringify(colors, null, 1).slice(0, 1200));
  console.log('灰载体上下文:', JSON.stringify(grayCtx, null, 1).slice(0, 1400));
})().catch((e) => console.log('ERR', String(e).slice(0, 200)));
