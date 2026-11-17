/* ============================================================================
 * a11y-select.mjs — 真 a11y 树验证（CDP Accessibility.getFullAXTree）
 * ============================================================================
 * 被测页面：
 *   主：http://localhost:8000/02-primitives/select/demo.html
 *       按钮 #b1（role="combobox"），<label for="b1">投资主体</label>，
 *       默认值 value='a' → 显示「A 股主板」。
 *       select.js 的 paint() 写 aria-labelledby="<字段名id> <值id>"，朗读应为
 *       「字段名 + 当前值」。
 *   顺带：http://localhost:8000/03-patterns/tooltip/demo.html
 *       tooltip.js 的 ensureLiveRegion() 造 #tooltip-live（role="tooltip"、
 *       aria-live="polite"、aria-label="组件提示"）。
 *
 * 运行前提（同 lib-env.mjs 头部）：
 *   1. 模拟器已启动、adb devices 可见（本脚本自行 ensureDevice/ensureReverse）
 *   2. 模拟器内 Chrome 可用（CDP 经 tcp:9222 → localabstract:chrome_devtools_remote）
 *   3. 宿主 8000 端口已跑 agentcss http-serve.py
 *   4. 页面标签不存在时脚本会 am start 自动打开
 *
 * 契约点：
 *   ① AX 树里有 role=combobox 节点（select demo 共 3 个 Select 实例）
 *   ② #b1 那个 combobox 的可访问名同时含字段名「投资主体」与当前值「A 股主板」
 *      （aria-labelledby="字段名id 值id" 的计算名，朗读 = 字段名 + 当前值）
 *   ③ DOM 佐证：aria-labelledby 的两个 id 解出来的文字分别正确
 *   ④ tooltip demo 页存在 live region（role=tooltip）节点 —— AX 树优先，
 *      AX 树未含时以 DOM 的 #tooltip-live[role="tooltip"] 为准记录（注明证据来源）
 * ============================================================================
 */
import {
  ensureDevice, ensureReverse, ensureCdp, connectPage,
  createCollector, isDirectRun, BASE_URL,
} from './lib-env.mjs';

const SELECT_SUBSTR = '/02-primitives/select/demo.html';
const TOOLTIP_SUBSTR = '/03-patterns/tooltip/demo.html';

/* getFullAXTree：无 rootNodeId 参数取整棵树。个别内核要求先 Accessibility.enable */
async function fullAXTree(session) {
  try {
    return await session.send('Accessibility.getFullAXTree');
  } catch {
    await session.send('Accessibility.enable');
    return await session.send('Accessibility.getFullAXTree');
  }
}

