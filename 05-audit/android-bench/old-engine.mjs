/* MANUAL-ONLY: 老引擎验证需 bench28（API28 + Chrome 69）台子，由 run-gate 手动触发
 * 老引擎验证（裸 CDP，兼容 Chrome 69 的旧协议——Playwright connectOverCDP
   会发 Chrome 69 不认识的 Browser.setDownloadBehavior ⇒ 连接被断）。
   判据：页面渲染、零 JS 错误、tooltip 触摸开关（ES5 路径在 2018 年引擎上）。 */
import { writeFileSync } from 'node:fs';
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
const evalJs = (expr) => new Promise((resolve) => {
  const id = ++msgId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
});
const touch = async (x, y) => {
  const id1 = ++msgId; ws.send(JSON.stringify({ id: id1, method: 'Input.dispatchTouchEvent', params: { type: 'touchStart', touchPoints: [{ x, y }] } }));
  await sleep(60);
  const id2 = ++msgId; ws.send(JSON.stringify({ id: id2, method: 'Input.dispatchTouchEvent', params: { type: 'touchEnd', touchPoints: [] } }));
};
const errors = [];
let ready = false;
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(msg.params.exceptionDetails).slice(0, 150));
};
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws 连接失败')); });
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
writeFileSync(`${ANDROID_BENCH_ROOT}/results/old-engine.json`, JSON.stringify({ ua, results }, null, 2));
ws.close();
process.exit(results.every(r => r.ok) ? 0 : 1);
