/*
 * network-policy.js — PDF 渲染时的远程网络边界（仅 `--network-policy=strict` 启用）
 *
 * ============================================================================
 * 🔴 为什么需要它（不是"再加一道 URL 正则"那么浅）
 * ----------------------------------------------------------------------------
 *   插件在调用 CLI **之前**能对传入的 URL 做静态检查，但它看不到两件事：
 *     ① 公开站点把页面 302 到 http://127.0.0.1/…（重定向由 Chromium 跟随）；
 *     ② 域名先解析成公网 IP、真正连接时又解析成内网 IP（DNS rebinding）。
 *   这两件事都发生在浏览器里，字符串检查够不着。
 *
 *   本模块在**渲染子进程内**做三层：
 *     A. 导航前：解析目标域名，要求所有 A/AAAA 都是公网地址；把第一个公网
 *        IPv4 用 Chrome 的 --host-resolver-rules 固定住，让 Chromium 不再
 *        自己解析这个域名 ⇒ DNS rebinding 失去第二次解析的机会。
 *     B. 浏览器侧：Network.setBlockedURLs 屏蔽私网/环回/链路本地的**字面量**
 *        URL，重定向到这些地址时在发起前就被 Chrome 挡掉。
 *     C. 事件侧：Network.requestWillBeSent（含 redirectResponse）与
 *        Network.responseReceived.remoteIPAddress 逐条复核；发现越界就记下，
 *        打印前判定失败，**不产出 PDF**。
 *
 *   ⚠️ 诚实的边界：C 层是"发现即拒绝交付"，不是"连接从未发生"；A/B 才是
 *   事前拦截。IPv6-only 域名没有可用的 IPv4 可 pin，此时只靠 B/C，安全性
 *   弱一档 —— prepare() 会在返回里标明 pinned=null，调用方须如实说明。
 *
 *   ⚠️ 默认 off：不传 --network-policy 时，pdf-renderer 一行本模块的代码
 *   都不会执行，既有行为（含本地 file:// 渲染）完全不变。
 *
 *   与 dsh-plugin-agentcss 的 isPrivateHost() 是**同源规则**（同一张私网表），
 *   但两个包各自实现：插件是 npm 包，不能依赖库未暴露的深层路径。
 *   改动这张表时，两边与各自的表驱动测试必须一起改。
 * ============================================================================
 */
'use strict';

var dns = require('dns');
var lookup = dns.promises.lookup;

/** 环回 / 私网 / 链路本地（含云元数据）/ CGNAT / IPv4 映射地址。 */
function isPrivateV4(h) {
  /* new URL() 会把 2130706433 / 127.1 / 0 这类等价写法规范化成点分十进制 */
  var v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!v4) return false;
  var a = Number(v4[1]);
  var b = Number(v4[2]);
  return a === 0 || a === 10 || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

/* 把 IPv6 字面量展开成 8 个 hextet；尾部点分 IPv4（::ffff:1.2.3.4 形态）
   先折算成两个 hextet 再统一处理。展开失败（畸形）返回 null。 */
function expandIPv6(h) {
  var v4 = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (v4) {
    var o = [Number(v4[2].split('.')[0]), Number(v4[2].split('.')[1]),
      Number(v4[2].split('.')[2]), Number(v4[2].split('.')[3])];
    h = v4[1] + (o[0] * 256 + o[1]).toString(16)
      + ':' + (o[2] * 256 + o[3]).toString(16);
  }
  var halves = h.split('::');
  if (halves.length > 2) return null;
  var head = halves[0] === '' ? [] : halves[0].split(':');
  var g = [];
  var i;
  if (halves.length === 1) {
    g = head;
    if (g.length !== 8) return null;
  } else {
    var tail = halves[1] === '' ? [] : halves[1].split(':');
    if (head.length + tail.length > 7) return null;
    for (i = 0; i < head.length; i += 1) g.push(head[i]);
    for (i = 8 - head.length - tail.length; i > 0; i -= 1) g.push('0');
    for (i = 0; i < tail.length; i += 1) g.push(tail[i]);
  }
  for (i = 0; i < 8; i += 1) {
    if (!/^[0-9a-f]{1,4}$/.test(g[i])) return null;
  }
  return g;
}

/* 两个 hextet 里内嵌的 IPv4（高位段 + 低位段）按 v4 规则复核。 */
function v4InHextetsPrivate(hi, lo) {
  var n1 = parseInt(hi, 16);
  var n2 = parseInt(lo, 16);
  if (isNaN(n1) || isNaN(n2)) return false;
  var dotted = [Math.floor(n1 / 256) % 256, n1 % 256,
    Math.floor(n2 / 256) % 256, n2 % 256].join('.');
  return isPrivateV4(dotted);
}

