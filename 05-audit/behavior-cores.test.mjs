/**
 * behavior-cores.test.mjs — 5 个微行为核的单元测试（0.8.7 新增）
 * ============================================================================
 * 🔴 为什么补这个（补的是全库最大的一块质量缺口）
 * ---------------------------------------------------------------------------
 *   5 个行为核共 **551 行**（dismissable 118 / roving 152 / typeahead 124 /
 *   emit 76 / focus-return 81），此前**一条单测都没有**。
 *   浏览器契约门禁覆盖"组件里用得对不对"，但——
 *     · 契约只在 demo 页面上跑 ⇒ **边界分支摸不到**
 *     · 契约**慢**（全量 3 分钟）⇒ 不会频繁跑
 *   ⇒ 核的逻辑正确性只能靠间接推断，这是不可接受的。
 *
 * ⭐ 分工（本文件 vs 浏览器门禁）—— 不要越界下结论
 *   本文件（桩，毫秒级）：核的**逻辑分支**与**边界**
 *   浏览器门禁（慢，真环境）：**真实事件流**、冒泡顺序、stopPropagation、
 *                焦点陷阱、跨浏览器差异
 *   ⚠️ mini-dom.mjs **不冒泡、不支持捕获阶段**
 *      ⇒「Esc 只关最内层」这类**必须**由浏览器门禁证明。
 *        本文件里凡涉及冒泡的断言，一律直接调document 的监听器。
 *
 * ============================================================================
 * ⚠️ 写这个文件时我犯的错（值得记，见 ERRORS E40）
 * ---------------------------------------------------------------------------
 *   第一版**照着想象写**了 API：`flEmitOn()`、`t.key('a')`、`r.key({...})`
 *   —— 真实的 emit 根本没有 `flEmitOn`，typeahead 的方法叫 `type()`、
 *   roving 的是 `step(i, d)`。⇒ 全部是**假失败**。
 *   ⇒ 纪律：**测任何东西之前先读它的真实签名**，
 *     一行 `sed -n '/^var flX/,/^  function/p'` 就能省掉一小时返工。
 * ============================================================================
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { el, bel, makeDoc, loadScript, key } from './mini-dom.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);

/** 在新桩里加载一个核，返回 { ctx, document, window }
 *  🔴 返回的 `el` 是**绑好了 ownerDocument** 的版本 ——
 *     桩里 focus() 必须靠它写document.activeElement，
 *     漏绑会抛「桩没接好」并被被测代码的 try/catch 吞掉。
 */
function loadCore(name) {
  const { document, window } = makeDoc();
  const src = fs.readFileSync(
    path.join(ROOT, '01-tokens', 'behavior', name + '.js'), 'utf8');
  const ctx = loadScript(src, window);
  const bound = (tag) => bel(tag, document);
  return { ctx, document, window, el: bound };
}

/* ==========================================================================
 * 1 · focus-return（81 行）
 *   真实 API：flFocusReturn(opts) → { save, restore, target, clear }
 * ========================================================================== */
test('focus-return · save() 记住当时的 activeElement', () => {
  const { ctx, document } = loadCore('focus-return');
  const E = (t) => bel(t, document);
  const fr = ctx.flFocusReturn();
  const btn = E('button');
  document.activeElement = btn;

  assert.equal(fr.save(), btn, 'save() 返回它记住的元素');
  assert.equal(fr.target(), btn, 'target() 读得回记住了谁');
});

test('focus-return · restore() 把焦点还回去并返回 true', () => {
  const { ctx, document } = loadCore('focus-return');
  const E = (t) => bel(t, document);
  const fr = ctx.flFocusReturn();
  const btn = E('button');
  document.activeElement = btn;
  fr.save();

  document.activeElement = document.body;
  assert.equal(fr.restore(), true, '还原成功返回 true');
  assert.equal(document.activeElement, btn, '焦点必须回到原元素');
});

test('focus-return · 从没 save() 过就 restore() ⇒ 返回 false（不是假还）', () => {
  const { ctx, document } = loadCore('focus-return');
  const E = (t) => bel(t, document);
  const fr = ctx.flFocusReturn();
  assert.equal(fr.restore(), false, '没记过就必须失败');
  assert.equal(document.activeElement, document.body, '焦点不许乱动');
});

/* 🔴 文件头 ②：元素被移除后 focus() 不报错，但焦点不动
      ⇒ 用户以为还回去了，其实掉在 body 上。必须退到 fallback。 */
test('focus-return · 元素已移除 ⇒ 退到 fallback', () => {
  const { ctx, document } = loadCore('focus-return');
  const E = (t) => bel(t, document);
  const gone = E('button');
  const fb = E('button');
  const fr = ctx.flFocusReturn({ fallback: fb });

  document.activeElement = gone;
  fr.save();
  document.activeElement = document.body;

  const real = document.contains;
  document.contains = (n) => (n === gone ? false : real(n));

  assert.equal(fr.restore(), true);
  assert.equal(document.activeElement, fb, '原元素没了必须退到 fallback');
});

test('focus-return · 无 fallback 且元素已移除 ⇒ 返回 false', () => {
  const { ctx, document } = loadCore('focus-return');
  const E = (t) => bel(t, document);
  const gone = E('button');
  const fr = ctx.flFocusReturn();
  document.activeElement = gone;
  fr.save();
  document.activeElement = document.body;

  const real = document.contains;
  document.contains = (n) => (n === gone ? false : real(n));

  assert.equal(fr.restore(), false, '没有退路就如实失败');
  assert.equal(document.activeElement, document.body, '不许乱动焦点');
});

/* 🔴 文件头 ③：restore() 后清空，否则第二次 restore 会把焦点又拽回来。 */
test('focus-return · restore() 后清空 ⇒ 第二次不重复抢焦点', () => {
  const { ctx, document } = loadCore('focus-return');
  const E = (t) => bel(t, document);
  const fr = ctx.flFocusReturn();
  const btn = E('button');
  document.activeElement = btn;
  fr.save();

  assert.equal(fr.restore(), true);
  document.activeElement = document.body;
  assert.equal(fr.restore(), false, '第二次必须失败（已经还过了）');
  assert.equal(document.activeElement, document.body, '不许再抢一次');
});

