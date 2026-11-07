#!/usr/bin/env node
/*
 * network-policy-gate.js — `--network-policy=strict` 的判据
 *
 * ============================================================================
 * 🔴 为什么单独一道门禁
 * ----------------------------------------------------------------------------
 *   远程重定向到内网、DNS rebinding 这两件事，靠"看一眼 URL 字符串"永远
 *   证伪不了。策略落在 ai/network-policy.js 里，但如果没有判据盯着，
 *   下一轮重构把 Network.enable 或事件监听删掉，全量门禁照样全绿。
 *
 *   本门禁**不连网、不起 Chrome、不写工作树**：
 *     · 表驱动覆盖私网/环回/等价 IP/IPv6/凭据 URL 与公网正例
 *     · 用可注入 resolver 真跑「域名解析到内网」的每条分支
 *     · 用 Module._compile 在内存里编译变异体，证明判据不是恒绿
 *     · 静态核对渲染子进程 / CLI / 导出器的接线没有被摘掉
 *   真实 Chrome 的端到端（off 零回归、strict 拒绝环回且旧 PDF 不变）
 *   放在 pdf-export-gate.js 的 E23–E25 —— 那里本来就有 Chrome 夹具。
 *
 * 用法：
 *   node 05-audit/network-policy-gate.js
 *   node 05-audit/network-policy-gate.js --selftest   # 同一套纯内存判据
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.dirname(__dirname);
const POLICY = path.join(ROOT, 'ai', 'network-policy.js');
const RENDERER = path.join(ROOT, 'ai', 'pdf-renderer.js');
const CLI = path.join(ROOT, 'ai', 'cli.js');
const PDF = path.join(ROOT, 'ai', 'pdf.js');

let bad = 0;
function check(id, ok, detail) {
  console.log('  [' + (ok ? 'OK  ' : 'FAIL') + '] ' + id.padEnd(46)
    + (detail === undefined ? '' : String(detail)));
  if (!ok) bad += 1;
}

const p = require(POLICY);

/* ---------- ① URL 表驱动：应拒 / 应放行 ---------- */
function tableChecks() {
const BLOCKED = [
  'http://127.0.0.1/', 'http://127.1/', 'http://2130706433/', 'http://0/',
  'http://localhost/', 'http://LOCALHOST./', 'http://10.1.2.3/',
  'http://172.16.0.1/', 'http://192.168.1.8/',
  'http://169.254.169.254/latest/meta-data/', 'http://100.64.0.1/',
  'http://[::1]/', 'http://[::ffff:127.0.0.1]/',
  'http://user:pw@example.com/', 'http://foo.local/', 'http://198.18.0.1/'
];
const ALLOWED = [
  'https://example.com/report', 'http://93.184.216.34/a',
  'data:text/html,x', 'file:///tmp/a.html', 'blob:https://example.com/x'
];
let missed = BLOCKED.filter((u) => !p.violationForUrl(u));
let wrongly = ALLOWED.filter((u) => p.violationForUrl(u));
check('① 私网/环回/等价 IP 全部拒绝（' + BLOCKED.length + ' 例）',
  missed.length === 0, missed.length ? '漏: ' + missed.join(',') : BLOCKED.length + '/' + BLOCKED.length);
check('① 公网与本地子资源不误拒（' + ALLOWED.length + ' 例）',
  wrongly.length === 0, wrongly.length ? '误拒: ' + wrongly.join(',') : ALLOWED.length + '/' + ALLOWED.length);

/* ---------- ② 事件层：重定向链两端与真实远端 IP ---------- */
const redirect = {
  request: { url: 'http://127.0.0.1/admin' },
  redirectResponse: { url: 'https://example.com/go' }
};
check('② 公开站点重定向到环回 ⇒ 抓住',
  !!p.requestViolation(redirect), p.requestViolation(redirect));
check('② 重定向来源本身是私网 ⇒ 也抓住',
  !!p.requestViolation({
    request: { url: 'https://example.com/x' },
    redirectResponse: { url: 'http://10.0.0.1/x' }
  }));
check('② 正常公网请求不误拒',
  !p.requestViolation({ request: { url: 'https://example.com/a.png' } }));
check('② 响应来自私网 IP ⇒ 抓住',
  !!p.responseViolation({ response: { remoteIPAddress: '10.0.0.5' } }));
check('② 响应来自公网 IP 不误拒',
  !p.responseViolation({ response: { remoteIPAddress: '93.184.216.34' } }));
/* 系统开了本地代理时，Chrome 连的是 127.0.0.1，把所有公网渲染一起拒掉
   比没有策略更糟。这三条守住"代理可用"与"内网仍拦"的分界。 */
check('② 环回代理 + 公网域名 URL ⇒ 放行（不误伤）',
  !p.responseViolation({ response: {
    remoteIPAddress: '127.0.0.1', url: 'https://example.com/' } }));
check('② 环回代理 + 环回 URL ⇒ 仍拒绝',
  !!p.responseViolation({ response: {
    remoteIPAddress: '127.0.0.1', url: 'http://127.0.0.1/admin' } }));
check('② 非环回私网 IP 即使 URL 是公网也拒绝',
  !!p.responseViolation({ response: {
    remoteIPAddress: '10.0.0.5', url: 'https://example.com/' } }));

const patterns = p.blockedUrlPatterns();
check('② 浏览器侧黑名单非空且含关键前缀',
  patterns.length > 50 && patterns.some((x) => x.indexOf('127.') >= 0)
    && patterns.some((x) => x.indexOf('169.254') >= 0),
  patterns.length + ' 条');
}