function isPrivateHost(host) {
  var h = String(host).replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  /* ES5 写法：这个文件在 ai/ 下，K6 门禁按"老 WebView 也能跑"的标准扫它，
     endsWith / startsWith 在那些环境里会直接抛异常。 */
  var endsWith = function (s) { return h.slice(-s.length) === s; };
  if (h === 'localhost' || endsWith('.localhost') || endsWith('.local')
      || endsWith('.internal') || h === 'metadata') return true;
  if (isPrivateV4(h)) return true;
  if (h.indexOf(':') >= 0) {
    /* 🔴 0.27.24（外部审计实证）：原来只认 ::1 / :: / fc-fd / fe8-feb /
       ::ffff: 前缀——IPv4-compatible（::7f00:1）、NAT64（64:ff9b::7f00:1）、
       6to4（2002:7f00:1::1）、Teredo（2001:0::/32）全部漏判，实测均 false。
       ⇒ 改为展开成 hextet 后按前缀逐族复核，内嵌的 IPv4 一律走 v4 规则：
         · ::ffff:0:0/96 映射：内嵌 v4 公网则放行（原来一刀切判私，
           会把 ::ffff:93.184.216.34 这类公网映射误伤）
         · ::/96 兼容（已弃用但部分栈仍路由）
         · 64:ff9b::/96 与 64:ff9b:1::/48（NAT64，RFC 6052 / 8219）
         · 2002::/16（6to4，内嵌 v4 在第 2/3 段）
         · 2001:0::/32（Teredo，隧道可进内网 ⇒ 整族保守判私）
         · 2001:db8::/32（文档前缀，不该出现在公网渲染里） */
    var g = expandIPv6(h);
    if (!g) return false;
    var allZero = true;
    var i;
    for (i = 0; i < 8; i += 1) { if (g[i] !== '0') { allZero = false; break; } }
    if (allZero) return true;
    var first = parseInt(g[0], 16);
    if (allZeroExceptLastOne(g)) return true;
    if ((first & 0xfe00) === 0xfc00) return true;
    if ((first & 0xffc0) === 0xfe80) return true;
    if (g[0] === '0' && g[1] === '0' && g[2] === '0' && g[3] === '0'
      && g[4] === '0' && g[5] === 'ffff') return v4InHextetsPrivate(g[6], g[7]);
    if (g[0] === '0' && g[1] === '0' && g[2] === '0' && g[3] === '0'
      && g[4] === '0' && g[5] === '0') return v4InHextetsPrivate(g[6], g[7]);
    if (first === 0x64 && parseInt(g[1], 16) === 0xff9b
      && g[3] === '0' && g[4] === '0' && g[5] === '0'
      && (g[2] === '0' || g[2] === '1')) return v4InHextetsPrivate(g[6], g[7]);
    if (first === 0x2002) return v4InHextetsPrivate(g[1], g[2]);
    if (first === 0x2001 && parseInt(g[1], 16) === 0) return true;
    if (first === 0x2001 && parseInt(g[1], 16) === 0x0db8) return true;
    return false;
  }
  return false;
}

function allZeroExceptLastOne(g) {
  for (var i = 0; i < 7; i += 1) { if (g[i] !== '0') return false; }
  return g[7] === '1';
}

function policyError(message) {
  var e = new Error(message);
  e.code = 'network-policy';
  return e;
}

/**
 * 单个 URL 的违规描述；null = 允许。
 * 只判 http(s)：页面里的 data:/blob:/file: 子资源不属于"远程网络访问"。
 */