test('focus-return · clear() 显式清掉记忆', () => {
  const { ctx, document } = loadCore('focus-return');
  const E = (t) => bel(t, document);
  const fr = ctx.flFocusReturn();
  const btn = E('button');
  document.activeElement = btn;
  fr.save();
  fr.clear();

  assert.equal(fr.target(), null, 'clear() 之后 target 为空');
  assert.equal(fr.restore(), false);
});

test('focus-return · activeElement 是 body 时不记（否则等于没记）', () => {
  const { ctx, document } = loadCore('focus-return');
  const E = (t) => bel(t, document);
  const fr = ctx.flFocusReturn();
  document.activeElement = document.body;
  fr.save();
  assert.equal(fr.target(), null, 'body 不该被记住');
});

/* ==========================================================================
 * 2 · emit（76 行）
 *   真实 API：flEmit(el, name, detail) → CustomEvent | null
 *   ⚠️ 没有 flEmitOn —— 它就是**直接 dispatch 一个 CustomEvent**，
 *      监听由调用方自己addEventListener。
 * ========================================================================== */

/** 让 document.createEvent 能造出带 initCustomEvent 的对象 */
function withCreateEvent(doc) {
  doc.createEvent = (type) => ({
    type,
    initCustomEvent(t, bubbles, cancelable, detail) {
      this._t = t;
      this.detail = detail;
      this._bubbles = bubbles;
    },
    get type() { return this._t || type; },
  });
  return doc;
}

test('emit · 返回的事件带 fl- 前缀与 detail', () => {
  const { ctx, document } = loadCore('emit');
  const E = (t) => bel(t, document);
  withCreateEvent(document);
  const root = E('div');

  const ev = ctx.flEmit(root, 'change', { value: 7 });
  assert.ok(ev, '必须返回一个事件对象');
  assert.equal(ev.type, 'fl-change', '未带前缀的自动补 fl-');
  assert.equal(ev.detail.value, 7, 'detail 原样传下去');
});

test('emit · 已经带 fl- 前缀的不重复加', () => {
  const { ctx, document } = loadCore('emit');
  const E = (t) => bel(t, document);
  withCreateEvent(document);
  const ev = ctx.flEmit(E('div'), 'fl-change', {});
  assert.equal(ev.type, 'fl-change', '不能变成 fl-fl-change');
});

test('emit · 元素不可派发时返回 null 而不是抛错', () => {
  const { ctx, document } = loadCore('emit');
  const E = (t) => bel(t, document);
  withCreateEvent(document);
  assert.equal(ctx.flEmit(null, 'change', {}), null);
  assert.equal(ctx.flEmit({}, 'change', {}), null, '没有 dispatchEvent ⇒ null');
});

test('emit · detail 为空时是 null（不塞undefined）', () => {
  const { ctx, document } = loadCore('emit');
  const E = (t) => bel(t, document);
  withCreateEvent(document);
  const ev = ctx.flEmit(E('div'), 'x');
  assert.equal(ev.detail, null);
});

test('emit · 事件标记为冒泡（调用方的监听器在祖先上也要能收到）', () => {
  const { ctx, document } = loadCore('emit');
  const E = (t) => bel(t, document);
  withCreateEvent(document);
  const ev = ctx.flEmit(E('div'), 'x', {});
  assert.equal(ev._bubbles, true, '必须冒泡，否则委托监听收不到');
});

/* ==========================================================================
 * 3 · dismissable（118 行）
 *   真实 API：flDismissable(opts) → { destroy }
 *   opts: { escOn[], inside[], when(), onDismiss(ev, reason) }
 * ========================================================================== */
test('dismissable · Esc 触发 onDismiss 且 reason 是 esc', () => {
  const { ctx, document } = loadCore('dismissable');
  const E = (t) => bel(t, document);
  const box = E('div');
  let reason = null;
  ctx.flDismissable({
    escOn: [box], inside: [box], when: () => true,
    onDismiss: (ev, r) => { reason = r; },
  });
  box.dispatchEvent(key('Escape'));
  assert.equal(reason, 'esc');
});

test('dismissable · when() 为 false 时完全不响应', () => {
  const { ctx, document } = loadCore('dismissable');
  const E = (t) => bel(t, document);
  const box = E('div');
  let n = 0;
  ctx.flDismissable({
    escOn: [box], inside: [box], when: () => false,
    onDismiss: () => { n += 1; },
  });
  box.dispatchEvent(key('Escape'));
  assert.equal(n, 0, '关着的时候不该响应');
});

/* 🔴 文件头：Esc 判定同时看 key 与 keyCode（老 WebView 只有后者）。 */
test('dismissable · Esc 只给 keyCode 也响应', () => {
  const { ctx, document } = loadCore('dismissable');
  const E = (t) => bel(t, document);
  const box = E('div');
  let reason = null;
  ctx.flDismissable({
    escOn: [box], inside: [box], when: () => true,
    onDismiss: (ev, r) => { reason = r; },
  });
  box.dispatchEvent({ type: 'keydown', key: undefined, keyCode: 27 });
  assert.equal(reason, 'esc', '只给 keyCode 也必须认');
});

test('dismissable · Esc 调用了 preventDefault（避免浏览器默认行为）', () => {
  const { ctx, document } = loadCore('dismissable');
  const E = (t) => bel(t, document);
  const box = E('div');
  ctx.flDismissable({
    escOn: [box], inside: [box], when: () => true, onDismiss: () => {},
  });
  const ev = key('Escape');
  box.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true, 'Esc 必须 preventDefault');
});

