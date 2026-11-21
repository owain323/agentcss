# CI 组件层首跑 · 红片分类处置台账

🔴 背景：0.27.21 起 127 道组件层门禁首次进 CI（WO-11）。此前它们只在
Windows/Chromium 本地跑过；首跑在 Linux + 三引擎上红了一片。**红是真实状态**，
本文档是逐门的分类台账：产品缺陷（修）/ 环境差异（修观测条件）/ 判据坏了
（修判据本身，不许为绿放宽）。修法全部先在本地 `FL_ENGINE=firefox MODE=component`
复现，再动手。

## 已修（0.27.21 后续提交）

| 门禁 | 引擎 | 分类 | 根因与证据 | 处置 |
|------|------|------|-----------|------|
| motion-live / -rev | firefox+webkit | 判据坏了（工具） | `page.evaluate(fn, a, b, c…)` 多参数被 Playwright 拒收（"Too many arguments…"）；chromium 不报 ⇒ 本地全绿掩盖 | 多参统一包单对象（motion-concurrency.js:66） |
| tap-target | firefox+webkit | 同上 | 同上（tap-target.js:91） | 同上，本地 firefox 转绿 |
| dist-parity | firefox+webkit | 同上 | 同上（dist-parity-check.js:108 COMPARE） | 同上，本地 firefox 转绿 |
| skel-lever | firefox+webkit | 同上 | 同上（skeleton-lever-check.js:189/194/197 三处） | 同上，本地 firefox 转绿 |
| zoom-reflow / -rev | firefox+webkit | 同上 | 同上（zoom-reflow.js:287 watchLayout） | 同上，本地 firefox 转绿 |
| consumer / -rev | firefox+webkit | 判据坏了（垫片缺） | shimPage 没有 `emulateMediaType` 映射——playwright 的方法名叫 `emulateMedia({media})`（chromium 走 puppeteer 有此方法 ⇒ 掩蔽） | browser.js 补垫片，本地 firefox 转绿 |
| print / -rev / -adv / print-policy(±rev) / print-content(±rev) | firefox+webkit | 判据坏了（能力边界） | `page.pdf` 是 Chromium 专属 API，firefox/webkit 无实现路径 ⇒ 整门没有可跑的判据 | `requireChromium` 守卫 → 显式第三态 SKIP（显式原因，不冒充通过） |
| a11y-ax(±rev) / forced-colors / upload / app-shell / timeline / dir-color / tree / model-viewer | firefox+webkit | 判据坏了（能力边界） | 判据观测走 CDP（createCDPSession / touchscreen 拖拽序列）——CDP 仅 Chromium 有实现；firefox 上报 `page.target is not a function` 等 | 同上 → SKIP |
| beh-reverse | firefox+webkit | 判据坏了（编排器） | 编排内多个子门走 CDP；子门各自 exit 3 会被编排器读成 FAIL | 编排器最外层守卫 → 整门 SKIP |
| tap-highlight | firefox | 判据坏了（适用域） | `-webkit-tap-highlight-color` 是 WebKit 专有属性，Firefox computed 恒为空串——判据在 Firefox 上没有语义 | firefox 下 SKIP（这门本来就是 iOS/WebKit 行为守卫） |
| model-viewer | firefox+webkit | 判据坏了（能力边界） | 3D 触摸拖拽序列用 puppeteer 的 touchscreen.touchStart/touchMove——Playwright 的 firefox/webkit 只有 tap()，按下-拖动-抬起没有实现路径 | requireChromium 守卫 → SKIP |
| token-resolved | webkit | 判据坏了（基线序列化） | 解析值基线按 chromium 序列化（字体栈等 computed 值各引擎序列化不同）；核对本质是「computed 与 tokens.css 一致」，chromium 核即可 | requireChromium 守卫 → SKIP |
| css-validity | webkit | 判据坏了（已知引擎缺口） | scrollbar-color（WebKit 未实现标准属性，本库有 ::-webkit-scrollbar 厂商层兜底）+ overscroll-behavior(-x)（当前 WebKit 构建未实现，自然回弹） | 引擎已知缺口表 → WARN 注理由，三引擎转绿 | `orphans`/`widows`（report.css:400 分页排版）Firefox 长期未实现——声明合法、优雅降级，与门禁已有的 -webkit- WARN 同形态 | 进引擎已知缺口表 → WARN 注理由，不阻断 |

