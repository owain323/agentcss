/* ============================================================================
 * run-all.mjs — 顺序跑全部 3 个验证脚本，最后汇总
 * ============================================================================
 * 加载顺序（每个套件两档，动态 import 实现）：
 *   1. 优先 import ./<base>-full.mjs（深度版，需 export const run）
 *   2. -full 文件不存在 / import 失败 / 没有 run 导出 → 退回 ./<base>.mjs（基础版）
 *      两种情况都能跑；实际加载了哪个文件会在每个套件的横幅里打印。
 *   3. a11y-select 没有 -full 版，直接用 ./a11y-select.mjs。
 *   ⚠ 基础版若不接 lib-env 收集器（run() 不返回 {entries}，只自写
 *      results/<base>.json），run-all 会代读该文件并把结果合并进 report.json；
 *      若 run() 有返回（深度版），由脚本自己合并，run-all 不重复写。
 *
 * 顺序（与契约一致）：
 *   1. ensureDevice → ensureReverse（adb reverse tcp:8000 tcp:8000）
 *   2. openInChrome 预开三个页面（模拟器内 Chrome 用 http://localhost:8000 访问）
 *   3. 逐个跑 touch-tooltip → ime-combobox → a11y-select
 *      （每个脚本内部自己 ensureCdp / connectOverCDP / newCDPSession，全部幂等）
 *   失败项不中断：一个脚本挂了继续跑其余，最后统一汇总。
 *
 * 运行前提（同 lib-env.mjs 头部）：
 *   1. 模拟器已启动、adb devices 可见
 *   2. 模拟器内 Chrome 可用（从未启动过也没关系：ensureCdp 轮询时会 am start 拉起）
 *   3. 宿主 8000 端口已跑 agentcss http-serve.py
 *   4. 结果：<台子根>\results\report.json（按脚本名分节，含通过率）
 *
 * 退出码：全部通过 = 0；任一失败 = 1（环境前置不满足时三个脚本全记失败）。
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ensureDevice, ensureReverse, openInChrome, mergeReport, createCollector,
  isDirectRun, RESULTS_DIR, REPORT_PATH, ADB_EXE, BASE_URL,
} from './lib-env.mjs';
import { run as runA11ySelect } from './a11y-select.mjs';

/* name = report.json 分节键（固定，不随 full/basic 变）；
   base = 文件名前缀；hasFull = 是否存在 -full 深度版可选 */
const SUITES_DEF = [
  { name: 'touch-tooltip', base: 'touch-tooltip', hasFull: true, pathSeg: '/03-patterns/tooltip/demo.html' },
  { name: 'ime-combobox', base: 'ime-combobox', hasFull: true, pathSeg: '/02-primitives/combobox/demo.html' },
  { name: 'a11y-select', base: 'a11y-select', hasFull: false, pathSeg: '/02-primitives/select/demo.html' },
];

/* 优先 -full 深度版；文件不存在 / import 失败 / 缺 run 导出 → 退回基础版
   深度版文件：'touch-tooltip-full' 'ime-combobox-full'（stem 登记给 orphan-gate）
   stem 登记写在这里：hasFull 只留布尔，文件名字面量必须可被引用图扫到） */
async function loadSuiteRun(def) {
  let fullErr = null;
  if (def.hasFull) {
    try {
      const m = await import('./' + def.base + '-full.mjs');
      if (typeof m.run === 'function') {
        return { fn: m.run, used: def.base + '-full.mjs', version: 'full', fullErr: null };
      }
      fullErr = new Error(def.base + '-full.mjs 加载成功但没有 export const run');
    } catch (e) {
      fullErr = e;
    }
  }
  const m = await import('./' + def.base + '.mjs');
  if (typeof m.run !== 'function') {
    /* 基础版没有可调用的 run：给一条可操作的失败，而不是让 run-all 崩 */
    const detail = '基础版 ' + def.base + '.mjs 缺少 export const run（它可能是 import 即执行的顶层脚本？请把主流程包成 run 导出，或恢复 -full 版）' +
      (fullErr ? '；-full 版导入失败：' + (fullErr.message || fullErr) : '');
    return {
      fn: async () => {
        const c = createCollector(def.name);
        c.check('脚本可加载（需 export const run）', false, detail);
        return await c.finish();
      },
      used: def.base + '.mjs',
      version: 'basic-no-run',
      fullErr,
    };
  }
  return { fn: m.run, used: def.base + '.mjs', version: 'basic', fullErr };
}

