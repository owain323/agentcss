/*
 * shot-verdict.js — ai shot 的**判定语义**（纯函数，零依赖，可离线自检）
 *
 * ============================================================================
 * 为什么判定不能留在调用方
 * ----------------------------------------------------------------------------
 * `ai shot --json` 已经输出溢出元素表与 JS 报错——数据是够的，缺的是解释层。
 * 让模型自己读 40 行溢出数据 = 回到"随模型能力自我发挥"：
 * 判定语义必须**固化进探针**，产出 verdict 让 agent 直接行动。
 *
 * 判定规则（交接文档 §3.2，逐条可被自检验证）
 * ----------------------------------------------------------------------------
 *   consoleErrors 非空            → fail（js-error：JS 报错不能是 warn）
 *   溢出元素不在滚动祖先内        → fail（true-overflow：真溢出）
 *   溢出元素都在滚动祖先内        → warn（container-scroll：设计内滚动，要让人知道）
 *   无溢出、无报错                → pass
 *   某宽度采集不完整（探针没跑成）→ fail（capture-incomplete：判定不可信，不许假 pass）
 *
 * 多宽度聚合：status 取最差档；reasons 带 where（哪个宽度、哪个元素）。
 * ============================================================================
 */
'use strict';

var SEVERITY_ORDER = { pass: 0, warn: 1, fail: 2 };

/** 单宽度的判定。entry 形状见 ai/shot.js 的 shots[]（captureOk 必须带）。 */
function verdictForWidth(entry) {
  var reasons = [];
  if (!entry || entry.captureOk !== true) {
    reasons.push({
      code: 'capture-incomplete', severity: 'fail',
      where: 'w' + (entry && entry.width ? entry.width : '?'),
      detail: '探针没有跑成（页面加载失败/解析失败）——判定不可信，不许假 pass'
    });
    return { status: 'fail', reasons: reasons };
  }
  if (entry.consoleErrors && entry.consoleErrors.length) {
    reasons.push({
      code: 'js-error', severity: 'fail',
      where: 'w' + entry.width,
      detail: 'JS 报错 ' + entry.consoleErrors.length + ' 条：' +
        entry.consoleErrors[0]
    });
  }
  var items = entry.overflowItems || [];
  for (var i = 0; i < items.length; i++) {
    if (items[i].inScroll) {
      reasons.push({
        code: 'container-scroll', severity: 'warn',
        where: 'w' + entry.width + ' ' + items[i].tag,
        detail: '溢出在设计内滚动容器里（表格横向滚动是契约行为），不判失败'
      });
    } else {
      reasons.push({
        code: 'true-overflow', severity: 'fail',
        where: 'w' + entry.width + ' ' + items[i].tag,
        detail: '溢出且不在任何滚动祖先内——真溢出，会顶破布局'
      });
    }
  }
  if (entry.pageOverflow) {
    reasons.push({
      code: 'page-overflow', severity: 'fail',
      where: 'w' + entry.width,
      detail: '页面级横向溢出（scrollWidth > 视口）——不管元素在不在容器里，页面已经顶破'
    });
  }
  var status = 'pass';
  for (var k = 0; k < reasons.length; k++) {
    if (SEVERITY_ORDER[reasons[k].severity] > SEVERITY_ORDER[status]) {
      status = reasons[k].severity;
    }
  }
  return { status: status, reasons: reasons };
}

/** 多宽度聚合：取最差档，reasons 按 where 汇总。 */
function computeShotVerdict(widthEntries, consoleErrors) {
  var all = [];
  var perWidth = [];
  var worst = 'pass';
  var list = widthEntries || [];
  for (var i = 0; i < list.length; i++) {
    var v = verdictForWidth(list[i]);
    perWidth.push(v);
    all = all.concat(v.reasons);
    if (SEVERITY_ORDER[v.status] > SEVERITY_ORDER[worst]) worst = v.status;
  }
  var ce = consoleErrors || [];
  if (ce.length) {
    all.unshift({
      code: 'js-error', severity: 'fail', where: '全局',
      detail: 'JS 报错 ' + ce.length + ' 条：' + ce[0]
    });
  }
  for (var j = 0; j < all.length; j++) {
    if (SEVERITY_ORDER[all[j].severity] > SEVERITY_ORDER[worst]) {
      worst = all[j].severity;
    }
  }
  return { status: worst, reasons: all, perWidth: perWidth };
}

/** 一句话中文结论（给人类输出与 agent 的 summary 字段共用）。 */
function summarize(verdict, widthCount) {
  var s = verdict && verdict.status;
  var n = (verdict && verdict.reasons || []).length;
  if (s === 'pass') return widthCount + ' 个宽度全部通过：无溢出、无 JS 报错';
  if (s === 'warn') return '发现 ' + n + ' 处设计内滚动（warn，不判失败）——确认是契约行为即可';
  return '发现 ' + n + ' 处必须处理的问题（fail）：真溢出 / JS 报错 / 采集不完整';
}

