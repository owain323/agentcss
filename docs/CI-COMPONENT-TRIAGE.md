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
| print-adv | chromium（Linux） | 判据坏了（平台敏感） | 对抗夹具的**等值断言**（unbreakable↔breakable run 数一致）按 win32 文字度量校准——Linux 度量下断言必假红 | 「跑不了 ≠ 通过」第三态 第三态：牙齿在录制平台已验；Linux 上 print 门禁本体走基线分集照跑 |
| skel-lever（溢出无元素名） | chromium+webkit（Linux） | 可诊断性 | 页级 scrollWidth 无元素身份——sparkline 6px 排查三轮无元素名 | 溢出时顺带报最宽前三个元素（nightly 自指认） |

## 已修 · 第五批（run 44936823108 的证据 + 本地探针，2026-11-22）

| 门禁 | 引擎 | 分类 | 根因与证据 | 处置 |
|------|------|------|-----------|------|
| skel-lever（sparkline 6px） | chromium+webkit（Linux） | 产品缺陷（长 token 度量稳健性） | nightly 自指认 `code right=326`：guide/sparkline.html h3 内 `preserveAspectRatio="none"`（25 字符无断点）；Windows 度量下 right≈318 本就贴边，Linux mono/CJK 度量略宽即溢出。本地探针（逐档加宽 mono 度量）**第一个推页的就是它** | 骨架 typography.css 的 `code` 规则加 `overflow-wrap: break-word`（token 独行放不下才断，常宽零影响；`pre` 内 white-space:pre 无换行点不受影响）。注入式复验：+0.5px/字符仍无页级溢出；三态基线重录后 **PNG 零像素 diff**（只有 stamp 指纹更新） |
| a11y-ax（date-range 旋钮名） | chromium（Linux CI） | 判据坏了（归一没修完整） | 0.27.23 的归一正则只收**单个** token；实测名字是**双词形式**（快照「年 年」/ CI「Month Month」，中间一空格）⇒ 归一零命中——两轮 nightly diff 两侧都是裸名 | 正则改「同一 token 重复一到多次」（反向引用 + `i` 标志；「年 月」混合 token 与作者命名不误伤，17 用例自验）；快照重录 → 旋钮名统一为 `<date-part>`，本地判据失败 0 |
| clicktest（hover 抬起） | chromium（CI） | 可诊断性（根因未定，带证据再修） | run 44936823108：`中心命中=A.card__link`——鼠标确实点在卡片本尊上，transform 仍为无 ⇒ 剩两嫌疑：① `(hover)/(pointer)` 媒体查询在 CI headless 不成立（抬起规则被 `@media (hover: hover) and (pointer: fine)` 门控）② `prefers-reduced-motion: reduce`（card.css 在其下对 :hover 显式 transform:none） | card 用例加**三探针**（matchMedia hover/pointer/reduced-motion）+ **鼠标轨迹**（mousemove 落点是否在卡矩形内）——判据一字未动，下一轮 nightly 一次裁决 |
| switch-geom | webkit（CI Linux） | 可诊断性（根因未定） | run 44936823108：OFF 测得 ON 几何（左20 右2），垂直对称正常；Windows webkit 不复现；`--dur-fast`=120ms < 250ms 等待 ⇒ 过渡"慢"说不成立，剩「transition 冻结 / 状态未生效」两嫌疑 | 加四探针：`checked` 回读 / computed `transform`（卡在 translateX 还是 none）/ `getAnimations` playState（stuck=永远 running）/ reduced-motion；失败时 **+1s 复测**区分「过渡未结算」与「状态没变」 |
| 矩阵 job（新发现） | firefox/webkit（chromium 同） | 观测条件（workflow 未兑现第三态立法） | firefox「执行 129 道全部通过 + 22 道未判定」→ 聚合退出 3 → workflow 步骤按失败上色 ⇒ **矩阵 job 按构造恒红**——四项全修绿它也红（chromium 上 print-adv 的 Linux 第三态同理，未判定 2 道） | gate.yml 组件层步骤上浮 exit 3：绿 + step summary 显式写「已执行判据全部通过；未判定 ≠ 通过」（逐道 SKIP 理由仍在日志）；退出码 1/2/4 照旧红。改的是 workflow 对退出码的解释，判据与门禁本体零改动 |
| 静态三连（新发现） | —— | 流程事故 | 交接文档 `WO-交接版-v3.md` 被 `git add -A` 卷进根目录推上公开仓（738bd3e）：repo-hygiene 未登记条目 / leak 内部台账编号 / release 不在 npm files 白名单。push 快门禁当时被 cancel 没人看见，dispatch 一轮才现形 | `git rm`（内容移 internal/WO-HANDOFF-v3.md 本地留档）。⚠️ 它已进公开仓 **git 历史**——归入作者动作（与 key 轮换同批决策） |
| zoom-reflow（overlay @200%） | webkit | 偶发 | run 44918395385 红（布局指标 1817ms 未稳定），run 44936823108 未复现 | 观察项不修；再复现两次以上再立案 |

