/**
 * icons-anim-reduced.js — 图标动效 reduced-motion 真浏览器判据
 * ============================================================================
 * 🔴 为什么必须真浏览器：CSS 文件里有 media 块 ≠ 生效。0.27.18 拒收 SMIL
 *    的整个理由就是"reduced 不可控"——这条判据证明 CSS 路线的 reduced
 *    真的生效（先证明动画在跑、再证明 reduce 下全 0，两头都测才不是恒真）。
 *
 * 判据（demo 页 8 个动画元素：draw 3 形状 + breathe 3 形状 + popin + spin）：
 *   ① 正常媒体：getAnimations() ≥ 5（动画真的在跑——否则"全 0"是恒真判据）
 *   ② prefers-reduced-motion: reduce：getAnimations() = 0 且图标完整可见
 *      （draw 形状 opacity=1 且无 dash 裁切；spin/popin 无 transform）
 *   ③ 反向控制：把 icon-anim 类摘掉 ⇒ 正常媒体下计数回到 0
 *      （证明 ① 的计数来自本组件的 CSS，不是环境噪声）
 *
 * 用法：node 05-audit/icons-anim-reduced.js   （需要 :8000 静态服务）
 */
'use strict';
const { launch } = require('./browser.js');

const BASE = 'http://127.0.0.1:8000/';
const PAGE = '09-assets/icons-anim/demo.html';

let bad = 0, total = 0;
function chk(label, ok, extra) {
  total++;
  if (!ok) bad++;
  console.log('    ' + (ok ? 'OK  ' : 'FAIL') + ' ' + label +
    (extra === undefined ? '' : '  → ' + JSON.stringify(extra)));
}

(async () => {
  console.log('  === icons-anim · reduced-motion（真浏览器）===');
  const b = await launch();
  const p = await b.newPage();
  await p.setViewport({ width: 393, height: 852, deviceScaleFactor: 1 });

  /* ① 正常媒体：动画在跑 */
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await p.goto(BASE + PAGE, { waitUntil: 'networkidle0', timeout: 20000 });
  await new Promise((r) => setTimeout(r, 300));
  const normal = await p.evaluate(() => ({
    count: document.getAnimations().length,
    breatheRunning: (() => {
      const el = document.querySelector('.icon-anim--breathe');
      return el.getAnimations({ subtree: true }).some(
        (a) => a.playState === 'running' || a.playState === 'finished');
    })(),
  }));
  chk('① 正常媒体：动画在跑（getAnimations ≥ 5）', normal.count >= 5, normal.count);
  chk('① breathe 循环真实运行', normal.breatheRunning === true);

  /* ② reduced：全灭且可见 */
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await new Promise((r) => setTimeout(r, 200));
  const reduced = await p.evaluate(() => {
    const draw = document.querySelector('.icon-anim--draw');
    const spin = document.querySelector('.icon-anim--spin');
    const drawShape = draw.querySelector('path');
    return {
      count: document.getAnimations().length,
      drawOpacity: getComputedStyle(drawShape).opacity,
      drawOffset: getComputedStyle(drawShape).strokeDashoffset,
      spinTransform: getComputedStyle(spin).transform,
      spinVisible: getComputedStyle(spin).opacity === '1',
    };
  });
  chk('② reduce：动画全部停止（getAnimations = 0）', reduced.count === 0, reduced.count);
  chk('② reduce：draw 图标完整可见（opacity=1、无 dash 裁切）',
    reduced.drawOpacity === '1' &&
      (reduced.drawOffset === '0px' || reduced.drawOffset === 'none'),
    reduced.drawOpacity + '/' + reduced.drawOffset);
  chk('② reduce：spin 无 transform 残留、可见',
    (reduced.spinTransform === 'none' || reduced.spinTransform === 'matrix(1, 0, 0, 1, 0, 0)')
      && reduced.spinVisible === true,
    reduced.spinTransform);

  /* ③ 反向控制：摘类 ⇒ 计数归零（①的计数确实来自本组件 CSS） */
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  const stripped = await p.evaluate(() => {
    document.querySelectorAll('.icon-anim').forEach((el) => {
      el.setAttribute('class', el.getAttribute('class')
        .replace(/icon-anim--\w+/g, '').trim());
    });
    return document.getAnimations().length;
  });
  chk('③ 反向控制：摘掉模式类 ⇒ 计数归 0（①不是环境噪声）', stripped === 0, stripped);

  await p.close();
  await b.close();
  console.log(bad
    ? '  [FAIL] ' + bad + ' / ' + total + ' 条不成立'
    : '  [OK  ] ' + total + ' 条全部成立（动画在跑 ⇄ reduced 全灭 ⇄ 摘类归零）');
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error('  [FAIL] 环境问题（不是检查不通过）：' + e.message);
  process.exit(2);
});
