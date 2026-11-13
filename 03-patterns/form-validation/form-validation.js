/*
 * form-validation.js — 表单校验行为层（正式发布，此前只活在 demo 里）
 *
 * 依据：form-validation.css 头部「校验时机」一节（本文件就是它的执行者）。
 * ============================================================================
 * ⭐ 三层时机（CSS 头部的契约，这里逐条落实）：
 *     a) blur          字段失焦时校验一次（用户已输完一段）
 *     b) input         只有"脏"过的字段才实时校验（未 blur 过的不打扰）
 *     c) submit        全量校验 + 错误汇总（role=alert，焦点移入汇总）
 *
 * 🔴 为什么 2026-11 才把它发布成文件：CSS 头部宣称"本组件负责校验时机/汇总/焦点"，
 *    但行为脚本只写在 demo.html 里 —— 每个使用者要抄 40 行 demo 代码。
 *    nav.js 头部亲自谴责过这种"教程式交付"。
 *
 * 用法（DOM 契约，与 demo 一致）：
 *   <form data-validate-form>
 *     <div class="field" data-validate="required" data-name="公司名称">
 *       <input class="field__input" id="c">
 *       <span class="field__error" role="alert"></span>
 *     </div>
 *     <div data-summary-slot></div>
 *   </form>
 *   规则注册：FormValidation.rule('money', fn, msg)；内置 required / optional。
 *   字段可带 data-validate-msg 覆盖规则默认文案。
 *
 * 无依赖 · ES5 · 自动初始化 [data-validate-form]（幂等）
 */
