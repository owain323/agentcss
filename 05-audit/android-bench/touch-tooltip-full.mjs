/* ============================================================================
 * MANUAL-ONLY: 深度版（10+ 项断言）：需真安卓 Chrome 与台子，由 run-gate.sh 手动触发，CI 无模拟器
 * touch-tooltip-full.mjs — tooltip 触屏契约（真触摸，不用 mouse 点击）· 深度版
 * ============================================================================
 * ⭐ 命名说明：本文件是 run-all 优先加载的深度版（需 export const run）；
 *    同目录的 touch-tooltip.mjs 是基础版兜底（断言为本文件的子集）。
 *
 * 被测页面：
 *   http://localhost:8000/03-patterns/tooltip/demo.html
 *   按钮 id=b1（Tooltip.attach(b1, '这是补充说明：点击后会进入批量模式')）；
 *   attach 的气泡挂在 body 上；0.27.11 起所有权为集合 {hover,focus,click}，
 *   触摸后 700ms 内的合成 mouse 事件被抑制（tooltip.js 的 recentTouch 守卫）。
 *
 * 运行前提（同 lib-env.mjs 头部）：
 *   1. 模拟器已启动、adb devices 可见（本脚本自行 ensureDevice/ensureReverse）
 *   2. 模拟器内 Chrome 可用（CDP 经 tcp:9222 → localabstract:chrome_devtools_remote）
 *   3. 宿主 8000 端口已跑 agentcss http-serve.py
 *   4. 页面标签不存在时脚本会 am start 自动打开；不修改模拟器视口（真机分辨率）
 *
 * 契约点（坐标全部来自 #b1/中性元素的 getBoundingClientRect，经 CDPSession 的
 * Input.dispatchTouchEvent 派发 touchStart/touchEnd，绝不派发 mouse 点击）：
 *   ① tooltip 挂在 body 上（不是触发元素的兄弟节点）
 *   ② 初态关闭：无 data-state、计算 opacity=0
 *   ③ 一次点按必是「开」（data-state=open、opacity≈1）——修过的回归：
 *      修前第一次点击以"关"收场
 *   ④ 再点一下才是「关」
 *   ⑤ touchstart 后 700ms 内派发合成 mouseenter（模拟 WebView 合成路径）
 *      不给开气泡（触屏抑制窗）
 *   ⑥ 等待 800ms（抑制窗过期）后再派发 mouseenter ⇒ 恢复 hover 开气泡的能力
 *   ⑦ 悬停开的，mouseleave 移开就收
 *   ⑧ 点外部（真触摸）也能关
 *   ⑨ Esc 能关（WCAG 1.4.13）
 *   ⑩ blur 能关（blur 同时收掉 focus 与 click 两份所有权）
 *   失败时输出事件序列日志（document touchstart/touchend + #b1 上的各事件）。
 * ============================================================================
 */
import {
  ensureDevice, ensureReverse, ensureCdp, connectPage,
  sleep, createCollector, isDirectRun, BASE_URL,
} from './lib-env.mjs';

const PAGE_SUBSTR = '/03-patterns/tooltip/demo.html';

