/*
 * shot.js — 把页面截成 PNG（给定宽度、可选整页）
 *
 * ============================================================================
 * 🔴 为什么不用 `chrome --screenshot --window-size=390,844`
 * ----------------------------------------------------------------------------
 * 因为它**会撒谎**。Windows 上窗口有最小宽度，`--window-size=390` 拿到的
 * 实际视口是 **500px**（实测 innerWidth=500），而 `--screenshot` 只按 390 裁一刀。
 * 结果是一张"看起来是 390 宽"的图：文字在右边缘被切掉、媒体查询按 500 生效 ——
 * 你据此判断"窄屏没问题"，其实从没看过 390。
 *
 * 这类失败最贵的地方在于**它不报错**：图是好的、能打开、只是内容不对。
 * 所以这里走 Chrome 的调试管道（`--remote-debugging-pipe`，零依赖、不开端口），
 * 用 `Emulation.setDeviceMetricsOverride` 把视口**设成**要的那个数，再截。
 *
 * ============================================================================
 * 为什么是管道而不是 `--remote-debugging-port`
 * ----------------------------------------------------------------------------
 * 端口版要处理：端口占用、防火墙弹窗（Windows 首次监听会弹）、启动竞态
 * （等调试端口文件出现的时机）、以及同一个 profile 被复用时的锁。
 * 管道版把这些全绕开：读写走子进程的 fd 3/4，消息以 `\0` 分隔的 JSON。
 * 代价是自己拼十几行帧处理 —— 比处理上面四件事便宜得多。
 *
 * ============================================================================
 * 它**不是**视觉基线
 * ----------------------------------------------------------------------------
 * 基线（逐字节比对）由 `05-audit/shot-baseline.py` 管，那套要考虑字体、
 * 双平台产物与指纹。这里的产物是给人/给 Agent **看一眼**的：
 * 同一台机器、同样参数，两次逐字节一致（门禁验的就是这条）；
 * 换一台机器不保证 —— 字体光栅化不一样，别拿它当跨机器判据。
 */
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var { pathToFileURL } = require('url');
var pdf = require('./pdf.js');
var connect = require('./cdp.js').connect;
var netPolicy = require('./network-policy.js');
var computeShotVerdict = require('./shot-verdict.js').computeShotVerdict;

var DEFAULT_WIDTHS = [1440];
var DEFAULT_HEIGHT = 900;
var DEFAULT_WAIT = 800;
/* 整页截图的高度上限。PNG 面积是 W×H×scale²，超了内存与耗时都会失控；
   截断**不静默**：结果里带 truncatedAt，人/Agent 能看见。 */
var MAX_FULL_HEIGHT = 10000;

/** 页面在某个宽度下的量：溢出多少、谁溢出、有多高。 */
var PROBE_JS = [
  '(function(){',
  '  var d = document.documentElement;',
  '  var vw = d.clientWidth;',
  '  var over = [];',
  '  var overItems = [];',
  '  var all = document.querySelectorAll("body *");',
  '  var overCapped = false;',
  '  for (var i = 0; i < all.length && over.length < 40; i++) {',
  '    var e = all[i], r = e.getBoundingClientRect();',
  '    if (r.width === 0 && r.height === 0) continue;',
  '    if (r.right > vw + 1 || r.left < -1) {',
  '      var cls = typeof e.className === "string" ? e.className : "";',
  '      var tag = e.tagName.toLowerCase() + (cls ? "." + cls.trim().split(/\s+/).join(".") : "")',
  '        + " @" + Math.round(r.right);',
  '      /* P0-judge 判定语义必须在浏览器侧做：溢出元素是否在 overflow:auto/scroll',
  '         的祖先内 = 设计内滚动（warn）与真溢出（fail）的唯一分界。',
  '         在 Node 侧拿类名猜 = 假绿。 */',
  '      var inScroll = false;',
  '      for (var p = e.parentElement; p; p = p.parentElement) {',
  '        var cs = getComputedStyle(p);',
  '        var ox = cs.overflowX, oy = cs.overflowY;',
  '        if (ox === "auto" || ox === "scroll" || oy === "auto" || oy === "scroll") { inScroll = true; break; }',
  '        if (p === document.body) break;',
  '      }',
  '      /* 画布外（off-canvas）：**布局位置本在视口内**，是 transform 把它整体推了出去',
  '         —— 抽屉的收起态（`translateX(100%)`）、从侧边入场的动画都是这种。',
  '         它不产生横向滚动（scrollWidth 不变），和"布局本身就比视口宽"的真溢出是两件事。',
  '         判据：offset 链（布局，不受 transform 影响）对比 getBoundingClientRect（渲染后），',
  '         且只在**整体**离开视口时成立 —— 露出一半的变换元素仍然是真溢出。 */',
  '      var lx = 0, ln = e;',
  '      while (ln) { lx += ln.offsetLeft; ln = ln.offsetParent; }',
  '      var layoutRight = lx + e.offsetWidth;',
  '      var offCanvas = (r.left >= vw - 1 || r.right <= 1) &&',
  '        lx >= -1 && layoutRight <= vw + 1;',
  '      over.push(tag);',
  '      if (overItems.length < 40) overItems.push({ tag: tag, inScroll: inScroll, offCanvas: offCanvas });',
  '    }',
  '  }',
  '  return JSON.stringify({',
  '    viewport: vw, scrollWidth: d.scrollWidth, scrollHeight: d.scrollHeight,',
  '    pageOverflow: d.scrollWidth > vw + 1,',
  '    overflow: over.slice(0, 6), overflowCount: over.length,',
  '    overflowCapped: i < all.length && over.length >= 40,',
  '    overflowItems: overItems',
  '  });',
  '})();',
].join('\n');

