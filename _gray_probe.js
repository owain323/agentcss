#!/usr/bin/env node
/* 一次性诊断：解析 icons demo 打印 PDF 里 0.67 灰 fill 后的文本（用后即删） */
'use strict';
const { render } = require('./05-audit/print-gate.js');
const zlib = require('zlib');

(async () => {
  const { pdf } = await render('http://127.0.0.1:8000/09-assets/icons/demo.html', 'light');
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  const grayRe = /0\.6[0-9]+ 0\.6[0-9]+ 0\.6[0-9]+ rg/g;
  const tjRe = /\(((?:[^()\\]|\\.)*)\)\s*Tj/;
  let m, texts = [];
  while ((m = re.exec(pdf))) {
    let s;
    try { s = zlib.inflateSync(Buffer.from(m[1], 'binary')); } catch (e) { continue; }
    const t = s.toString('latin1');
    if (!grayRe.test(t)) continue;
    const segs = t.split(/0\.6[0-9]+ 0\.6[0-9]+ 0\.6[0-9]+ rg/).slice(1);
    for (const seg of segs) {
      const tj = seg.match(tjRe);
      if (tj) texts.push(tj[1].slice(0, 40));
      const arrM = seg.match(/\[((?:[^[\]\\]|\\.)*)\]\s*TJ/);
      if (arrM) texts.push('TJ:' + arrM[1].slice(0, 60));
      if (texts.length > 12) break;
    }
    if (texts.length > 12) break;
  }
  console.log('灰 fill 之后的文本（前 12）:', JSON.stringify(texts, null, 1));
})().catch((e) => console.log('ERR', String(e).slice(0, 200)));
