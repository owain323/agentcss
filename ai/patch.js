/*
 * patch.js — 补丁 API：作用对象是**语义 id**，不是 HTML
 *
 * ============================================================================
 * 🔴 为什么是 id 而不是别的
 * ----------------------------------------------------------------------------
 * 三种"指向要改哪里"的方式：
 *
 *   ① HTML 路径  「第 3 个 div 的第 2 个子节点」
 *      ⇒ 任何一次结构变动都会让它失效。改 A 的时候 B 的引用就悄悄变了。
 *   ② CSS 选择器 「.page-3 h1」
 *      ⇒ 作用域扩散到整个文档（INVARIANT I-1 / I-2）。这是事故的直接形态。
 *   ③ 语义 id
 *      ⇒ 稳定、可比、可 diff、可回放。**改别的地方不影响它。**
 *
 * ============================================================================
 * 🔴 move 是**结构上不可能出错**的操作
 * ----------------------------------------------------------------------------
 * "改布局把内容弄没了" 这个故障，靠提醒 AI 小心是治不好的 ——
 * 因为整篇重写时，"内容"和"位置"混在同一个字符串里。
 *
 * ⇒ 解法是把它们拆开：move 只改 children 数组，**一个字节的内容都不碰**。
 *   这不是"小心一点"，是**让那类错误无法被表达出来**。
 *
 * ============================================================================
 * 五种操作
 * ----------------------------------------------------------------------------
 *   create  { op, node, parent, index }   新建节点并挂到 parent
 *   update  { op, id, set, unset }        改属性/文本（不动结构）
 *   move    { op, id, parent, index }     只改挂载位置，内容保持不变
 *   delete  { op, id }                    删除节点及其子树
 *   replace { op, id, node }              整体替换（保留挂载位置与 id）
 * ============================================================================
 */
'use strict';

var OPS = ['create', 'update', 'move', 'delete', 'replace'];

/* 🔴 保留名：这些字符串不能当节点 id，也不能当 set 的键（原型污染）
 * ----------------------------------------------------------------------------
 * 曾经 `work.nodes` 是普通对象，`op.id = '__proto__'` 时
 * `work.nodes['__proto__']` 取到的是 **Object.prototype**（truthy），
 * `if (!n)` 这道"节点不存在"的守卫因此失效，紧接着 `n[k] = …` 直接写进
 * Object.prototype —— 一次 apply 就能改掉整个进程的原型。
 * 实测：apply 返回 ok:true，随后 `({}).pwned === 1`。
 *
 * 三层修（缺一层都能被绕过）：
 *   ① 承载对象改无原型（nullProto）—— `__proto__` 在上面只是普通键；
 *   ② 这类 id / 键明确拒绝 —— 因为即使不污染，`__proto__` 作为键在
 *      JSON 往返、`for…in`、深比较里都会变形，不该出现在文档里；
 *   ③ 输出前转回普通对象时，键集合已被 ② 保证干净。
 * 补丁来自外部（AI agent 工作流的输入面），不能假设它是善意的。 */
var RESERVED_KEYS = ['__proto__', 'constructor', 'prototype'];

function isReserved(v) {
  return typeof v === 'string' && RESERVED_KEYS.indexOf(v) >= 0;
}

/** 无原型承载：`obj['__proto__']` 在这里是普通属性，取不到原型链。 */
function nullProto(src) {
  var o = Object.create(null);
  if (src && typeof src === 'object') {
    Object.keys(src).forEach(function (k) {
      if (!isReserved(k)) o[k] = src[k];
    });
  }
  return o;
}

/** 找出某个节点的父 id（顶层返回 null）。 */
function parentOf(nodes, id) {
  var found = null;
  Object.keys(nodes).forEach(function (pid) {
    var ch = nodes[pid] && nodes[pid].children;
    if (Array.isArray(ch) && ch.indexOf(id) >= 0) found = pid;
  });
  return found;
}

// 每种操作的必填字段。与 ai/patch.schema.json 的 opRequirements 保持一致。
var REQUIRED = {
  create: ['op', 'node'],
  update: ['op', 'id'],
  move: ['op', 'id', 'parent'],
  delete: ['op', 'id'],
  replace: ['op', 'id', 'node']
};