function slugWidth(w) { return String(w); }

/**
 * @param {object} o
 * @param {string} o.src             本地 HTML 路径或 http(s) URL
 * @param {string} o.out             输出文件；多宽度时须含 `{width}`
 * @param {number[]} [o.widths]      视口宽度，默认 [1440]
 * @param {number} [o.height]        视口高度，默认 900
 * @param {boolean} [o.full]         整页（否则只截首屏）
 * @param {number} [o.scale]         设备像素比，默认 1
 * @param {number} [o.wait]          加载后额外等待（毫秒），默认 800
 * @param {string} [o.chrome]
 * @param {number} [o.timeoutMs]
 * @param {string} [o.networkPolicy]      off（默认）| strict —— 远程网络边界
 * @param {boolean} [o.allowLoopbackProxy] strict 下显式豁免环回代理（C 层）
 * @returns {Promise<object>}
 */
async function shoot(o) {
  o = o || {};
  var t0 = Date.now();
  if (!o.src) return { ok: false, code: 'usage', message: '缺少 src' };
  if (!o.out) return { ok: false, code: 'usage', message: '缺少 out' };

  var widths = o.widths && o.widths.length ? o.widths : DEFAULT_WIDTHS;
  for (var i = 0; i < widths.length; i++) {
    if (!Number.isInteger(widths[i]) || widths[i] < 200 || widths[i] > 4000) {
      return { ok: false, code: 'usage',
        message: '宽度必须是 200–4000 的整数，收到 ' + JSON.stringify(widths[i]) };
    }
  }
  var height = o.height || DEFAULT_HEIGHT;
  if (!Number.isInteger(height) || height < 200 || height > 4000) {
    return { ok: false, code: 'usage',
      message: '高度必须是 200–4000 的整数，收到 ' + JSON.stringify(o.height) };
  }
  var scale = o.scale === undefined ? 1 : Number(o.scale);
  if (!(scale > 0 && scale <= 3)) {
    return { ok: false, code: 'usage', message: '--scale 必须在 (0, 3]，收到 ' + JSON.stringify(o.scale) };
  }

  var remote = /^https?:\/\//i.test(o.src);
  if (!remote) {
    var srcAbs = path.resolve(o.src);
    if (!fs.existsSync(srcAbs)) return { ok: false, code: 'usage', message: '找不到输入文件：' + srcAbs };
    o.src = srcAbs;
  }

  /* 🔴 0.27.24：ai shot 此前接受任意远程 URL 却没有网络策略（外部审计）。
     与 pdf 同一套 strict：A DNS 预解析+pin / B URL 黑名单 / C 事件复核 /
     D Fetch 请求级拦截。默认 off —— 本地 file:// 渲染行为一字不变。 */
  if (o.networkPolicy !== undefined && o.networkPolicy !== null
    && o.networkPolicy !== 'off' && o.networkPolicy !== 'strict') {
    return { ok: false, code: 'usage',
      message: '--network-policy 只能是 off | strict，收到 '
        + JSON.stringify(String(o.networkPolicy)) };
  }
  var policy = null;
  if (o.networkPolicy === 'strict') {
    var remoteTarget = /^https?:\/\//i.test(o.src || '');
    try {
      policy = remoteTarget
        ? await netPolicy.prepare(o.src)
        : { hostname: null, ips: [], pinned: null, chromeArgs: [],
          blockedPatterns: netPolicy.blockedUrlPatterns() };
    } catch (e) {
      return { ok: false, code: 'network-policy',
        message: String(e && e.message || e), chrome: null, shots: [],
        verdict: { status: 'fail', reasons: [{ code: 'network-policy', severity: 'fail',
          where: 'src', detail: String(e && e.message || e).slice(0, 120) }],
          summary: '网络策略拒绝，判定不可信' } };
    }
  }

  var outTpl = String(o.out);
  if (widths.length > 1 && outTpl.indexOf('{width}') < 0) {
    return { ok: false, code: 'usage',
      message: '截多个宽度时 --out 必须含 {width}（例：shot-{width}.png），'
        + '否则 ' + widths.length + ' 张图会写进同一个文件，最后只剩一张' };
  }

  var chrome = pdf.resolveChrome(o.chrome);
  if (chrome.error) return { ok: false, code: 'no-chrome', message: chrome.error };

  var profile = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcss-shot-'));
  var cdp = connect(chrome.path, profile, policy ? policy.chromeArgs : []);
  var shots = [];
  var consoleErrors = [];
  var budget = o.timeoutMs || 90000;
  var deadline = Date.now() + budget;

  try {
    var target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    var attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    var sid = attached.sessionId;

    await cdp.send('Page.enable', {}, sid);
    await cdp.send('Runtime.enable', {}, sid);
    /* JS 异常要收集：截出一张"布局正确但内容没渲染"的图是最坏的产物，
       而它通常就是一行 TypeError 造成的。 */
    cdp.on('Runtime.exceptionThrown', function (p) {
      if (consoleErrors.length >= 20) return;
      var d = (p && p.exceptionDetails) || {};
      var txt = (d.exception && d.exception.description) || d.text || '未捕获异常';
      consoleErrors.push(String(txt).split('\n')[0]);
    });
    cdp.on('Runtime.consoleAPICalled', function (p) {
      if (consoleErrors.length >= 20) return;
      if (!p || p.type !== 'error') return;
      var parts = (p.args || []).map(function (a) {
        return a.value === undefined ? (a.description || a.type) : String(a.value);
      });
      consoleErrors.push('console.error: ' + parts.join(' '));
    });

    /* strict 网络策略：B/C/D 三层统一接线（与 pdf-renderer 同一条实现）。 */
    var netState = null;
    if (policy) {
      netState = await netPolicy.attach(cdp, sid, policy,
        { allowLoopbackProxy: !!o.allowLoopbackProxy });
    }

    for (var w = 0; w < widths.length; w++) {
      if (Date.now() > deadline) {
        return { ok: false, code: 'timeout', message: '超出时间预算 ' + budget + 'ms', chrome: chrome.path, shots: shots,
          verdict: { status: 'fail', reasons: [{ code: 'capture-incomplete', severity: 'fail', where: 'w' + widths[w], detail: '超出时间预算——部分宽度没截，判定不可信' }], summary: '采集不完整，判定不可信' } };
      }
      var width = widths[w];
      var w0 = Date.now();

      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: width, height: height, deviceScaleFactor: scale, mobile: false
      }, sid);

      var loaded = cdp.waitEvent('Page.loadEventFired', sid, 30000);
      var nav = await cdp.send('Page.navigate', { url: remote ? o.src : pathToFileURL(o.src).href }, sid);
      if (nav && nav.errorText) {
        return { ok: false, code: 'render',
          message: '页面加载失败（' + nav.errorText + '）：' + o.src, chrome: chrome.path, shots: shots,
          verdict: { status: 'fail', reasons: [{ code: 'capture-incomplete', severity: 'fail', where: 'w' + widths[w], detail: '页面加载失败——判定不可信' }], summary: '采集不完整，判定不可信' } };
      }
      await loaded;
      /* 🔴 0.27.18：默认等待必须真的生效 —— 旧代码 `if (o.wait)` 对
         undefined 直接跳过，DEFAULT_WAIT=800 从未起作用，结果元数据
         却上报 wait:800（采集保真度和元数据双输；实测 per-shot 179ms
         却自称等了 800ms）。html-check §9 显式传 wait 绕开了它，门禁
         一直抓不到。 */
      await new Promise(function (r) {
        setTimeout(r, o.wait === undefined ? DEFAULT_WAIT : o.wait);
      });

      /* strict 捕获到非公网访问 ⇒ 不把这张图交出去（与 pdf 同语义）。 */
      if (netState && netState.violations.length) {
        return { ok: false, code: 'network-policy',
          message: '网络策略拒绝：' + netState.violations[0]
            + '（strict 不允许访问非公网地址；本次不产出截图）',
          chrome: chrome.path, shots: shots,
          verdict: { status: 'fail', reasons: [{ code: 'network-policy', severity: 'fail',
            where: 'w' + width, detail: 'strict 捕获到非公网访问——判定不可信' }],
            summary: '网络策略拒绝，判定不可信' } };
      }

      var probe = await cdp.send('Runtime.evaluate', {
        expression: PROBE_JS, returnByValue: true
      }, sid);
      var info = {};
      try { info = JSON.parse(probe.result.value); } catch (e) { info = {}; }

      var clipH = height;
      var truncated = null;
      if (o.full) {
        var want = info.scrollHeight || height;
        clipH = Math.min(want, MAX_FULL_HEIGHT);
        if (want > MAX_FULL_HEIGHT) truncated = want;
      }

      var shot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: !!o.full,
        clip: { x: 0, y: 0, width: width, height: clipH, scale: 1 }
      }, sid);
      var png = Buffer.from(shot.data, 'base64');
      if (png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) {
        /* 🔴 0.27.18：失败路径也带 verdict —— capture-incomplete 语义
           统一（旧实现这里只回 code/message，JSON 契约有两个缺口）。 */
        return { ok: false, code: 'render', message: '产出的不是 PNG（' + png.length + ' 字节）',
          chrome: chrome.path, shots: shots,
          verdict: { status: 'fail', reasons: [{ code: 'capture-incomplete', severity: 'fail', where: 'w' + width, detail: '截图产出不是合法 PNG——判定不可信' }], summary: '采集不完整，判定不可信' } };
      }

      var outFile = path.resolve(outTpl.replace(/\{width\}/g, slugWidth(width)));
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, png);

      shots.push({
        width: width, out: outFile, bytes: png.length, ms: Date.now() - w0,
        png: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) },
        full: !!o.full,
        truncatedAt: truncated,
        viewport: info.viewport === undefined ? null : info.viewport,
        scrollWidth: info.scrollWidth === undefined ? null : info.scrollWidth,
        scrollHeight: info.scrollHeight === undefined ? null : info.scrollHeight,
        overflow: info.overflow || [],
        overflowCount: info.overflowCount || 0,
        overflowCapped: info.overflowCapped === true,
        captureOk: info.viewport !== undefined,
        pageOverflow: info.pageOverflow === true,
        overflowItems: info.overflowItems || []
      });
    }

    var verdict = computeShotVerdict(shots, consoleErrors);
    var verdictMod = require('./shot-verdict.js');
    return {
      ok: true, code: null, message: null, chrome: chrome.path,
      scale: scale, wait: o.wait === undefined ? DEFAULT_WAIT : o.wait,
      networkPolicy: policy ? 'strict' : 'off',
      networkPolicyDegraded: !!(netState && netState.degraded),
      shots: shots, consoleErrors: consoleErrors,
      verdict: verdict, summary: verdictMod.summarize(verdict, shots.length),
      ms: Date.now() - t0
    };
  } catch (e) {
    /* 🔴 0.27.18：异常路径同样补 capture-incomplete verdict（与
       timeout/nav 失败同语义——采集没跑成就不许留下"没有判定"的缺口）。 */
    return { ok: false, code: 'render', message: String(e && e.message || e), chrome: chrome.path, shots: shots,
      verdict: { status: 'fail', reasons: [{ code: 'capture-incomplete', severity: 'fail', where: '采集', detail: '探针异常——判定不可信：' + String(e && e.message || e).slice(0, 80) }], summary: '采集不完整，判定不可信' } };
  } finally {
    cdp.close();
    /* 清理必须**在进程退出前**做完：CLI 随后就 exit，挂 setTimeout 等于每截一张图
       就在系统临时目录里留一个 Chrome profile（pdf.js 那边实测漏过 6 个）。
       先等一下再删：Windows 上子进程刚 kill 时还握着文件句柄。 */
    await new Promise(function (r) { setTimeout(r, 120); });
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); }
    catch (e) { /* 偶发 EBUSY，交给系统清理 */ }
  }
}

module.exports = { shoot: shoot, DEFAULT_WIDTHS: DEFAULT_WIDTHS, DEFAULT_HEIGHT: DEFAULT_HEIGHT, DEFAULT_WAIT: DEFAULT_WAIT };
