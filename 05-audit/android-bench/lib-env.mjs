/* ============================================================================
 * lib-env.mjs — Android 真机验证台 · 公共库（被其余 4 个脚本 import）
 * ============================================================================
 * 运行前提（不满足时各函数会抛出带可操作建议的错误）：
 *   1. 模拟器已启动，`adb devices` 至少有一台状态为 device 的设备（emulator-* 亦可）。
 *   2. 模拟器内装有 Chrome（测试通过 chrome_devtools_remote 接管真 Chrome，
 *      WebView 不行）。默认由系统解析处理 VIEW intent 的应用；若模拟器默认
 *      浏览器不是 Chrome，设环境变量 AGENTCSS_ANDROID_BROWSER_PKG=<包名>
 *      （例如 com.android.chrome）后重跑。
 *   3. 宿主机 8000 端口已跑 agentcss 的 http-serve.py（根目录 = 被测
 *      仓库根）。本库会执行 `adb reverse tcp:8000 tcp:8000`，模拟器内 Chrome
 *      用 http://localhost:8000/... 访问页面。
 *   4. `adb forward tcp:9222 localabstract:chrome_devtools_remote` + 轮询
 *      /json/version，之后 playwright 经 connectOverCDP('http://127.0.0.1:9222')
 *      接管。注意：chrome_devtools_remote socket 只在 Chrome 启动过至少一次后
 *      才存在 —— ensureCdp 支持 bootstrapUrl，轮询期间会自动 am start 拉起 Chrome。
 *   5. Node ≥ 18（本台为 24）；playwright 来自被测仓库 node_modules（不额外安装）。
 *
 * 已知限制（诚实入档，0.27.17）：
 *   CDP 建连**之后** Chrome 崩溃/重启没有自动重连 —— 该套件剩余断言会塌缩成
 *   一条响亮的环境失败（不是假绿）；跨套件可恢复（每个套件自建连接）。
 *   自动重连要动每个套件的 session 生命周期，收益配不上改动面，暂不做。
 *
 * 结果契约：
 *   每个脚本跑完，把 {name, ok, detail}[] 按脚本名分节合并进
 *   <台子根>/results/report.json（重跑同一脚本只覆盖它自己那一节），
 *   并在控制台打印 PASS/FAIL 明细与汇总表。
 * ============================================================================
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ANDROID_BENCH_ROOT = process.env.ANDROID_BENCH;
/* 同目录兄弟脚本（orphan-gate 的 stem 登记也写在这里）：
   'dvh-viewport' 'run-gate' 'old-engine' 三个兄弟脚本（观测项 / 手动门禁 / 老引擎）也在这里维护 */
if (!ANDROID_BENCH_ROOT) {
  console.error('[android-bench] 请设 ANDROID_BENCH 环境变量指向台子根目录（内含 sdk/platform-tools/adb.exe）。'
    + ' 例：ANDROID_BENCH=<台子根目录>（其下应有 sdk/platform-tools/adb.exe）');
  process.exit(2);
}

/* playwright 从**本仓库**的 node_modules 引入：脚本在 05-audit/android-bench/ 下，
   仓库根是上两级 ⇒ 换机器、换目录都不用改这一行。 */
const require = createRequire(new URL('../../package.json', import.meta.url));
const { chromium } = require('playwright');

export { chromium };

