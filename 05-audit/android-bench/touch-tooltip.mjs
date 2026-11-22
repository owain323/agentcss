import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ANDROID_BENCH_ROOT = process.env.ANDROID_BENCH;
if (!ANDROID_BENCH_ROOT) {
  console.error('[android-bench] 请设 ANDROID_BENCH 环境变量指向台子根目录。');
  process.exit(2);
}
/* 从**本仓库**的 package.json 解析 playwright：脚本在 05-audit/android-bench/ 下，
   仓库根是上两级 ⇒ 换机器、换目录都不用改这一行。 */
const require = createRequire(new URL('../../package.json', import.meta.url));
const { chromium } = require('playwright');
const ADB = '<台子根目录>/sdk/platform-tools/adb.exe';
const URL_TO_TEST = 'http://localhost:8000/03-patterns/tooltip/demo.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sh = (c) => execSync(`"${ADB}" ${c}`, { encoding: 'utf8' });

const results = [];
const pass = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? '  PASS ' : '  FAIL ') + name + '  ← ' + detail); };

/* 主流程：包成函数供 run-all 兜底调用（export const run = main），逻辑与原顶层脚本一致 */
async function main() {
  // 前提：adb reverse + Chrome 已打开目标页
  sh('reverse --remove tcp:8000'); sh('reverse tcp:8000 tcp:8000');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find(p => p.url().includes('tooltip/demo'));
  if (!page) { page = await ctx.newPage(); await page.goto(URL_TO_TEST); await page.waitForLoadState('load'); }
  console.log('接管页面:', page.url());

  // 打开新 tab 避免首启残留
  page = await ctx.newPage();
  await page.goto(URL_TO_TEST);
  await page.waitForLoadState('load');
  await page.waitForTimeout(400);

  // CDP session 派发真触摸
  const session = await page.context().newCDPSession(page);
  const rect = await page.evaluate(() => { const r = document.getElementById('b1').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
  const tap = async () => {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x, y: rect.y }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const state = () => page.evaluate(() => {
    const t = document.querySelector('body > .tooltip');
    return t ? (t.getAttribute('data-state') || 'closed') : 'no-element';
  });

  // ① 第一次点按（touch）⇒ 契约：必是开
  await tap(); await sleep(300);
  const s1 = await state();
  pass('触摸①：一次点按打开', s1 === 'open', 'data-state=' + s1);

  // ② 合成 mouseenter 在 700ms 抑制窗内 ⇒ 不许重复打开/翻转
  await page.evaluate(() => document.getElementById('b1').dispatchEvent(new MouseEvent('mouseenter', { bubbles: false })));
  await sleep(150);
  const s2 = await state();
  pass('触摸②：抑制窗内合成 mouseenter 不翻转', s2 === 'open', 'data-state=' + s2);

  // ③ 第二次点按 ⇒ 关
  await tap(); await sleep(300);
  const s3 = await state();
  pass('触摸③：第二次点按关闭', s3 === 'closed', 'data-state=' + s3);

  // ④ 700ms 抑制窗过期后，合成 mouseenter 恢复 hover 能力
  await sleep(800);   /* 先真正走出抑制窗（上一拍 touchstart 起算 700ms），否则被正确抑制 */
  await page.evaluate(() => document.getElementById('b1').dispatchEvent(new MouseEvent('mouseenter', { bubbles: false })));
  await sleep(300);
  const s4 = await state();
  pass('触摸④：抑制窗过期后 hover 恢复', s4 === 'open', 'data-state=' + s4);

  // ⑤ mouseleave 收起
  await page.evaluate(() => document.getElementById('b1').dispatchEvent(new MouseEvent('mouseleave', { bubbles: false })));
  await sleep(200);
  const s5 = await state();
  pass('触摸⑤：mouseleave 收起', s5 === 'closed', 'data-state=' + s5);

  console.log('---');
  console.log('通过 ' + results.filter(r => r.ok).length + '/' + results.length);
  writeFileSync('<台子根目录>/results/touch-tooltip.json', JSON.stringify(results, null, 2));
  await browser.close();
}

export const run = main;

/* 直接 node 执行时仍然自跑（import 进 run-all 时不触发） */
const isMain = (() => {
  try { return !!process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url; } catch { return false; }
})();
if (isMain) {
  main().catch((e) => { console.error((e && e.stack) || e); process.exitCode = 1; });
}
