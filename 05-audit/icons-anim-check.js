#!/usr/bin/env node
/**
 * icons-anim-check.js — 图标动效（CSS 路线）的专属契约（静态判据）
 *
 * ============================================================================
 * 四条约定，别的门禁都不查：
 *
 *   ① 四模式类名齐全（draw / breathe / popin / spin）
 *   ② reduced-motion 全灭：media 块覆盖四模式且 animation:none，
 *      且 icons-anim 不在 motion-policy.json 的 keep 清单里
 *      （纯装饰动效，reduced 必须全灭——这是 0.27.18 拒收 SMIL 的理由本身）
 *   ③ fail-open：基础态不许有 opacity:0 门栅（透明起点只许活在 @keyframes
 *      里）——"动画是可见性的来源"是 SMIL 批次 draw 模式的真实事故
 *   ④ 文件自包含：不许引外部资源（url()/<svg>/content 注入）——
 *      几何零改动的 CSS 面：只许碰 dasharray/offset/opacity/transform
 *
 * 组件路径：09-assets/icons-anim/（覆盖率门禁按目录名认契约，这里写成字面量）
 *
 * 用法：
 *   node 05-audit/icons-anim-check.js
 *   node 05-audit/icons-anim-check.js --selftest
 * 退出码：0 = 全过；1 = 有判据不过；2 = 文件缺失
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const FILES = {
  css: path.join(REPO, '09-assets', 'icons-anim', 'icons-anim.css'),
  demo: path.join(REPO, '09-assets', 'icons-anim', 'demo.html'),
  policy: path.join(REPO, 'ai', 'motion-policy.json'),
};
const MODES = ['draw', 'breathe', 'popin', 'spin'];

function read(p) {
  try { return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'); }
  catch (e) { return null; }
}

/* 剥注释 + 剥 @keyframes 与 @media 块（用于"基础态"判据） */
function baseLayer(css) {
  const noComment = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return noComment
    .replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, '')
    .replace(/@media[^{]+\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, '');
}

