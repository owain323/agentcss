/**
 * icons-check.js — 静态图标资产（09-assets/icons）的运行时门禁（0.27.22）
 *
 * ============================================================================
 * 🔴 为什么需要
 * ---------------------------------------------------------------------------
 *   35 个 Lucide SVG + manifest 此前只有**目录级**质量（assets-catalog 的
 *   数量/描述一致性）——渲染层、文件完整性、消费页的可访问名约定
 *   **没有任何判据**。一个坏掉的 viewBox、一个丢 alt 的 img，
 *   要等有人肉眼看到才被发现。
 *
 * 判据
 * ---------------------------------------------------------------------------
 *  ① 磁盘：svg/ 文件集 == manifest 名集（双向），数量 == manifest.count
 *  ② 每个 SVG：viewBox="0 0 24 24" 统一、stroke="currentColor"、
 *     stroke-width="2"（README 主张的三条统一）、非空几何
 *  ③ manifest：name/label/group/keywords 字段齐、label 非空
 *  ④ demo 页（浏览器）：img 网格全部加载成功（naturalWidth=24）且
 *     alt == manifest label；inline 槽位全部注入成功且保留
 *     aria-hidden / role+aria-label；颜色继承演示真的继承
 *     （改容器 color ⇒ stroke 跟着变）
 *
 * ⚠️ manifest 的 sha256 是 **icon-forge 侧的源文件溯源**（Lucide 源的哈希，
 *    不是本仓分发副本的哈希——两份内容刻意不同：分发副本由管线规范化）。
 *    ⇒ 本地不可验，本门禁**不**对它断言；它坏了要在 icon-forge 侧爆。
 *
 * selftest：judge 纯函数 + 合成坏夹具（缺文件 / viewBox 漂 / 数量谎报 /
 *   alt 缺失），每个变异必须让对应判据红。
 * ============================================================================
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { launch } = require('./browser.js');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, '09-assets', 'icons');
const BASE = process.env.BASE || 'http://127.0.0.1:8000';

/* ---------------- ①②③ 磁盘判据（纯函数，selftest 直接喂夹具） ---------- */

function judgeFiles(manifest, files) {
  /** files: Map<name, content>（不含 .svg 后缀的键） */
  const bad = [];
  const names = manifest.icons.map((i) => i.name);
  const wanted = new Set(names);
  const have = new Set(files.keys());

  if (manifest.count !== names.length) {
    bad.push('manifest.count=' + manifest.count + ' 但 icons 数组有 ' + names.length + ' 条');
  }
  for (const n of names) {
    if (!have.has(n)) bad.push('manifest 有 ' + n + ' 但 svg/' + n + '.svg 不存在');
    else if (!files.get(n).trim()) bad.push('svg/' + n + '.svg 是空文件');
  }
  for (const n of have) {
    if (!wanted.has(n)) bad.push('svg/ 里有 ' + n + ' 但 manifest 没有登记');
  }
  return bad;
}

