#!/usr/bin/env node
/* 一次性诊断 6：解码十进制串行化 PDF ⇒ 扫灰载体（用后即删） */
'use strict';
const { render } = require('./05-audit/print-gate.js');
const zlib = require('zlib');

(async () => {
  const { pdf } = await render('http://127.0.0.1:8000/09-assets/icons/demo.html', 'light');
  const raw = Buffer.from(pdf.toString('latin1').split(',').map(Number));
  console.log('解码后:', raw.length, '字节, 头:', raw.slice(0, 8).toString('latin1'));
  const s = raw.toString('latin1');
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  const colors = {};
  const grayCtx = [];
  let m;
  while ((m = re.exec(s))) {
    let d;
    try { d = zlib.inflateSync(Buffer.from(m[1], 'binary')).toString('latin1'); } catch (e) { continue; }
    const ops = [
      /(?:^|[\s>])([\d.]+) ([\d.]+) ([\d.]+) rg\b/g,
      /(?:^|[\s>])([\d.]+) scn\b/g,
      /(?:^|[\s>])([\d.]+) g\b/g,
      /(?:^|[\s>])([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) k\b/g,
    ];
    for (const op of ops) {
      let c;
      while ((c = op.exec(d))) {
        const parts = c.slice(1).map(Number);
        const isGray = parts.length === 3 && parts.every((v) => v > 0.62 && v < 0.72);
        const hex = parts.length === 3
          ? '#' + parts.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
          : '#gray' + parts.map((v) => Math.round(v * 100)).join('_');
        colors[hex] = (colors[hex] || 0) + 1;
        if (isGray && grayCtx.length < 6) {
          grayCtx.push(hex + ' ⇒ ' + d.slice(c.index, c.index + 300).replace(/[^\x20-\x7e]/g, '.').slice(0, 260));
        }
      }
    }
  }
  console.log('色操作符分布:', JSON.stringify(colors, null, 1).slice(0, 900));
  console.log('灰载体上下文:', JSON.stringify(grayCtx, null, 1).slice(0, 1500));
})().catch((e) => console.log('ERR', String(e).slice(0, 200)));