## 已修 · 第六批（run 44940962508 的探针证据，2026-11-22）

| 门禁 | 引擎 | 分类 | 根因与证据 | 处置 |
|------|------|------|-----------|------|
| switch-geom | webkit（CI Linux） | 判据坏了（观测时机） | 四探针指认：250ms 时 OFF 的过渡**还在跑**（动画[running:transform]，transform 仍是 ON 的矩阵），**+1s 后正确结算**（左2 右20，transform=none）——状态本来就对，量早了。CSS 时长仅 120ms，慢的是 CI 上样式结算/动画启动的墙钟 | 盲等 250ms 改成**结算等待**：双 rAF（等过渡注册）→ `getAnimations().finished` → 3s 兜底。判据一字未动；三引擎本地绿 |
| clicktest（hover 抬起） | chromium（CI Linux） | 环境差异（观测环境缺指针） | 三探针指认：`hover媒体=✗/fine=✗`（CI chromium 报 pointer:none——抬起规则被 `@media (hover: hover) and (pointer: fine)` 门控整个失效）；`reduced=✗`（排除减动效）、`指针在卡上=√`（排除鼠标问题）。同机 firefox/webkit 的 clicktest 过（它们报 fine）；同二进制 Windows 上报 fine ⇒ Linux ozone-headless 无输入设备的环境差异。`--blink-settings=primaryHoverType/primaryPointerType` 本地 20 组合实测**零翻转**（Chrome 153 已不认，业界流传的咒语失效） | ① `browser.js` 增 `extraArgs` 追加机制（供后续环境钉定用，本次未用到）② card 用例加**缓解探针**（仅在媒体缺失时跑）：桌面仿真 / 触摸关 / 不仿触摸 / 移动仿真 / 清除——下一轮 nightly 指认哪种 CDP 原语能翻转；全部无效则按第三态立法收口（无指针环境不可观测 hover 保证，显式 SKIP + 理由） |
| a11y-ax（选择器按钮名） | chromium（Linux CI） | 快照无 locale 归一（同族第二例） | date 控件的「打开选择器」按钮名同为浏览器侧字符串且双词：快照 zh「显示日期选择器 显示日期选择器」 vs CI en「Show date picker Show date picker」（run 44940962508 diff）——0.27.24 的 `<date-part>` 归一生效后漂移行从旋钮移到按钮 | 同法归一 `<date-picker-toggle>`（枚举 chrome 词表 + 同 token 重复；作者自己的 hasPopup 按钮不受影响）；快照重录，本地判据失败 0 |
| Linux 基线 | —— | 基线对齐（流程） | typography.css 变更移了渲染指纹 ⇒ 快门禁/发布资格的 visual-stamp 三态红（录于旧 head 指纹） | `record-baseline.yml` 重录（run 44941830147）→ fetch `baseline/linux-44941830147` → checkout shots+print 基线 → 随第六批提交。**PNG 零像素 diff**（只有 stamp 指纹更新）——overflow-wrap 在拍摄宽度下无可断 token |