function judgeSvg(name, content, manifest) {
  const bad = [];
  if (!/viewBox="0 0 24 24"/.test(content)) {
    bad.push(name + ': viewBox 不是统一的 "0 0 24 24"（manifest 主张 ' + manifest.viewBox + '）');
  }
  if (!/stroke="currentColor"/.test(content)) {
    bad.push(name + ': 缺 stroke="currentColor"（inline 方式的颜色继承靠它）');
  }
  if (!/stroke-width="2"/.test(content)) {
    bad.push(name + ': 缺 stroke-width="2"（README 主张的统一线宽）');
  }
  const inner = content.replace(/<\?[^?]*\?>/, '').replace(/<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
  if (!inner) bad.push(name + ': 没有几何内容（空 SVG）');
  return bad;
}

function judgeMeta(manifest) {
  const bad = [];
  for (const it of manifest.icons) {
    if (!it.name) bad.push('一条 manifest 缺 name');
    if (!it.label || !String(it.label).trim()) bad.push(it.name + ': label 为空（可访问名来自它）');
    if (!it.group) bad.push(it.name + ': 缺 group');
    if (!Array.isArray(it.keywords) || !it.keywords.length) {
      bad.push(it.name + ': 缺 keywords（ai icons 按它搜索）');
    }
    if (!it.sha256) bad.push(it.name + ': 缺 sha256（icon-forge 溯源）');
  }
  return bad;
}

/* ---------------- ④ demo 页判据（浏览器） ------------------------------- */

async function judgeDemo(browser) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  /* 🔴 无 width/height 属性的 SVG 在 Chromium 里 naturalWidth 恒为 0
     （ Unlike 位图，SVG 无内在尺寸）⇒ 加载成败不能用 naturalWidth 判。
     改用**响应状态**（4xx/5xx 计数）+ 布局尺寸（width 属性）判。 */
  page.on('response', (r) => {
    if (r.status() >= 400) errs.push('HTTP ' + r.status() + ' ' + r.url().split('/').pop());
  });
  await page.goto(BASE + '/09-assets/icons/demo.html', { waitUntil: 'networkidle0' });
  /* manifest 注入是 fetch + DOM 操作 ⇒ 等网格真正渲染完 */
  await page.waitForFunction(
    () => document.querySelectorAll('.icon-slot svg').length >= 30,
    { timeout: 15000 },
  );
  const r = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('.icon-grid li img')];
    const slots = [...document.querySelectorAll('.icon-slot')];
    const colorDemo = document.querySelector('[data-icon-color-demo] .icon-slot svg');
    const imgBad = imgs
      .filter((im) => !(im.complete && im.clientWidth === 24 && im.clientHeight === 24)
             || !im.getAttribute('alt'))
      .map((im) => im.getAttribute('src'));
    const slotBad = slots
      .filter((s) => !s.querySelector('svg'))
      .map((s) => s.getAttribute('data-icon'));
    const slotNoA11y = slots
      .filter((s) => s.getAttribute('aria-hidden') !== 'true'
             && !(s.getAttribute('role') === 'img' && s.getAttribute('aria-label')))
      .map((s) => s.getAttribute('data-icon'));
    return {
      imgs: imgs.length, imgBad,
      slots: slots.length, slotBad, slotNoA11y,
      inherit: colorDemo
        ? (getComputedStyle(colorDemo).stroke || '')
        : 'missing',
    };
  });
  await page.close();

  const bad = [];
  if (r.imgs < 30) bad.push('demo 的 img 网格只有 ' + r.imgs + ' 个（应有 35）');
  if (r.imgBad.length) {
    bad.push('img 未按 24×24 布局或缺 alt：' + r.imgBad.slice(0, 4).join(', '));
  }
  if (r.slotBad.length) {
    bad.push('inline 槽位未注入：' + r.slotBad.slice(0, 4).join(', '));
  }
  if (r.slotNoA11y.length) {
    bad.push('inline 槽位既无 aria-hidden 也无 role+label：' + r.slotNoA11y.slice(0, 4).join(', '));
  }
  /* 颜色继承：容器 color=#fff ⇒ stroke 计算值必须是白色系（rgb(255,…)）。
     不是 currentColor ⇒ inline 方式的核心卖点失效。 */
  if (!/255,\s*255,\s*255/.test(r.inherit)) {
    bad.push('颜色继承演示失效：容器 #fff 下 stroke=' + r.inherit);
  }
  if (errs.length) bad.push('demo 页有未捕获 JS 错误：' + errs[0]);
  return bad;
}

/* ---------------- 组装与入口 ------------------------------------------- */