export async function run() {
  const c = createCollector('a11y-select');
  let browserSel = null;
  let browserTt = null;
  try {
    /* ---- 环境：设备 → reverse → forward/CDP → 找页或开页 ---- */
    const devices = ensureDevice();
    const reverse = ensureReverse();
    const cdp = await ensureCdp({ bootstrapUrl: BASE_URL + SELECT_SUBSTR });
    c.setMeta({
      devices,
      reverse,
      cdpBrowser: cdp.info && cdp.info.Browser ? cdp.info.Browser : '',
    });

    /* ---- select 页：AX 树找 combobox ---- */
    const sel = await connectPage(SELECT_SUBSTR, { openUrl: BASE_URL + SELECT_SUBSTR });
    browserSel = sel.browser;
    const session = await sel.page.context().newCDPSession(sel.page);
    const tree = await fullAXTree(session);
    const nodes = (tree && tree.nodes) || [];
    const combos = nodes.filter(
      (n) => n.role && n.role.value === 'combobox' && !n.ignored
    );
    const names = combos.map((n) => (n.name && n.name.value) || '(无名)');
    c.check('① AX 树里有 role=combobox 节点（select demo 的触发按钮）',
      combos.length > 0,
      '整树 ' + nodes.length + ' 个节点，其中 role=combobox ' + combos.length +
        ' 个，name：' + (names.join(' / ') || '(无)') +
        '（demo 有 s1/s2/s3 三个实例：s1 有 label，s2/s3 无 label 退 aria-label）');

    const hit = combos.find((n) => {
      const nm = (n.name && n.name.value) || '';
      return nm.indexOf('投资主体') >= 0 && nm.indexOf('A 股主板') >= 0;
    });
    c.check('② combobox 的可访问名 =「字段名 + 当前值」（投资主体 + A 股主板）',
      !!hit,
      hit
        ? 'name="' + (hit.name && hit.name.value) + '"（backendDOMNodeId=' +
          hit.backendDOMNodeId + '）——aria-labelledby 拼接，朗读应念「投资主体 A 股主板」'
        : '实际 combobox 名：' + (names.join(' / ') || '(一个都没有)') +
          '；期望同时含「投资主体」与「A 股主板」' +
          '（上一版缺陷：aria-label 只写当前值，字段名被挤掉）');

    /* DOM 佐证：aria-labelledby 的两个 id 各自解出什么文字 */
    const dom = await sel.page.evaluate(() => {
      const b = document.getElementById('b1');
      const lb = b.getAttribute('aria-labelledby') || '';
      const parts = lb.split(/\s+/).filter(Boolean).map((id) => {
        const el = document.getElementById(id);
        return el ? el.textContent.replace(/\s+/g, ' ').trim() : '(#' + id + ' 不存在)';
      });
      const vEl = b.querySelector('.select__value');
      return {
        role: b.getAttribute('role'),
        labelledby: lb,
        parts,
        valueText: vEl ? vEl.textContent : null,
      };
    });
    c.check('③ DOM 佐证：aria-labelledby =「字段名元素 值元素」且两段文字正确',
      dom.role === 'combobox' && dom.parts.length === 2 &&
        dom.parts[0].indexOf('投资主体') >= 0 &&
        dom.parts[1].indexOf('A 股主板') >= 0,
      'role=' + dom.role + '，aria-labelledby="' + dom.labelledby + '" → [' +
        dom.parts.join(' | ') + ']，.select__value 文字=' + JSON.stringify(dom.valueText));

    /* ---- tooltip 页：live region（role=tooltip）节点 ---- */
    const tt = await connectPage(TOOLTIP_SUBSTR, { openUrl: BASE_URL + TOOLTIP_SUBSTR });
    browserTt = tt.browser;
    const session2 = await tt.page.context().newCDPSession(tt.page);
    const tree2 = await fullAXTree(session2);
    const nodes2 = (tree2 && tree2.nodes) || [];
    const tips = nodes2.filter(
      (n) => n.role && n.role.value === 'tooltip' && !n.ignored
    );
    const tipNames = tips.map((n) => (n.name && n.name.value) || '(无名)');
    const domTip = await tt.page.evaluate(() => {
      const el = document.getElementById('tooltip-live');
      return el
        ? {
            exists: true,
            role: el.getAttribute('role'),
            label: el.getAttribute('aria-label'),
            live: el.getAttribute('aria-live'),
            atomic: el.getAttribute('aria-atomic'),
          }
        : { exists: false };
    });
    /* 🔴 0.27.17 AX 树证据是硬判据：旧实现 `tips.length > 0 || domTip.exists`
       在 AX 树缺席时退化为"DOM 里有个 div"——#tooltip-live 在 attach 时必建，
       demo 页一加载就在，断言近乎恒真。DOM 证据只做旁证不计分；
       AX 树取不到 = 判据未执行 = 记红（与 ime ③ 同一纪律）。 */
    const axReady = !!(tree2 && tree2.nodes && tree2.nodes.length > 0);
    c.check('④ tooltip demo 页在 AX 树里有 role=tooltip 的 live region',
      axReady && tips.length > 0,
      (axReady
        ? 'AX 树证据：role=tooltip 节点 ' + tips.length + ' 个，name=' +
          tipNames.join(' / ')
        : 'AX 树未取到（节点 0 条）——判据未执行，不许以 DOM 兜底记绿') +
        '；DOM 旁证：#tooltip-live 存在=' + domTip.exists +
        '，role=' + domTip.role + '，aria-label=' + domTip.label +
        '，aria-live=' + domTip.live + '，aria-atomic=' + domTip.atomic);
  } catch (e) {
    c.check('环境/连接前置（设备、reverse、CDP、页面）', false, (e && e.stack) || String(e));
  } finally {
    for (const b of [browserSel, browserTt]) {
      if (b) {
        try { await b.close(); } catch { /* 断开连接即可 */ }
      }
    }
  }
  return await c.finish();
}

if (isDirectRun(import.meta.url)) {
  run()
    .then((r) => { process.exitCode = r.ok ? 0 : 1; })
    .catch((e) => {
      console.error('未接住的异常：', (e && e.stack) || e);
      process.exitCode = 1;
    });
}
