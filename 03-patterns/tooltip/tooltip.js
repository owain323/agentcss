/**
 * tooltip.js — 文字提示（B3 /
 *
 * ⭐ 三条硬要求：
 *   ① **键盘可达**：focus 时也要出（触屏没有 hover）
 *   ② **Esc 能关**（WCAG 1.4.13 Content on Hover or Focus）
 *   ③ ⛔ **不承载必要信息** —— 触屏没有 hover，只放 tooltip 等于不存在
 *
 * 🔴 触发规则（0.27 审查实测修出，这里只写"为什么"）：
 *   气泡记一个"openBy"（hover / focus / click 谁开的）：
 *   click **只翻转自己开的**（openBy==='click' 才关）——
 *   否则真指针/触屏的第一次点击 = focus 先出 + click 再翻转关，
 *   气泡闪一下就没（实测：第一次点击以关闭收场）。
 *   focus / hover 刚开的那一下 click 只把 openBy 改成 click（钉住）。
 *
 * 无依赖 · ES5 · 用法：
 *   Tooltip.attach(el, '文字')            // 默认 bottom
 *   Tooltip.attach(el, '文字', 'top')     // 指定方位
 *   Tooltip.attach(el, '文字', 'start')   // 内联起点侧（RTL 下自动换到右边）
 *   Tooltip.attach(el, '文字', 'left')    // 物理左（RTL 下**仍是物理左**）
 *   Tooltip.detach(el)                    // 换页/销毁时摘干净（防泄漏）
 *
 * 🔴 0.4.2 修了两个实测出来的既有缺陷（都不报错，只是"看着不对"）：
 *   ① `place='left'|'right'` 拼出的 `tooltip--left` / `--right` **CSS 里没有**
 *      （只有 --inset-inline-start / -end）⇒ 这两个方位**没有小三角**。
 *      ⇒ 现在按书写方向换算类名：物理左在 LTR 是内联起点、RTL 是内联终点。
 *   ② 定位前**先入 DOM 再量**：游离元素 getBoundingClientRect() 全是 0
 *      ⇒ top 方位与锚点完全重叠（实测 tip.top == anchor.top），左右上下偏半身。
 *
 * 🔴 0.27 审查又修了三个（都在 0.27.10 的包上实测复现）：
 *   ① **hover 是死的**：CSS 只写了 `[data-tooltip]:hover + .tooltip`（相邻兄弟），
 *      而 attach() 把气泡挂到 body ⇒ 永远不是兄弟 ⇒ hover 从未生效。
 *      ⇒ 补 mouseenter/mouseleave（pointerenter 老 WebView 没有，不用）；
 *        触屏点按会**合成** mouse 事件 ⇒ touchstart 后 700ms 内的 mouseenter
 *        一律忽略，触屏仍只走 click / focus（不"粘住"）。
 *   ② **第一次点击是关不是开**（见上面"触发规则"）。
 *   ③ **attach 泄漏**：dismissable 记录进了共享 __flDismiss 栈，没人摘
 *      （drawer/popover 都 dm.destroy()，tooltip 没有销毁路径）。
 *      ⇒ 新增 Tooltip.detach(el)；attach 同时幂等（重复挂不双注册）。
 */
