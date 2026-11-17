# android-bench —— 真安卓 Chrome 行为门禁（手动档）

在真·安卓 Chromium（模拟器或真机）上跑行为契约。它补的是桌面 Playwright 覆盖不到的三类事实：**真触摸事件序列**、**真 IME 合成**、**真无障碍树播报**。

## 为什么是手动档

CI 是 Linux（无模拟器、无 Chrome APK）——挂进 check-all 任何 MODE 都会让 CI 必红。
这是一道**有台子的机器上、发版前手动跑**的门禁（对应 docs/RELEASE-PROCESS.md 的发版清单）。

## 前提

| 项 | 说明 |
|---|---|
| 台子 | `ANDROID_BENCH` 环境变量指向台子根目录（默认 `<台子根目录>`，内含 `sdk/`） |
| 设备 | 模拟器或真机，`adb devices` 可见；系统镜像建议 `google_apis_playstore`（预装 Chrome） |
| 页面服务 | 宿主 8000 端口跑 `05-audit/http-serve.py`（仓库根启动） |
| 网络 | `adb reverse tcp:8000 tcp:8000` 由脚本自动做 |

## 判据（26 项命名判据 + 前置/诊断条目，分布三个套件）

### touch-tooltip（11 项 · CDP `Input.dispatchTouchEvent` 真触摸）

| # | 判据 | 契约出处 |
|---|---|---|
| ① | attach 创建气泡：show 前游离（设计如此），show 后挂 body | tooltip README「定位前必须先入 DOM」 |
| ② | 初态无 data-state（游离节点 opacity 不可断言） | 显隐靠 data-state，别写 display |
| ③ | **一次点按必是「开」**（修前第一次点击以"关"收场） | touch 序列 focus+click 双触发回归 |
| ④ | 再点一下才是「关」 | 同上 |
| ⑤ | touchstart 后 700ms 内合成 mouseenter **不给开**（触屏抑制窗） | 触屏 hover 会"粘住" |
| ⑥ | 抑制窗过期（>700ms）后 mouseenter 恢复开的能力 | 同上（窗是有时限的，不是永久禁用） |
| ⑦ | 悬停开的，mouseleave 移开就收（hover 所有权释放） | 所有权集合 {hover,focus,click} |
| ⑧ | 点外部（真触摸）也能关 | dismissable 核 |
| ⑨ | Esc 能关（WCAG 1.4.13） | 同上 |
| ⑩ | blur 能关（blur 同时收 focus 与 click 两份所有权） | 同上 |

### ime-combobox（11 项 · CDP `Input.imeSetComposition` 真 IME 通道优先，合成事件退化）

| # | 判据 | 契约出处 |
|---|---|---|
| ① | "ni" 上屏 + compositionstart 送达 | IME 三层守卫的前置 |
| ② | 合成期 Enter(229) **不加标签**（拼音半截不许变标签） | compositionstart/end + isComposing + keyCode 229 |
| ③ | trusted keydown（CDP `Input.dispatchKeyEvent` 229）也让路 | 同上（trusted 与合成事件同等对待） |
| ④ | 合成期 ↑↓(229) **不挪游标** | 同上 |
| ⑤⑥ | 普通 keyCode(40/38/13) 的 ↑↓/Enter 合成期也让路 | **标志层独立可辨**（不依赖 keyCode 判断） |
| ⑦ | `isComposing:true` 的 Enter 让路 | **isComposing 层**（第三个守卫层） |
| ⑧ | 建议列表照常过滤（合成期打字不停服务） | "建议列表照常刷新" |
| ⑨ | compositionend 后收尾 Enter(229) 仍不加 | 守卫复位前不得误提交 |
| ⑩ | 普通 Enter(13) 正常提交、输入清空（守卫复位证明） | 同上 |

### a11y-select（4 项 · CDP `Accessibility.getFullAXTree` 真无障碍树）

| # | 判据 | 契约出处 |
|---|---|---|
| ① | AX 树里有 role=combobox 节点 | select README |
| ② | combobox 可访问名 = **「字段名 + 当前值」**（aria-labelledby 两段都念） | select.js paint 的 labelledby 链 |
| ③ | DOM 佐证：labelledby 两个 id 解出的文字分别正确 | 同上 |
| ④ | tooltip live region（role=tooltip，aria-live=polite）在真 AX 树里 | WCAG 4.1.3 |

另有 dvh-viewport.mjs（观测项）：地址栏随滚动收缩时布局自适应、无横向溢出、
稳定态 visualViewport==innerHeight（page.css 的 100vh+100dvh 双写在真机上的信号）。
地址栏收不收本身是 Chrome UI 层行为，**只观测不计分**。

### old-engine（5 项 · 裸 CDP，兼容 Chrome 69 旧协议）

老引擎台：`bench28` AVD（API28 google_apis_playstore，自带 **Chrome 69**——2018 年引擎）。
这是"老 WebView 可用"的**实证**层：ES5 语法、无原生 closest 的兜底路径、
触摸事件契约，全部在真旧引擎上过一遍。

| # | 判据 |
|---|---|
| ① | 引擎 UA 确认（Chrome/68–69 时代） |
| ② | 页面渲染（.page .wrap 存在） |
| ③ | **零 JS 错误**（ES5 全量在旧引擎上无异常） |
| ④ | tooltip 真触摸：一次点按开 |
| ⑤ | tooltip 真触摸：再点关 |

⚠️ Chrome 69 的 CDP 协议较老——Playwright `connectOverCDP` 会发它不认识的
`Browser.setDownloadBehavior` 导致连接被断。本脚本用 **Node 原生 WebSocket 裸 CDP**
（Runtime.evaluate / Input.dispatchTouchEvent）绕过，不依赖 Playwright。

## 用法

```bash
# 0) 一次性：装台子（JDK17 + cmdline-tools + 镜像 ~2GB，全落 ANDROID_BENCH）
#    台子脚本见 ANDROID_BENCH/setup2.sh / boot.sh（非仓库文件）
bash 05-audit/android-bench/run-gate.sh
```

退出码：全部通过 0；任一失败 1；无设备 2（SKIP，不算失败也不算通过）。
结果写 `ANDROID_BENCH/results/report.json`（按套件分节 + 通过率）。

## 已知边界

- TalkBack 朗读：需要 Play 登录装 TalkBack，当前 AX 树判据是它的近似
- 老 WebView：需侧载旧版 Chrome/WebView APK（Chrome 80 等），当前镜像是最现代引擎——
  "老 WebView 可用"的 ES5/polyfill 判据仍由桌面层单测守住
- 无窗模拟器下地址栏收拢不稳定：dvh-viewport 已把它降为观测项