## 已修 · 第七批（run 44943881582 的实证与探针终局，2026-11-22）

| 门禁 | 引擎 | 分类 | 根因与证据 | 处置 |
|------|------|------|-----------|------|
| **CI 实证 ✓（本 run）** | —— | —— | switch-geom **PASS**（webkit，结算等待生效）；a11y-ax **PASS**（chromium，`<date-picker-toggle>` 归一生效）；skel-lever **PASS**（双引擎）。快门禁/发布资格 **success**（Linux 基线对齐生效） | —— |
| clicktest（hover 抬起） | chromium（CI） | 环境不可观测 → **第三态收口** | 缓解探针终局：桌面仿真/触摸关/不仿触摸/移动仿真/清除五种 CDP 原语**全部无效**（hfa 恒定）；平台原生 pointer:none 不可移动。hover 保证定义在「有可悬停指针」的环境上，card.css 的规则本就被 `@media (hover: hover) and (pointer: fine)` 门控——此环境判据不可观测 | card 用例在 `hover:none` 环境**显式 SKIP**（未判定 ≠ 通过 ≠ 失败，不冒充通过）；harness 加第三态行与退出码法典（有失败=1 / 无失败但有未判定=3 / 全绿=0）。判据一字未动；回归由本地 Windows（51/51）与 firefox/webkit CI 承担 |
| gate.yml（上浮失效） | 全引擎 | 判据坏了（我的 workflow 脚本） | 第六批的上浮没生效：GitHub run 默认 **bash -e**——check-all 退出 3 时 shell 当场中止，`code=$?` 执行不到（firefox 照旧 exit 3） | 改 `|| code=$?` 惯用法 + `code=${code:-0}`；本地 bash -e 实证 |

## 审计响应（2026-11-22 第二轮 · 作者审计三条的处置）

