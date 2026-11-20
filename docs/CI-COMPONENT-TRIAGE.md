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
| print / -rev / -adv / print-policy(±rev) / print-content(±rev) | firefox+webkit | 判据坏了（能力边界） | `page.pdf` 是 Chromium 专属 API，firefox/webkit 无实现路径 ⇒ 整门没有可跑的判据 | `requireChromium` 守卫 → E153 第三态 SKIP（显式原因，不冒充通过） |
| a11y-ax(±rev) / forced-colors / upload / app-shell / timeline / dir-color / tree / model-viewer | firefox+webkit | 判据坏了（能力边界） | 判据观测走 CDP（createCDPSession / touchscreen 拖拽序列）——CDP 仅 Chromium 有实现；firefox 上报 `page.target is not a function` 等 | 同上 → SKIP |
| beh-reverse | firefox+webkit | 判据坏了（编排器） | 编排内多个子门走 CDP；子门各自 exit 3 会被编排器读成 FAIL | 编排器最外层守卫 → 整门 SKIP |
| tap-highlight | firefox | 判据坏了（适用域） | `-webkit-tap-highlight-color` 是 WebKit 专有属性，Firefox computed 恒为空串——判据在 Firefox 上没有语义 | firefox 下 SKIP（这门本来就是 iOS/WebKit 行为守卫） |
| css-validity | firefox | 判据坏了（已知引擎缺口） | `orphans`/`widows`（report.css:400 分页排版）Firefox 长期未实现——声明合法、优雅降级，与门禁已有的 -webkit- WARN 同形态 | 进引擎已知缺口表 → WARN 注理由，不阻断 |

## 环境类（已修观测条件）

| 症状 | 根因 | 处置 |
|------|------|------|
| print / a11y-ax / zoom-reflow / skel-lever 在 **chromium** job 也红（本地 Windows 全绿） | ubuntu 镜像无 CJK/阿拉伯/希伯来字体，文字度量漂移 ⇒ 溢出/行数/可访问名全变 | browsers job 补 `ci-fonts.sh`（quick job 0.27.20 就有，browsers 漏了） |
| accent-gate 等 puppeteer 门禁 1 秒即红 | puppeteer-core 找不到可执行文件——browsers job 只装了 playwright 引擎 | 靠 browser.js 的 findPlaywrightChrome（会扫 ms-playwright 缓存）；剩余错误经诊断放宽（120→900 字符）后逐个看 |
| release-qualify：「浅克隆，v0.27.21 没被取下来」 | checkout 没设 fetch-depth/fetch-tags | 已补（与 quick job 同一条教训） |
| release.yml 首推卡发布前门禁 | api-contract 要真浏览器；此前靠 runner 镜像预装 Chrome，镜像换代后消失 | Chromium 安装挪到发布前门禁之前（release.yml / quick / release-qualify 三处显式装） |
| api-contract「:8000 上是另一棵树」 | `_canary.js/_canary.py` 硬编码 :8000，而探测服务独占**空闲端口** | canary 读 `BASE` 环境变量（共享库各一行）；`_probe` 探测失败时吐子进程真实输出 |

## 待诊断（红保持，下一轮 nightly 带证据后继续）

| 门禁 | 引擎 | 现象 | 备注 |
|------|------|------|------|
| clicktest | chromium（CI）+ firefox（本地） | card「hover 抬起 transform=无」——hover 后无 transform | Windows chromium 绿；CI 驱动是 puppeteer-core 25 + playwright 构建的 chromium，疑似驱动组合下的 hover 观测差异，待本地 firefox trace 细看 |
| analysis-report | firefox+webkit | 「缺 .report__main / .report__aside / .kf / figure」——整页结构读不到 | firefox 下页面没加载或选择器落空，14s 失败；待 trace |
| scrollbar | firefox | 「scrollbar-width 生效（实测 none）」 | firefox 对 scrollbar-width 的 computed 序列化与 chromium 不同，待对照 probe 选择器 |
| report | firefox+webkit（CI 05c57d0） | 多条「抛错：Cannot read properties of null」 | 疑似多参 evaluate 同族（已修一批），05c57d0 之后的 nightly 应重评 |
| token-resolved / switch-geom | webkit（CI） | 待本地 webkit 组件层复现 | 本地 webkit 跑完补此行 |

## 规矩（不因红片而变）

- SKIP 是显式第三态（E153）：写明「本引擎不适用 + 为什么」，不是通过。
- 不许把红改成绿：产品缺陷开修复单修代码；判据坏了修判据本身；
  环境差异修观测条件并记录在本页。
- 每条修复先在本地 `FL_ENGINE=<引擎> MODE=component bash 05-audit/check-all.sh`
  复现，再动手；「chromium 上不报 ⇒ 本地全绿」不算证据。
