(function (global) {
'use strict';

var LABELS = {
summaryTitle: function (n) { return '有 ' + n + ' 处需要修正：'; },
success: '已提交。焦点已移到这条提示上 —— 留在提交按钮上的话，按 Enter 会重复提交。',
};

function setLabels(patch) {
if (!patch) return;
if (typeof patch.summaryTitle === 'function') LABELS.summaryTitle = patch.summaryTitle;
if (typeof patch.success === 'string') LABELS.success = patch.success;
}

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

function closest(el, sel) {
while (el && el.nodeType === 1) {
var fn = el.matches || el.msMatchesSelector || el.webkitMatchesSelector;
if (fn && fn.call(el, sel)) return el;
el = el.parentNode;
}
return null;
}

function toArray(x) { return Array.prototype.slice.call(x); }

function checkField(field) {
var input = field.querySelector('.field__input');
var err = field.querySelector('.field__error');
if (!input || !err) return true;
var key = field.getAttribute('data-validate');
var r = RULES[key];

if (!r) { clearField(field, input, err); return true; }
if (r.test(input.value)) { clearField(field, input, err); return true; }
field.setAttribute('data-dirty', '');
input.setAttribute('aria-invalid', 'true');

err.textContent = field.getAttribute('data-validate-msg') || r.msg || '';
return false;
}

function clearField(field, input, err) {
field.removeAttribute('data-dirty');
input.removeAttribute('aria-invalid');
err.textContent = '';
}

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
if (nodes[i].fvInstance) continue;
new FormValidation(nodes[i]);
}
}

if (typeof document === 'undefined') return;
if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', init);
} else {
init();
}
})(typeof window !== 'undefined' ? window : globalThis);
