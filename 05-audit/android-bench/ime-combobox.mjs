import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ANDROID_BENCH_ROOT = process.env.ANDROID_BENCH;
if (!ANDROID_BENCH_ROOT) {
  console.error('[android-bench] 请设 ANDROID_BENCH 环境变量指向台子根目录。');
  process.exit(2);
}
const require = createRequire(new URL('../../package.json', import.meta.url));
const { chromium } = require('playwright');
const ADB = '<台子根目录>/sdk/platform-tools/adb.exe';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sh = (c) => execSync(`"${ADB}" ${c}`, { encoding: 'utf8' });
const results = [];
const pass = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? '  PASS ' : '  FAIL ') + name + '  ← ' + detail); };

/* 主流程：包成函数供 run-all 兜底调用（export const run = main），逻辑与原顶层脚本一致 */
async function main() {
  sh('reverse tcp:8000 tcp:8000');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  await page.goto('http://localhost:8000/02-primitives/combobox/demo.html');
  await page.waitForLoadState('load');

  // 页面内自建最小实例（与 combobox-instance-check 的 HARNESS 同款）
  const h = await page.evaluate(() => {
    const d = document.createElement('div');
    d.className = 'combo';
    d.innerHTML = '<div class="combo__field"><input class="combo__input" data-combo-input></div><div data-combo-tags></div><ul data-combo-list></ul>';
    document.body.appendChild(d);
    const cb = window.Combobox.create(d, {
      options: [{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }, { value: 'c', label: '丙' }],
      max: 5,
    });
    window.__t = { root: d, cb, input: d.querySelector('[data-combo-input]') };
    window.__t.input.focus();
    return { ok: !!window.__t.cb, hasInput: !!window.__t.input };
  });
  pass('实例创建', h.ok && h.hasInput, JSON.stringify(h));

  // 合成期序列：compositionstart → keydown(229,Enter) → keydown(229,ArrowDown) → input → compositionend
  await page.evaluate(() => {
    const inp = window.__t.input;
    inp.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    inp.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, keyCode: 229, key: 'Process' }));
    inp.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'ni', inputType: 'insertCompositionText' }));
    inp.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, keyCode: 229, key: 'Enter' }));   // 合成期 Enter：契约=不加标签
    inp.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, keyCode: 229, key: 'ArrowDown' })); // 合成期 ↓：契约=不动游标
    inp.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, keyCode: 229, key: 'Enter' }));
    inp.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你好' }));
    inp.value = '你好';
    inp.dispatchEvent(new InputEvent('input', { bubbles: true, data: '你好', inputType: 'insertCompositionText' }));
  });
  await sleep(200);
  const mid = await page.evaluate(() => ({
    tags: window.__t.cb.tags,
    activedesc: window.__t.input.getAttribute('aria-activedescendant'),
    listHidden: window.__t.root.querySelector('[data-combo-list]').hidden,
  }));
  pass('合成期 Enter 不提交标签', mid.tags.length === 0, 'tags=' + JSON.stringify(mid.tags) + '（拼音半截不许变标签）');
  pass('合成期 ↓ 不挪游标', mid.activedesc === null, 'aria-activedescendant=' + mid.activedesc + '（合成期游标必须让路）');

  // compositionend 后正常提交：输入 'a' → ↓+Enter → 标签出现
  await page.evaluate(() => {
    const inp = window.__t.input;
    inp.value = 'a';
    inp.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'a', inputType: 'insertText' }));
  });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await sleep(200);
  const post = await page.evaluate(() => ({ tags: window.__t.cb.tags }));
  pass('compositionend 后正常提交', post.tags.length === 1 && post.tags[0] === 'a', 'tags=' + JSON.stringify(post.tags));

  console.log('---');
  console.log('通过 ' + results.filter(r => r.ok).length + '/' + results.length);
  writeFileSync('<台子根目录>/results/ime-combobox.json', JSON.stringify(results, null, 2));
  await page.close();
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