(function (global) {

/* ==== BEHAVIOR INJECT BEGIN: focus-return ==== */
var flFocusReturn = function (opts) {
  var opt = opts || {};
  var saved = null;

  return {
    save: function () {
      var a = document.activeElement;
      saved = (a && a !== document.body && a.focus) ? a : null;
      return saved;
    },

    restore: function () {
      var target = saved;
      /* ⚠️ 见文档 ②：不判 contains 的话，元素被移除后 focus() 不报错
         但焦点不动 ⇒ 用户以为还回去了，其实掉在 body 上。 */
      if (!target || !document.contains(target)) target = opt.fallback || null;
      if (!target) { saved = null; return false; }
      try {
        target.focus();
      } catch (e) {
        saved = null;
        return false;
      }
      var ok = document.activeElement === target;
      saved = null;   /* 见文档 ③ */
      return ok;
    },

    target: function () { return saved; },
    clear: function () { saved = null; },
  };
};
/* ==== BEHAVIOR INJECT END: focus-return ==== */
/* ==== BEHAVIOR INJECT BEGIN: dismissable ==== */
var flDismissable = function (opts) {
  var opt = opts || {};
  var escOn = opt.escOn || [];
  var inside = opt.inside || [];
  var outside = opt.outside !== false;
  var when = opt.when || function () { return true; };
  var onDismiss = opt.onDismiss || function () {};

  var shared = window.__flDismiss || (window.__flDismiss = { stack: [], bound: false });

  function isInside(node) {
    if (!node) return false;
    for (var i = 0; i < inside.length; i++) {
      var el = inside[i];
      if (!el || !el.contains) continue;
      if (el === node || el.contains(node)) return true;
    }
    return false;
  }

  function onKey(e) {
    if (!when()) return;
    var k = e.key;
    if (k !== 'Escape' && k !== 'Esc' && e.keyCode !== 27) return;
    /* 先问 onDismiss，它返回 false 就不干预（分级 Esc，见文件头 ⑤） */
    var closed = onDismiss(e, 'esc');
    if (closed === false) return;
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
  }

  function onDocClick(e) {
    var top = null;
    for (var i = shared.stack.length - 1; i >= 0; i--) {
      if (shared.stack[i].when()) { top = shared.stack[i]; break; }
    }
    if (!top || top.isInside(e.target)) return;
    top.onDismiss(e, 'outside');
  }

  var rec = { when: when, isInside: isInside, onDismiss: onDismiss };

  for (var j = 0; j < escOn.length; j++) {
    if (escOn[j]) escOn[j].addEventListener('keydown', onKey);
  }
  /* 只有"点外部要关"的层才进栈：栈是给 onDocClick 挑最内层用的，
     模态层不该被这条规则选中（见文件头 ④）。
     ⚠️ Esc 不依赖栈（它挂在元素上），所以不进栈不影响 Esc。 */
  if (outside) shared.stack.push(rec);
  if (!shared.bound) {
    shared.bound = true;
    document.addEventListener('click', onDocClick, true);
  }

  return {
    destroy: function () {
      for (var j = 0; j < escOn.length; j++) {
        if (escOn[j]) escOn[j].removeEventListener('keydown', onKey);
      }
      var k = shared.stack.indexOf(rec);
      if (k >= 0) shared.stack.splice(k, 1);
    },
  };
};
/* ==== BEHAVIOR INJECT END: dismissable ==== */
  'use strict';

  var uid = 0;

  /* 读屏文案默认值（F2 / 0.26.0）。
     本组件是 `attach(el, text)` 形式、没有逐实例 opts，
     所以文案用**模块级**设置：`Tooltip.setLabels({ region: 'Tooltip' })`。 */
  var LABELS = { region: '组件提示' };

  function setLabels(patch) {
    if (!patch) return;
    for (var k in LABELS) {
      if (Object.prototype.hasOwnProperty.call(LABELS, k)
        && patch[k] !== undefined && patch[k] !== null) {
        LABELS[k] = patch[k];
      }
    }
  }

  /* 触屏点按会合成 mouse 事件（iOS 点按钮也会 fire mouseenter）：
     不挡的话气泡会被"假的 hover"打开并粘住 ⇒ touchstart 后一小段时间里，
     mouseenter 一律当点按的副产物，不给它开气泡的权力。
     挂 document 捕获、模块级一次（共享，不随 attach 增长）。 */
  var TOUCH_WINDOW_MS = 700;
  var lastTouchAt = 0;
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('touchstart', function () {
      lastTouchAt = Date.now();
    }, true);
  }

  function recentTouch() {
    return (Date.now() - lastTouchAt) < TOUCH_WINDOW_MS;
  }

  function ensureLiveRegion() {
    var id = 'tooltip-live';
    var r = document.getElementById(id);
    if (r) return r;
    r = document.createElement('div');
    r.id = id;
    r.setAttribute('role', 'tooltip');
    /* ⭐ aria-live：内容变化时读屏会念出来
       （否则键盘用户看到的提示，盲用户听不到） */
    r.setAttribute('aria-live', 'polite');
    r.setAttribute('aria-atomic', 'true');
    /* 🔴 aria-label（0.8.9 补）：`role="tooltip"` 的元素**必须有可访问名**
       —— 实测 axe 报 serious：
         `aria-tooltip-name: ARIA tooltip nodes must have an accessible name`
       这个 live region 里的文字是**运行时塞进去的提示内容**，
       而在读屏用户"到达"它之前它通常是空的
       ⇒ 光靠内容拿不到名字 ⇒ 必须显式给 aria-label。
       label 用通用措辞，具体内容由 aria-live 负责播报。 */
    r.setAttribute('aria-label', LABELS.region);
    r.style.cssText =
      'position:absolute;width:1px;height:1px;padding:0;margin:-1px;' +
      'overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0';
    document.body.appendChild(r);
    return r;
  }

  /* 逻辑方位 ⇒ 完整类名。CSS 里只有 --inset-inline-start / --inset-inline-end。
     🔴 为什么写整串而不是 `'tooltip--' + CLS[pos]`：拼出来的名字
     在源码里 grep 不到，改 CSS 时无法反查谁在用；覆盖率门禁也只能看到
     一段前缀，于是四个方位长期被记成"只被 README 认领"
     —— 而它们其实每次 hover 都在渲染。 */
  var CLS = {
    top: 'tooltip--top', bottom: 'tooltip--bottom',
    start: 'tooltip--inset-inline-start', end: 'tooltip--inset-inline-end',
  };

  /**
   * 物理方位换算成逻辑方位。
   * 物理「左」在 LTR 里是内联起点，在 RTL 里是内联终点 ——
   * 不换算的话，RTL 下小三角会指向气泡外侧（见 tooltip.css 的注释）。
   * 🔴 inset-inline-start/end 是文档里长期写着的取值，但这里只认
   * start/end ⇒ 静默落到 bottom。现在把别名收进来（映射到同一个类），
   * 文档和行为终于一致，旧调用不用改。
   */
  function resolve(el, place) {
    var p = place || 'bottom';
    if (p === 'inset-inline-start') p = 'start';
    else if (p === 'inset-inline-end') p = 'end';
    if (p === 'top' || p === 'bottom' || p === 'start' || p === 'end') return p;
    if (p !== 'left' && p !== 'right') return 'bottom';
    var rtl = getComputedStyle(el).direction === 'rtl';
    if (p === 'left') return rtl ? 'end' : 'start';
    return rtl ? 'start' : 'end';
  }

  /**
   * 给元素挂一个 tooltip
   * @param {Element} el 触发元素
   * @param {string} text 提示文字
   * @param {string} [place] top / bottom / start / end（默认 bottom）；
   *                 left / right 也接受（物理方位，RTL 下按方向换算类名）；
   *                 inset-inline-start / -end 作为 start / end 的别名
   */
  function attach(el, text, place) {
    if (!el || !text) return;
    /* 幂等守卫：同一元素重复 attach 不再双注册（监听会翻倍、
       dismissable 栈记录会一条条攒成泄漏）。与 upload/tabs 的
       xxxInstance 是同一套约定。 */
    if (el.tooltipInstance) {
      /* 🔴 live region 可能被**外部**摘走（使用者清 body、框架重建都会）：
         实例手里攥着的是游离节点 ⇒ 念不出声且无报错。重 attach 是使用者的
         合理修复动作 —— 守卫只拦"重复注册"，不拦"重建播报通道"。 */
      el.tooltipInstance.reensureLive();
      return;
    }

    /* 焦点归位核：在 show() 之前声明，避免读代码时误以为fr 还没定义。
       声明写在 attach 开头 ⇒ show()/hide() 用到时它一定已赋值。 */
    var fr = flFocusReturn({ fallback: el });

    var pos = resolve(el, place);
    var id = 'tt' + (++uid);
    var tip = document.createElement('div');
    tip.id = id;
    tip.className = 'tooltip ' + CLS[pos];
    tip.setAttribute('role', 'tooltip');
    tip.textContent = text;

    var live = ensureLiveRegion();

    /* 🔴 live region 被“外部摘除”后的重建口（幂等 attach 路径调用）。
       ensureLiveRegion 自带"在 DOM 里就复用"判断，重复调用安全。 */
    function reensureLive() { live = ensureLiveRegion(); }

    /* 气泡"为什么开着"：hover / focus / click / null。
       click 只翻转 openBy==='click' 的（文件头"触发规则"）。 */
    var openBy = null;

    function show(reason) {
      openBy = reason || 'focus';
      /* 🔴 打开的**这一刻**先记住焦点，关闭时才能还回去。
         必须在任何可能改变焦点的操作**之前**做（否则记到的是新元素）。 */
      fr.save();
      /* 🔴 定位前**必须先入 DOM**：游离元素的 getBoundingClientRect() 全是 0
         （实测：top 方位的气泡与锚点完全重叠，就是这么来的）。
         先挂上去、藏起来量，量完再显示。 */
      tip.style.visibility = 'hidden';
      tip.style.display = 'block';
      if (!tip.parentNode) document.body.appendChild(tip);

      var b = el.getBoundingClientRect();
      var t = tip.getBoundingClientRect();
      if (pos === 'top') {
        tip.style.top = (b.top - t.height) + window.pageYOffset + 'px';
        tip.style.left = (b.left + b.width / 2 - t.width / 2) + window.pageXOffset + 'px';
      } else if (pos === 'start' || pos === 'end') {
        var rtl = getComputedStyle(el).direction === 'rtl';
        /* start = 气泡在锚点的内联起点侧：LTR 靠左（右缘贴锚点左缘），
           RTL 靠右（左缘贴锚点右缘） */
        var x = (pos === 'start')
          ? (rtl ? b.right : b.left - t.width)
          : (rtl ? b.left - t.width : b.right);
        tip.style.left = x + window.pageXOffset + 'px';
        tip.style.top = (b.top + b.height / 2 - t.height / 2) + window.pageYOffset + 'px';
      } else {
        tip.style.top = (b.bottom + window.pageYOffset) + 'px';
        tip.style.left = (b.left + b.width / 2 - t.width / 2) + window.pageXOffset + 'px';
      }
      tip.style.visibility = '';       /* 交还给 CSS（data-state 控制显隐） */
      tip.setAttribute('data-state', 'open');
      live.textContent = text;
    }

    function hide() {
      openBy = null;
      tip.removeAttribute('data-state');
      live.textContent = '';
    }

    /* ① 键盘可达：focus 也出。重复 focus（点按、编程式）重定位无害，
       只是把 openBy 升级成 focus —— blur 接管关闭。 */
    function onFocus() { show('focus'); }
    function onBlur() { hide(); }

    /* ② 悬停（0.27 审查补，见文件头 ①）：attach() 的气泡挂在 body，
       CSS 的相邻兄弟 hover 规则打不中 ⇒ hover 必须由 JS 驱动。
       手写兄弟结构的那条 CSS 路径不受影响，照旧生效。 */
    function onMouseEnter() {
      if (recentTouch()) return;           /* 触屏合成事件，不给开 */
      if (openBy === 'hover') return;
      show('hover');                       /* focus/click 开着就不动它 */
    }
    function onMouseLeave() {
      /* 只关"hover 自己开的"；click 钉住的、focus 持有的各自负责关 */
      if (openBy === 'hover') hide();
    }

    /* ③ 触屏唯一入口 + 指针显式操作（文件头"触发规则"）：
       第一次点击必是开，第二次才是关；Esc / 点外部 / blur 也都能关。 */
    function onClick(e) {
      e.stopPropagation();
      if (openBy === 'click') { hide(); return; }
      if (openBy) { openBy = 'click'; return; }   /* focus/hover 刚开的，改归 click，不翻转 */
      show('click');
    }

    el.addEventListener('focus', onFocus);
    el.addEventListener('blur', onBlur);
    el.addEventListener('mouseenter', onMouseEnter);
    el.addEventListener('mouseleave', onMouseLeave);
    el.addEventListener('click', onClick);

    /* ④ Esc 能关（WCAG 1.4.13）+ 点击外部关闭 —— 走 dismissable 核
      （0.8.6 收编，原先手写 `document.addEventListener('click', hide)`
      在冒泡阶段判定，点浮层内部也会关掉）。Esc 关闭后的焦点归位
      走 focus-return 核。⚠️ destroy 时 dismiss.destroy() 必须一起调：
      只摘监听不摘栈记录的话，__flDismiss 栈只增不减（实测泄漏）。 */
    var dismiss = flDismissable({
      escOn: [el],
      inside: [el, tip],
      when: function () { return openBy !== null; },
      onDismiss: function (ev, reason) {
        hide();
        /* 有"存进去的焦点"才还（focus 路径）；hover/click 开的没有存档，
           Esc 不该凭空把焦点搬到触发元素上 */
        if (reason === 'esc' && fr.target()) fr.restore();
      }
    });

    /* ⑤ 关联：aria-describedby（不是 aria-label ——
       label 是名字，describedby 是补充说明，语义不同）。
       记住挂之前的值：detach 时原样还回去，不吞掉页面上已有的描述。 */
    var prevDescribed = el.getAttribute('aria-describedby');
    el.setAttribute('aria-describedby', prevDescribed ? (prevDescribed + ' ' + id) : id);
    var hadDataTooltip = el.hasAttribute('data-tooltip');
    el.setAttribute('data-tooltip', text);

    /* 销毁路径：detach() 的全部依据。谁挂的监听、栈记录、
       aria 关联、气泡节点，挂了什么摘什么。 */
    function destroy() {
      el.removeEventListener('focus', onFocus);
      el.removeEventListener('blur', onBlur);
      el.removeEventListener('mouseenter', onMouseEnter);
      el.removeEventListener('mouseleave', onMouseLeave);
      el.removeEventListener('click', onClick);
      dismiss.destroy();
      if (prevDescribed) el.setAttribute('aria-describedby', prevDescribed);
      else el.removeAttribute('aria-describedby');
      if (!hadDataTooltip) el.removeAttribute('data-tooltip');
      if (tip.parentNode) tip.parentNode.removeChild(tip);
      if (live.textContent === text) live.textContent = '';
      openBy = null;
    }

    el.tooltipInstance = { el: el, tip: tip, text: text, destroy: destroy, reensureLive: reensureLive };
  }

  /**
   * 摘掉 attach() 挂上的监听、dismissable 记录与气泡节点。
   * SPA 换页 / 动态销毁元素时必须调用，否则 __flDismiss 栈只增不减。
   * @param {Element} el 之前传给 attach 的同一个元素
   */
  function detach(el) {
    if (!el || !el.tooltipInstance) return;
    var inst = el.tooltipInstance;
    if (inst && inst.destroy) inst.destroy();
    try {
      delete el.tooltipInstance;
    } catch (e) {
      el.tooltipInstance = null;   /* 老 IE 删宿主属性会抛 ⇒ 退化为置空 */
    }
  }

  global.Tooltip = { attach: attach, detach: detach, setLabels: setLabels };
})(typeof window !== 'undefined' ? window : globalThis);
