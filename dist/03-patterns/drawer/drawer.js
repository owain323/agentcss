(function (global) {
'use strict';

var flEmit = function (el, name, detail) {
if (!el || !el.dispatchEvent) return null;
var type = name.indexOf('fl-') === 0 ? name : 'fl-' + name;
var ev = null;

if (typeof window.CustomEvent === 'function') {
try {
ev = new window.CustomEvent(type, {
detail: detail || null, bubbles: true, cancelable: false
});
} catch (e) { ev = null; }
}
if (!ev) {
try {
ev = document.createEvent('CustomEvent');
ev.initCustomEvent(type, true, false, detail || null);
} catch (e2) { return null; }
}
el.dispatchEvent(ev);
return ev;
};

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

if (!target || !document.contains(target)) target = opt.fallback || null;
if (!target) { saved = null; return false; }
try {
target.focus();
} catch (e) {
saved = null;
return false;
}
var ok = document.activeElement === target;
saved = null;
return ok;
},

target: function () { return saved; },
clear: function () { saved = null; },
};
};

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

var FOCUSABLE = [
'a[href]',
'button:not([disabled])',
'input:not([disabled]):not([type="hidden"])',
'select:not([disabled])',
'textarea:not([disabled])',
'[tabindex]:not([tabindex="-1"])',
].join(',');

var drawerUid = 0;

var BTN_VARIANT = {
primary: 'btn--primary', danger: 'btn--danger',
ghost: 'btn--ghost', secondary: 'btn--secondary',
};

var warnedVariant = {};
function btnClassOf(v) {
var cls = BTN_VARIANT[v];
if (!cls && v != null && v !== '' && !warnedVariant[v]) {
warnedVariant[v] = 1;
if (typeof console !== 'undefined' && console.warn) {
console.warn('drawer：未知的动作按钮 variant "' + v +
'"（退回无修饰的 .btn；可用值：primary/danger/ghost/secondary）');
}
}
return 'btn' + (cls ? ' ' + cls : '');
}
var lockCount = 0, savedScroll = 0;

var sbwChanged = false, sbwSaved = '';

function lockScroll() {
if (lockCount === 0) {
savedScroll = window.pageYOffset || 0;

var sbw = window.innerWidth - document.documentElement.clientWidth;
if (sbw > 0) {
var cur = parseFloat(getComputedStyle(document.body).paddingRight) || 0;
sbwSaved = document.body.style.paddingRight;
document.body.style.paddingRight = (cur + sbw) + 'px';
sbwChanged = true;
}
document.body.style.overflow = 'hidden';
}
lockCount++;
}
function unlockScroll() {
lockCount = Math.max(0, lockCount - 1);
if (lockCount === 0) {
document.body.style.overflow = '';

if (sbwChanged) {
document.body.style.paddingRight = sbwSaved;
sbwChanged = false;
sbwSaved = '';
}
window.scrollTo(0, savedScroll);
}
}

var bgRefs = [];

function bgAcquire(node) {
for (var i = 0; i < bgRefs.length; i++) {
if (bgRefs[i].node === node) { bgRefs[i].count++; return; }
}

bgRefs.push({
node: node, count: 1,
prevInert: node.inert === true,
prevAria: node.getAttribute('aria-hidden')
});
node.inert = true;
node.setAttribute('aria-hidden', 'true');
}

function bgRelease(node) {
for (var i = 0; i < bgRefs.length; i++) {
if (bgRefs[i].node !== node) continue;
var rec = bgRefs[i];
rec.count--;
if (rec.count <= 0) {
node.inert = rec.prevInert === true;
if (rec.prevAria === null) node.removeAttribute('aria-hidden');
else node.setAttribute('aria-hidden', rec.prevAria);
bgRefs.splice(i, 1);
}
return;
}
}

function setBackgroundInert(on, bucket, ownHost) {
if (on) {
var got = [];

Array.prototype.forEach.call(document.body.children, function (n) {
if (n === ownHost) return;
if (n.tagName === 'SCRIPT' || n.tagName === 'STYLE') return;
bgAcquire(n);
got.push(n);
});
return got;
}
(bucket || []).forEach(function (n) { bgRelease(n); });
return [];
}

var PLACE_CLASS = {
right:  'drawer--right', end:   'drawer--right',
left:   'drawer--left',  start: 'drawer--left',
top:    'drawer--top',
bottom: 'drawer--bottom'
};

var SANITIZER = null;

function setSanitizer(fn) {
SANITIZER = (typeof fn === 'function') ? fn : null;
}

function sanitizeHtml(html, perCall) {
var fn = (typeof perCall === 'function') ? perCall : SANITIZER;
return fn ? String(fn(String(html))) : String(html);
}

