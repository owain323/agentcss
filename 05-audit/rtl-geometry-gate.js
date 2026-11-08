#!/usr/bin/env node
/*
 * rtl-geometry-gate.js — 「逻辑属性定位 + 物理位移」必须成对写 RTL 覆盖
 *
 * ============================================================================
 * 🔴 为什么需要这一道（2026-11-08 外部审计实证）
 * ----------------------------------------------------------------------------
 * 全库有两处组件的几何是「逻辑方向定位 + 物理 translate」的混合：
 *
 *   switch  定位 `inset-inline-start`（逻辑，RTL 自动靠右）
 *           位移 `translateX(+行程)`（物理，不跟着翻）⇒ RTL 下滑块滑出轨道
 *   nav     定位 `inset-inline-end: 0`（逻辑，RTL 变左侧）
 *           收起 `translateX(100%)`（物理，仍向右）⇒ RTL 下抽屉移进视口
 *
 * 这两类错**不报错、不溢出、不触发任何行为契约**，LTR 页面上完全看不到；
 * 像素基线只在 RTL 那十几张里偶然覆盖到 nav，switch 完全没覆盖。
 * ⇒ 判据必须是**量出来的几何**，不是"规则存在"。
 *
 * ⚠️ 关键陷阱：transform 有 transition，设置 dir 之后**立刻**读
 *    getComputedStyle 拿到的是过渡起始值（本文件第一版就踩了这个，
 *    差点把已修好的代码判成没修）。所有测量都必须等过渡结束。
 *
 * ⚠️ 依赖本地静态服务 :8000（check-all.sh 会起）。没有就 SKIP（RC=3），不冒充通过。
 * ============================================================================
 */
'use strict';

const http = require('http');
const { newPage } = require('./browser.js');

const BASE = 'http://127.0.0.1:8000';
const SETTLE = 700;          // 比 --dur-base 宽裕，确保过渡走完
let bad = 0;
let total = 0;

function ok(name, detail) {
  total++;
  console.log('  [OK  ] ' + name + (detail ? '\n         ' + detail : ''));
}
function fail(name, detail) {
  total++;
  bad++;
  console.log('  [FAIL] ' + name + '\n         ' + detail);
}

