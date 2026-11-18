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

/** 一句话中文结论（给人类输出与 agent 的 summary 字段共用）。
    🔴 0.27.18：fail 文案只列**实际出现**的分型，不再罗列全类别菜单
    （旧文案"2 处问题：真溢出 / JS 报错 / 采集不完整"——明明只有
    真溢出，读起来像三类都有）。 */
function summarize(verdict, widthCount) {
  var s = verdict && verdict.status;
  var rs = (verdict && verdict.reasons || []);
  var n = rs.length;
  if (s === 'pass') return widthCount + ' 个宽度全部通过：无溢出、无 JS 报错';
  if (s === 'warn') return '发现 ' + n + ' 处设计内滚动（warn，不判失败）——确认是契约行为即可';
  var seen = {};
  var kinds = [];
  var ORDER = { 'true-overflow': '真溢出', 'js-error': 'JS 报错',
    'page-overflow': '页面级溢出', 'capture-incomplete': '采集不完整' };
  rs.forEach(function (r) {
    if (!seen[r.code]) { seen[r.code] = 1; kinds.push(ORDER[r.code] || r.code); }
  });
  return '发现 ' + n + ' 处必须处理的问题（fail）：' + kinds.join(' / ');
}

/* ---------------------------------------------------------------- 自检
   反向控制（§3.3 三联的离线层）：①②③④ 四用例 + 边界 + 对照断言。
   🔴 0.27.17 诚实化：这组原来叫"变异探针 M1~M5"，但它们**没有把任何
   规则关掉再跑**——只是同参数重复断言（M1≡③、M3≡② 逐字同参），
   "每条规则单独承重"的证明力弱于其声称。真正关规则需要测试钩子进
   生产代码，交换不划算 ⇒ 如实改叫**对照断言**，且每条只断言前组
   用例没碰过的**独有性质**（分型/分档/聚合维度）。计数动态汇报，
   不再写死"8 项"。
   （浏览器侧 fixture 三联——注入缺陷必红/还原必绿/快照不变——
     由 05-audit/shot-verdict-check.js 用真浏览器跑，见该文件头。） */
function selftest() {
  var bad = 0, total = 0;
  function expect(name, got, want, why) {
    total++;
    if (got === want) console.log('  OK   ' + name);
    else { console.log('  FAIL ' + name + '：期望 ' + JSON.stringify(want) +
      ' 实得 ' + JSON.stringify(got) + '（' + why + '）'); bad++; }
  }
  var W = function (o) {
    o = o || {};
    return { width: 390, captureOk: true, consoleErrors: [],
      pageOverflow: !!o.pageOverflow,
      overflowItems: o.items || [] };
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

  /* 页面级溢出 → fail（0.27.17 补：page-overflow 规则此前自检零覆盖） */
  var po = computeShotVerdict([W({ pageOverflow: true })], []);
  expect('页面级溢出 → fail', po.status, 'fail', '页面顶破必须红');

  /* 多宽度聚合：最差档 */
  var agg = computeShotVerdict(
    [W({ items: [{ tag: 'div.d', inScroll: true }] }), W({ items: [{ tag: 'p.p', inScroll: false }] })], []);
  expect('多宽度聚合取最差档', agg.status, 'fail', 'warn + fail 并存 ⇒ fail');

  /* ---- 对照断言：只断言前面用例没碰过的独有性质 ---- */
  /* 对照A js-error 的**分型**在位且是 fail 档（③ 只查了总档） */
  expect('对照A js-error 分型 severity=fail', !!(je.reasons[0] &&
    je.reasons[0].code === 'js-error' && je.reasons[0].severity === 'fail'),
    true, '分型丢了 agent 就没法定位');

  /* 对照B true-overflow 分型 severity=fail（① 只查了"存在"） */
  var toR = to.reasons.filter(function (r) { return r.code === 'true-overflow'; })[0];
  expect('对照B true-overflow severity=fail', !!toR && toR.severity === 'fail',
    true, '降档会让 agent 拿着 warn 不动手');

  /* 对照C inScroll 条目**永不**产生 true-overflow 分型 —— 容器分辨规则的
     独有性质（② 只查了总档 warn；做反 = 表格页假红 + 分型错） */
  expect('对照C inScroll 不产生 true-overflow', cs.reasons.some(function (r) {
    return r.code === 'true-overflow'; }), false, '做反 = 表格页全部假红');

  /* 对照D capture-incomplete 分型在位（边界只查了总档） */
  expect('对照D capture-incomplete 分型在位', !!(ci.reasons[0] &&
    ci.reasons[0].code === 'capture-incomplete' && ci.reasons[0].severity === 'fail'),
    true, '探针没跑成必须带分型上报');

  /* 对照E page-overflow 分型在位（新用例只查了总档） */
  expect('对照E page-overflow 分型在位', po.reasons.some(function (r) {
    return r.code === 'page-overflow'; }), true, '页面级与元素级必须分得开');

  /* 对照F 聚合的 perWidth 维度：各宽度档位如实保留、聚合=最差档
     （旧 M5 只查总档，看不出聚合是"取 max"还是"首宽度决定"） */
  var pw = agg.perWidth.map(function (v) { return v.status; });
  expect('对照F perWidth 档位 [warn, fail] 且聚合 fail',
    JSON.stringify(pw) === JSON.stringify(['warn', 'fail']) && agg.status === 'fail',
    true, '聚合必须真取最差档，不是取第一个');

  console.log(bad
    ? '  [FAIL] 自检 ' + bad + ' / ' + total + ' 项不过'
    : '  [OK  ] shot-verdict 自检 ' + total + ' 项全过（4 用例 + 边界 + 对照断言）');
  return bad ? 1 : 0;
}

module.exports = {
  computeShotVerdict: computeShotVerdict,
  verdictForWidth: verdictForWidth,
  summarize: summarize,
  selftest: selftest
};

/* 直接运行 ⇒ 自检（四用例 + 边界 + 对照断言）。exit 0 = 判据可信。 */
if (require.main === module) {
  process.exit(selftest());
}