test('dismissable · Esc 调用了 stopPropagation（只关最内层的前提）', () => {
  const { ctx, document } = loadCore('dismissable');
  const E = (t) => bel(t, document);
  const box = E('div');
  ctx.flDismissable({
    escOn: [box], inside: [box], when: () => true, onDismiss: () => {},
  });
  const ev = key('Escape');
  box.dispatchEvent(ev);
  assert.equal(ev._stopped, true,
    '必须 stopPropagation，否则内层 Esc 会把外层一起关掉');
});

/* 🔴 0.8.8 新增：分级 Esc。onDismiss 返回 false ⇒ 核**不干预**默认行为。*/
test('dismissable · onDismiss 返回 false ⇒ 不 preventDefault（分级 Esc 的钩子）', () => {
  const { ctx, document } = loadCore('dismissable');
  const E = (t) => bel(t, document);
  const box = E('div');
  ctx.flDismissable({
    escOn: [box], inside: [box], when: () => true,
    onDismiss: () => false,          /* 我这次没关 */
  });
  const ev = key('Escape');
  box.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, false,
    '组件说"没关" ⇒ 核不该抢走 preventDefault');
  assert.equal(ev._stopped, false,
    '组件说"没关" ⇒ 不该 stopPropagation（Esc 要能继续传给外层）');
});

test('dismissable · onDismiss 返回 true ⇒ 照旧 preventDefault + stopPropagation', () => {
  const { ctx, document } = loadCore('dismissable');
  const E = (t) => bel(t, document);
  const box = E('div');
  ctx.flDismissable({
    escOn: [box], inside: [box], when: () => true,
    onDismiss: () => true,
  });
  const ev = key('Escape');
  box.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(ev._stopped, true);
});

test('dismissable · onDismiss 无返回值（undefined）⇒ 等同 true（向后兼容）', () => {
  const { ctx, document } = loadCore('dismissable');
  const E = (t) => bel(t, document);
  const box = E('div');
  let n = 0;
  ctx.flDismissable({
    escOn: [box], inside: [box], when: () => true,
    onDismiss: () => { n += 1; },   /* 没有 return */
  });
  const ev = key('Escape');
  box.dispatchEvent(ev);
  assert.equal(n, 1);
  assert.equal(ev.defaultPrevented, true,
    '现有一律 onDismiss（无返回值）的组件行为不能变');
  assert.equal(ev._stopped, true);
});

test('dismissable · 分级 Esc：三级里只有前两级被核接管', () => {
  const { ctx, document } = loadCore('dismissable');
  const E = (t) => bel(t, document);
  const box = E('div');
  const log = [];
  ctx.flDismissable({
    escOn: [box], inside: [box], when: () => true,
    onDismiss: () => {
      log.push('call');
      /* 模拟 combobox：第一级关、第二级清、第三级放弃 */
      return log.length < 3;
    },
  });

  const e1 = key('Escape'); box.dispatchEvent(e1);
  const e2 = key('Escape'); box.dispatchEvent(e2);
  const e3 = key('Escape'); box.dispatchEvent(e3);

  assert.equal(log.length, 3, 'onDismiss 三次都被调用');
  assert.equal(e1.defaultPrevented, true, '第一级：核接管');
  assert.equal(e2.defaultPrevented, true, '第二级：核接管');
  assert.equal(e3.defaultPrevented, false, '第三级：组件放弃 ⇒ 核不干预');
  assert.equal(e3._stopped, false, '第三级不该 stopPropagation');
});

test('dismissable · 其它键不触发', () => {
  const { ctx, document } = loadCore('dismissable');
  const E = (t) => bel(t, document);
  const box = E('div');
  let n = 0;
  ctx.flDismissable({
    escOn: [box], inside: [box], when: () => true,
    onDismiss: () => { n += 1; },
  });
  box.dispatchEvent(key('Enter'));
  box.dispatchEvent(key('a'));
  assert.equal(n, 0);
});

/* 🔴 文件头 ②：外部点击判定必须把触发元素算进 inside，
      否则"点触发器刚打开就被自己那一下点关掉"。 */
test('dismissable · 点 inside 之内（含触发器）不算外部', () => {
  const { ctx, document } = loadCore('dismissable');
  const E = (t) => bel(t, document);
  const trigger = E('button');
  const box = E('div');
  const kid = E('span');
  box._adopt(kid);

  let outside = 0;
  ctx.flDismissable({
    escOn: [trigger], inside: [trigger, box], when: () => true,
    onDismiss: (ev, r) => { if (r === 'outside') outside += 1; },
  });

  document.dispatchEvent({ type: 'click', target: trigger });
  document.dispatchEvent({ type: 'click', target: kid });
  assert.equal(outside, 0, '点触发器与点内部都不算外部');
});

test('dismissable · 点 outside 触发 reason=outside', () => {
  const { ctx, document } = loadCore('dismissable');
  const E = (t) => bel(t, document);
  const box = E('div');
  let reason = null;
  ctx.flDismissable({
    escOn: [box], inside: [box], when: () => true,
    onDismiss: (ev, r) => { reason = r; },
  });
  document.dispatchEvent({ type: 'click', target: E('div') });
  assert.equal(reason, 'outside');
});

test('dismissable · 点 outside 时 Esc 的 preventDefault 不生效（那是键盘专属）', () => {
  const { ctx, document } = loadCore('dismissable');
  const E = (t) => bel(t, document);
  const box = E('div');
  const seen = [];
  ctx.flDismissable({
    escOn: [box], inside: [box], when: () => true,
    onDismiss: (ev, r) => { seen.push(ev.defaultPrevented === true); },
  });
  document.dispatchEvent({ type: 'click', target: E('div') });
  assert.deepEqual(seen, [false], '鼠标点击不该被 preventDefault');
});

/* 🔴 栈：嵌套浮层时"点外部"只关**最上面那个开着的**。
   ⚠️ 栈挂在 window 上（文件头 ③），两个核实例共享同一个栈。 */