| 项 | 分类 | 证据与做法 | 处置 |
|------|------|------|------|
| size-baseline.py 判据与注释矛盾（0.27.11 起的债，12 版未修） | 判据坏了（代码没实现注释的「1KB 门槛」） | `:173` 注释「小文件涨 50% 可能只有几百字节，不值得拦」vs `:178` `d > tol or …` 比率项单独拦——typography.css +410B ⇒ +13.2% 被拦。**两轮（0.27.11 / 0.27.24 第五批）都走了「重录基线」绕行**——同一动作重演两次即债 | 代码对齐注释：文件级改 **gzip/raw 双绝对门槛**（`dabs > 1024 or rabs > 1024`），比率只剩展示（总量侧不动：总量的 5% 是几十 KB，比率项语义成立）。**证明**：① 回退 0.27.23 基线，新逻辑下 +410B 不重录即绿（绕行路径消失）② 反向变异 +2KB 不可压缩 ⇒ exit=1、文件被点名 ③ `--selftest` 4 用例（selftest-all 自动发现）——矛盾能活 12 版就是因为文件级逻辑没有反向控制 |
| 发得出去 ≠ 三引擎全绿（0.27.23 在矩阵连红三轮期间照发） | 观测条件（发版流程缺门） | `publish:check` = 静态层 + pack-smoke，矩阵不在发版链上 | ① `release-run.sh` 新增 `preflight [sha]` 子命令：查该提交上最新 gate.yml dispatch run，非 success 拒绝（正例 df88907 exit=0 / 反例 absent exit=1 带恢复指引）② release.yml 发布前守门步硬卡同一检查（新增 `actions: read`）。**恢复路径**：dispatch → 等六 job 全绿 → 打 tag / 重跑发布 |
| visual-stamp/visual 是失败第一名（5 次失败 run 29 处失败占 10 处） | 观测条件（"记得去 dispatch"的摩擦） | 成因恒定：win32 当场能录，Linux 要人工 `gh workflow run record-baseline` + 合并 | **案 A 变体**：visual-stamp-gate 过期/缺失时落机器可读标记 `05-audit/.stamp-stale.json`（伪造 stamp 实测：红 + 标记落 / 还原：绿 + 标记清）⇒ gate.yml 快门禁与发布资格两 job（仅 master）读到标记**自动派发** record-baseline（S4 修订：job 级 `actions: write` 只为派发，不给 contents:write；record-baseline 加并发组防双派发竞态）。**门禁照旧红不掩盖；基线分支的合并保留为像素 diff 的人工复核点**。案 B（基线出仓 artifact 化）不选：动 shot/print 门禁的读路径 + 伤本地克隆体验 + 录制来源可信度反而要另建 |
| 审计更正（双向证据纪律） | —— | 「hover 抬起用 margin 改位」是门禁**判据文案**不是缺陷本体——探针实证根因是 CI chromium 报 pointer:none（环境不可观测），已按第三态立法显式 SKIP。sparkline 溢出才是真产品缺陷（已修） | 审计的另一半「nightly 红的是真缺陷」成立一半；「0.27.23 照发」的流程批评成立，已由上两条接住 |
| laptop-agentcss-write-20261031 部署密钥 | 安全债（结论补齐） | 实测：`read_only=false`（可写），指纹 = 本机 `~/.ssh/agentcss_deploy_ed25519`（agentcss-fix 的 `core.sshCommand` 指定它）——**就是本仓当前的推送凭据**；无任何 workflow 依赖它；本机无账号级 agentcss 密钥（id_ed25519 是 frontend-lib 仓的部署密钥、id_rsa 未注册） | **结论：保留**。它是仓库级作用域的推送凭据，撤销即断本机推送；风险边界=仅此仓。若要撤销：先在 GitHub 账号级注册 SSH key 并改 `core.sshCommand` → 再删部署密钥——作者动作 |
| E:\frontend-lib 落后 | 流程债（只报不收） | 实测：本地 963b255，落后 **85 提交**（不止 7）；agentcss 是延续仓（可纯快进）；examples/finance-report/index.html 有一处未提交的一词改动（归母净利率→净利率，85 提交未碰该文件） | 已 `git merge --ff-only origin/master` 快进到 5cd859e，VERSION 0.27.23；一词改动**原样保留**在工作区——方向是术语精确度下降（归母净利率是标准财务术语），建议作者复核是否本意，确认后要么提交要么放弃 |

## 待诊断（清零 · 终验）

无。四个交接项全部收口，**run 44945009886（df88907）六 job 全绿——夜间矩阵建成以来首次**：
chromium/firefox/webkit 三矩阵 + 快门禁 + 发布资格 + API 契约全部 success。
chromium 聚合「已执行 129 道全部通过 + 3 道未判定（engine / print-adv / clicktest）」→
exit 3 → 上浮绿 + step summary 留痕「未判定 ≠ 通过」。
clicktest 的 [SKIP] 行与 gate 级第三态在日志中可见，判据一字未动。

观察项保留：zoom-reflow（overlay @200%，webkit）偶发——44918395385 红过一次、
44940962508/44943881582 未复现；再复现两次以上再立案。

## 规矩（不因红片而变）

- SKIP 是显式第三态（「跑不了 ≠ 通过」第三态）：写明「本引擎不适用 + 为什么」，不是通过。
- 不许把红改成绿：产品缺陷开修复单修代码；判据坏了修判据本身；
  环境差异修观测条件并记录在本页。
- 每条修复先在本地 `FL_ENGINE=<引擎> MODE=component bash 05-audit/check-all.sh`
  复现，再动手；「chromium 上不报 ⇒ 本地全绿」不算证据。
