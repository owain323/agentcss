/* ============================================================================
 * MANUAL-ONLY: 深度版（10+ 项断言，CDP 真 IME 通道）：需真安卓 Chrome 与台子，由 run-gate.sh 手动触发
 * ime-combobox.mjs — combobox 的 IME 合成守卫（三层：compositionstart 标志 /
 * e.isComposing / keyCode 229）· 深度版
 * ============================================================================
 * ⭐ 命名说明：本文件是 run-all 优先加载的深度版（需 export const run）；
 *    同目录的 ime-combobox.mjs 是基础版兜底（断言为本文件的子集）。
 *
 * 被测页面：
 *   http://localhost:8000/02-primitives/combobox/demo.html
 *   页面自带 Combobox（combobox.js 已挂 window.Combobox）。为了不依赖 demo 的
 *   具体结构、也为了不污染 demo 实例，本脚本按
 *   05-audit/combobox-instance-check.js 的 window.__mk HARNESS 写法，
 *   在页面里现造一个最小实例（__mk 源码逐字取自该门禁文件）。
 *
 * 运行前提（同 lib-env.mjs 头部）：
 *   1. 模拟器已启动、adb devices 可见（本脚本自行 ensureDevice/ensureReverse）
 *   2. 模拟器内 Chrome 可用（CDP 经 tcp:9222 → localabstract:chrome_devtools_remote）
 *   3. 宿主 8000 端口已跑 agentcss http-serve.py
 *   4. 页面标签不存在时脚本会 am start 自动打开
 *
 * 合成文本的送达通道（优先真实 IME 通道，逐层退化，实际用哪条写进结果 meta）：
 *   A. CDP Input.imeSetComposition（session.send）设合成文本 "ni"
 *      —— compositionstart / compositionupdate / input 由浏览器原生派发；
 *      结束用 Input.insertText 提交（ImeCommitText → 原生 compositionend）。
 *   B. 退化：page.evaluate 派发合成事件序列
 *      compositionstart → keydown(229,'Process') → input('ni') → compositionend。
 *
 * 契约点（combobox.js 的 onKeydown 守卫：composing || e.isComposing || keyCode===229）：
 *   ① 合成文本 "ni" 上屏、compositionstart 已送达输入框
 *   ② 合成期间 Enter（keydown keyCode=229）不加任何标签
 *   ③ 合成期间 ↑↓（keyCode=229）不动游标（aria-activedescendant 保持空）
 *   ③b 浏览器派发的 trusted keydown（CDP Input.dispatchKeyEvent, 229）也让路
 *   ④ 合成期间普通 keyCode 的 ↑↓ 也让路（compositionstart 标志层独立可辨）
 *   ⑤ 合成期间普通 keyCode 的 Enter 也让路（不提交）
 *   ⑥ e.isComposing=true 的 Enter 让路（isComposing 层独立可辨）
 *   ⑦ 合成期间建议列表照常刷新（input 事件不被拦：过滤到「NI 镍 / 9 nine」，
 *      命中片段带 <mark> 高亮，「上海/shanghai」被滤掉）
 *   ⑧ compositionend 后的收尾 Enter（标志已复位但 keyCode 仍是 229）仍不加标签
 *   ⑨ compositionend 后普通 Enter 正常提交（精确命中 value="ni" 成标签、输入清空
 *      ——这一条同时证明合成标志确实被 compositionend 复位）
 * ============================================================================
 */
import {
  ensureDevice, ensureReverse, ensureCdp, connectPage,
  sleep, createCollector, isDirectRun, BASE_URL,
} from './lib-env.mjs';

const PAGE_SUBSTR = '/02-primitives/combobox/demo.html';

/* window.__mk HARNESS —— 逐字取自 05-audit/combobox-instance-check.js
   （该文件头部注释：__mk 造"自足"实例，不依赖 demo 的具体结构；
     __clickNth 每次重查 DOM；__key / __type 是最小事件派发器） */
const HARNESS = [
  'window.__mk = function (opt, listId) {',
  '  var d = document.createElement("div");',
  '  d.className = "combo";',
  '  d.innerHTML = \'<div class="combo__field">\' +',
  '                \'<input class="combo__input" data-combo-input>\\n\' +',
  '                \'</div>\' +',
  '                \'<div data-combo-tags></div>\' +',
  '                \'<ul data-combo-list></ul>\';',
  '  if (listId) d.querySelector("[data-combo-list]").id = listId;',
  '  document.body.appendChild(d);',
  '  return { root: d, cb: window.Combobox.create(d, opt || {}) };',
  '};',
  '/* 每点一次就**重新查** DOM：点完会重绘，旧节点已经不在文档里 */',
  'window.__clickNth = function (root, n) {',
  '  var os = [].slice.call(root.querySelectorAll(\'[role="option"]\'));',
  '  if (os.length <= n) return false;',
  '  os[n].click();',
  '  return true;',
  '};',
  'window.__key = function (el, k) {',
  '  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));',
  '};',
  'window.__type = function (el, v) {',
  '  el.value = v;',
  '  el.dispatchEvent(new Event("input", { bubbles: true }));',
  '};'
].join('\n');