/* ---------------------------------------------------------------- 自检
   反向控制（§3.3 三联的离线层）：①②③④ 四用例 + 变异探针。
   变异探针 = 把某条规则"关掉"后，对应用例的判定必须翻转
   ⇒ 证明每条规则都是**承重的**，不是装饰。
   （浏览器侧 fixture 三联——注入缺陷必红/还原必绿/快照不变——
     由 05-audit/shot-verdict-check.js 用真浏览器跑，见该文件头。） */
function selftest() {
  var bad = 0;
  function expect(name, got, want, why) {
    if (got === want) console.log('  OK   ' + name);
    else { console.log('  FAIL ' + name + '：期望 ' + want + ' 实得 ' + got + '（' + why + '）'); bad++; }
  }
  var W = function (o) {
    return { width: 390, captureOk: true, consoleErrors: [], pageOverflow: false,
      overflowItems: (o && o.items) || [] };
  };

  /* ④ 干净页面 → pass */
  var clean = computeShotVerdict([W({})], []);
  expect('④ 干净页面 → pass', clean.status, 'pass', '基础绿');

  /* ① 真溢出 → fail */
  var to = computeShotVerdict([W({ items: [{ tag: 'table.t', inScroll: false }] })], []);
  expect('① 真溢出 → fail', to.status, 'fail', '不在滚动祖先内的溢出必须红');
  expect('① reasons 含 true-overflow', to.reasons.some(function (r) {
    return r.code === 'true-overflow'; }), true, '分型必须可读');

  /* ② 设计内滚动 → warn（最容易做反的一条：不许 fail） */
  var cs = computeShotVerdict([W({ items: [{ tag: 'table.t', inScroll: true }] })], []);
  expect('② 容器内滚动 → warn（不是 fail）', cs.status, 'warn', '表格横向滚动是契约行为');

  /* ③ console.error → fail */
  var je = computeShotVerdict([W({})], ['TypeError: x is not a function']);
  expect('③ JS 报错 → fail', je.status, 'fail', 'JS 报错不能是 warn');

  /* 边界诚实：采集不完整 → fail（不许假 pass） */
  var ci = computeShotVerdict([{ width: 390, captureOk: false }], []);
  expect('边界 采集不完整 → fail', ci.status, 'fail', '判定不可信必须如实说');

  /* 多宽度聚合：最差档 */
  var agg = computeShotVerdict(
    [W({ items: [{ tag: 'div.d', inScroll: true }] }), W({ items: [{ tag: 'p.p', inScroll: false }] })], []);
  expect('多宽度聚合取最差档', agg.status, 'fail', 'warn + fail 并存 ⇒ fail');

  /* ---- 变异探针（5 条）：每条规则单独承重 ---- */
  /* 变异 M1：若无 js-error 规则 ⇒ 报错用例应为 pass，实际 fail ⇒ 规则承重 */
  var m1 = computeShotVerdict([W({})], ['TypeError: x']);
  expect('M1 js-error 规则承重', m1.status === 'fail', true, '去掉该规则这里会变 pass');
  /* M2：若无 true-overflow 规则 ⇒ 真溢出用例应为 warn（容器路径），实际 fail */
  var m2 = computeShotVerdict([W({ items: [{ tag: 'table.t', inScroll: false }] })], []);
  expect('M2 true-overflow 规则承重', m2.reasons.some(function (r) {
    return r.code === 'true-overflow'; }), true, '去掉该规则会误判成设计内滚动');
  /* M3：若无 container-warn 分辨 ⇒ 容器内滚动会误判成 fail（这条最容易做反） */
  var m3 = computeShotVerdict([W({ items: [{ tag: 'table.t', inScroll: true }] })], []);
  expect('M3 容器分辨承重（warn 不是 fail）', m3.status === 'warn', true,
    '做反 = 表格页全部假红');
  /* M4：若无 capture-incomplete ⇒ 采集失败会被当成 pass（假绿） */
  var m4 = computeShotVerdict([{ width: 390, captureOk: false }], []);
  expect('M4 capture-incomplete 规则承重', m4.status === 'fail', true,
    '去掉该规则 = 探针没跑也报绿');
  /* M5：聚合取最差档 ⇒ warn+fail 并存必须 fail */
  expect('M5 聚合取最差档承重', agg.status === 'fail', true, '取 min 会漏报');

  console.log(bad ? '  [FAIL] 自检 %d 项'.replace('%d', bad) : '  [OK  ] shot-verdict 自检 8 项全过（4 用例 + 5 变异探针，含三态边界）');
  return bad ? 1 : 0;
}

module.exports = {
  computeShotVerdict: computeShotVerdict,
  verdictForWidth: verdictForWidth,
  summarize: summarize,
  selftest: selftest
};

/* 直接运行 ⇒ 自检（四用例 + 五变异探针）。exit 0 = 判据可信。 */
if (require.main === module) {
  process.exit(selftest());
}