## 环境类（已修观测条件）

| 症状 | 根因 | 处置 |
|------|------|------|
| print / a11y-ax / zoom-reflow / skel-lever 在 **chromium** job 也红（本地 Windows 全绿） | ubuntu 镜像无 CJK/阿拉伯/希伯来字体，文字度量漂移 ⇒ 溢出/行数/可访问名全变 | browsers job 补 `ci-fonts.sh`（quick job 0.27.20 就有，browsers 漏了） |
| accent-gate 等 puppeteer 门禁 1 秒即红 | puppeteer-core 找不到可执行文件——browsers job 只装了 playwright 引擎 | 靠 browser.js 的 findPlaywrightChrome（会扫 ms-playwright 缓存）；剩余错误经诊断放宽（120→900 字符）后逐个看 |
| release-qualify：「浅克隆，v0.27.21 没被取下来」 | checkout 没设 fetch-depth/fetch-tags | 已补（与 quick job 同一条教训） |
| release.yml 首推卡发布前门禁 | api-contract 要真浏览器；此前靠 runner 镜像预装 Chrome，镜像换代后消失 | Chromium 安装挪到发布前门禁之前（release.yml / quick / release-qualify 三处显式装） |
| api-contract「:8000 上是另一棵树」 | `_canary.js/_canary.py` 硬编码 :8000，而探测服务独占**空闲端口** | canary 读 `BASE` 环境变量（共享库各一行）；`_probe` 探测失败时吐子进程真实输出 |

## 已修 · 第二批（dispatch run 44781478377 的证据）

| 门禁 | 引擎 | 分类 | 根因与证据 | 处置 |
|------|------|------|-----------|------|
| accent-gate | 全引擎 | 产品缺陷（工具） | 内嵌脚本 executablePath 硬编码本机 Windows Chrome 路径——CI Linux 上必然 Browser was not found（0 秒即红；诊断放宽后完整报错现形） | 改走 browser.js 的浏览器发现（与全库同源），本地转绿 |
| print / print-adv | chromium（Linux） | 判据坏了（基线平台绑定） | run 数基线按 win32 录制（984），Linux 文字度量跑出 1033——基线无平台标记 ⇒ 假红 | 基线带 platform 字段 + 平台不匹配时第三态 SKIP（与 shot-baseline 平台分集同一课） |
| selftest | chromium（CI） | 判据坏了（发现逻辑） | find_chrome 只有 Windows 注册表路径 ⇒ CI 上永远 None ⇒ 误判环境类假红 | 发现逻辑与 browser.js 同源（CHROME_PATH → 既有候选 → 复用发现 → PATH） |
| print / print-adv | chromium（Linux） | 判据坏了（基线平台绑定） | run 数基线按 win32 录制（984），Linux 文字度量跑出 1033——基线无平台标记 ⇒ 假红 | 基线带 platform 字段（--update 写入）+ 平台不匹配时第三态 SKIP（与 shot-baseline 平台分集同一课）|
| skel-lever / zoom-reflow | chromium（Linux） | 产品缺陷（demo/指南页）·**部分已修** | model-viewer/demo.html 两张**裸表**（320px 下 min-content 溢出 5px，Linux 字体度量触发）——已套 .table 滚动壳 + 补 table.css；guide/sparkline.html 的 6px 溢出元素待定位（Windows 无法复现，Linux 字体度量专属） | model-viewer 已修；sparkline 待 Linux 环境定位元素 |

## 已修 · 第三批（shim 根因 + 引擎差异，dispatch run 44788562329 的证据）

