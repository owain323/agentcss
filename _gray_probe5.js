#!/usr/bin/env node
/* 一次性诊断 5：buffer 形态与流解析成功率（用后即删） */
'use strict';
const { render } = require('./05-audit/print-gate.js');
const zlib = require('zlib');

(async () => {
  const { pdf } = await render('http://127.0.0.1:8000/09-assets/icons/demo.html', 'light');
  console.log('pdf 类型:', pdf.constructor.name, '| length:', pdf.length);
  const s = pdf.toString('latin1');
  console.log('头 20 字节:', JSON.stringify(s.slice(0, 20)));
  const re = /stream\r?\n/g;
  let count = 0, ok = 0, fail = 0, m;
  const failures = [];
  while ((m = re.exec(s))) {
    count++;
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) { fail++; continue; }
    try {
      zlib.inflateSync(Buffer.from(s.slice(start, end), 'binary'));
      ok++;
    } catch (e) {
      fail++;
      if (failures.length < 3) failures.push(s.slice(start, start + 40).replace(/[^\x20-\x7e]/g, '.'));
    }
  }
  console.log('流:', count, 'inflate 成功:', ok, '失败:', fail);
  console.log('失败样例:', JSON.stringify(failures));
})().catch((e) => console.log('ERR', String(e).slice(0, 200)));