test('dismissable · 嵌套时点外部只关最内层', () => {
  const { ctx, document } = loadCore('dismissable');
  const E = (t) => bel(t, document);
  const outer = E('div');
  const inner = E('div');
  const closed = [];

  ctx.flDismissable({
    escOn: [outer], inside: [outer], when: () => true,
    onDismiss: (ev, r) => { closed.push('outer:' + r); },
  });
  ctx.flDismissable({
    escOn: [inner], inside: [inner], when: () => true,
    onDismiss: (ev, r) => { closed.push('inner:' + r); },
  });

  document.dispatchEvent({ type: 'click', target: E('div') });
  assert.deepEqual(closed, ['inner:outside'], '只该关最内层');
});

test('dismissable · 外层已关（when 为false）时点外部落到更外层', () => {
  const { ctx, document } = loadCore('dismissable');
  const E = (t) => bel(t, document);
  const outer = E('div');
  const inner = E('div');
  const closed = [];

  ctx.flDismissable({
    escOn: [outer], inside: [outer], when: () => true,
    onDismiss: (ev, r) => { closed.push('outer:' + r); },
  });
  ctx.flDismissable({
    escOn: [inner], inside: [inner], when: () => false,
    onDismiss: (ev, r) => { closed.push('inner:' + r); },
  });

  document.dispatchEvent({ type: 'click', target: E('div') });
  assert.deepEqual(closed, ['outer:outside'],
    '内层关着时应轮到外层，而不是什么都不做');
});

test('dismissable · destroy 后既不响应 Esc 也不占栈', () => {
  const { ctx, document } = loadCore('dismissable');
  const E = (t) => bel(t, document);
  const box = E('div');
  let n = 0;
  const d = ctx.flDismissable({
    escOn: [box], inside: [box], when: () => true,
    onDismiss: () => { n += 1; },
  });

  box.dispatchEvent(key('Escape'));
  assert.equal(n, 1);

  d.destroy();
  box.dispatchEvent(key('Escape'));
  document.dispatchEvent({ type: 'click', target: E('div') });
  assert.equal(n, 1, 'destroy 之后必须彻底不响应');
});

/* 🔴 0.8.8 补：destroy 必须把自己从**共享栈**里移除。
   起因：combobox 收编时我漏了 dismiss.destroy()，而门禁
   「document 不残留监听」抓不到 —— 因为组件其它监听器也被摘了、
   组件确实不再响应，**只有核的栈里那条记录还留着**（真内存泄漏）。
   ⇒ 这条门禁在**栈的层面**才抓得到。 */
test('dismissable · destroy 后从共享栈里移除（否则闭包泄漏）', () => {
  const { ctx, document, window } = loadCore('dismissable');
  const E = (t) => bel(t, document);
  const box = E('div');
  /* 🔴 shared 是**懒创建**的（首次 flDismissable 才建）⇒ 不能假设它已存在。*/
  const stackLen = () => (window.__flDismiss ? window.__flDismiss.stack.length : 0);

  const before = stackLen();
  const d = ctx.flDismissable({
    escOn: [box], inside: [box], when: () => true, onDismiss: () => {},
  });
  assert.equal(stackLen(), before + 1, '创建时应入栈');

  d.destroy();
  assert.equal(stackLen(), before,
    'destroy 后必须出栈，否则 rec 闭包（连着组件的 root）永远不释放');
});

test('dismissable · destroy 之后 onDocClick 不再回调该实例', () => {
  const { ctx, document, window } = loadCore('dismissable');
  const E = (t) => bel(t, document);
  const box = E('div');
  const other = E('div');
  let n = 0;

  const d = ctx.flDismissable({
    escOn: [box], inside: [box], when: () => true,
    onDismiss: (ev, r) => { if (r === 'outside') n += 1; },
  });
  d.destroy();

  document.dispatchEvent({ type: 'click', target: other });
  assert.equal(n, 0, '已destroy 的实例不该再收到 outside 通知');
});

test('dismissable · 空参数不崩（组件只传一半的情况是真实的）', () => {
  const { ctx, document } = loadCore('dismissable');
  const E = (t) => bel(t, document);
  assert.doesNotThrow(() => ctx.flDismissable({}).destroy());
});

/* ==========================================================================
 * 4 · typeahead（124 行）
 *   真实 API：flTypeahead(opts) → { type, clear, buffer, destroy }
 *   opts: { items(), textOf(), usable(), timeout, onHit }
 * ========================================================================== */
test('typeahead · 输入首字母跳到匹配项（onHit 收到该项）', () => {
  const { ctx, document } = loadCore('typeahead');
  const E = (t) => bel(t, document);
  const items = [
 { textContent: 'Apple' }, { textContent: 'Banana' },
    { textContent: 'Cherry' },
  ];
  const hits = [];
  const t = ctx.flTypeahead({
    items: () => items, onHit: (i, item) => hits.push(item),
  });

  t.type('b');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].textContent, 'Banana');
});

test('typeahead · 连续输入成词后按整词匹配', () => {
  const { ctx, document } = loadCore('typeahead');
  const E = (t) => bel(t, document);
  const items = [
    { textContent: 'Apple' }, { textContent: 'Banana' },
    { textContent: 'Cherry' },
  ];
  const hits = [];
  const t = ctx.flTypeahead({
    items: () => items, onHit: (i, item) => hits.push(item),
  });

  t.type('c'); t.type('h');
  assert.equal(hits[hits.length - 1].textContent, 'Cherry');
});

test('typeahead · 无匹配时不触发 onHit', () => {
  const { ctx, document } = loadCore('typeahead');
  const E = (t) => bel(t, document);
  const items = [{ textContent: 'Apple' }];
  let n = 0;
  const t = ctx.flTypeahead({ items: () => items, onHit: () => { n += 1; } });
  t.type('z');
  assert.equal(n, 0, '没有 z 开头的项，不许乱跳');
});

test('typeahead · usable() 为假的项被跳过', () => {
  const { ctx, document } = loadCore('typeahead');
  const items = [
    { textContent: 'Apple', ok: false },      /* 禁用 */
    { textContent: 'Avocado', ok: true },
  ];
  const hits = [];
  const t = ctx.flTypeahead({
    items: () => items,
    usable: (x) => x.ok !== false,
    onHit: (i, item) => hits.push(item),
  });
  t.type('a');
  assert.equal(hits[0].textContent, 'Avocado', '禁用的 Apple 应被跳过');
});

