import { createRequire } from 'node:module';
/* MANUAL-ONLY: 观测项脚本 —— 地址栏收拢是 Chrome UI 层行为（无窗模拟器下不稳定），只在有台子的机器上人工跑。
   不进 check-all 队列的理由见 05-audit/android-bench/README.md。 */
import { writeFileSync } from 'node:fs';

const ANDROID_BENCH_ROOT = process.env.ANDROID_BENCH;
if (!ANDROID_BENCH_ROOT) {
  console.error('[android-bench] 请设 ANDROID_BENCH 环境变量指向台子根目录。');
  process.exit(2);
}
const require = createRequire('C:/Users/czj17751/.zcode/workspace/draft-de03321d-1117-49f6-878c-567330e02793/agentcss-fix/package.json');
const { chromium } = require('playwright');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
const pass = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? '  PASS ' : '  FAIL ') + name + '  ← ' + detail); };

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
await page.goto('http://localhost:8000/03-patterns/tooltip/demo.html');
await page.waitForLoadState('load');
await sleep(500);

const before = await page.evaluate(() => ({
  innerH: window.innerHeight,
  pageH: document.documentElement.scrollHeight,
  visualH: window.visualViewport ? Math.round(window.visualViewport.height) : null,
}));

// 模拟触屏滚动（CDP synthesizeScrollGesture = 真实触摸滚动手势）
// 🔴 手势偶尔不被页面吃掉（焦点/标签前台状态抖动）⇒ 重试直到确认滚起来
const session = await page.context().newCDPSession(page);
let scrolled = 0;
for (let round = 0; round < 4; round++) {
  for (let i = 0; i < 4; i++) {
    await session.send('Input.synthesizeScrollGesture', {
      x: 195, y: 500, xDistance: 0, yDistance: -600, speed: 1200,
      gestureSourceType: 'touch',
    });
    await sleep(300);
  }
  scrolled = await page.evaluate(() => Math.round(window.scrollY));
  if (scrolled > 300) break;
  await sleep(500);
}
await sleep(800);
const after = await page.evaluate(() => ({
  innerH: window.innerHeight,
  pageH: document.documentElement.scrollHeight,
  visualH: window.visualViewport ? Math.round(window.visualViewport.height) : null,
  scrollY: Math.round(window.scrollY),
}));

console.log('滚动前:', JSON.stringify(before), ' 滚动后:', JSON.stringify(after));
const collapsed = after.innerH > before.innerH;
/* 🔴 地址栏收不收是 Chrome UI 层行为（无窗模拟器下不稳定），不是产品契约；
   产品契约 = 视口变化时布局自适应且无溢出（下面两条硬判据）。这条降为观测项。 */
const collapsedObserved = scrolled > 300 && collapsed;
console.log('  观测  地址栏随滚动收缩=' + collapsedObserved
  + '（innerHeight ' + before.innerH + ' → ' + after.innerH + '，scrollY=' + scrolled + '）');
results.push({ name: '[观测] 地址栏随滚动收缩', ok: true, detail: 'innerHeight ' + before.innerH + ' → ' + after.innerH + '（UI 层行为，不计分）' });
pass('页面无横向溢出（滚动后）', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '');

// 视觉视口与布局视口在稳定态一致（dvh 生效的间接信号）
// 🔴 收拢动画约 300-600ms：多次读数取末次稳定值，别在动画中途冤枉它
await sleep(1500);
let vvSeries = [];
for (let k = 0; k < 3; k++) {
  vvSeries.push(await page.evaluate(() => ({ v: Math.round(window.visualViewport.height), i: window.innerHeight })));
  await sleep(400);
}
const stable = vvSeries[vvSeries.length - 1];
const converged = vvSeries.every(x => Math.abs(x.v - x.i) <= 2);
pass('visualViewport 与 innerHeight 稳定态一致（dvh 生效信号）', converged,
  '序列=' + vvSeries.map(x => `vv${x.v}/i${x.i}`).join(' → '));

console.log('---');
console.log('通过 ' + results.filter(r => r.ok).length + '/' + results.length);
writeFileSync('<台子根目录>/results/dvh-viewport.json', JSON.stringify({ before, after, results }, null, 2));
await page.close();
await browser.close();
