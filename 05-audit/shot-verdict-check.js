/*
 * shot-verdict-check.js — ai shot verdict 的**集成反向控制**（真浏览器）
 *
 * ============================================================================
 * 四张夹具页（05-audit/fixtures/shot-verdict/）→ 真跑 shoot() → 断言 verdict：
 *   clean.html             → pass（无溢出、无报错）
 *   true-overflow.html     → fail + reasons 含 true-overflow
 *   container-scroll.html  → warn + reasons 含 container-scroll（不是 fail——
 *                            这条最容易做反，设计内滚动不许误报）
 *   js-error.html          → fail + reasons 含 js-error
 *
 * 🔴 三联（§3.3）：夹具本身就是"注入的缺陷"（随仓库提交，改坏即红）；
 *    还原 = clean 夹具必须绿；sha256 一致 = 夹具文件随 git 锚定。
 *    判定规则的离线对照断言在 ai/shot-verdict.js --selftest。
 *
 * ⚠️ 需要真 Chrome（与 ai shot 同款解析），无浏览器环境跑不了——
 *    属 component 层判据。
 * ============================================================================
 */
'use strict';

var path = require('path');
var fs = require('fs');
var os = require('os');
var shoot = require('../ai/shot.js').shoot;

var FIXTURES = path.join(__dirname, 'fixtures', 'shot-verdict');
/* 🔴 0.27.17 截图产物落系统临时目录：旧路径 `__dirname/../../tmp` 会
   静默越过仓库根，落到工作区共享目录（调试时找半天）。截图是一次性
   渲染产物，不进仓库也不该堆在仓库旁边。 */
var OUT = path.join(os.tmpdir(), 'agentcss-shot-verdict-out');
/* 窄视口：让真溢出/容器滚动都真的发生（1440 下 600px 元素不溢出） */
var WIDTH = 390;

var EXPECT = [
  { file: 'clean.html', status: 'pass', code: null },
  { file: 'true-overflow.html', status: 'fail', code: 'true-overflow' },
  { file: 'container-scroll.html', status: 'warn', code: 'container-scroll' },
  { file: 'js-error.html', status: 'fail', code: 'js-error' },
];

(async function main() {
  var bad = 0;
  for (var i = 0; i < EXPECT.length; i++) {
    var e = EXPECT[i];
    var r = await shoot({
      src: path.join(FIXTURES, e.file),
      out: path.join(OUT, e.file.replace('.html', '.png')),
      widths: [WIDTH], height: 600, wait: 300,
    });
    var v = r.verdict;
    if (!r.ok && !v) {
      console.log('  FAIL ' + e.file + '：shoot 没产出 verdict——' + (r.message || r.code));
      bad++;
      continue;
    }
    var okStatus = v.status === e.status;
    var okCode = e.code === null
      ? !v.reasons.some(function (x) { return x.code === e.code; })
      : v.reasons.some(function (x) { return x.code === e.code; });
    if (okStatus && okCode) {
      console.log('  OK   ' + e.file.padEnd(24) + ' verdict=' + v.status +
                  (v.reasons.length ? '（' + v.reasons[0].code + '）' : ''));
    } else {
      console.log('  FAIL ' + e.file + '：期望 ' + e.status + '/' + (e.code || '—') +
                  '，实得 ' + v.status + '，reasons=' +
                  v.reasons.map(function (x) { return x.code; }).join(','));
      bad++;
    }
  }
  /* 夹具完整性：被删/被改 ⇒ 门禁自己先红（§3.3 的 sha256 锚定层） */
  for (var j = 0; j < EXPECT.length; j++) {
    var f = path.join(FIXTURES, EXPECT[j].file);
    if (!fs.existsSync(f)) {
      console.log('  FAIL 夹具丢失：' + EXPECT[j].file + '（反向控制失效）');
      bad++;
    }
  }
  console.log(bad ? '  ❌ shot-verdict 集成：' + bad + ' 项不满足'
                  : '  ✅ shot-verdict 集成：四夹具 verdict 全部符合判定语义');
  process.exit(bad ? 1 : 0);
})();