| 门禁 | 引擎 | 分类 | 根因与证据 | 处置 |
|------|------|------|-----------|------|
| clicktest / analysis-report / report / responsive / demo-claim | firefox+webkit | 判据坏了（垫片缺） | shimPage.setViewport 带 isMobile 时**换 context 新页丢已加载文档**——先 goto 再 setViewport(mobile) 的门禁拿到 about:blank ⇒ 全部「缺元素/NaN/截断误报」。puppeteer 语义是只改视口 | 换页前重导航当前 URL（本地 firefox/webkit 全绿） |
| scrollbar（scrollbar-width 断言） | firefox | 引擎观测限制 | Playwright 的 headless Firefox 对 scrollbar-width 的 getComputedStyle **恒报 none**（inline thin 也算 none，CSS.supports=true 同页对照） | firefox 下降级为 CSSOM 规则存在性核对（理由入断言文本） |
| responsive（截断判据） | firefox | 判据坏了（判据域） | display:inline 的 scrollWidth/clientWidth 无意义——Firefox 对 nowrap inline span 恒报溢出，1440 桌面宽也报 20 个 table__unit「截断」（Chromium 不暴露语义差 ⇒ 本地全绿掩盖） | 截断判据跳过 inline 元素（与省略号跳过同型） |
| a11y-ax（date-range 旋钮名） | chromium（Linux CI） | 快照无 locale 钉定 | 原生 date 控件内部旋钮的可访问名跟浏览器 UI locale 走（zh「年 年」/ en「Month Month」） | browser.js 两分支钉 locale=zh-CN（快照从此跨机器确定） |
| nav-drawer（焦点陷阱） | webkit | 🔴 产品缺陷 | nav 抽屉焦点陷阱只在首/尾边界拦截，中间依赖原生 Tab 顺序——WebKit 在 tabindex=-1 容器 + inert 正文下把 BODY 当下一站，第一次 Tab 焦点就逃出抽屉（chromium/firefox 掩蔽） | nav.js 改显式全循环陷阱（三引擎行为一致，nav-drawer 三引擎绿） |
| switch-geom / skel-lever / zoom-reflow | webkit/chromium | 同 shim 缺陷连带 | setViewport 丢文档的同族表现 | 同上，本地 webkit 全绿 |
| print ⑦ 强度（media 代表） | chromium（Linux） | 产品缺陷（新页缺打印设计） | icons demo（70 media 元素）成为全集 media 最大实例；其 35 张 img 图标打印成 2.3:1 灰栅格 | demo 加 @media print 收起装饰网格（print-policy omit 先例）+ 进 print 样本作 media 代表（预算 6） |

## 待诊断（红保持，下一轮 nightly 带证据后继续）

| 门禁 | 引擎 | 现象 | 备注 |
|------|------|------|------|
| clicktest | chromium（CI）+ firefox | card「hover 抬起 transform=无」 | Windows chromium 绿；CI 驱动组合（puppeteer-core 25 × playwright 构建的 chromium）下 hover 观测差异，待驱动组合专项 |
| analysis-report | firefox+webkit | 「缺 .report__main / .report__aside / .kf / figure」——整页结构读不到 | firefox 下页面没加载或选择器落空，待 trace |
| scrollbar | firefox | 「scrollbar-width 生效（实测 none）」 | Firefox 对 scrollbar-width 的 computed 序列化与 chromium 不同（Windows firefox 也复现 ⇒ 引擎行为非环境），待对照 probe 元素 |
| report | firefox+webkit | 多条 NaN 与「抛错：Cannot read properties of null」 | NaN 来自 computed 解析（getComputedStyle 序列化差异），null 来自选择器落空；待逐条 trace |
| a11y-ax | chromium（Linux） | date-range spinbutton 可访问名「年 年」↔「Month Month」 | 🔴 产品缺陷候选：可访问名跟**操作系统 locale** 而非页面语言（date-range.js 的标签来源），快照也无平台/语言分集——两个架构面，挂修复单 |
| switch-geom / nav-drawer | webkit | switch 几何 / 焦点陷阱行为差异 | 本地 webkit 复现 nav-drawer「8 次 Tab 仍在抽屉内」1/50 条不成立——WebKit 焦点行为差异，待细看 |

## 规矩（不因红片而变）

- SKIP 是显式第三态（「跑不了 ≠ 通过」第三态）：写明「本引擎不适用 + 为什么」，不是通过。
- 不许把红改成绿：产品缺陷开修复单修代码；判据坏了修判据本身；
  环境差异修观测条件并记录在本页。
- 每条修复先在本地 `FL_ENGINE=<引擎> MODE=component bash 05-audit/check-all.sh`
  复现，再动手；「chromium 上不报 ⇒ 本地全绿」不算证据。