export const ADB_EXE = ANDROID_BENCH_ROOT + '/sdk/platform-tools/adb.exe';
export const RESULTS_DIR = ANDROID_BENCH_ROOT + '/results';
export const REPORT_PATH = RESULTS_DIR + '/report.json';
export const BASE_URL = 'http://localhost:8000';
export const CDP_URL = 'http://127.0.0.1:9222';

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* 仅在被直接执行（node xxx.mjs）时为真；被 run-all import 时不触发自动运行 */
export function isDirectRun(callerModuleUrl) {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return pathToFileURL(argv1).href === callerModuleUrl;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------------------
 * adb：execSync 封装。返回 { ok, out }；allowFail=true 时失败不抛（只记文本）。
 * ------------------------------------------------------------------------- */
/* 🔴 多台并存时锁定 serial（ANDROID_SERIAL 显式指定 > 第一台 device） */
let SERIAL = process.env.ANDROID_SERIAL || null;
export function adb(args, { timeoutMs = 20000, allowFail = false } = {}) {
  const line = `"${ADB_EXE}" ${SERIAL ? "-s " + SERIAL + " " : ""}${args}`;
  let out;
  try {
    out = execSync(line, { encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
  } catch (e) {
    const stdout = e && e.stdout ? String(e.stdout) : '';
    const stderr = e && e.stderr ? String(e.stderr) : '';
    const text = (stdout + stderr + (e && e.message ? ' ' + e.message : '')).trim();
    if (allowFail) return { ok: false, out: text };
    throw new Error(`adb ${args} 失败\n  stdout: ${stdout.trim()}\n  stderr: ${stderr.trim()}`);
  }
  return { ok: true, out: String(out || '').trim() };
}

/* 确认至少一台状态为 device 的设备；返回设备序列号数组（写进报告 meta） */
export function ensureDevice() {
  const r = adb('devices');
  /* 多台并存时锁定 serial（安卓台可能同时有 bench35 与 bench28） */
  const ready = r.out
    .split(/\r?\n/)
    .slice(1)
    .filter((l) => /\tdevice\s*$/.test(l));
  if (ready.length && !SERIAL) SERIAL = ready[0].split('\t')[0].trim();
  /* 🔴 0.27.17 显式 serial 必须校验：ANDROID_SERIAL 指向 offline/已拔设备时，
     旧实现只要还有别的设备在线就照用死 serial，后续 adb -s 全部
     "device offline / more than one device / not found"，报错不指向真因。
     这里直接吵出来：serial 是台子级的确定性约定，静默换设备会污染基线。 */
  if (SERIAL && !ready.some((l) => l.split('\t')[0].trim() === SERIAL)) {
    throw new Error(
      'ANDROID_SERIAL=' + SERIAL + ' 不在当前可用设备列表（状态须为 device）：\n    ' +
        (ready.join('\n    ') || '（无）') +
        '\n  排查：设备 offline/unauthorized 需在模拟器里授权；已拔除则清掉 ANDROID_SERIAL 重跑（不指定时自动取第一台）。'
    );
  }
  if (!ready.length) {
    throw new Error(
      '没有状态为 device 的 Android 设备。adb devices 输出：\n    ' +
        r.out.split(/\r?\n/).join('\n    ') +
        '\n  前提：模拟器已启动；无线设备需先 adb connect <ip:port>；状态 offline/unauthorized 需在模拟器里授权调试。'
    );
  }
  return ready.map((l) => l.split('\t')[0].trim());
}
export function ensureReverse() {
  adb('reverse tcp:8000 tcp:8000');
  const list = adb('reverse --list');
  if (!list.out.includes('tcp:8000')) {
    throw new Error(
      'adb reverse tcp:8000 未生效（reverse --list = ' + JSON.stringify(list.out) + '）\n' +
        '  前提：宿主 8000 端口已跑 agentcss 的 http-serve.py，且模拟器在线。'
    );
  }
  return list.out;
}

/* adb forward tcp:9222 localabstract:chrome_devtools_remote → 轮询 /json/version。
 * 超时 30s；bootstrapUrl 提供时，若 socket 尚不存在（Chrome 从未启动），
 * 会在轮询中途用 am start 拉起一次 Chrome 再继续轮询。 */
export async function ensureCdp({ timeoutMs = 30000, bootstrapUrl = null } = {}) {
  adb('forward tcp:9222 localabstract:chrome_devtools_remote');
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  let bootstrapped = false;
  let polls = 0;
  while (Date.now() < deadline) {
    polls++;
    try {
      const res = await fetch(CDP_URL + '/json/version', { signal: AbortSignal.timeout(2500) });
      if (res.ok) {
        const info = await res.json();
        return { info, polls, bootstrapped };
      }
      lastErr = new Error('/json/version HTTP ' + res.status);
    } catch (e) {
      lastErr = e;
      /* 转发可能随 Chrome 重启失效 → 顺手重打一次 forward（幂等） */
      adb('forward tcp:9222 localabstract:chrome_devtools_remote', { allowFail: true });
    }
    /* 轮询 ~3s 还不通且给了 bootstrapUrl → 拉起 Chrome（socket 只有启动后才存在） */
    if (bootstrapUrl && !bootstrapped && polls >= 3) {
      bootstrapped = true;
      try {
        await openInChrome(bootstrapUrl);
      } catch (e) {
        lastErr = e;
      }
    }
    await sleep(500);
  }
  throw new Error(
    'CDP 端口 9222 在 ' + timeoutMs + 'ms 内未就绪（最后一次错误：' +
      (lastErr && lastErr.message ? lastErr.message : String(lastErr)) + '）\n' +
      '  前提：模拟器内 Chrome 已启动过至少一次（localabstract:chrome_devtools_remote 才存在）。\n' +
      '  排查：adb shell am start -a android.intent.action.VIEW -d "http://localhost:8000/" 拉起 Chrome 后重跑。'
  );
}

/* 模拟器内打开 URL：am start -a android.intent.action.VIEW -d "<url>"。
 * 设了 AGENTCSS_ANDROID_BROWSER_PKG 时把包名作为最后一个参数（指定用 Chrome 打开）。 */
export async function openInChrome(url) {
  const pkg = process.env.AGENTCSS_ANDROID_BROWSER_PKG || '';
  const tail = pkg ? ' "' + pkg + '"' : '';
  const r = adb('shell am start -a android.intent.action.VIEW -d "' + url + '"' + tail);
  return r.out;
}

/* connectOverCDP → 枚举 contexts/targets → 找 URL 含 urlSubstring 的 page → 等 load。
 * 找不到且给了 openUrl 时，先 am start 打开一次再继续轮询（覆盖「Chrome 没起」场景）。 */
export async function connectPage(urlSubstring, { openUrl = null, timeoutMs = 45000, loadTimeoutMs = 30000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let browser = null;
  let opened = false;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      if (!browser) browser = await chromium.connectOverCDP(CDP_URL);
      const pages = browser.contexts().flatMap((ctx) => ctx.pages());
      const hit = pages.find((p) => p.url().includes(urlSubstring));
      if (hit) {
        /* 🔴 0.27.17 命中先重载：上一轮残留的同 URL 标签会带着上一轮的
           组件状态（抽屉开着、标签已加、tooltip 悬着）被优先命中，
           造成"期望关闭却撞上残留 open"的假红（old-engine 的清标签
           同款问题）。reload 把状态归零，与 am start 全新打开等价，
           且不依赖调用方是否传 openUrl。 */
        await hit.reload({ timeout: loadTimeoutMs }).catch(() => {});
        await hit.waitForLoadState('load', { timeout: loadTimeoutMs }).catch(() => {});
        /* 拉到前台：保证 CSS transition / IME 行为与真人使用一致（后台标签会被节流） */
        await hit.bringToFront().catch(() => {});
        return { browser, page: hit };
      }
      if (openUrl && !opened) {
        await openInChrome(openUrl);
        opened = true;
      }
    } catch (e) {
      lastErr = e;
      if (openUrl && !opened) {
        try {
          await openInChrome(openUrl);
          opened = true;
        } catch {
          /* 下轮重试 */
        }
      }
    }
    await sleep(600);
  }
  if (browser) {
    try {
      await browser.close();
    } catch {
      /* 连接级 close，失败不影响 */
    }
  }
  throw new Error(
    timeoutMs + 'ms 内没有找到 URL 含「' + urlSubstring + '」的标签页' +
      (lastErr ? '；最后一次错误：' + (lastErr.message || String(lastErr)) : '') +
      (openUrl ? '（已尝试 am start 打开 ' + openUrl + '）' : '')
  );
}

/* 把 {name, ok, detail}[] 按脚本名合并进 report.json（只覆盖本脚本那一节） */
export function mergeReport(scriptName, entries, meta = {}) {
  let report = {};
  try {
    report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  } catch {
    report = {};
  }
  report.scripts = report.scripts || {};
  const failed = entries.filter((e) => !e.ok).length;
  report.scripts[scriptName] = {
    ok: failed === 0 && entries.length > 0,
    passed: entries.length - failed,
    failed,
    meta,
    entries,
  };
  const all = Object.values(report.scripts);
  const checks = all.reduce((s, v) => s + v.passed + v.failed, 0);
  const checksPassed = all.reduce((s, v) => s + v.passed, 0);
  report.generatedAt = new Date().toISOString();
  report.summary = {
    scripts: all.length,
    scriptsOk: all.filter((v) => v.ok).length,
    checks,
    checksPassed,
    checksFailed: checks - checksPassed,
    passRate: checks ? Math.round((checksPassed / checks) * 1000) / 10 + '%' : 'n/a',
  };
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  return report;
}

/* 结果收集器：{name, ok, detail}[] → 控制台明细 + 汇总表 + report.json */
export function createCollector(scriptName) {
  const entries = [];
  const meta = {};
  const collector = {
    scriptName,
    entries,
    meta,
    check(name, ok, detail) {
      const entry = { name, ok: !!ok, detail: detail == null ? '' : String(detail) };
      entries.push(entry);
      process.stdout.write('  [' + (entry.ok ? 'PASS' : 'FAIL') + '] ' + name + '\n');
      if (entry.detail) process.stdout.write('         ' + entry.detail + '\n');
      return entry;
    },
    setMeta(patch) {
      Object.assign(meta, patch);
    },
    get hasFailures() {
      return entries.some((e) => !e.ok);
    },
    async finish() {
      const passed = entries.filter((e) => e.ok).length;
      process.stdout.write(
        '\n  === ' + scriptName + '：' + passed + '/' + entries.length + ' 通过 ===\n'
      );
      try {
        console.table(
          entries.map((e) => ({ 检查项: e.name, 结果: e.ok ? 'PASS' : 'FAIL' }))
        );
      } catch {
        /* console.table 失败不影响结论 */
      }
      let report = null;
      try {
        report = mergeReport(scriptName, entries, meta);
      } catch (e) {
        process.stdout.write('  report.json 写入失败：' + (e && e.message ? e.message : e) + '\n');
      }
      process.stdout.write('  报告：' + REPORT_PATH + '\n');
      return { ok: !collector.hasFailures, entries, meta, report };
    },
  };
  return collector;
}