const RULES = [
  ['四模式类名齐全', (f) => {
    const missing = MODES.filter((m) => f.css.indexOf('.icon-anim--' + m) === -1);
    return [missing.length === 0,
      missing.length ? '缺：' + missing.join('/') : '4/4'];
  }],

  ['reduced 全灭', (f) => {
    /* media 块必须存在，且四模式的动画在块内被 animation:none 覆盖 */
    const m = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(f.css);
    if (!m) return [false, '没有 prefers-reduced-motion 块'];
    const block = m[1];
    const off = (block.match(/animation:\s*none/g) || []).length;
    const covered = MODES.every((mode) => block.indexOf('icon-anim--' + mode) !== -1);
    /* 不许进 keep 清单：纯装饰动效，reduced 不保留 */
    let keepHit = false;
    try {
      const policy = JSON.parse(f.policy);
      const reg = JSON.stringify(policy);
      keepHit = reg.indexOf('icons-anim') !== -1;
    } catch (e) { /* policy 缺失不算红（文件可选），keep 检查跳过 */ }
    /* 计数口径：popin/spin 合并声明是合法写法，数"出现次数"会误报；
       判的是"四模式选择器都被块覆盖 + 块里真的有 animation:none"。
       破坏样本（animation:none 被换掉）⇒ off=0 必红。 */
    return [off >= 1 && covered && !keepHit,
      'animation:none ×' + off + ' / 四模式选择器全覆盖 ' + covered +
      (keepHit ? ' / 🔴 进了 motion-policy keep（纯装饰不许保留）' : ' / 未进 keep ✓')];
  }],

  ['fail-open 基础态可见', (f) => {
    /* 基础层（非 keyframes、非 media）不许出现 opacity:0 —— 透明起点
       只许活在 @keyframes 里；SMIL draw 的永久隐形就是这条要堵的。 */
    const offenders = [];
    const lines = baseLayer(f.css).split('\n');
    lines.forEach((ln, i) => {
      if (/opacity\s*:\s*0(?![.\d])/.test(ln)) offenders.push('第 ' + (i + 1) + ' 行');
    });
    return [offenders.length === 0,
      offenders.length ? '基础态出现 opacity:0：' + offenders.join('、') : '基础态全可见'];
  }],

  ['文件自包含（几何零改动的 CSS 面）', (f) => {
    /* 不引外部资源、不注入图形内容：url()/内联 svg/content 都是
       "CSS 层做超出动效的事"的形状，一律不许。 */
    const noComment = f.css.replace(/\/\*[\s\S]*?\*\//g, '');
    const hits = [];
    if (/url\(/.test(noComment)) hits.push('url()');
    if (/<svg/i.test(noComment)) hits.push('内联 <svg>');
    if (/content\s*:/.test(noComment)) hits.push('content 注入');
    return [hits.length === 0,
      hits.length ? '出现：' + hits.join('/') : '只碰动效声明'];
  }],

  ['demo 覆盖四模式', (f) => {
    if (f.demo === null) return [false, 'demo.html 缺失'];
    const missing = MODES.filter((m) => f.demo.indexOf('icon-anim--' + m) === -1);
    const named = (f.demo.match(/aria-label=/g) || []).length;
    return [missing.length === 0 && named >= 4,
      missing.length ? 'demo 缺模式：' + missing.join('/')
        : '4/4 · aria-label ×' + named];
  }],
];

function run(texts) {
  return RULES.map(function (r) {
    let res;
    try { res = r[1](texts); } catch (e) { res = [false, '判据自身抛错：' + e.message]; }
    return { name: r[0], ok: !!res[0], msg: res[1] };
  });
}

/* 每条判据都要能红 */
const MUTATIONS = {
  '四模式类名齐全': (f) => { f.css = f.css.replace(/\.icon-anim--spin/g, '.icon-anim--rotate'); },
  'reduced 全灭': (f) => { f.css = f.css.replace(/animation:\s*none;/g, 'animation-duration: 2s;'); },
  'fail-open 基础态可见': (f) => { f.css = f.css.replace('@keyframes icon-anim-draw {', '.icon-anim--draw { opacity: 0; }\n@keyframes icon-anim-draw {'); },
  '文件自包含（几何零改动的 CSS 面）': (f) => { f.css = f.css.replace('/* ---- draw', '/* ---- draw'); f.css += '\n.icon-anim--spin { background: url("x.svg"); }\n'; },
  'demo 覆盖四模式': (f) => { f.demo = f.demo.replace(/icon-anim--spin/g, 'icon-anim--rotate'); },
};

function selftest() {
  const base = { css: read(FILES.css), demo: read(FILES.demo), policy: read(FILES.policy) };
  if (!base.css || !base.demo) {
    console.log('  [FAIL] 组件文件缺失，自检无法进行');
    return 2;
  }
  const good = run(base);
  let bad = good.filter((r) => !r.ok).length;
  console.log('  基准（未破坏）：' + (bad ? 'FAIL ' + bad : 'PASS ' + RULES.length + '/' + RULES.length));

  RULES.forEach(function (r) {
    const name = r[0];   /* RULES 条目是数组 [名称, 判据函数]——r.name 是 undefined */
    const mut = { css: base.css, demo: base.demo, policy: base.policy };
    MUTATIONS[name](mut);
    const res = run(mut).filter((x) => x.name === name)[0];
    if (res.ok) {
      console.log('  [FAIL] ' + name + ' 破坏后仍然通过（判据没牙）');
      bad++;
    } else {
      console.log('  PASS  ' + name + ' 破坏后变红：' + res.msg);
    }
  });

  console.log('  自检 ' + (RULES.length + 1) + ' 条，失败 ' + bad + ' 条');
  return bad ? 1 : 0;
}

function main() {
  if (process.argv.indexOf('--selftest') !== -1) {
    process.exit(selftest());
  }
  const texts = { css: read(FILES.css), demo: read(FILES.demo), policy: read(FILES.policy) };
  if (!texts.css) {
    console.log('  [FAIL] icons-anim.css 缺失 —— 不许判通过');
    process.exit(2);
  }
  console.log('  icons-anim 组件契约（静态判据）');
  let bad = 0;
  run(texts).forEach(function (r) {
    console.log('  ' + (r.ok ? 'OK  ' : 'FAIL') + ' ' + r.name + ' —— ' + r.msg);
    if (!r.ok) bad++;
  });
  if (bad) {
    console.log('  ⇒ ' + bad + ' 条不过');
    process.exit(1);
  }
  console.log('  全部通过（' + RULES.length + ' 条）');
  process.exit(0);
}

if (require.main === module) main();