async function reachable() {
  return new Promise((resolve) => {
    const req = http.get(BASE + '/02-primitives/switch/demo.html', (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
  });
}

async function main() {
  if (!(await reachable())) {
    console.log('  [SKIP] 本地静态服务 :8000 不可达 ⇒ 无法量几何（不冒充通过）');
    process.exit(3);
  }

  const page = await newPage({ width: 1280, height: 900, deviceScaleFactor: 1 });
  try {
    /* ---------------------------------------------------------------- switch */
    await page.goto(BASE + '/02-primitives/switch/demo.html', { waitUntil: 'load' });
    const sw = await page.evaluate(async (settle) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const one = async (dir) => {
        document.documentElement.setAttribute('dir', dir);
        const input = document.querySelector('.switch__input');
        const track = document.querySelector('.switch__track');
        const thumb = document.querySelector('.switch__thumb');
        if (!input || !track || !thumb) return { err: 'missing' };
        input.checked = false;
        await sleep(settle);
        const off = thumb.getBoundingClientRect();
        const tr = track.getBoundingClientRect();
        input.checked = true;
        await sleep(settle);
        const on = thumb.getBoundingClientRect();
        return {
          track: { left: Math.round(tr.left), right: Math.round(tr.right) },
          travel: Math.round(on.left - off.left),
          on: { left: Math.round(on.left), right: Math.round(on.right) },
        };
      };
      return { ltr: await one('ltr'), rtl: await one('rtl') };
    }, SETTLE);

    if (sw.err) {
      fail('SW1 switch demo 里找不到 input/track/thumb', JSON.stringify(sw));
    } else {
      /* ① 行程方向：LTR 向右（正）、RTL 向左（负）。RTL 若仍为正 ⇒ 没有 RTL 覆盖。 */
      (sw.rtl.travel < 0)
        ? ok('SW1 RTL 行程方向为负（有 RTL 覆盖）', 'travel RTL=' + sw.rtl.travel + ' LTR=' + sw.ltr.travel)
        : fail('SW1 RTL 行程仍为正 ⇒ 滑块会滑出轨道', 'travel RTL=' + sw.rtl.travel + '（应为负）');

      /* ② 几何：开态滑块必须完全落在轨道内（容 2px 边框） */
      const inTrack = (m) => m.on.left >= m.track.left - 2 && m.on.right <= m.track.right + 2;
      inTrack(sw.ltr)
        ? ok('SW2 LTR 开态滑块在轨道内', JSON.stringify(sw.ltr))
        : fail('SW2 LTR 开态滑块跑出轨道', JSON.stringify(sw.ltr));
      inTrack(sw.rtl)
        ? ok('SW3 RTL 开态滑块在轨道内', JSON.stringify(sw.rtl))
        : fail('SW3 RTL 开态滑块跑出轨道', JSON.stringify(sw.rtl));
    }

    /* ---------------------------------------------------------------- nav */
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.goto(BASE + '/03-patterns/nav/demo.html', { waitUntil: 'load' });
    const nav = await page.evaluate(async (settle) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const one = async (dir) => {
        document.documentElement.setAttribute('dir', dir);
        const el = document.querySelector('.nav__list');
        if (!el) return { err: 'no .nav__list' };
        el.removeAttribute('data-state');
        await sleep(settle);
        const closed = el.getBoundingClientRect();
        const closedT = getComputedStyle(el).transform;
        el.setAttribute('data-state', 'open');
        await sleep(settle);
        const open = el.getBoundingClientRect();
        return {
          vw: window.innerWidth,
          closed: { left: Math.round(closed.left), right: Math.round(closed.right) },
          open: { left: Math.round(open.left), right: Math.round(open.right) },
          closedTransform: closedT,
        };
      };
      return { ltr: await one('ltr'), rtl: await one('rtl') };
    }, SETTLE);

    if (nav.err) {
      fail('NV1 nav demo 里找不到 .nav__list', JSON.stringify(nav));
    } else {
      const outside = (m) => m.closed.right <= 0 || m.closed.left >= m.vw;
      outside(nav.ltr)
        ? ok('NV1 LTR 收起态完全在视口外', JSON.stringify(nav.ltr.closed) + ' vw=' + nav.ltr.vw)
        : fail('NV1 LTR 收起态仍在视口内 ⇒ 导航挡内容', JSON.stringify(nav.ltr));
      outside(nav.rtl)
        ? ok('NV2 RTL 收起态完全在视口外', JSON.stringify(nav.rtl.closed) + ' vw=' + nav.rtl.vw)
        : fail('NV2 RTL 收起态移进视口 ⇒ 抽屉盖住内容（缺 RTL 覆盖）', JSON.stringify(nav.rtl));
      /* 打开态必须贴住各自方向的边缘：LTR 贴右、RTL 贴左 */
      (nav.ltr.open.right === nav.ltr.vw)
        ? ok('NV3 LTR 打开态贴右边缘', 'right=' + nav.ltr.open.right)
        : fail('NV3 LTR 打开态没贴右边缘', JSON.stringify(nav.ltr.open));
      (nav.rtl.open.left === 0)
        ? ok('NV4 RTL 打开态贴左边缘', 'left=' + nav.rtl.open.left)
        : fail('NV4 RTL 打开态没贴左边缘', JSON.stringify(nav.rtl.open));
    }
  } finally {
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 })
      .catch(() => {});
    await page.__browser.close().catch(() => {});
  }

  console.log('\n  ' + (bad ? bad + ' / ' + total + ' 条未通过' : '✅ ' + total + ' 条全部通过'));
  process.exit(bad ? 1 : 0);
}

main().catch((e) => {
  console.log('  [FAIL] 门禁自身出错：' + (e && e.message));
  process.exit(1);
});