test('typeahead · 单字符重复会在多个候选间循环', () => {
  const { ctx, document } = loadCore('typeahead');
  const E = (t) => bel(t, document);
  const items = [{ textContent: 'Apple' }, { textContent: 'Avocado' }];
  const hits = [];
  const t = ctx.flTypeahead({
    items: () => items, onHit: (i, item) => hits.push(item.textContent),
  });

  t.type('a'); t.type('a'); t.type('a');
  assert.ok(new Set(hits).size >= 2,
    '连按同一个字母应在候选间循环，实测只命中：' + hits.join(','));
});

test('typeahead · clear() 后缓冲为空', () => {
  const { ctx, document } = loadCore('typeahead');
  const E = (t) => bel(t, document);
  const items = [{ textContent: 'Cherry' }];
  const t = ctx.flTypeahead({ items: () => items, onHit: () => {} });
  t.type('c');
  assert.ok(t.buffer().length > 0, '先确认缓冲里有东西');
  t.clear();
  assert.equal(t.buffer(), '', 'clear() 之后缓冲必须为空');
});

test('typeahead · 非字符输入被忽略（不把 Shift/Ctrl 塞进缓冲）', () => {
  const { ctx, document } = loadCore('typeahead');
  const E = (t) => bel(t, document);
  const items = [{ textContent: 'Apple' }];
  const t = ctx.flTypeahead({ items: () => items, onHit: () => {} });
  t.type('a');
  const before = t.buffer();
  t.type(''); t.type(null); t.type(undefined);
  assert.equal(t.buffer(), before, '空输入不该改变缓冲');
});

/*🔴 实测得出的真实契约：`destroy()` 只停**定时器**，
     `type()` 本身**不受 destroy 影响**（核里没有"已销毁"标志）。
     第一版我写成"destroy 后不再响应"，是照想象写的 ⇒ 失败。
     ⇒ 这条改成把真实语义钉住：
        - destroy 确实让缓冲超时不再触发（clear 不再被调）
        - 但它**不是**"禁用这个核"，想停用得自己设 gate。*/
test('typeahead · destroy 只停定时器，不阻止 type()（真实契约）', () => {
  const { ctx, document } = loadCore('typeahead');
  const items = [{ textContent: 'Apple' }];
  let n = 0;
  const t = ctx.flTypeahead({
    items: () => items, timeout: 5, onHit: () => { n += 1; },
  });

  t.type('a');
  assert.equal(n, 1);
  const bufBefore = t.buffer();
  t.destroy();
  /* 定时器被停 ⇒ 等一会儿缓冲也不该自己清掉（除非 clear 真的跑了） */
  return new Promise((resolve) => setTimeout(() => {
    assert.equal(t.buffer(), bufBefore,
      'destroy 后定时器应已停，缓冲不该在超时后被清空');
    resolve();
  }, 40));
});

test('typeahead · 未 destroy 时超时会清空缓冲', () => {
  const { ctx, document } = loadCore('typeahead');
  const items = [{ textContent: 'Apple' }];
  const t = ctx.flTypeahead({ items: () => items, timeout: 5, onHit: () => {} });
  t.type('a');
  assert.ok(t.buffer().length > 0);
  return new Promise((resolve) => setTimeout(() => {
    assert.equal(t.buffer(), '', '超时后缓冲必须自己清空');
    resolve();
  }, 40));
});

/* ==========================================================================
 * 5 · roving（152 行）
 *   真实 API：flRoving(opts) → { rove, step, indexOf, destroy }
 *   opts: { container, items(), movable(), nodeOf(), axis, loop, homeEnd,
 *           tabindex, onMove }
 * ========================================================================== */
function rovingItems(doc) {
  const mk = (label) => {
    /* 🔴 这里必须用 bel(doc) 而不是测试体内的 E() ——
本函数定义在测试体之外，拿不到 E。 */
    const n = bel('a', doc);
    n.textContent = label;
    n.setAttribute('tabindex', '-1');
    return n;
  };
  return [mk('一'), mk('二'), mk('三')];
}

/* 🔴 rove() 的真实签名是 `rove(target)`，**收元素不是收下标**；
     而且它**只改 tabindex，不触发 onMove**（onMove 由 step / 按键路径调）。
     我第一版写成 `rove(1)` ⇒ 核里 `n === target` 永远不成立 ⇒ 静默无效，
     而测试却「因为没触发 onMove 而失败」——看起来像核坏了，其实是调用方错了。 */
test('roving · rove(元素) 把该项设为唯一可 Tab 到达的项', () => {
  const { ctx, document } = loadCore('roving');
  const items = rovingItems(document);
  const r = ctx.flRoving({
    items: () => items, movable: () => items, nodeOf: (x) => x, onMove: () => {},
  });

  r.rove(items[1]);
  assert.equal(items[1].getAttribute('tabindex'), '0', '该项 tabindex=0');
  assert.equal(items[0].getAttribute('tabindex'), '-1', '其余必须是 -1');
  assert.equal(items[2].getAttribute('tabindex'), '-1', '其余必须是 -1');
});

test('roving · rove 传下标（不是元素）时不误设任何项（契约钉住）', () => {
  const { ctx, document } = loadCore('roving');
  const items = rovingItems(document);
  const r = ctx.flRoving({
    items: () => items, movable: () => items, nodeOf: (x) => x, onMove: () => {},
  });
  /* rove 只认元素：传数字时 `n === target` 恒不成立，谁都不会变成 0。
     写这条是为了钉住该行为 —— 免得将来有人"顺手支持下标"时静默改了语义。 */
  r.rove(2);
  assert.ok(items.every((n) => n.getAttribute('tabindex') === '-1'),
    'rove(数字) 不该意外让某一项变成 0');
});