/* 主流程：包成函数供 run-all 调用（export const run = main），也可单独 node 执行 */
async function main() {
  const c = createCollector('ime-combobox');
  let browser = null;
  try {
    /* ---- 环境：设备 → reverse → forward/CDP → 找页或开页 ---- */
    const devices = ensureDevice();
    const reverse = ensureReverse();
    const cdp = await ensureCdp({ bootstrapUrl: BASE_URL + PAGE_SUBSTR });
    const opened = await connectPage(PAGE_SUBSTR, { openUrl: BASE_URL + PAGE_SUBSTR });
    browser = opened.browser;
    const page = opened.page;
    const session = await page.context().newCDPSession(page);
    c.setMeta({
      devices,
      reverse,
      cdpBrowser: cdp.info && cdp.info.Browser ? cdp.info.Browser : '',
    });

    /* ---- 造最小实例 + 探针（事件序列日志 / 状态读数 / 精确 keydown 派发器）---- */
    await page.evaluate(HARNESS);
    const base = await page.evaluate(() => {
      window.__h = window.__mk({
        label: 'IME 合成测试',
        options: [
          { value: 'ni', label: 'NI 镍' },
          { value: 'nine', label: '9 nine' },
          { value: 'shanghai', label: '上海' },
        ],
      });
      const inp = window.__h.root.querySelector('[data-combo-input]');
      window.__hInput = inp;
      window.__hProbe = { log: [] };
      window.__hProbe._fns = [];
      ['compositionstart', 'compositionupdate', 'compositionend', 'keydown', 'input']
        .forEach((t) => {
          const fn = (e) => {
            if (e.target !== inp) return;
            window.__hProbe.log.push({
              type: t,
              key: e.key == null ? null : e.key,
              keyCode: e.keyCode == null ? null : e.keyCode,
              isComposing: !!e.isComposing,
              trusted: !!e.isTrusted,
              data: e.data == null ? null : e.data,
              value: inp.value,
              t: Math.round(performance.now()),
            });
          };
          window.__hProbe._fns.push([t, fn]);
          document.addEventListener(t, fn, true);
        });
      window.__hState = function () {
        const root = window.__h.root;
        const list = root.querySelector('[data-combo-list]');
        const os = [].slice.call(list.querySelectorAll('[role="option"]'));
        return {
          value: window.__hInput.value,
          expanded: window.__hInput.getAttribute('aria-expanded'),
          activedesc: window.__hInput.getAttribute('aria-activedescendant'),
          listHidden: list.hidden,
          optValues: os.map((o) => o.getAttribute('data-value')),
          optTexts: os.map((o) => o.textContent),
          marks: os.filter((o) => o.querySelector('mark')).length,
          tags: window.__h.cb.tags.slice(),
        };
      };
      /* 合成路径的精确 keydown：可以指定 keyCode / isComposing（原生 CDP 只能控部分） */
      window.__hKey = function (init) {
        window.__hInput.dispatchEvent(
          new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, init))
        );
      };
      window.__hComp = function (type, data) {
        window.__hInput.dispatchEvent(
          new CompositionEvent(type, { bubbles: true, cancelable: true, data: data || null })
        );
      };
      inp.focus(); /* focus → open()：列表开、3 个选项 */
      return {
        role: inp.getAttribute('role'),
        autocomplete: inp.getAttribute('aria-autocomplete'),
        st: window.__hState(),
      };
    });

    c.check('前置：最小实例就绪（role=combobox、focus 后列表开、3 个选项、无标签）',
      base.role === 'combobox' && base.autocomplete === 'list' &&
        base.st.listHidden === false && base.st.optValues.length === 3 &&
        base.st.tags.length === 0 && base.st.activedesc == null,
      'role=' + base.role + '，aria-autocomplete=' + base.autocomplete +
        '，listHidden=' + base.st.listHidden +
        '，options=' + JSON.stringify(base.st.optValues) +
        '，tags=' + JSON.stringify(base.st.tags) +
        '，activedescendant=' + JSON.stringify(base.st.activedesc));

    /* ---- 合成开始：优先 CDP Input.imeSetComposition，不行退化为合成事件 ---- */
    let imeVia = '';
    let compStartSeen = false;
    try {
      await session.send('Input.imeSetComposition', {
        text: 'ni', selectionStart: 2, selectionEnd: 2,
      });
      await sleep(200);
      const v = await page.evaluate(() => ({
        value: window.__hInput.value,
        compStart: window.__hProbe.log.some((e) => e.type === 'compositionstart'),
      }));
      if (v.value === 'ni' && v.compStart) {
        imeVia = 'CDP Input.imeSetComposition（真实 IME 通道）';
        compStartSeen = true;
      }
    } catch {
      /* 落到合成路径 */
    }
    if (!imeVia) {
      /* 退化序列（按契约）：compositionstart → keydown(229,'Process') → input('ni') */
      await page.evaluate(() => {
        window.__hComp('compositionstart', 'ni');
        window.__hKey({ key: 'Process', keyCode: 229 });
        window.__hInput.value = 'ni';
        window.__hInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
      compStartSeen = await page.evaluate(() =>
        window.__hProbe.log.some((e) => e.type === 'compositionstart')
      );
      imeVia = '合成事件（退化路径）：compositionstart → keydown(229) → input("ni")';
    }
    c.setMeta({ imeVia });

    const dur = await page.evaluate(() => window.__hState());
    c.check('① 合成文本「ni」上屏且 compositionstart 已送达输入框',
      dur.value === 'ni' && compStartSeen,
      'IME 通道=' + imeVia + '；input.value=' + JSON.stringify(dur.value) +
        '，compositionstart 见探针=' + compStartSeen +
        '，列表开=' + !dur.listHidden + '，选项=' + JSON.stringify(dur.optValues));

    /* ---- 合成期间：三层守卫逐一验证 ---- */
    await page.evaluate(() => window.__hKey({ key: 'Enter', keyCode: 229 }));
    let s = await page.evaluate(() => window.__hState());
    c.check('② 合成期间 Enter（keydown keyCode=229）不加任何标签',
      s.tags.length === 0,
      'keydown {Enter,229} 后 tags=' + JSON.stringify(s.tags) +
        '（守卫失效时 q="ni" 会精确命中 value="ni" 被加成标签）');

    let trustedErr = null;
    try {
      await session.send('Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Process', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229,
      });
      await session.send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Process', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229,
      });
      await sleep(100);
    } catch (e) {
      trustedErr = e && e.message ? e.message : String(e);
    }
    if (!trustedErr) {
      s = await page.evaluate(() => {
        const st = window.__hState();
        st.trustedSeen = window.__hProbe.log.some(
          (e) => e.type === 'keydown' && e.keyCode === 229 && e.trusted
        );
        return st;
      });
      c.check('③ 浏览器派发的 trusted keydown（CDP dispatchKeyEvent, 229）也让路',
        s.tags.length === 0 && s.activedesc == null,
        'trusted keydown(229) 到达输入框=' + s.trustedSeen +
          '；tags=' + JSON.stringify(s.tags) +
          '，activedescendant=' + JSON.stringify(s.activedesc));
    } else {
      /* 🔴 0.27.17 不许静默蒸发：dispatchKeyEvent 抛错时这条判据**没有跑**，
         不是通过 —— 旧实现无 else 分支，套件照样显示"全过"，
         "10+ 项覆盖"在报告里虚高。判据未执行 = 如实记红。 */
      c.check('③ 浏览器派发的 trusted keydown（CDP dispatchKeyEvent, 229）也让路',
        false, 'CDP dispatchKeyEvent 不可用（' + trustedErr + '）——判据未执行，记红');
    }

    await page.evaluate(() => {
      window.__hKey({ key: 'ArrowDown', keyCode: 229 });
      window.__hKey({ key: 'ArrowUp', keyCode: 229 });
    });
    s = await page.evaluate(() => window.__hState());
    c.check('④ 合成期间 ↑↓（keyCode=229）不动游标',
      s.activedesc == null,
      '↓(229)+↑(229) 后 aria-activedescendant=' + JSON.stringify(s.activedesc) +
        '（期望 null/undefined；守卫失效时会指向第 0 项）');

    /* 标志层：composing=true 时按普通 keyCode 派发也必须让路 */
    await page.evaluate(() => {
      window.__hKey({ key: 'ArrowDown', keyCode: 40 });
      window.__hKey({ key: 'ArrowUp', keyCode: 38 });
    });
    s = await page.evaluate(() => window.__hState());
    c.check('⑤ 合成期间普通 keyCode 的 ↑↓ 也让路（compositionstart 标志层）',
      s.activedesc == null,
      'composing=true 时 keydown {ArrowDown,40}/{ArrowUp,38} → aria-activedescendant=' +
        JSON.stringify(s.activedesc) + '（期望 null；标志层失效时会指向第 0 项）');

    await page.evaluate(() => window.__hKey({ key: 'Enter', keyCode: 13 }));
    s = await page.evaluate(() => window.__hState());
    c.check('⑥ 合成期间普通 keyCode 的 Enter 也让路（不提交）',
      s.tags.length === 0,
      'composing=true 时 keydown {Enter,13} → tags=' + JSON.stringify(s.tags) +
        '（期望 []；标志层失效时会精确命中「ni」）');

    await page.evaluate(() => window.__hKey({ key: 'Enter', keyCode: 13, isComposing: true }));
    s = await page.evaluate(() => window.__hState());
    c.check('⑦ e.isComposing=true 的 Enter 让路（isComposing 层）',
      s.tags.length === 0,
      'keydown {Enter,13,isComposing:true} → tags=' + JSON.stringify(s.tags) + '（期望 []）');

    s = await page.evaluate(() => window.__hState());
    c.check('⑧ 合成期间建议列表照常刷新（input 事件不被拦）',
      s.listHidden === false && s.optValues.length === 2 &&
        s.optValues.indexOf('ni') >= 0 && s.optValues.indexOf('nine') >= 0 && s.marks >= 1,
      'listHidden=' + s.listHidden + '，选项文字=' + JSON.stringify(s.optTexts) +
        '（值 ' + JSON.stringify(s.optValues) + '），带 <mark> 命中高亮=' + s.marks +
        ' 个（"上海/shanghai" 必须被滤掉）');

    /* ---- 合成结束：CDP insertText 提交（原生 compositionend），不行退化为合成事件 ---- */
    let endVia = '';
    if (imeVia.indexOf('CDP') === 0) {
      try {
        await session.send('Input.insertText', { text: 'ni' });
        await sleep(150);
        const v = await page.evaluate(() => ({
          value: window.__hInput.value,
          ended: window.__hProbe.log.some((e) => e.type === 'compositionend'),
        }));
        if (v.value === 'ni' && v.ended) endVia = 'CDP Input.insertText（真实提交通道）';
      } catch {
        /* 落到合成 compositionend */
      }
    }
    if (!endVia) {
      await page.evaluate(() => window.__hComp('compositionend', 'ni'));
      endVia = '合成 compositionend';
    }
    c.setMeta({ imeVia, endVia });

    /* 收尾 Enter：标志可能已复位但 keyCode 仍是 229（tooltip.js 注释同款场景） */
    await page.evaluate(() => window.__hKey({ key: 'Enter', keyCode: 229 }));
    s = await page.evaluate(() => window.__hState());
    c.check('⑨ compositionend 后的收尾 Enter（keyCode=229）仍不加标签',
      s.tags.length === 0,
      '合成结束（' + endVia + '）后 keydown {Enter,229} → tags=' + JSON.stringify(s.tags) +
        '（期望 []；229 层失效时会精确命中「ni」）');

    /* 正常提交 */
    await page.evaluate(() => window.__hKey({ key: 'Enter', keyCode: 13 }));
    s = await page.evaluate(() => window.__hState());
    c.check('⑩ compositionend 后普通 Enter 正常提交（成标签、输入清空）',
      s.tags.length === 1 && s.tags[0] === 'ni' && s.value === '',
      'keydown {Enter,13} → tags=' + JSON.stringify(s.tags) +
        '，input.value=' + JSON.stringify(s.value) +
        '（期望 ["ni"] 与 ""；同时证明合成标志已被 compositionend 复位）');

    /* ---- 清理：摘实例与探针监听（失败不影响判据） ---- */
    try {
      await page.evaluate(() => {
        try { window.__h.cb.destroy(); } catch {}
        (window.__hProbe._fns || []).forEach((p) =>
          document.removeEventListener(p[0], p[1], true)
        );
        if (window.__h.root.parentNode) {
          window.__h.root.parentNode.removeChild(window.__h.root);
        }
      });
    } catch {
      /* 清理失败不判红 */
    }

    /* 失败时附事件序列 */
    if (c.hasFailures) {
      try {
        const seq = await page.evaluate(() =>
          window.__hProbe.log
            .map((e) => e.t + ' ' + e.type + ' key=' + e.key + ' kc=' + e.keyCode +
              ' ic=' + (e.isComposing ? 1 : 0) + ' trusted=' + (e.trusted ? 1 : 0) +
              ' v=' + JSON.stringify(e.value))
            .join('\n    ')
        );
        c.check('诊断：输入框上的事件序列（探针）', true, '\n    ' + seq);
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