function clone(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

function fail(path, msg) {
  return { path: path, msg: msg };
}

/**
 * 校验补丁本身（不碰文档）。返回错误数组，空数组 = 合法。
 */
function validatePatch(patch) {
  var errors = [];
  if (!patch || typeof patch !== 'object') {
    return [fail('', '补丁必须是一个对象')];
  }
  if (!Array.isArray(patch.ops)) {
    return [fail('/ops', '补丁必须含 ops 数组')];
  }
  patch.ops.forEach(function (op, i) {
    var p = '/ops/' + i;
    if (!op || typeof op !== 'object') {
      errors.push(fail(p, '操作必须是对象'));
      return;
    }
    if (OPS.indexOf(op.op) < 0) {
      errors.push(fail(p + '/op', '未知操作 ' + JSON.stringify(op.op) +
        '（可用：' + OPS.join(' / ') + '）'));
      return;
    }
    REQUIRED[op.op].forEach(function (k) {
      if (op[k] === undefined) {
        errors.push(fail(p, op.op + ' 操作缺少字段 ' + k));
      }
    });
    if (op.op === 'create' && op.node && !op.node.id) {
      errors.push(fail(p + '/node/id', 'create 的节点必须有 id'));
    }
    if (op.op === 'create' && op.node && !op.node.kind) {
      errors.push(fail(p + '/node/kind', 'create 的节点必须有 kind'));
    }
    if (op.parent !== undefined && op.parent !== null &&
        typeof op.parent !== 'string') {
      errors.push(fail(p + '/parent', 'parent 必须是节点 id 或 null（表示顶层）'));
    }
    /* 🔴 保留名一律拒绝，理由见顶部 RESERVED_KEYS 注释 */
    if (isReserved(op.id)) {
      errors.push(fail(p + '/id', 'id 不能用保留名 ' + JSON.stringify(op.id) +
        '（会改写原型链，见 patch.js 顶部说明）'));
    }
    if (isReserved(op.parent)) {
      errors.push(fail(p + '/parent', 'parent 不能用保留名 ' +
        JSON.stringify(op.parent)));
    }
    if (op.node && isReserved(op.node.id)) {
      errors.push(fail(p + '/node/id', 'id 不能用保留名 ' +
        JSON.stringify(op.node.id)));
    }
    if (op.set && typeof op.set === 'object' && !Array.isArray(op.set)) {
      Object.keys(op.set).forEach(function (k) {
        if (isReserved(k)) {
          errors.push(fail(p + '/set/' + k, '不能设置保留名属性 ' +
            JSON.stringify(k)));
        }
      });
    }
    if (Array.isArray(op.unset)) {
      op.unset.forEach(function (k) {
        if (isReserved(k)) {
          errors.push(fail(p + '/unset/' + k, '不能删除保留名属性 ' +
            JSON.stringify(k)));
        }
      });
    }
  });
  return errors;
}

function detachFromParent(nodes, id) {
  Object.keys(nodes).forEach(function (pid) {
    var ch = nodes[pid].children;
    if (!Array.isArray(ch)) return;
    var at = ch.indexOf(id);
    while (at >= 0) {
      ch.splice(at, 1);
      at = ch.indexOf(id);
    }
  });
  var root = nodes.__root || [];
  var at2 = root.indexOf(id);
  while (at2 >= 0) {
    root.splice(at2, 1);
    at2 = root.indexOf(id);
  }
}

function subtree(nodes, id) {
  var out = [id];
  (nodes[id].children || []).forEach(function (c) {
    if (nodes[c]) out = out.concat(subtree(nodes, c));
  });
  return out;
}

function attach(nodes, id, parent, index) {
  if (parent === null || parent === undefined) {
    if (!Array.isArray(nodes.__root)) nodes.__root = [];
    if (index === undefined || index < 0 || index > nodes.__root.length) {
      nodes.__root.push(id);
    } else {
      nodes.__root.splice(index, 0, id);
    }
    return null;
  }
  if (!nodes[parent]) {
    return fail('', '父节点不存在：' + parent);
  }
  if (!Array.isArray(nodes[parent].children)) nodes[parent].children = [];
  var ch = nodes[parent].children;
  if (index === undefined || index < 0 || index > ch.length) ch.push(id);
  else ch.splice(index, 0, id);
  return null;
}

/**
 * 应用补丁。**不修改传入的 doc** —— 成功才返回新文档，失败原文档不受影响。
 * @returns {{ok:boolean, doc:object, errors:Array, applied:number}}
 */
function apply(doc, patch) {
  var errs = validatePatch(patch);
  if (errs.length) return { ok: false, doc: doc, errors: errs, applied: 0 };

  var work = clone(doc);
  /* 🔴 无原型承载：即使有人绕过 validatePatch，`__proto__` 在这里也只是
     一个普通键，写它不会碰到 Object.prototype。 */
  work.nodes = nullProto(work.nodes);
  // root 用内部键承载，apply 结束时写回 doc.root
  work.nodes.__root = Array.isArray(work.root) ? work.root.slice() : [];
  delete work.root;

  var applied = 0;
  var errors = [];

  for (var i = 0; i < patch.ops.length; i++) {
    var op = patch.ops[i];
    var p = '/ops/' + i;

    if (op.op === 'create') {
      if (work.nodes[op.node.id]) {
        errors.push(fail(p, '节点 id 已存在：' + op.node.id +
          '（create 不覆盖；要覆盖请用 replace）'));
        continue;
      }
      work.nodes[op.node.id] = clone(op.node);
      var e = attach(work.nodes, op.node.id, op.parent, op.index);
      if (e) { errors.push({ path: p, msg: e.msg }); delete work.nodes[op.node.id]; continue; }
      applied++;
      continue;
    }

    if (op.op === 'update') {
      var n = work.nodes[op.id];
      if (!n) { errors.push(fail(p, '节点不存在：' + op.id)); continue; }
      if (op.set) {
        Object.keys(op.set).forEach(function (k) {
          if (k === 'id') { errors.push(fail(p + '/set/id', '不允许改 id（等于换了一个节点）')); return; }
          n[k] = clone(op.set[k]);
        });
      }
      (op.unset || []).forEach(function (k) {
        if (k === 'id') { errors.push(fail(p + '/unset/id', '不允许删除 id')); return; }
        delete n[k];
      });
      applied++;
      continue;
    }

    if (op.op === 'move') {
      if (!work.nodes[op.id]) { errors.push(fail(p, '节点不存在：' + op.id)); continue; }
      // 🔴 内容保持不变：只改挂载关系
      detachFromParent(work.nodes, op.id);
      var e2 = attach(work.nodes, op.id, op.parent, op.index);
      if (e2) { errors.push({ path: p, msg: e2.msg }); continue; }
      applied++;
      continue;
    }

    if (op.op === 'delete') {
      if (!work.nodes[op.id]) { errors.push(fail(p, '节点不存在：' + op.id)); continue; }
      var doomed = subtree(work.nodes, op.id);
      detachFromParent(work.nodes, op.id);
      doomed.forEach(function (d) { delete work.nodes[d]; });
      applied++;
      continue;
    }

    if (op.op === 'replace') {
      var old = work.nodes[op.id];
      if (!old) { errors.push(fail(p, '节点不存在：' + op.id)); continue; }
      var parentId = null, idx = -1;
      Object.keys(work.nodes).forEach(function (pid) {
        if (pid === '__root') return;
        var at = (work.nodes[pid].children || []).indexOf(op.id);
        if (at >= 0) { parentId = pid; idx = at; }
      });
      if (idx < 0) {
        idx = (work.nodes.__root || []).indexOf(op.id);
        parentId = null;
      }
      var kept = clone(op.node);
      kept.id = op.id;                          // id 必须保持
      subtree(work.nodes, op.id).forEach(function (d) {
        if (d !== op.id) delete work.nodes[d];
      });
      work.nodes[op.id] = kept;
      detachFromParent(work.nodes, op.id);
      var e3 = attach(work.nodes, op.id, parentId, idx);
      if (e3) { errors.push({ path: p, msg: e3.msg }); continue; }
      applied++;
      continue;
    }
  }

  if (errors.length) {
    return { ok: false, doc: doc, errors: errors, applied: applied };
  }

  var root = work.nodes.__root || [];
  delete work.nodes.__root;
  work.root = root;
  /* 输出转回普通对象：调用方会 deepEqual、会直接改、会 JSON.stringify。
     键集合已被 validatePatch 保证不含保留名 ⇒ 这里不会触发 __proto__ setter。 */
  var plain = {};
  Object.keys(work.nodes).forEach(function (k) { plain[k] = work.nodes[k]; });
  work.nodes = plain;
  return { ok: true, doc: work, errors: [], applied: applied };
}

/**
 * 确定性检查：同一份文档 + 同一份补丁，跑两次结果必须逐字节相同。
 * ⚠️ 这是"可回放"的可验证形式 —— 不是声称，是能跑出来的断言。
 */
function isDeterministic(doc, patch) {
  var a = apply(doc, patch);
  var b = apply(doc, patch);
  if (a.ok !== b.ok) return false;
  return JSON.stringify(a.doc) === JSON.stringify(b.doc);
}

/**
 * 反向补丁（撤销用）。
 * ⚠️ 只对**已成功应用**的补丁有意义；失败补丁无法求逆。
 */
function invert(doc, patch) {
  var ops = [];
  var errs = validatePatch(patch);
  if (errs.length) return { ok: false, ops: [], errors: errs };

  var nodes = doc.nodes || {};
  for (var i = patch.ops.length - 1; i >= 0; i--) {
    var op = patch.ops[i];
    if (op.op === 'create') {
      ops.push({ op: 'delete', id: op.node.id });
    } else if (op.op === 'delete') {
      var n = nodes[op.id];
      if (!n) return { ok: false, ops: [], errors: [fail('/ops/' + i, '撤销失败：原节点已不存在')] };
      /* 🔴 delete 删的是**整棵子树**，undo 必须把子树一起建回来。
         原来只 create 一个节点 ⇒ 撤销后父的 children 里全是不存在的 id：
         文档结构悬空，而且 apply 不会报错（它不校验引用完整性）。
         顺序必须父在前——subtree() 是 DFS，天然满足。 */
      var ids = subtree(nodes, op.id);
      ids.forEach(function (id, k) {
        var node = clone(nodes[id]);
        var p = parentOf(nodes, id);
        var ix;
        if (p === null) ix = (doc.root || []).indexOf(id);
        else ix = (nodes[p].children || []).indexOf(id);
        if (k > 0 && ix < 0) ix = undefined;   // 原位置已不可考 ⇒ 追加到末尾
        ops.push({ op: 'create', node: node, parent: p, index: ix });
      });
    } else if (op.op === 'move') {
      var parent0 = null, idx0 = 0;
      Object.keys(nodes).forEach(function (pid) {
        var at = (nodes[pid].children || []).indexOf(op.id);
        if (at >= 0) { parent0 = pid; idx0 = at; }
      });
      if (parent0 === null) idx0 = (doc.root || []).indexOf(op.id);
      ops.push({ op: 'move', id: op.id, parent: parent0, index: idx0 });
    } else if (op.op === 'update' || op.op === 'replace') {
      var before = nodes[op.id];
      if (!before) {
        return { ok: false, ops: [], errors: [fail('/ops/' + i, '撤销失败：原节点已不存在')] };
      }
      if (op.op === 'update') {
        var set = {}, unset = [];
        (op.set ? Object.keys(op.set) : []).forEach(function (k) {
          if (before[k] === undefined) unset.push(k);
          else set[k] = clone(before[k]);
        });
        (op.unset || []).forEach(function (k) {
          if (before[k] !== undefined) set[k] = clone(before[k]);
        });
        ops.push({ op: 'update', id: op.id, set: set, unset: unset });
      } else {
        ops.push({ op: 'replace', id: op.id, node: clone(before) });
      }
    }
  }
  return { ok: true, ops: ops, errors: [] };
}

module.exports = {
  OPS: OPS,
  REQUIRED: REQUIRED,
  validatePatch: validatePatch,
  apply: apply,
  invert: invert,
  isDeterministic: isDeterministic
};
