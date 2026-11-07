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
function isPrivateHost(host) {
  var h = String(host).replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  /* ES5 写法：这个文件在 ai/ 下，K6 门禁按"老 WebView 也能跑"的标准扫它，
     endsWith / startsWith 在那些环境里会直接抛异常。 */
  var endsWith = function (s) { return h.slice(-s.length) === s; };
  if (h === 'localhost' || endsWith('.localhost') || endsWith('.local')
      || endsWith('.internal') || h === 'metadata') return true;
  /* new URL() 会把 2130706433 / 127.1 / 0 这类等价写法规范化成点分十进制 */
  var v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
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
  if (h.indexOf(':') >= 0) {
    var startsWith = function (s) { return h.slice(0, s.length) === s; };
    return h === '::1' || h === '::' || startsWith('fc') || startsWith('fd')
      || startsWith('fe8') || startsWith('fe9') || startsWith('fea')
      || startsWith('feb') || startsWith('::ffff:');
  }
  return false;
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
 * 🔴 代理环境（实测 2026-11-07）：系统开了 127.0.0.1:7897 时，Chrome 把
 *    https://example.com/ 交给本地代理，remoteIPAddress 一律是 127.0.0.1。
 *    若照字面判"私网 IP ⇒ 拒绝"，strict 会把**所有**公网渲染一起拒掉，
 *    比没有这道策略更糟。⇒ 环回 IP 且 URL 的 host 是公网域名时视为代理连接，
 *    放行并在 prepare/renderer 侧如实标注降级；URL 本身就是环回/私网字面量
 *    的仍拒绝（那类本该被 B 层在发起前挡住，这里是兜底）。
 *    非环回的私网 IP（10./172.16./192.168./169.254.）一律拒绝。
 */
function responseViolation(p) {
  var resp = p && p.response;
  var ip = resp && resp.remoteIPAddress;
  if (!ip) return null;
  var host = String(ip).replace(/^\[|\]$/g, '');
  if (!isPrivateHost(host)) return null;
  if (isLoopback(host) && resp.url) {
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

module.exports = {
  isPrivateHost: isPrivateHost,
  isLoopback: isLoopback,
  violationForUrl: violationForUrl,
  requestViolation: requestViolation,
  responseViolation: responseViolation,
  blockedUrlPatterns: blockedUrlPatterns,
  prepare: prepare,
  policyError: policyError
};