/* 主流程：包成函数供 run-all 调用（export const run = main），也可单独 node 执行 */
async function main() {
  const c = createCollector('touch-tooltip');
  let browser = null;
  try {
    /* ---- 环境：设备 → reverse → forward/CDP → 找页或开页 ---- */
    const devices = ensureDevice();
    const reverse = ensureReverse();
    const cdp = await ensureCdp({ bootstrapUrl: BASE_URL + PAGE_SUBSTR });
    c.setMeta({
      devices,
      reverse,
      cdpBrowser: cdp.info && cdp.info.Browser ? cdp.info.Browser : '',
      cdpBootstrap: cdp.bootstrapped,
    });

    const opened = await connectPage(PAGE_SUBSTR, { openUrl: BASE_URL + PAGE_SUBSTR });
    browser = opened.browser;
    const page = opened.page;
    const session = await page.context().newCDPSession(page);

    /* ---- 页面侧：探针（事件序列日志）+ 气泡状态读数 ----
       气泡定位：优先实例句柄 b1.tooltipInstance.tip，退化用 aria-describedby
       第一个 id（attach 写的就是这个气泡 id）。 */
    await page.evaluate(() => {
      const b1 = document.getElementById('b1');
      window.__tt = { log: [] };
      const rec = (type) => window.__tt.log.push({ type, t: Math.round(performance.now()) });
      document.addEventListener('touchstart', () => rec('doc:touchstart'), { capture: true, passive: true });
      document.addEventListener('touchend', () => rec('doc:touchend'), { capture: true, passive: true });
      ['click', 'mouseenter', 'mouseleave', 'focus', 'blur', 'keydown'].forEach((t) => {
        b1.addEventListener(t, () => rec('b1:' + t), { capture: true });
      });
      window.__ttState = function () {
        const b = document.getElementById('b1');
        let tip = (b.tooltipInstance && b.tooltipInstance.tip) || null;
        if (!tip) {
          const first = (b.getAttribute('aria-describedby') || '').split(/\s+/)[0];
          tip = first ? document.getElementById(first) : null;
        }
        if (!tip) return { missing: true };
        const cs = getComputedStyle(tip);
        return {
          id: tip.id,
          parentTag: tip.parentNode ? tip.parentNode.tagName : null,
          inBody: tip.parentNode === document.body,
          state: tip.getAttribute('data-state'),
          opacity: cs.opacity,
          visibility: cs.visibility,
          text: tip.textContent,
        };
      };
    });

    /* ---- 坐标：CDP Input 坐标系 = viewport 的 CSS 像素 = getBoundingClientRect ---- */
    const pts = await page.evaluate(() => {
      const h2 = document.querySelectorAll('main h2')[0]; /* 中性元素：非交互的标题 */
      h2.scrollIntoView({ block: 'start' });
      const rectOf = (el) => {
        const r = el.getBoundingClientRect();
        return {
          x: r.left + r.width / 2,
          y: r.top + r.height / 2,
          top: r.top,
          bottom: r.bottom,
          w: r.width,
          h: r.height,
        };
      };
      return {
        b1: rectOf(document.getElementById('b1')),
        neutral: rectOf(h2),
        vh: window.innerHeight,
      };
    });
    const b1Visible = pts.b1.top >= 0 && pts.b1.bottom <= pts.vh && pts.b1.w > 0;
    const neutralVisible = pts.neutral.top >= 0 && pts.neutral.bottom <= pts.vh && pts.neutral.w > 0;
    c.check('前置：#b1 与中性元素（第一个 h2）都在视口内，可安全真触摸',
      b1Visible && neutralVisible,
      '#b1 中心=(' + Math.round(pts.b1.x) + ',' + Math.round(pts.b1.y) + ')，' +
        '中性 h2 中心=(' + Math.round(pts.neutral.x) + ',' + Math.round(pts.neutral.y) + ')' +
        '，视口高=' + pts.vh +
        (!b1Visible ? '；#b1 超出视口' : '') + (!neutralVisible ? '；中性 h2 超出视口' : ''));

    /* 真触摸：touchStart(x,y) → 保持 60ms → touchEnd（合成 mouse 序列由 Chrome 走） */
    const tap = async (p) => {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: p.x, y: p.y }],
      });
      await sleep(60);
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const state = () => page.evaluate(() => window.__ttState());
    const syntheticMouse = (type) => page.evaluate((t) => {
      document.getElementById('b1').dispatchEvent(
        new MouseEvent(t, { bubbles: false, cancelable: false, view: window })
      );
    }, type);
    const openOK = (st) => st && !st.missing && st.inBody === true &&
      st.state === 'open' && parseFloat(st.opacity) >= 0.99 && st.visibility === 'visible';
    const closedOK = (st) => st && !st.missing &&
      st.state == null && parseFloat(st.opacity) <= 0.01;

    /* ① ② 挂载位置与初态 */
    /* 🔴 2026-11-16 修正探针时序：attach 时气泡是**游离节点**（show 的第一拍
       才 append 进 body —— README「定位前必须先入 DOM」指的就是这个设计），
       所以"挂 body"与"opacity=0"这两个断言只能在**首次 show 之后**成立；
       游离节点上 getComputedStyle 返回空串，初态只能断言 data-state。 */
    const st0 = await state();
    c.check('① attach 创建气泡：show 前游离（设计如此），show 后挂 body',
      !!(st0 && !st0.missing),
      (st0 && st0.missing)
        ? '没有找到气泡：tooltipInstance 与 aria-describedby 都没指到元素'
        : 'tip id=' + st0.id + '，show 前父节点=' + (st0.parentTag || '游离') +
          '（游离=设计；挂 body 的验证见 ③）');

    c.check('② 初态关闭：无 data-state（show 前游离，opacity 不可测）',
      !!(st0 && st0.state == null),
      'data-state=' + (st0 && st0.state) + '（期望 null；游离节点上 opacity/visibility 是空串，不可断言）');

    /* ③ 一次点按必是开 */
    await tap(pts.b1);
    await sleep(250);
    const st1 = await state();
    c.check('③ 一次点按必是「开」（真触摸，非 mouse）',
      openOK(st1) && st1.inBody === true && st1.parentTag === 'BODY',
      'touch 点按 #b1 后 data-state=' + st1.state + '，opacity=' + st1.opacity +
        '，visibility=' + st1.visibility + '，气泡文字「' + st1.text + '」，父节点=' + st1.parentTag +
        '（期望 open / ≈1 / visible / BODY；修前第一次点击以"关"收场）');

    /* ④ 再点一下才是关 */
    await tap(pts.b1);
    await sleep(250);
    const st2 = await state();
    c.check('④ 再点一下才是「关」',
      closedOK(st2),
      '第二次点按后 data-state=' + st2.state + '，opacity=' + st2.opacity +
        '（期望 null / ≈0）');

    /* ⑤ 700ms 抑制窗：中性触摸（只为了把 document 的 touchstart 时间戳打上）
       → 立刻对 #b1 派发合成 mouseenter（WebView 合成路径的等价物）→ 不许开 */
    await tap(pts.neutral);
    await sleep(80);
    await syntheticMouse('mouseenter');
    await sleep(150);
    const st3 = await state();
    const win = await page.evaluate(() => {
      const log = window.__tt.log;
      let ts = -1;
      let me = -1;
      for (const e of log) {
        if (e.type === 'doc:touchstart') ts = e.t;
        if (e.type === 'b1:mouseenter') me = e.t;
      }
      return { delta: ts >= 0 && me >= 0 ? me - ts : null };
    });
    c.check('⑤ touchstart 后 700ms 内的合成 mouseenter 不给开（触屏抑制窗）',
      closedOK(st3) && win.delta != null && win.delta < 700,
      'touchstart → 合成 mouseenter 实测 ' + win.delta + 'ms（须 <700ms 才算落在窗内）；' +
        '此刻 data-state=' + st3.state + '，opacity=' + st3.opacity +
        (st3.state === 'open' ? '；气泡被合成 hover 打开 ⇒ 抑制失效' : '') +
        (win.delta != null && win.delta >= 700
          ? '；注意：CDP 链路慢，判据没落在窗内，请重跑再下结论'
          : ''));

    /* ⑥ 抑制窗过期（等 800ms）后 mouseenter 恢复开气泡的能力 */
    await sleep(800);
    await syntheticMouse('mouseenter');
    await sleep(250);
    const st4 = await state();
    const gap = await page.evaluate(() => {
      const log = window.__tt.log;
      let ts = -1;
      const mes = [];
      for (const e of log) {
        if (e.type === 'doc:touchstart') ts = e.t;
        if (e.type === 'b1:mouseenter') mes.push(e.t);
      }
      const last = mes.length ? mes[mes.length - 1] : -1;
      return { delta: ts >= 0 && last >= 0 ? last - ts : null };
    });
    c.check('⑥ 抑制窗过期（>700ms）后 mouseenter 恢复开气泡',
      openOK(st4) && gap.delta != null && gap.delta >= 700,
      '同一次触摸起 ' + gap.delta + 'ms 后派发 mouseenter：data-state=' + st4.state +
        '，opacity=' + st4.opacity + '（期望 open / ≈1）');

    /* ⑦ 悬停开的移开就收 */
    await syntheticMouse('mouseleave');
    await sleep(200);
    const st5 = await state();
    c.check('⑦ 悬停开的，mouseleave 移开就收（hover 所有权释放）',
      closedOK(st5),
      'mouseleave 后 data-state=' + st5.state + '，opacity=' + st5.opacity +
        '（期望 null / ≈0）');

    /* ⑧ 点外部（真触摸）也能关 */
    await tap(pts.b1);
    await sleep(250);
    const st6open = await state();
    await tap(pts.neutral);
    await sleep(250);
    const st6 = await state();
    c.check('⑧ 点外部（真触摸）也能关',
      openOK(st6open) && closedOK(st6),
      '点 #b1 开（data-state=' + st6open.state + '，opacity=' + st6open.opacity + '）' +
        ' → 点外部 h2 → data-state=' + st6.state + '，opacity=' + st6.opacity +
        '（两步都必须成立）');

    /* ⑨ Esc 能关 */
    await tap(pts.b1);
    await sleep(250);
    const st7open = await state();
    await page.evaluate(() => {
      document.getElementById('b1').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
    });
    await sleep(200);
    const st7 = await state();
    c.check('⑨ Esc 能关（WCAG 1.4.13）',
      openOK(st7open) && closedOK(st7),
      '点按开（data-state=' + st7open.state + '）→ Esc keydown → data-state=' +
        st7.state + '，opacity=' + st7.opacity + '（期望 null / ≈0）');

    /* ⑩ blur 能关（click 钉住的也一并收掉：onBlur 同时 release focus 与 click） */
    await tap(pts.b1);
    await sleep(250);
    const st8open = await state();
    await page.evaluate(() => {
      const b = document.getElementById('b1');
      if (document.activeElement !== b) b.focus(); /* 没焦点先补上，blur 事件才真的发 */
      b.blur();
    });
    await sleep(200);
    const st8 = await state();
    c.check('⑩ blur 能关（blur 同时收掉 focus 与 click 所有权）',
      openOK(st8open) && closedOK(st8),
      '点按开（data-state=' + st8open.state + '）→ blur() → data-state=' +
        st8.state + '，opacity=' + st8.opacity + '（期望 null / ≈0）');

    /* 失败时附事件序列，方便定位是哪一步走了哪个分支 */
    if (c.hasFailures) {
      try {
        const seq = await page.evaluate(() =>
          window.__tt.log.map((e) => e.t + 'ms ' + e.type).join(' | ')
        );
        c.check('诊断：document/#b1 事件序列（最后 30 条）', true,
          seq.split(' | ').slice(-30).join(' | '));
      } catch {
        /* 诊断拿不到就算了 */
      }
    }
  } catch (e) {
    c.check('环境/连接前置（设备、reverse、CDP、页面）', false, (e && e.stack) || String(e));
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* 断开连接即可 */ }
    }
  }
  return await c.finish();
}

export const run = main;

if (isDirectRun(import.meta.url)) {
  run()
    .then((r) => { process.exitCode = r.ok ? 0 : 1; })
    .catch((e) => {
      console.error('未接住的异常：', (e && e.stack) || e);
      process.exitCode = 1;
    });
}