test('roving · step(i, d) 会循环（loop 默认开）', () => {
  const { ctx, document } = loadCore('roving');
  const E = (t) => bel(t, document);
  const items = rovingItems(document);
  const r = ctx.flRoving({
    items: () => items, movable: () => items, nodeOf: (x) => x, onMove: () => {},
  });
  assert.equal(r.step(0, 1), 1);
  assert.equal(r.step(2, 1), 0, '末尾再往前 ⇒ 回到 0（循环）');
  assert.equal(r.step(0, -1), 2, '开头再往后 ⇒ 到末尾（循环）');
});

test('roving · loop:false 时到头返回 -1（不循环）', () => {
  const { ctx, document } = loadCore('roving');
  const E = (t) => bel(t, document);
  const items = rovingItems(document);
  const r = ctx.flRoving({
    items: () => items, movable: () => items, nodeOf: (x) => x,
    loop: false, onMove: () => {},
  });
  assert.equal(r.step(2, 1), -1, '末尾再往前 ⇒ -1');
  assert.equal(r.step(0, -1), -1, '开头再往后 ⇒ -1');
});

test('roving · 零项时 step 返回 -1（空列表是真实场景：筛选后为空）', () => {
  const { ctx, document } = loadCore('roving');
  const E = (t) => bel(t, document);
  const r = ctx.flRoving({ items: () => [], onMove: () => {} });
  assert.equal(r.step(0, 1), -1);
  assert.doesNotThrow(() => r.rove(0));
});

test('roving · tabindex:false 时不碰 tabindex（④：只步进）', () => {
  const { ctx, document } = loadCore('roving');
  const E = (t) => bel(t, document);
  const items = rovingItems(document);
  const r = ctx.flRoving({
    items: () => items, movable: () => items, nodeOf: (x) => x,
    tabindex: false, onMove: () => {},
  });
  r.rove(1);
  assert.equal(items[1].getAttribute('tabindex'), '-1',
    '声明不要 tabindex 时不该动它');
});

test('roving · indexOf 按 node 反查下标（-1 表示不在集合里）', () => {
  const { ctx, document } = loadCore('roving');
  const E = (t) => bel(t, document);
  const items = rovingItems(document);
  const stranger = E('a');
  const r = ctx.flRoving({
    items: () => items, movable: () => items, nodeOf: (x) => x, onMove: () => {},
  });
  assert.equal(r.indexOf(items[1]), 1);
  assert.equal(r.indexOf(stranger), -1, '不在集合里 ⇒ -1');
});

test('roving · destroy 后 container 上不再监听 keydown', () => {
  const { ctx, document } = loadCore('roving');
  const E = (t) => bel(t, document);
  const items = rovingItems(document);
  const container = E('div');
  items.forEach((n) => container._adopt(n));
  let n = 0;
  const r = ctx.flRoving({
    container, items: () => items, movable: () => items,
    nodeOf: (x) => x, onMove: () => { n += 1; },
  });

  container.dispatchEvent(key('ArrowDown'));
  const before = n;
  r.destroy();
  container.dispatchEvent(key('ArrowDown'));
  assert.equal(n, before, 'destroy 之后不该再响应方向键');
});

/* 🔴 核的 `axis` **默认是 'x'** ⇒ 默认布局下 ArrowDown / ArrowUp **不响应**
     （那是竖向 tablist 才用的，写 `axis: 'y'`）。
     我第一版拿ArrowDown 测默认配置，失败后差点以为核坏了。
     ⇒ 下面两条分别钉住「默认 x 轴」与「显式 y 轴」的真实行为。 */
test('roving · 默认 axis=x：ArrowRight 响应，ArrowDown 不响应', () => {
  const { ctx, document } = loadCore('roving');
  const items = rovingItems(document);
  const container = bel('div', document);
  items.forEach((n) => container._adopt(n));
  const moved = [];
  ctx.flRoving({
    container, items: () => items, movable: () => items, nodeOf: (x) => x,
    onMove: (i, node, reason) => moved.push([i, reason]),
  });

  /* 事件的 target 必须在集合里（核靠它定位当前项） */
  container.dispatchEvent(Object.assign(key('ArrowDown'), { target: items[0] }));
  assert.equal(moved.length, 0, '默认（横排）下 ArrowDown 不该响应');

  container.dispatchEvent(Object.assign(key('ArrowRight'), { target: items[0] }));
  assert.equal(moved.length, 1, '默认（横排）下 ArrowRight 必须响应');
  assert.equal(moved[0][0], 1, '从第 0 项前进到第 1 项');
  assert.equal(moved[0][1], 'step', 'reason 应该是 step');
});

test('roving · axis:y时ArrowDown 响应（竖排）', () => {
  const { ctx, document } = loadCore('roving');
  const items = rovingItems(document);
  const container = bel('div', document);
  items.forEach((n) => container._adopt(n));
  const moved = [];
  ctx.flRoving({
    container, items: () => items, movable: () => items, nodeOf: (x) => x,
    axis: 'y', onMove: (i, node, reason) => moved.push([i, reason]),
  });

  container.dispatchEvent(Object.assign(key('ArrowDown'), { target: items[0] }));
  assert.equal(moved.length, 1, 'axis=y 时 ArrowDown 必须响应');

  container.dispatchEvent(Object.assign(key('ArrowRight'), { target: items[1] }));
  assert.equal(moved.length, 1, 'axis=y 时 ArrowRight 不该响应');
});

test('roving · target 不在集合里 ⇒ 不响应（防止误伤页面其它元素）', () => {
  const { ctx, document } = loadCore('roving');
  const items = rovingItems(document);
  const container = bel('div', document);
  items.forEach((n) => container._adopt(n));
  const moved = [];
  ctx.flRoving({
    container, items: () => items, movable: () => items, nodeOf: (x) => x,
    onMove: (i) => moved.push(i),
  });

  const stranger = bel('input', document);
  container.dispatchEvent(Object.assign(key('ArrowRight'), { target: stranger }));
  assert.equal(moved.length, 0, '不是集合成员的 target 不该触发移动');
});

