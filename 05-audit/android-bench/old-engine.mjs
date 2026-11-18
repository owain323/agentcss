/* 老引擎验证（裸 CDP，兼容 Chrome 69 的旧协议——Playwright connectOverCDP
   会发 Chrome 69 不认识的 Browser.setDownloadBehavior ⇒ 连接被断）。
   判据：页面渲染、零 JS 错误、tooltip 触摸开关（ES5 路径在 2018 年引擎上）。 */
/* MANUAL-ONLY: 老引擎验证需 bench28（API28 镜像自带 Chrome 69）台子，
   由 run-gate 手动触发；裸 CDP（Node 原生 WebSocket）绕过 Playwright
   对旧协议的不兼容（connectOverCDP 发 Chrome 69 不认识的
   Browser.setDownloadBehavior ⇒ 连接被断）。 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
const ANDROID_BENCH_ROOT = process.env.ANDROID_BENCH;
if (!ANDROID_BENCH_ROOT) {
  console.log('  FAIL 请设 ANDROID_BENCH 环境变量（指向台子根目录，内含 sdk/platform-tools/adb.exe）');
  process.exit(2);
}
const ADB = ANDROID_BENCH_ROOT + '/sdk/platform-tools/adb.exe';
const serial = process.env.ANDROID_SERIAL || (() => {
  try {
    const out = execSync('"' + ADB + '" devices').toString();
    const l = out.split(/\r?\n/).filter(x => /\tdevice\s*$/.test(x))[0];
    return l ? l.split('	')[0].trim() : null;
  } catch (e) { return null; }
})();
if (!serial) {
  console.log('  FAIL 没有状态为 device 的设备（adb devices 为空或 adb 不可用）');
  process.exit(2);
}
/* 🔴 转发必须带 -s：多台并存时裸 forward 会报 more than one device，
   留着旧转发的话 CDP 会连到错误的那台（实测连成 Chrome 124）。
   🔴 0.27.17 reverse tcp:8000 自带：页面 URL 是 localhost:8000，
   旧实现只做 forward 不做 reverse，独立跑本脚本时导航必失败
   （响亮红但前置声明不完整）——现在自给自足。 */
execSync('"' + ADB + '" -s ' + serial + ' forward tcp:9222 localabstract:chrome_devtools_remote');
execSync('"' + ADB + '" -s ' + serial + ' reverse tcp:8000 tcp:8000');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const CDP = 'http://127.0.0.1:9222';
const URL_TO_TEST = 'http://localhost:8000/03-patterns/tooltip/demo.html';
const results = [];
const pass = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? '  PASS ' : '  FAIL ') + name + '  ← ' + detail); };

// ① 清掉重复标签页，只留一个并导航到目标 URL
const list0 = await fetch(CDP + '/json/list').then(r => r.json());
const pages0 = list0.filter(t => t.type === 'page');
for (const t of pages0.slice(1)) {
  await fetch(CDP + '/json/close/' + t.id).catch(() => {});
}
const target = pages0[0];
if (!target) { console.log('  FAIL 没有可用的页面目标'); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
let wsClosed = false;
/* 🔴 0.27.17 关闭即醒：旧实现 pending 永不 reject、无 onclose、
   CLOSED 态 ws.send 被静默忽略 ⇒ 标签页关闭/Chrome 崩溃后
   await 永久悬挂，run-gate 跟着挂死。现在 onclose 把所有
   未决请求就地打翻，下一条 evalJs 也直接响亮失败。 */
const failPending = (why) => {
  wsClosed = true;
  for (const [, res] of pending) res({ __cdpError: why });
  pending.clear();
};
ws.onclose = () => failPending('ws 已关闭（Chrome 标签页被关/崩溃）');
const alive = () => {
  if (wsClosed || ws.readyState > 1) throw new Error('CDP 通道已关闭，无法继续');
};
const evalJs = (expr, timeoutMs = 15000) => new Promise((resolve, reject) => {
  try { alive(); } catch (e) { reject(e); return; }
  const id = ++msgId;
  const timer = setTimeout(() => {
    if (pending.has(id)) {
      pending.delete(id);
      reject(new Error('CDP 响应超时（' + timeoutMs + 'ms）：' + expr.slice(0, 60)));
    }
  }, timeoutMs);
  pending.set(id, (result) => { clearTimeout(timer); resolve(result); });
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
});
const touch = async (x, y) => {
  alive();
  const id1 = ++msgId; ws.send(JSON.stringify({ id: id1, method: 'Input.dispatchTouchEvent', params: { type: 'touchStart', touchPoints: [{ x, y }] } }));
  await sleep(60);
  alive();
  const id2 = ++msgId; ws.send(JSON.stringify({ id: id2, method: 'Input.dispatchTouchEvent', params: { type: 'touchEnd', touchPoints: [] } }));
};
const errors = [];
let ready = false;
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(msg.params.exceptionDetails).slice(0, 150));
  /* 🔴 0.27.17 console.error 也算：旧实现只听 exceptionThrown（未捕获异常），
     console.error 不产生该事件 ⇒ "零 JS 错误"名不副实（对照 ai/shot.js
     专门监听 consoleAPICalled 的 error 级）。 */
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push('console.error: ' + JSON.stringify(msg.params.args).slice(0, 150));
  }
};
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws 连接失败')); });
/* 🔴 0.27.18 必须显式启用 Runtime 域：裸 CDP 不发 Runtime.enable，
   exceptionThrown / consoleAPICalled 事件**不会送达**——下方 errors
   永远为空，"零 JS 错误"结构性恒真（0.27.17 加的 console.error 监听
   就挂在这条死通道上）。对照 ai/shot.js:155 一直有 enable。 */