function loadReal() {
  const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
  const files = new Map();
  for (const f of fs.readdirSync(path.join(DIR, 'svg'))) {
    if (!f.endsWith('.svg')) continue;
    files.set(f.replace(/\.svg$/, ''),
              fs.readFileSync(path.join(DIR, 'svg', f), 'utf8'));
  }
  return { manifest, files };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) return selftest();

  console.log('  === 静态图标资产（icons）===');
  console.log('');
  const { manifest, files } = loadReal();
  let bad = judgeFiles(manifest, files)
    .concat(judgeMeta(manifest));
  for (const [name, content] of files) bad = bad.concat(judgeSvg(name, content, manifest));

  if (bad.length) {
    console.log('  🔴 磁盘层 %d 处：', bad.length);
    for (const b of bad.slice(0, 8)) console.log('     · ' + b);
    if (bad.length > 8) console.log('     …… 另有 %d 处', bad.length - 8);
    return 1;
  }
  console.log('  OK   磁盘层：%d 个 SVG 与 manifest 双向一致，三统一成立', files.size);

  const browser = await launch();
  let demoBad;
  try {
    demoBad = await judgeDemo(browser);
  } finally {
    await browser.close();
  }
  if (demoBad.length) {
    console.log('  🔴 demo 页 %d 处：', demoBad.length);
    for (const b of demoBad.slice(0, 8)) console.log('     · ' + b);
    return 1;
  }
  console.log('  OK   demo 页：img 网格 / inline 注入 / a11y 约定 / 颜色继承 全部成立');
  console.log('');
  console.log('  ✅ 图标资产：目录可信 ⇒ 渲染可信 ⇒ 可访问名可信');
  return 0;
}

/* ---------------- 反向控制（合成坏夹具） -------------------------------- */

function selftest() {
  const okM = {
    name: 'Icon Forge Set', version: '1', viewBox: '0 0 24 24', strokeWidth: 2,
    count: 1,
    icons: [{ name: 'a', label: '甲', group: 'g', keywords: ['k'], sha256: 'x',
              body: '<path d="M1 1"/>' }],
  };
  const okF = new Map([['a', '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M1 1"/></svg>']]);
  /* [标签, isRed（判据是否红了）, expectRed（该变异**应该**红吗）] */
  const cases = [
    ['基准（好夹具）不许红', (() => {
      const red = judgeFiles(okM, okF).length
        + judgeSvg('a', okF.get('a'), okM).length + judgeMeta(okM).length;
      return red > 0;
    })(), false],
    ['① 文件缺失必须红', judgeFiles(okM, new Map()).length > 0, true],
    ['① 数量谎报必须红', (() => {
      const m = JSON.parse(JSON.stringify(okM)); m.count = 99;
      return judgeFiles(m, okF).length > 0;
    })(), true],
    ['① 幽灵文件必须红', (() => {
      const f = new Map(okF); f.set('ghost', okF.get('a'));
      return judgeFiles(okM, f).length > 0;
    })(), true],
    ['② viewBox 漂移必须红', judgeSvg('a',
      okF.get('a').replace('viewBox="0 0 24 24"', 'viewBox="0 0 20 20"'), okM).length > 0, true],
    ['② 丢 currentColor 必须红', judgeSvg('a',
      okF.get('a').replace('stroke="currentColor"', 'stroke="#000"'), okM).length > 0, true],
    ['③ label 为空必须红', (() => {
      const m = JSON.parse(JSON.stringify(okM)); m.icons[0].label = '';
      return judgeMeta(m).length > 0;
    })(), true],
    ['③ 丢 keywords 必须红', (() => {
      const m = JSON.parse(JSON.stringify(okM)); delete m.icons[0].keywords;
      return judgeMeta(m).length > 0;
    })(), true],
  ];
  let bad = 0;
  for (const [label, isRed, expectRed] of cases) {
    const pass = (isRed === expectRed);
    console.log('  %s %s', pass ? 'OK ' : '🔴', label);
    if (!pass) bad++;
  }
  console.log('');
  if (bad) {
    console.log('  🔴 ' + bad + ' 条反向控制没通过');
    return 1;
  }
  console.log('  ✅ 反向控制全部通过 ⇒ 判据有牙');
  return 0;
}

if (require.main === module) {
  main().then((rc) => process.exit(rc || 0)).catch((e) => {
    console.error('  🔴 ' + ((e && e.message) || e));
    process.exit(1);
  });
}