(function (global) {
  'use strict';

  /* 汇总/成功文案。模块级可覆盖（本组件是 init(form) 形式，无逐实例 opts）。 */
  var LABELS = {
    summaryTitle: function (n) { return '有 ' + n + ' 处需要修正：'; },
    success: '已提交。焦点已移到这条提示上 —— 留在提交按钮上的话，按 Enter 会重复提交。',
  };

  function setLabels(patch) {
    if (!patch) return;
    if (typeof patch.summaryTitle === 'function') LABELS.summaryTitle = patch.summaryTitle;
    if (typeof patch.success === 'string') LABELS.success = patch.success;
  }

  /* ---------- 规则注册表。业务规则属于页面，不属于库 ----------
     内置三个与 demo 完全一致：required / money（示例规则，可覆盖）/ optional。 */
  var RULES = {
    required: {
      test: function (v) { return v.trim().length > 0; },
      msg: '请填写本字段',
    },
    money: {
      test: function (v) { return /^\d+(\.\d{1,2})?$/.test(v.trim()); },
      msg: '金额最多两位小数，例如 12.34',
    },
    optional: { test: function () { return true; }, msg: '' },
  };

  function rule(name, test, msg) {
    if (!name || typeof test !== 'function') return false;
    RULES[name] = { test: test, msg: msg || '' };
    return true;
  }

  /* ES5 兜底的 closest（老 WebView 没有 Element.closest，直接调会抛） */
  function closest(el, sel) {
    while (el && el.nodeType === 1) {
      var fn = el.matches || el.msMatchesSelector || el.webkitMatchesSelector;
      if (fn && fn.call(el, sel)) return el;
      el = el.parentNode;
    }
    return null;
  }

  function toArray(x) { return Array.prototype.slice.call(x); }

  /* ---------- 单字段校验：data-dirty / aria-invalid / .field__error 三处同步 */
  function checkField(field) {
    var input = field.querySelector('.field__input');
    var err = field.querySelector('.field__error');
    if (!input || !err) return true;
    var key = field.getAttribute('data-validate');
    var r = RULES[key];
    /* 未登记规则的字段视为通过 —— CSS 不显示它的错误行，不该静默挡提交 */
    if (!r) { clearField(field, input, err); return true; }
    if (r.test(input.value)) { clearField(field, input, err); return true; }
    field.setAttribute('data-dirty', '');
    input.setAttribute('aria-invalid', 'true');
    /* 优先字段上的 data-validate-msg，其次规则默认文案 */
    err.textContent = field.getAttribute('data-validate-msg') || r.msg || '';
    return false;
  }

  function clearField(field, input, err) {
    field.removeAttribute('data-dirty');
    input.removeAttribute('aria-invalid');
    err.textContent = '';
  }

  /* ---------- 汇总条：DOM API 构建，不碰 innerHTML（见 SECURITY.md 的 sink 台账） */
  function buildSummary(form, slot, bad, labels) {
    while (slot.firstChild) slot.removeChild(slot.firstChild);
    if (!bad.length) return null;
    var box = document.createElement('div');
    box.className = 'form__summary';
    box.setAttribute('role', 'alert');
    box.setAttribute('tabindex', '-1');
    var title = document.createElement('span');
    title.className = 'form__summary-title';
    title.textContent = labels.summaryTitle(bad.length);
    box.appendChild(title);
    toArray(bad).forEach(function (f) {
      var input = f.querySelector('.field__input');
      if (!input || !input.id) return;
      var a = document.createElement('a');
      a.className = 'form__summary-link';
      a.href = '#' + input.id;
      a.textContent = f.getAttribute('data-name') || input.id;
      box.appendChild(a);
    });
    slot.appendChild(box);
    return box;
  }

  function clearSummary(form, slot) {
    form.classList.remove('form--has-summary');
    if (slot) while (slot.firstChild) slot.removeChild(slot.firstChild);
  }

  /* ---------- 一个表单 = 一个实例。同一 form 只允许一份监听 ---------- */
  function FormValidation(form, opts) {
    if (form && form.fvInstance) return form.fvInstance;
    this.form = form;
    this.labels = {};
    var k;
    for (k in LABELS) {
      if (Object.prototype.hasOwnProperty.call(LABELS, k)) this.labels[k] = LABELS[k];
    }
    if (opts && opts.labels) {
      if (typeof opts.labels.summaryTitle === 'function') {
        this.labels.summaryTitle = opts.labels.summaryTitle;
      }
      if (typeof opts.labels.success === 'string') this.labels.success = opts.labels.success;
    }
    this.slot = form.querySelector('[data-summary-slot]') ||
                form.querySelector('#summary-slot');
    this.fields = toArray(form.querySelectorAll('.field'));
    this.bind();
    form.fvInstance = this;
  }

  FormValidation.prototype.check = function (field) {
    return checkField(field);
  };

  FormValidation.prototype.checkAll = function () {
    var self = this;
    var bad = [];
    this.fields.forEach(function (f) {
      if (!self.check(f)) bad.push(f);
    });
    return bad;
  };

  FormValidation.prototype.clear = function () {
    var self = this;
    clearSummary(this.form, this.slot);
    this.fields.forEach(function (f) {
      var input = f.querySelector('.field__input');
      var err = f.querySelector('.field__error');
      if (input && err) clearField(f, input, err);
    });
  };

  FormValidation.prototype.bind = function () {
    var self = this;
    var form = this.form;

    this.fields.forEach(function (field) {
      var input = field.querySelector('.field__input');
      if (!input) return;
      input.addEventListener('blur', function () { self.check(field); });
      /* 只有"脏"过的字段才实时校验 —— 未 blur 过的不打扰（CSS 头部时机 b） */
      input.addEventListener('input', function () {
        if (field.hasAttribute('data-dirty')) self.check(field);
      });
    });

    form.addEventListener('submit', function (e) {
      var bad = self.checkAll();
      if (bad.length) {
        if (e.preventDefault) e.preventDefault();
        form.classList.add('form--has-summary');
        if (self.slot) {
          var box = buildSummary(form, self.slot, bad, self.labels);
          if (box) box.focus();
        }
        return;
      }
      /* 提交成功也必须清 data-dirty：空 .field__error 带着属性时，
         CSS 的错误行样式（圆点图标）会露出来（demo 实测踩过）。 */
      clearSummary(form, self.slot);
      self.fields.forEach(function (f) {
        var input = f.querySelector('.field__input');
        var err = f.querySelector('.field__error');
        if (input && err) clearField(f, input, err);
      });
      if (self.slot) {
        var ok = document.createElement('div');
        ok.className = 'form__notice';
        ok.setAttribute('role', 'alert');
        ok.setAttribute('tabindex', '-1');
        ok.textContent = self.labels.success;
        while (self.slot.firstChild) self.slot.removeChild(self.slot.firstChild);
        self.slot.appendChild(ok);
        ok.focus();
      }
    });

    form.addEventListener('reset', function () {
      self.clear();
    });

    /* 汇总链接跳转后聚焦对应输入框（浏览器只滚动，不会聚焦）。
       挂在 form 上而不是 document —— 多表单同页互不干扰。 */
    form.addEventListener('click', function (e) {
      var a = closest(e.target, '.form__summary-link');
      if (!a || !form.contains(a)) return;
      if (e.preventDefault) e.preventDefault();
      var t = document.querySelector(a.getAttribute('href'));
      if (t && t.focus) t.focus();
    });
  };

  global.FormValidation = {
    init: function (form, opts) { return new FormValidation(form, opts); },
    rule: rule,
    setLabels: setLabels,
  };

  function init() {
    var nodes = document.querySelectorAll('[data-validate-form]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].fvInstance) continue;   /* 幂等：SPA / HMR / 重复引入 */
      new FormValidation(nodes[i]);
    }
  }

  // @autoinit: [data-validate-form] —— 自动初始化；与 API.md「自动初始化」表由 autoinit-gate 双向校验
  if (typeof document === 'undefined') return;   /* SSR / Node 里 import 不初始化 */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