function violationForUrl(raw) {
  if (!raw) return null;
  var u;
  try { u = new URL(String(raw)); } catch (e) { return 'URL 无法解析：' + String(raw); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return 'URL 带用户名/密码';
  if (isPrivateHost(u.hostname)) {
    return '指向环回/私网/链路本地地址 ' + u.hostname;
  }
  return null;
}

/** Network.requestWillBeSent 的事件体；重定向链的两端都要查。 */
function requestViolation(p) {
  if (!p) return null;
  var urls = [];
  if (p.request && p.request.url) urls.push(p.request.url);
  if (p.redirectResponse && p.redirectResponse.url) urls.push(p.redirectResponse.url);
  for (var i = 0; i < urls.length; i += 1) {
    var v = violationForUrl(urls[i]);
    if (v) return '请求 ' + urls[i] + '：' + v;
  }
  return null;
}

function isLoopback(host) {
  var h = String(host).replace(/^\[|\]$/g, '').toLowerCase();
  return h === '::1' || h === 'localhost' || h.indexOf('127.') === 0
    || h.indexOf('::ffff:127.') === 0;
}

/**
 * Network.responseReceived 的事件体；看真正连上的 IP。
 *
 * 🔴 0.27.24（外部审计实证的 SSRF 绕过，默认拒绝）：原来的"环回代理豁免"
 *    （回环 IP 且 URL 是公网域名 ⇒ 一律放行）可以用 DNS rebinding 完整绕过：
 *    攻击者控制 rebind.evil.com 的解析到 127.0.0.1，页面嵌入它 ⇒
 *    remoteIPAddress=127.0.0.1 + 公网域名 ⇒ 被当成代理放行，
 *    本机回环服务的响应进了 PDF。实测 PoC：
 *      responseViolation({response:{remoteIPAddress:'127.0.0.1',
 *        url:'https://rebind.evil.com/secret'}}) 返回 null。
 *    ⇒ 豁免改为**显式开关** opts.allowLoopbackProxy（CLI
 *      --allow-loopback-proxy）。默认：公网域名连到环回/私网 ⇒ 违规。
 *    开关后的语义（代理用户）：remoteIPAddress 是环回 + URL 域名公网
 *      ⇒ 视为代理连接放行并标注 degraded；URL 本身是环回/私网字面量
 *      仍拒绝；非环回私网 IP（10./172.16./192.168./169.254.）一律拒绝。
 *    ⚠️ D 层（checkRequestUrl）不受这个开关影响：域名解析到私网
 *       在请求发出前就被拦，DNS rebinding 在默认与开关态都堵死。
 */
function responseViolation(p, opts) {
  var resp = p && p.response;
  var ip = resp && resp.remoteIPAddress;
  if (!ip) return null;
  var host = String(ip).replace(/^\[|\]$/g, '');
  if (!isPrivateHost(host)) return null;
  if (opts && opts.allowLoopbackProxy && isLoopback(host) && resp.url) {
    var urlHost;
    try { urlHost = new URL(String(resp.url)).hostname; }
    catch (e) { return '响应 URL 无法解析：' + String(resp.url); }
    if (urlHost && !isPrivateHost(urlHost)) return null;
  }
  return '响应来自非公网 IP ' + host;
}

/**
 * Chrome 侧的 URL 黑名单（Network.setBlockedURLs 的 urlPatterns）。
 * 只列确凿的私网/环回前缀，不写会误伤公网的宽模式。
 */
function blockedUrlPatterns() {
  var out = [
    '*://localhost/*', '*://*.localhost/*', '*://*.local/*', '*://*.internal/*',
    '*://127.*', '*://10.*', '*://0.*', '*://169.254.*',
    '*://192.168.*', '*://198.18.*', '*://198.19.*',
    '*://[::1]/*', '*://[::]/*', '*://[fe80::*]/*'
  ];
  for (var i = 16; i <= 31; i += 1) out.push('*://172.' + i + '.*');
  for (var j = 64; j <= 127; j += 1) out.push('*://100.' + j + '.*');
  return out;
}

/**
 * 导航前准备：静态校验 + DNS 预解析 + 生成 Chrome 的 IP pin 参数。
 * 任何一步不过都抛 code='network-policy' 的错误，浏览器**不会启动**。
 * resolver 只供测试注入（验证"域名解析到内网"这条分支真的会红）；
 * 生产路径用 dns.promises.lookup，行为不受这个参数影响。
 */
async function prepare(target, resolver) {
  var u;
  try { u = new URL(String(target)); }
  catch (e) { throw policyError('远程地址不是合法 URL：' + String(target)); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw policyError('远程地址只支持 http/https，收到 ' + u.protocol);
  }
  if (u.username || u.password) {
    throw policyError('远程地址不允许带用户名/密码');
  }
  if (isPrivateHost(u.hostname)) {
    throw policyError('目标主机 ' + u.hostname + ' 是环回/私网/链路本地地址；'
      + '本机页面请用本地文件路径，确需内网地址请走受信任的本地流程');
  }

  var records;
  try {
    records = await (resolver || lookup)(u.hostname, { all: true, verbatim: true });
  } catch (e) {
    throw policyError('无法解析目标域名 ' + u.hostname + '：' + (e && e.message || e));
  }
  var ips = (records || []).map(function (r) { return r.address; });
  if (!ips.length) {
    throw policyError('目标域名 ' + u.hostname + ' 没有解析到任何地址');
  }
  for (var i = 0; i < ips.length; i += 1) {
    if (isPrivateHost(ips[i])) {
      throw policyError('目标域名 ' + u.hostname + ' 解析到非公网地址 ' + ips[i]
        + '（DNS rebinding / 内网域名的典型形态）');
    }
  }

  var v4 = null;
  for (var k = 0; k < ips.length; k += 1) {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ips[k])) { v4 = ips[k]; break; }
  }
  return {
    hostname: u.hostname,
    ips: ips,
    pinned: v4,
    chromeArgs: v4
      ? ['--host-resolver-rules=MAP ' + u.hostname.replace(/^\[|\]$/g, '') + ' ' + v4]
      : [],
    blockedPatterns: blockedUrlPatterns()
  };
}