ws.send(JSON.stringify({ id: ++msgId, method: 'Runtime.enable', params: {} }));
await evalJs('1+1');   // 握手
await evalJs('location.href = ' + JSON.stringify(URL_TO_TEST) + '; 1');
for (let i = 0; i < 20; i++) {
  await sleep(300);
  const rs = (await evalJs('document.readyState')).result?.value;
  if (rs === 'complete') break;
}

const ua = (await evalJs('navigator.userAgent')).result?.value || '';
console.log('引擎 UA:', ua);
pass('引擎确认（Chrome 69 时代）', /Chrome\/6[89]/.test(ua), ua.slice(0, 70));
/* 🔴 0.27.19 鉴别力探针（--inject-error）：Runtime.enable 修复的清算——
   在页面上注入一条 console.error，"零 JS 错误"判据必须变红。
   没有这一步，"补了 enable"只是代码看起来对了；enable 之后监听
   真的活着，必须由一次阴性对照证明（质量门神 R2-2）。 */
const INJECT = process.argv.includes('--inject-error');
if (INJECT) {
  await evalJs('console.error("probe: 判红用注入错误"); 1');
  await sleep(300);
}
pass('页面渲染（旧引擎）', (await evalJs('!!document.querySelector(".page .wrap")')).result?.value === true, '');
pass('零 JS 错误', errors.length === 0, errors.join(' | ') || '无');

const rectJson = (await evalJs('JSON.stringify((() => { const r = document.getElementById("b1").getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })())')).result.value;
const rect = JSON.parse(rectJson);
const state = (await evalJs('(() => { const t = document.querySelector("body > .tooltip"); return t ? (t.getAttribute("data-state") || "closed") : "no-element"; })()')).result?.value;
console.log('初始状态:', state);

await touch(rect.x, rect.y); await sleep(300);
const s1 = (await evalJs('(() => { const t = document.querySelector("body > .tooltip"); return t ? (t.getAttribute("data-state") || "closed") : "no-element"; })()')).result?.value;
pass('旧引擎：一次点按开（真触摸）', s1 === 'open', 'data-state=' + s1);
await touch(rect.x, rect.y); await sleep(300);
const s2 = (await evalJs('(() => { const t = document.querySelector("body > .tooltip"); return t ? (t.getAttribute("data-state") || "closed") : "no-element"; })()')).result?.value;
pass('旧引擎：再点关', s2 === 'closed', 'data-state=' + s2);

console.log('---');
console.log('通过 ' + results.filter(r => r.ok).length + '/' + results.length);
mkdirSync(ANDROID_BENCH_ROOT + '/results', { recursive: true });
writeFileSync(`${ANDROID_BENCH_ROOT}/results/old-engine.json`, JSON.stringify({ ua, results }, null, 2));
ws.close();
process.exit(results.every(r => r.ok) ? 0 : 1);
