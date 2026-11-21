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

## 已修 · 第四批（run 44918395385 的证据）

| 门禁 | 引擎 | 分类 | 根因与证据 | 处置 |
|------|------|------|-----------|------|
| workflow | 全引擎 | 判据坏了（我引入的回归） | record-baseline.yml 里 `pkill -f http-serve.py` 的裸脚本名被 workflow-gate 解析成不存在的引用 | 步骤重写：PID 跟踪 + kill（workflow-gate 本地绿） |
| a11y-ax（date-range 旋钮名，locale 钉定后仍漂） | chromium（Linux CI） | 快照无 locale 归一 | 原生 `<input type=date>` 的内部旋钮名是 **Chromium 浏览器侧字符串**——`--lang`/Playwright locale 都改不动（CI en_US 转录 Month Month） | 转录归一：date 部分旋钮名 → `<date-part>`（浏览器 chrome 非作者内容，归一不损失回归能力） |
| demo-claim（analysis-report 对照块） | firefox | 判据坏了（单引擎校准阈值） | data-bad `>250` 是 chromium mono 度量校准的——firefox mono 下同串量得 228 | 分界校准 200（good ≤200 / bad >200 两引擎都成立），配对断言语义不变 |
| print-adv | chromium（Linux） | 判据坏了（平台敏感） | 对抗夹具的**等值断言**（unbreakable↔breakable run 数一致）按 win32 文字度量校准——Linux 度量下断言必假红 | E153 第三态：牙齿在录制平台已验；Linux 上 print 门禁本体走基线分集照跑 |
| skel-lever（溢出无元素名） | chromium+webkit（Linux） | 可诊断性 | 页级 scrollWidth 无元素身份——sparkline 6px 排查三轮无元素名 | 溢出时顺带报最宽前三个元素（nightly 自指认） |

## 待诊断（红保持，下一轮 nightly 带证据后继续）

| 门禁 | 引擎 | 现象 | 备注 |
|------|------|------|------|
| clicktest（hover 抬起） | chromium（CI） | 待 nightly 带诊断重跑 | 已加双 rAF settle + 中心命中元素诊断——nightly 会自指认 hover 点的命中元素（Windows 复现不了，CI 驱动组合专属） |
| switch-geom | webkit（CI Linux） | OFF 态滑块渲染在右（应左）——Windows webkit 不复现 | WebKit-Linux 渲染差异，证据已留 CI 日志；待 Linux 环境复现或渲染层分析 |
| skel-lever（sparkline 6px） | chromium+webkit（Linux） | 页级溢出无元素名 | 已加最宽三元素诊断——下一轮 nightly 自指认元素后修复 |
| a11y-ax（date-range locale） | 已修 | 转录归一 `<date-part>`（浏览器 chrome 非作者内容） | 本地绿；CI 待 nightly 确认 |

## 规矩（不因红片而变）

- SKIP 是显式第三态（「跑不了 ≠ 通过」第三态）：写明「本引擎不适用 + 为什么」，不是通过。
- 不许把红改成绿：产品缺陷开修复单修代码；判据坏了修判据本身；
  环境差异修观测条件并记录在本页。
- 每条修复先在本地 `FL_ENGINE=<引擎> MODE=component bash 05-audit/check-all.sh`
  复现，再动手；「chromium 上不报 ⇒ 本地全绿」不算证据。