/**
 * D 层：单个待发请求的判定（0.27.24 新增，修审计实证的绕过）。
 * C 层是"连接已经发生之后的复核"，A/B 只覆盖主文档——公网页面里的
 * 子资源与重定向域名此前没有事前校验。本函数在 Fetch.requestPaused 里
 * 逐条调用：字面量私网 → 拒；域名 → 逐条 DNS 解析，任一地址私网 ⇒ 拒。
 * cache 由宿主持有（跨请求复用 DNS 结论）；resolver 只供测试注入。
 * 返回违规描述或 null。
 */
async function checkRequestUrl(rawUrl, cache, resolver) {
  var v = violationForUrl(rawUrl);
  if (v) return v;
  var u;
  try { u = new URL(String(rawUrl)); } catch (e) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  var host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (cache[host] !== undefined) return cache[host];
  var verdict = null;
  try {
    var records = await (resolver || lookup)(host, { all: true, verbatim: true });
    var ips = (records || []).map(function (r) { return r.address; });
    for (var i = 0; i < ips.length; i += 1) {
      if (isPrivateHost(ips[i])) {
        verdict = '域名 ' + host + ' 解析到非公网地址 ' + ips[i]
          + '（DNS rebinding / 内网域名的典型形态）';
        break;
      }
    }
    if (!verdict && !ips.length) {
      verdict = '域名 ' + host + ' 没有解析到任何地址';
    }
  } catch (e) {
    verdict = '域名 ' + host + ' 解析失败：' + (e && e.message || e);
  }
  cache[host] = verdict;
  return verdict;
}

/**
 * 把 B/C/D 三层接到一个 CDP 会话上（pdf-renderer 与 shot 共用一条实现，
 * 防止"两个消费方各自接线，修一处漏一处"）。
 *   session   ai/cdp.js 的连接对象（send / on）
 *   sid       Target.attachToTarget 返回的 sessionId
 *   policy    prepare() 的返回；本地文件目标时至少含 blockedPatterns
 *   opts.allowLoopbackProxy  C 层环回代理豁免（显式开关，默认关）
 *   opts.resolver             只供测试注入
 * 返回 { violations, degraded }：violations 由事件逐条填入（截断在 10 条）。
 * 🔴 拦截到违规的请求必须回应（failRequest），否则导航会卡死——
 *    "拒绝连接"与"让页面继续"是同一次回应的两个分支，不是可选的。
 */
async function attach(session, sid, policy, opts) {
  opts = opts || {};
  var state = { violations: [], degraded: false };
  var dnsCache = {};
  if (policy.hostname) dnsCache[policy.hostname] = null;  /* prepare 已验过全公网 */
  await session.send('Network.enable', {}, sid);
  await session.send('Network.setBlockedURLs',
    { urls: policy.blockedPatterns }, sid);
  session.on('Network.requestWillBeSent', function (p) {
    var v = requestViolation(p);
    if (v && state.violations.length < 10) state.violations.push(v);
  });
  session.on('Network.responseReceived', function (p) {
    var v = responseViolation(p, opts);
    if (v && state.violations.length < 10) state.violations.push(v);
    if (p && p.response && isLoopback(p.response.remoteIPAddress || '')) {
      state.degraded = true;
    }
  });
  await session.send('Fetch.enable', {
    patterns: [
      { urlPattern: 'http://*', requestStage: 'Request' },
      { urlPattern: 'https://*', requestStage: 'Request' }
    ]
  }, sid);
  session.on('Fetch.requestPaused', function (pr) {
    var url = pr && pr.request && pr.request.url;
    checkRequestUrl(url, dnsCache, opts.resolver)
      .then(function (v) {
        if (v && state.violations.length < 10) {
          state.violations.push('请求 ' + url + '：' + v);
        }
        return v
          ? session.send('Fetch.failRequest',
            { requestId: pr.requestId, errorReason: 'AccessDenied' }, sid)
          : session.send('Fetch.continueRequest',
            { requestId: pr.requestId }, sid);
      })
      .catch(function () {
        /* 判定器自身异常 = 拿不准 ⇒ 拒发并记录（不许静默放行） */
        if (state.violations.length < 10) {
          state.violations.push('请求 ' + url + '：拦截器异常（拿不准即拒绝）');
        }
        return session.send('Fetch.failRequest',
          { requestId: pr.requestId, errorReason: 'AccessDenied' }, sid);
      });
  });
  return state;
}

module.exports = {
  isPrivateHost: isPrivateHost,
  isPrivateV4: isPrivateV4,
  isLoopback: isLoopback,
  violationForUrl: violationForUrl,
  requestViolation: requestViolation,
  responseViolation: responseViolation,
  checkRequestUrl: checkRequestUrl,
  attach: attach,
  blockedUrlPatterns: blockedUrlPatterns,
  prepare: prepare,
  policyError: policyError
};