/* ---------- ③ DNS 注入：真跑 rebinding 的每条分支 ---------- */
async function dnsChecks() {
  const url = 'https://api.example.com/report';
  let refused = false;
  try {
    await p.prepare(url, async () => [{ address: '10.0.0.5', family: 4 }]);
  } catch (e) { refused = e.code === 'network-policy'; }
  check('③ 域名解析到内网 ⇒ 拒绝且不启动浏览器', refused);

  let mixed = false;
  try {
    await p.prepare(url, async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 }
    ]);
  } catch (e) { mixed = e.code === 'network-policy'; }
  check('③ 公网+内网混合解析 ⇒ 也拒绝（不能只看第一条）', mixed);

  let failed = false;
  try {
    await p.prepare(url, async () => { throw new Error('ENOTFOUND'); });
  } catch (e) { failed = e.code === 'network-policy'; }
  check('③ DNS 解析失败 ⇒ 拒绝', failed);

  const ok = await p.prepare(url, async () => [{ address: '93.184.216.34', family: 4 }]);
  check('③ 全公网 ⇒ 生成 host-resolver-rules IP pin',
    ok.pinned === '93.184.216.34'
      && /MAP api\.example\.com 93\.184\.216\.34/.test(ok.chromeArgs[0] || ''),
    ok.chromeArgs[0]);

  const v6 = await p.prepare(url, async () => [
    { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }
  ]);
  check('③ IPv6-only ⇒ 不 pin 且如实标注（诚实降级）',
    v6.pinned === null && v6.chromeArgs.length === 0);
}

/* ---------- ④ 静态接线：防止有人把策略从渲染路径上摘掉 ---------- */
function wiringChecks() {
  const r = fs.readFileSync(RENDERER, 'utf8');
  for (const token of ['Network.enable', 'Network.setBlockedURLs',
    'Network.requestWillBeSent', 'Network.responseReceived',
    'netPolicy.policyError', 'policy.chromeArgs']) {
    check('④ renderer 接线 ' + token, r.indexOf(token) >= 0);
  }
  const c = fs.readFileSync(CLI, 'utf8');
  check('④ CLI 白名单包含 network-policy',
    /'chrome',\s*'network-policy'/.test(c) || /network-policy',/.test(c));
  check('④ CLI 退出码表包含 network-policy', /'network-policy':\s*4/.test(c));
  const d = fs.readFileSync(PDF, 'utf8');
  check('④ exportPdf 把 networkPolicy 传给子进程',
    /networkPolicy:\s*networkPolicy/.test(d));
  check('④ 代理降级会如实回传给调用方',
    /networkPolicyDegraded/.test(r) && /networkPolicyDegraded/.test(c)
      && /networkPolicyDegraded/.test(d));
}

/* ---------- ⑤ 元反向：判据必须能抓到"策略被改坏" ---------- */
function mutationProbe() {
  const src = fs.readFileSync(POLICY, 'utf8');
  const marker = '  if (isPrivateHost(u.hostname)) {\n    return \'指向环回/私网/链路本地地址 \' + u.hostname;\n  }';
  if (src.indexOf(marker) < 0) {
    check('⑤ 变异标记存在', false, '标记漂移 —— 不许静默跳过');
    return;
  }
  const mutantSrc = src.replace(marker, '');
  const m = new Module(POLICY, module);
  m.filename = POLICY;
  m.paths = Module._nodeModulePaths(path.dirname(POLICY));
  let mutant;
  try {
    m._compile(mutantSrc, POLICY);
    mutant = m.exports;
  } catch (e) {
    check('⑤ 变异体可编译', false, String(e.message));
    return;
  }
  check('⑤ 变异体确实放过私网 URL',
    !mutant.violationForUrl('http://127.0.0.1/')
      && !mutant.violationForUrl('http://10.1.2.3/'));
  check('⑤ 原判据仍能抓住这两个（不是恒绿）',
    !!p.violationForUrl('http://127.0.0.1/')
      && !!p.violationForUrl('http://10.1.2.3/'));
}

async function main() {
  console.log('  === 远程网络策略门禁 ===');
  tableChecks();
  wiringChecks();
  await dnsChecks();
  mutationProbe();
  console.log('  => ' + (bad ? bad + ' 条判据未通过' : '全部通过'));
  return bad ? 1 : 0;
}

main().then((rc) => process.exit(rc)).catch((e) => {
  console.error('  [FAIL] 门禁自身抛错：' + (e && e.stack || e));
  process.exit(1);
});