var DEFAULT_LABELS = { dialog: '抽屉', close: '关闭' };

var flLabels = function (defaults, src) {
src = src || {};
var out = {};
var k;
for (k in defaults) {
if (Object.prototype.hasOwnProperty.call(defaults, k)) {
out[k] = (src[k] === undefined || src[k] === null) ? defaults[k] : src[k];
}
}
return out;
};

function open(opt) {
opt = opt || {};
var L = flLabels(DEFAULT_LABELS, opt && opt.labels);
var place = opt.place || 'right';
var placeCls = PLACE_CLASS[place];
if (!placeCls) placeCls = PLACE_CLASS.right;

var fr = flFocusReturn({});
fr.save();

var host = document.createElement('div');
host.className = 'drawer-backdrop';
host.setAttribute('data-drawer-host', '');
if (opt.label) host.setAttribute('aria-label', opt.label);

var bgNodes = [];

var d = document.createElement('aside');
d.className = 'drawer ' + placeCls;
d.setAttribute('role', 'dialog');
d.setAttribute('aria-modal', 'true');

if (!d.id) d.id = 'drawer-' + (++drawerUid);
if (opt.title) d.setAttribute('aria-labelledby', d.id + '-title');
else d.setAttribute('aria-label', opt.label || L.dialog);
d.tabIndex = -1;

var head = document.createElement('div');
head.className = 'drawer__head';
var h = document.createElement('h2');
h.className = 'drawer__title';
h.id = d.id + '-title';
h.textContent = opt.title || '';
var closeBtn = document.createElement('button');
closeBtn.className = 'drawer__close';
closeBtn.type = 'button';
closeBtn.setAttribute('aria-label', L.close);
closeBtn.textContent = '\u00D7';
head.appendChild(h);
head.appendChild(closeBtn);

var body = document.createElement('div');
body.className = 'drawer__body';
if (typeof opt.content === 'string') {

body.innerHTML = sanitizeHtml(opt.content, opt.sanitize);
}
else if (opt.content) body.appendChild(opt.content);

d.appendChild(head);
d.appendChild(body);

if (opt.actions && opt.actions.length) {
var foot = document.createElement('div');
foot.className = 'drawer__foot';
opt.actions.forEach(function (a) {
var b = document.createElement('button');
b.type = 'button';

b.className = btnClassOf(a.variant);
b.textContent = a.label;
b.addEventListener('click', function () {
if (a.onClick) a.onClick(close);
if (a.keepOpen !== true) close();
});
foot.appendChild(b);
});
d.appendChild(foot);
}

host.appendChild(d);
document.body.appendChild(host);

bgNodes = setBackgroundInert(true, null, host);
lockScroll();

var f = d.querySelectorAll(FOCUSABLE);
var landed = false;
if (opt.initialFocus) {
var t = d.querySelector(opt.initialFocus);
if (t) {
try { t.focus(); } catch (e) {  }
landed = document.activeElement === t;
}
}
if (!landed) {
var first = null;
for (var fi = 0; fi < f.length; fi++) {
if (f[fi].offsetParent === null) continue;
first = f[fi];
break;
}
(first || d).focus();
}

var dm = flDismissable({
escOn: [d],
inside: [d],
when: function () { return !closed; },
onDismiss: function () { close(); },
});

function onKey(e) {
if (e.key !== 'Tab') return;

var list = [].slice.call(d.querySelectorAll(FOCUSABLE))
.filter(function (x) { return x.offsetParent !== null; });
if (!list.length) { e.preventDefault(); d.focus(); return; }
var first = list[0], last = list[list.length - 1];
if (e.shiftKey && (document.activeElement === first || document.activeElement === d)) {
e.preventDefault(); last.focus();
} else if (!e.shiftKey && document.activeElement === last) {
e.preventDefault(); first.focus();
}
}

d.addEventListener('keydown', onKey);
closeBtn.addEventListener('click', function () { close(); });

var closed = false;
function close() {
if (closed) return;
closed = true;
d.setAttribute('data-state', 'leaving');
d.removeEventListener('keydown', onKey);

dm.destroy();
setBackgroundInert(false, bgNodes);
bgNodes = [];
unlockScroll();

var done = false;
function remove() {
if (done) return; done = true;
d.removeEventListener('transitionend', onTe);
if (host.parentNode) host.parentNode.removeChild(host);
}

function onTe(e) {
if (e && e.target !== d) return;
remove();
}
d.addEventListener('transitionend', onTe);
setTimeout(remove, 320);

fr.restore();

flEmit(d, 'fl-close', null);
if (opt.onClose) opt.onClose();
}

return { el: d, close: close };
}

global.Drawer = { open: open, setSanitizer: setSanitizer };
})(typeof window !== 'undefined' ? window : globalThis);