async function main() {
  process.stdout.write('==== Android 真机验证台（agentcss 真机契约）====\n');
  process.stdout.write('adb: ' + ADB_EXE + '\n');
  process.stdout.write('页面基址: ' + BASE_URL + '（经 adb reverse tcp:8000）\n');
  process.stdout.write('套件加载顺序：优先 <base>-full.mjs（深度版），不存在/导入失败退回 <base>.mjs\n');

  /* 1. 环境前置 */
  try {
    const devs = ensureDevice();
    process.stdout.write('设备: ' + devs.join(', ') + '\n');
    ensureReverse();
    process.stdout.write('adb reverse tcp:8000 已就绪\n');
  } catch (e) {
    /* 环境不行：三个脚本全记失败、报告照写，便于 CI 留痕 */
    process.stdout.write('环境前置不满足：\n' + ((e && e.message) || String(e)) + '\n');
    const entries = [{
      name: '环境前置（adb 设备 / reverse tcp:8000）',
      ok: false,
      detail: (e && e.message) || String(e),
    }];
    for (const def of SUITES_DEF) mergeReport(def.name, entries);
    process.stdout.write('\n结论：0/3 个脚本可跑，全部记为失败。报告：' + REPORT_PATH + '\n');
    process.exitCode = 1;
    return;
  }

  /* 2. 预开三个页面（openInChrome 各页 → 之后 ensureCdp 轮询必然能通） */
  for (const def of SUITES_DEF) {
    try {
      await openInChrome(BASE_URL + def.pathSeg);
      process.stdout.write('已请求打开：' + BASE_URL + def.pathSeg + '（' + def.name + '）\n');
      await new Promise((r) => setTimeout(r, 300));
    } catch (e) {
      /* 打不开不拦：各脚本内 connectPage 还会再试 */
      process.stdout.write('am start 失败（' + def.name + '）：' +
        ((e && e.message) || e) + '\n');
    }
  }

  /* 3. 顺序跑，失败继续 */
  const summary = [];
  for (const def of SUITES_DEF) {
    process.stdout.write('\n-------- ' + def.name + ' --------\n');
    let used = '(未加载)';
    let loaded = null;
    try {
      loaded = await loadSuiteRun(def);
      used = loaded.used;
      if (loaded.version === 'full') {
        process.stdout.write('版本：' + used + '（深度版）\n');
      } else if (loaded.version === 'basic') {
        process.stdout.write('版本：' + used + '（基础版兜底；' +
          (loaded.fullErr
            ? '-full 导入失败：' + (loaded.fullErr.message || loaded.fullErr)
            : '-full 不可用') + '）\n');
      } else {
        process.stdout.write('版本：' + used + '（基础版，但缺 run 导出，按失败记录）\n');
      }
    } catch (e) {
      /* 连基础版都 import 失败：记一整条失败，继续下一个 */
      mergeReport(def.name, [{
        name: '脚本加载失败（-full 与基础版均不可用）',
        ok: false,
        detail: (e && e.stack) || String(e),
      }]);
      summary.push({ 脚本: def.name, 版本: used, 结果: 'FAIL', 通过: 0, 失败: 1 });
      continue;
    }

    let r = null;
    let threw = null;
    try {
      r = await loaded.fn();
    } catch (e) {
      threw = e;
    }
    if (threw) {
      /* 脚本自己没接住的异常：记一整条失败，继续下一个 */
      mergeReport(def.name, [{
        name: '脚本异常（run 未接住）',
        ok: false,
        detail: (threw && threw.stack) || String(threw),
      }]);
      summary.push({ 脚本: def.name, 版本: used, 结果: 'FAIL', 通过: 0, 失败: 1 });
      continue;
    }

    /* 深度版返回收集器结果；基础版可能返回 undefined（只自写 results/<base>.json） */
    let entries = r && Array.isArray(r.entries) ? r.entries : null;
    let ok = r && typeof r.ok === 'boolean' ? r.ok : null;
    if (!entries) {
      const sidePath = path.join(RESULTS_DIR, def.name + '.json');
      try {
        const arr = JSON.parse(fs.readFileSync(sidePath, 'utf8'));
        if (Array.isArray(arr) && arr.length) {
          entries = arr.map((e) => ({
            name: e.name,
            ok: !!e.ok,
            detail: e.detail == null ? '' : String(e.detail),
          }));
          ok = entries.every((e) => e.ok);
          process.stdout.write('（run() 未返回收集器结果，改读其自写文件 ' + sidePath + ' 汇总）\n');
        }
      } catch {
        /* 没有 side file */
      }
    }
    if (!entries) {
      entries = [{
        name: '脚本未返回结果',
        ok: false,
        detail: used + ' 的 run() 没有返回 {entries}，也未在 ' + RESULTS_DIR +
          ' 留下 ' + def.name + '.json，无从汇总',
      }];
      ok = false;
    }
    /* 基础版不会自己写 report.json → run-all 代写；深度版自带 finish/mergeReport 不重复 */
    if (!(r && r.report)) {
      mergeReport(def.name, entries, { file: used, version: loaded.version });
    }
    const passed = entries.filter((e) => e.ok).length;
    summary.push({
      脚本: def.name,
      版本: used,
      结果: ok ? 'PASS' : 'FAIL',
      通过: passed,
      失败: entries.length - passed,
    });
  }

  /* 4. 汇总 */
  process.stdout.write('\n==== 汇总 ====\n');
  try {
    console.table(summary);
  } catch {
    /* console.table 失败不影响 */
  }
  let report = null;
  try {
    report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  } catch {
    /* report 读不到就只按本轮 summary 退码 */
  }
  if (report && report.summary) {
    process.stdout.write(
      '检查项：' + report.summary.checksPassed + '/' + report.summary.checks +
        ' 通过（' + report.summary.passRate + '），脚本 ' +
        report.summary.scriptsOk + '/' + report.summary.scripts + ' 全绿\n'
    );
  }
  process.stdout.write('报告：' + REPORT_PATH + '\n');
  if (summary.some((s) => s.结果 !== 'PASS')) process.exitCode = 1;
}

if (isDirectRun(import.meta.url)) {
  main().catch((e) => {
    console.error((e && e.stack) || e);
    process.exitCode = 1;
  });
}