test('roving · Home / End 经事件路径也能到首尾', () => {
  const { ctx, document } = loadCore('roving');
  const items = rovingItems(document);
  const container = bel('div', document);
  items.forEach((n) => container._adopt(n));
  const moved = [];
  ctx.flRoving({
    container, items: () => items, movable: () => items, nodeOf: (x) => x,
    onMove: (i, node, reason) => moved.push([i, reason]),
  });

  container.dispatchEvent(Object.assign(key('End'), { target: items[0] }));
  assert.deepEqual(moved.pop(), [2, 'end'], 'End ⇒ 最后一项');
  container.dispatchEvent(Object.assign(key('Home'), { target: items[2] }));
  assert.deepEqual(moved.pop(), [0, 'home'], 'Home ⇒ 第一项');
});

/* 🔴 roving 核的 keyCode 双轨判定（0.x 加：老 WebView 不给 e.key）
      —— 与 mini-dom 的 key() 同构：桩同时带 key 与 keyCode，
      这里验证"只给 keyCode 也认得"这条老 WebView 真机路径。 */
test('roving · 只给 keyCode（无 e.key）也响应方向键 / Home / End', () => {
  const { ctx, document } = loadCore('roving');
  const items = rovingItems(document);
  const container = bel('div', document);
  items.forEach((n) => container._adopt(n));
  const moved = [];
  ctx.flRoving({
    container, items: () => items, movable: () => items, nodeOf: (x) => x,
    onMove: (i, node, reason) => moved.push([i, reason]),
  });

  container.dispatchEvent({ type: 'keydown', key: undefined, keyCode: 39, target: items[0] });
  assert.equal(moved.length, 1, 'keyCode 39（→）必须响应');
  container.dispatchEvent({ type: 'keydown', key: undefined, keyCode: 37, target: items[1] });
  assert.equal(moved[moved.length - 1][0], 0, 'keyCode 37（←）必须响应');
  container.dispatchEvent({ type: 'keydown', key: undefined, keyCode: 36, target: items[2] });
  assert.deepEqual(moved[moved.length - 1], [0, 'home'], 'keyCode 36（Home）必须响应');
  container.dispatchEvent({ type: 'keydown', key: undefined, keyCode: 35, target: items[0] });
  assert.deepEqual(moved[moved.length - 1], [2, 'end'], 'keyCode 35（End）必须响应');
});

/* ==========================================================================
 * 6 · combobox × dismissable 的接线（0.x 修「仲裁被截胡」的回归）
 * ---------------------------------------------------------------------------
 *   为什么放在这里：combobox.js 是组件不是核，但被测的是「组件**怎么用**
 *   dismissable 核」—— 共享栈挂在 window 上、外部点击判定挂在 document 上，
 *   只有本文件的 mini-dom 桨能同时提供这两样。
 *
 *   🔴 背景：combobox 曾在 create() 时建一份 `when(){return true}` 的
 *      **常驻**记录。核的 onDocClick 只认「栈里最后一个 when() 为真的
 *      记录」⇒ 这份常驻 no-op 记录把排在**前面**的 select / popover
 *      全部截胡：点外部时轮不到它们，被 combobox 的 close() 吃掉。
 *      修复：Esc 份 outside:false 不进栈（常驻，保三级 Esc）；
 *      外部点击份 open() 时创建、close() 时销毁 —— 关着的 combobox
 *      不再占栈位。
 * ========================================================================== */
function loadCombobox() {
  const { document, window } = makeDoc();
  /* dismissable 核与 combobox 组件载入**同一个 window**：
     共享栈 window.__flDismiss 是跨文件全局，仲裁就发生在它上面。
     ⚠️ 组件把构造器挂到 window 上（global.Combobox），核的顶层 var
        才落在执行上下文里 —— 两者取法不同（见返回值）。 */
  const core = loadScript(fs.readFileSync(
    path.join(ROOT, '01-tokens', 'behavior', 'dismissable.js'), 'utf8'), window);
  loadScript(fs.readFileSync(
    path.join(ROOT, '02-primitives', 'combobox', 'combobox.js'), 'utf8'), window);
  return { core, Combobox: window.Combobox, document, window };
}

/** combobox create() 需要的最小 DOM 桩（mini-dom 没有选择器，槽位写死） */
function mkCombo(document) {
  const input = bel('input', document);
  const list = bel('ul', document);
  const root = bel('div', document);
  input.value = '';
  list.hidden = true;
  root.querySelector = (sel) => (
    sel === '[data-combo-input]' ? input :
    sel === '[data-combo-list]' ? list : null);
  list.querySelectorAll = () => [];
  return { input, list, root };
}

/* 🔴 P1-2 主证：先创建的浮层必须还能被"点外部"关掉。 */
test('combobox · 关着时不占仲裁栈：先创建的浮层点外部仍会被关', () => {
  const { core, Combobox, document, window } = loadCombobox();
  const E = (t) => bel(t, document);
  const selRoot = E('div');
  let selectClosed = 0;
  /* 模拟"先于 combobox 创建"的 select：常驻记录（when 恒真） */
  core.flDismissable({
    escOn: [], inside: [selRoot], when: () => true,
    onDismiss: (ev, r) => { if (r === 'outside') selectClosed += 1; },
  });

  const f = mkCombo(document);
  Combobox.create(f.root);

  assert.equal(window.__flDismiss.stack.length, 1,
    'combobox 创建、列表关着 ⇒ 栈里只该有 select 的记录（常驻记录会凑成 2）');

  document.dispatchEvent({ type: 'click', target: E('div') });
  assert.equal(selectClosed, 1,
    '点外部必须轮到先创建的浮层 —— 旧的常驻 when()=true 记录会截胡');
});

test('combobox · 列表开着才占栈、关了就出栈；重复 open 不重复入栈', () => {
  const { Combobox, document, window } = loadCombobox();
  const E = (t) => bel(t, document);
  const f = mkCombo(document);
  Combobox.create(f.root, { options: [{ value: 'a', label: 'A' }] });

  assert.equal(window.__flDismiss.stack.length, 0, '初始关着 ⇒ 不占栈');
  f.input.dispatchEvent({ type: 'input' });                 /* onInput ⇒ open */
  assert.equal(f.list.hidden, false, 'input 事件 ⇒ 列表打开');
  assert.equal(f.input.getAttribute('aria-expanded'), 'true');
  assert.equal(window.__flDismiss.stack.length, 1, '开着 ⇒ 恰好一条记录');

  /* 开着时点外部：最内层是 combobox ⇒ 关它自己 */
  document.dispatchEvent({ type: 'click', target: E('div') });
  assert.equal(f.list.hidden, true, '点外部关闭');
  assert.equal(f.input.getAttribute('aria-expanded'), 'false');
  assert.equal(window.__flDismiss.stack.length, 0, '关了 ⇒ 记录必须出栈（不泄漏）');

  /* 快速开关 / 重复 open：不重复入栈、不泄漏 */
  f.input.dispatchEvent({ type: 'focus' });
  f.input.dispatchEvent({ type: 'click' });
  assert.equal(window.__flDismiss.stack.length, 1, '重复 open 只能有一条记录');
  document.dispatchEvent({ type: 'click', target: E('div') });
  assert.equal(window.__flDismiss.stack.length, 0);
});

/* 🔴 拆成两份核实例的目的：三级 Esc 必须原样保留（Esc 份常驻、不进栈）。 */
test('combobox · 三级 Esc 在新接线下保持：关列表 → 清输入 → 放弃', () => {
  const { Combobox, document, window } = loadCombobox();
  const f = mkCombo(document);
  Combobox.create(f.root);

  /* ① 列表开着 → Esc 关列表（核接管） */
  f.input.dispatchEvent({ type: 'input' });
  assert.equal(f.list.hidden, false);
  const e1 = key('Escape');
  f.input.dispatchEvent(e1);
  assert.equal(f.list.hidden, true, '一级 Esc：关列表');
  assert.equal(e1.defaultPrevented, true, '一级 Esc：核接管 preventDefault');
  assert.equal(window.__flDismiss.stack.length, 0, '关列表后外部点击记录出栈');

  /* ② 列表关了、输入有字 → Esc 清输入（列表关着 ⇒ 靠常驻的 Esc 份） */
  f.input.value = '未上屏的拼音';
  const e2 = key('Escape');
  f.input.dispatchEvent(e2);
  assert.equal(f.input.value, '', '二级 Esc：清输入');
  assert.equal(e2.defaultPrevented, true);

  /* ③ 都没了 → 放弃（Esc 要继续传给外层浮层） */
  const e3 = key('Escape');
  f.input.dispatchEvent(e3);
  assert.equal(e3.defaultPrevented, false, '三级 Esc：组件说"没关" ⇒ 核不抢默认行为');
});

/* 🔴 P2-8：paintList 重绘即"游标作废"，aria-activedescendant 不许再指旧 id。 */
test('combobox · paintList 必须清掉过期的 aria-activedescendant', () => {
  const { Combobox, document } = loadCombobox();
  const f = mkCombo(document);
  Combobox.create(f.root, { options: [{ value: 'a', label: 'A' }] });

  f.input.setAttribute('aria-activedescendant', 'combo-list-9-o2');
  f.input.dispatchEvent({ type: 'input' });               /* open ⇒ paintList */
  assert.equal(f.input.getAttribute('aria-activedescendant'), null,
    '过滤/重绘后旧 option id 已销毁，不许继续指着它');
});

/* 🔴 P1-5：拼音合成期间按键语义必须全部让路（目标读者就是中文用户）。 */
test('combobox · IME 合成期间按键让路：isComposing / keyCode 229 / composition 事件', () => {
  const { Combobox, document } = loadCombobox();
  const f = mkCombo(document);
  Combobox.create(f.root, { options: [{ value: 'a', label: 'A' }] });

  f.input.dispatchEvent({ type: 'input' });               /* open */
  assert.equal(f.list.hidden, false);

  f.input.dispatchEvent({ type: 'compositionstart' });    /* 合成中 */

  const down = key('ArrowDown');
  f.input.dispatchEvent(down);
  assert.equal(down.defaultPrevented, false, '合成中 ↑↓ 不许劫持（候选会乱跳）');

  const enter = key('Enter');
  f.input.dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, false, '合成中 Enter 不许把半截拼音提交成标签');

  /* 老 WebView 整段合成只报 keyCode=229，连 isComposing 都不给 */
  const legacy = { type: 'keydown', key: undefined, keyCode: 229 };
  f.input.dispatchEvent(legacy);
  assert.equal(legacy.defaultPrevented, false, 'keyCode 229 必须被认作合成中');

  /* 事件自带 isComposing=true（compositionstart 可能被错过时的兜底） */
  const ic = key('Enter');
  ic.isComposing = true;
  f.input.dispatchEvent(ic);
  assert.equal(ic.defaultPrevented, false, 'isComposing=true 也必须让路');

  /* 合成结束 ⇒ 按键语义恢复 */
  f.input.dispatchEvent({ type: 'compositionend' });
  const down2 = key('ArrowDown');
  f.input.dispatchEvent(down2);
  assert.equal(down2.defaultPrevented, true, '合成结束后按键语义恢复正常');
});

test('combobox · 列表开着时 destroy ⇒ 两份 dismissable 都摘净、记录出栈', () => {
  const { Combobox, document, window } = loadCombobox();
  const f = mkCombo(document);
  const inst = Combobox.create(f.root);
  f.input.dispatchEvent({ type: 'input' });
  assert.equal(window.__flDismiss.stack.length, 1, '开着 ⇒ 有一条记录');

  inst.destroy();
  assert.equal(window.__flDismiss.stack.length, 0, 'destroy 后不许残留记录（闭包泄漏）');
  assert.doesNotThrow(() => inst.destroy(), '重复 destroy 必须幂等');
});