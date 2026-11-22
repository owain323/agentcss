# ERRORS-INDEX — 缺陷编号释义

为什么有这个文件：代码注释里用 `E###` 指向一条具体的判断错误（判据取错参照物、
门禁在零对象上静默通过之类）。编号本身不自解释，所以这里给每个被引用的
编号一行释义：编号 / 一句话 / 首现版本 / 关联判据。

判据：`05-audit/error-ref-gate.py` —— 代码里出现的每个 `E###` 必须在本文件登记。
编号边界与 `terms.py` 的 INTERNAL_ID_RE 同一课（前面不能是 `[0-9A-Za-z#_-]`，
后面不能是字母数字，十六进制颜色 `#6E747E` 不咬）。1-2 位编号与 pdf-export /
app-shell 的**本地用例标号**同形，条目里标注了多义；`noqa:` 后面的 PEP8 码
不在这个命名空间，不收。`E999` 等夹具占位符也登记（注明非错误编号）。

| 编号 | 一句话 | 首现 | 关联判据 |
|------|--------|------|----------|
| E1 | pdf-export：导出一份真 PDF（产物真实性）；app-shell：反向·只去滚动容器 overflow（本地用例标号，多义） | 0.24.2 | pdf-export-gate.js / app-shell-check.js |
| E2 | pdf-export：同输入两次导出字节一致（确定性）；app-shell：反向·侧栏改 fixed；combobox：本地用例总数标号 | 0.24.2 | pdf-export-gate.js / app-shell-check.js |
| E3 | pdf-export：--paper 真换纸幅；app-shell：反向·窄屏强显侧栏 | 0.24.2 | pdf-export-gate.js / app-shell-check.js |
| E4 | pdf-export：页数=预算 ⇒ 通过（预算内放行） | 0.24.2 | pdf-export-gate.js |
| E5 | pdf-export：超预算 ⇒ rc5 + 三条出路 + 旧 PDF 不变 + 产物另存（渲染成功但判定失败组） | 0.24.2 | pdf-export-gate.js |
| E6 | pdf-export：打印规则（@media print）真的到达产物 | 0.24.2 | pdf-export-gate.js |
| E7 | pdf-export：边距参数真实影响页数 | 0.24.2 | pdf-export-gate.js |
| E8 | pdf-export：无浏览器 ⇒ rc3 + 说人话 + 无堆栈；terms：豁免过宽（裸 owner/repo 放行一切）同号教训 | 0.24.2 | pdf-export-gate.js / terms.py / ai/pdf.js |
| E9 | pdf-export：非法参数 ⇒ rc2 不产怪文件；预算 0 不当无界；报错回显原始输入 | 0.24.2 | pdf-export-gate.js |
| E10 | pdf-export：不给 --out ⇒ 落在同名 .pdf（默认输出） | 0.24.2 | pdf-export-gate.js |
| E11 | pdf-export：产物合格——字体链闭环 / 每页有文本（交给 print-gate 分析器） | 0.24.2 | pdf-export-gate.js |
| E12 | pdf-export：导出器与测试侧定位到同一个 Chrome（定位一致性交叉核对） | 0.24.2 | pdf-export-gate.js / ai/pdf.js |
| E13 | pdf-export：长文档页树 /Count 必须解析到根（分层页树）；元反向：旧读法同样本读错 | 0.24.2 | pdf-export-gate.js |
| E14 | pdf-export：ready-selector 等到延迟新增内容真的进入 PDF（比较文字 runs） | 0.27.0 | pdf-export-gate.js / terms.py |
| E15 | pdf-export：真实金融长文每页都有文字（抓透明面板与空白尾页） | 0.24.2 | pdf-export-gate.js |
| E16 | pdf-export：浏览器失败 ⇒ ok:false，已有 PDF 的 SHA-256 不变（最危险的假成功） | 0.27.17 | pdf-export-gate.js |
| E17 | pdf-export：ready 永不出现 ⇒ 有界 timeout，旧产物不变 | 0.27.17 | pdf-export-gate.js |
| E18 | pdf-export：非法 wait / 空 selector / 非法 CSS ⇒ 统一 usage，不许静默按默认导出；判据聋瞎同型 | 0.24.2 | pdf-export-gate.js / theme-scope-gate.js |
| E19 | pdf-export：浏览器起不来 ⇒ 结构化失败而非 EPIPE 崩溃；terms：两道门禁共用身份判据（单源） | 0.24.2 | pdf-export-gate.js / terms.py / leak-scan.py |
| E20 | pdf-export：硬杀留下的临时 HTML——下次导出清旧的、不碰新的 | 0.27.17 | pdf-export-gate.js |
| E21 | pdf-export：超预算失败 ⇒ 旧 PDF 逐字节不变 + 完整产物另存诊断路径；元反向：替换搬回判定前必被覆盖 | 0.27.17 | pdf-export-gate.js / check-all.sh |
| E22 | pdf-export：页树两套读法不一致 ⇒ 旧 PDF 不变 + 产物另存（后置判定必须在 rename 之前） | 0.27.17 | pdf-export-gate.js / check-all.sh |
| E23 | pdf-export：network-policy=off 与 strict 的本地导出逐字节一致（新策略零回归） | 0.27.7 | pdf-export-gate.js / network-policy-gate.js |
| E24 | pdf-export：CLI 白名单接受 strict；远程环回被拒绝且旧 PDF 不变 | 0.27.7 | pdf-export-gate.js |
| E25 | pdf-export：非法 policy 值在库与 CLI 都是 usage | 0.27.7 | pdf-export-gate.js |
| E26 | 门禁自身携带身份路径 / 词表痕迹＝自己制造泄漏 | 0.8.5 | leak-scan.py / outsider-audit.py |
| E27 | fix-start-here：静默退回是「漏掉整整一层」事故的温床 | 0.8.5 | fix-start-here.py |
| E28 | 成熟度探测逻辑单一来源（maturity-gate 重算会与 gen-ai-contract 打架） | 0.8.5 | gen-ai-contract.py / maturity-gate.py |
| E29 | gen-ai-contract：判据写成永真 ⇒ 门禁被架空 | 0.8.5 | gen-ai-contract.py |
| E31 | 同一个判定写两遍必然漂移（单一来源铁律） | 0.9.0 | 全库约定；gate-selfcheck.py 判据 ④ 挡第四份 CHANGELOG 解析器 |
| E34 | admission-gate：准入判据的真踩事故 | 0.9.0 | admission-gate.py |
| E35 | shot-baseline：视觉回归「未执行」冒充通过；截 0 张看不出是环境问题；比错图（家族最阴） | 0.9.0 | shot-baseline.py |
| E36 | pkg-name-gate：判据第一版过宽的同类修正 | 0.9.0 | pkg-name-gate.py |
| E38 | 历史台账条目（代码零引用，仅 CHANGELOG 记载） | 0.8.5 | — |
| E39 | behavior-matrix：反向控制突变体必须与当前真实状态解耦（改好代码不能让自测失效） | 0.9.0 | behavior-matrix-gate.py / maturity-gate.py |
| E40 | behavior-cores：测任何东西之前先读真实签名（照想象写 API = 全假失败） | 0.9.0 | behavior-cores.test.mjs |
| E41 | 守卫插到 return 之后＝门禁看起来在工作实际什么都没测（批量插零文件守卫的教训） | 0.9.0 | doc-facts-gate.py / numeric-gate.py / proper-noun-scan.py |
| E43 | CHANGELOG 版本标题解析写三份各不相同 ⇒ 只允许 _changelog.py 一份 | 0.9.0 | _changelog.py / gate-selfcheck.py 判据 ④ |
| E50 | fixture 前提错了 ⇒ 看起来像判据没牙（eol-gate 同病） | 0.8.8 | eol-gate.py |
| E61 | 「数字对不上」和「对得上」在终端里长得一模一样（输出可辨识性） | 0.9.0 | behavior-matrix-gate.py |
| E69 | README「共 N 个（stable A / beta B）」列举式声明也要登记（数字改了清单没改） | 0.11.16 | doc-facts-gate.py |
| E86 | tree demo「默认全部收起」其实全展开 ⇒ 判据建在错误前提上全绿 | 0.11.16 | tree-check.js |
| E123 | 编号形态本身要有边界（`E` + 三位数字；排除十六进制颜色与标识符；leak-scan 的 E\d{3} 判据来源） | 0.27.20 | terms.py / leak-scan.py |
| E129 | delta-check：判据写文件级没写用例级（与 pkg-name / do-dont 注释坑同类） | 0.11.16 | delta-check.js |
| E137 | leak-scan 自检夹具正例「括号内编号（E137）」；CHANGELOG 0.11.16 批次台账条目 | 0.11.16 | leak-scan.py |
| E139 | 精简档令牌数也是会被写死的事实（两处口径不一致永远对不上） | 0.12.0 | doc-facts-gate.py |
| E142 | metric：不判声明判实测（tabular-nums 在等宽字族上是无效动作） | 0.11.16 | metric-check.js |
| E143 | metric：RTL 膨胀后顶破视口 ⇒ 判量出来的行数，不判写法 | 0.11.16 | metric-check.js |
| E145 | table：符号必须跟打印出来的数字同号；leak-scan 夹具正例 | 0.12.0 | table-check.js / leak-scan.py |
| E149 | check-all：服务子进程必须 disown（wait 不带参数等所有子进程 ⇒ 永久挂住） | 0.12.0 | check-all.sh |
| E150 | selftest-all：完整子输出落盘（不可复现的红只印 4 行摘要查不了） | 0.12.0 | selftest-all.py |
| E153 | 第三态「跑了但判不了」不许冒充 PASS；注释写绝不报通过、代码却 return 0 | 0.12.0 | check-all.sh / engine-gate.js |
| E154 | check-all：每轮先清空 .git/tmp（只 mkdir 不清理 ⇒ 轮次间互相污染） | 0.12.0 | check-all.sh |
| E155 | check-all：唯一的 EXIT 出口；trap 是替换不是追加；服务必须 disown | 0.12.0 | check-all.sh |
| E166 | maturity-gate：自检报「判据没抓到」其实判据没瞎（反向控制前提错） | 0.12.0 | maturity-gate.py |
| E169 | upload：不透明底要从父层找，不能从元素自身开始 | 0.12.0 | upload-check.js |
| E170 | 切了状态 ≠ 样式落到终态（过渡未结束就读样式）；动画推到终态再量 | 0.12.0 | forced-colors-check.js / upload-check.js |
| E172 | setContent 前先确认 :8000 是门禁服务器（单线程 demo 服务压垮即假红）；networkidle0 ≠ 布局已定 | 0.12.0 | app-shell-check.js / rtl-render.js / upload-check.js |
| E183 | setContent 不换 window：实例要挂在刷新后仍在的窗口上；timeline 刷新回 about:blank 要重灌 | 0.12.0 | app-shell-check.js / timeline-check.js |
| E189 | timeline：图标与文字拼成可访问名「圆点 季报披露」（命名拼接事故） | 0.12.0 | timeline-check.js |
| E193 | perf：清单里少一行没人会数（零值上全绿同族） | 0.12.0 | perf-gate.js |
| E222 | theme-scope：对比度判据安静地永远通过（选择器永远匹配不到的同类形态） | 0.17.0 | theme-scope-gate.js |
| E228 | 并发数过高 ⇒ 资源争抢假红（6 核复跑全绿的现场） | 0.17.0 | check-all.sh |
| E229 | accent-gate：自检超时把失败算到下一个被测脚本头上（复发源） | 0.17.0 | accent-gate.py |
| E241 | shot-baseline：冻结 CSS 的覆盖范围要枚举到实际会动的选择器（* 选不到 UA shadow 伪元素） | 0.17.0 | shot-baseline.py / render-merge-experiment.js |
| E254 | print-policy：同特异性后加载静默覆盖前一个（抓「被更强的声明压掉」）；leak-scan 夹具正例 | 0.24.2 | print-policy-gate.js / coverage-gate.py / check-all.sh |
| E255 | print-policy：复刻删 visibility:visible 的判红（display 与高度全对也要抓）；leak-scan 夹具正例 | 0.24.2 | print-policy-gate.js |
| E258 | 历史台账条目（代码零引用，仅 CHANGELOG 记载） | 0.24.2 | — |
| E264 | pdf-export：报错必须回显使用者打进去的那串字符（不是 NaN→null） | 0.24.2 | pdf-export-gate.js |
| E265 | api-form：静态服务被占 ⇒ 全局同时消失（「全部 absent」是没取证，不是契约错） | 0.24.2 | api-form-gate.py |
| E288 | coverage：JS 拼串生成的类名会被漏看（拼接判据要改成完整字面量映射） | 0.24.2 | coverage-gate.py |
| E292 | 删除必须 command rm（平台把 rm 注入成送回收站）；TEMP/TMP 不许指到仓库 | 0.25.2 | check-all.sh / pack-smoke.sh / release-run.sh |
| E294 | AI 令牌描述的语义归属（--check 只保证 JSON 与生成器一致，不保证生成器是对的） | 0.25.2 | ai-token-desc-gate.py / gen-ai-contract.py |
| E295 | motion：必须 void el.offsetWidth 强制重排（同帧改类再量是旧值） | 0.25.2 | motion-concurrency.js |
| E296 | print-gate：iframe「加载完」≠「内容装得下」（旧判据只看 sheets>0 ⇒ 打印产物腰斩） | 0.25.2 | print-gate.js |
| E297 | 源码挂到 window 的全局，d.ts 必须声明（24 个挂载只声明 16 个） | 0.25.3 | types-globals-gate.py |
| E298 | 历史台账条目（代码零引用，仅 CHANGELOG 记载） | 0.25.3 | — |
| E299 | xss-sink：旧内核 type 回退成文本 ⇒ value 可为任意串；leak-scan 夹具正例 | 0.25.2 | xss-sink-gate.py / leak-scan.py |
| E303 | print-gate：活标本框要撑到内容高度才算就绪（t=150ms 的半成品版面被当成就绪） | 0.25.2 | print-gate.js |
| E312 | dist-js-parity：自检往 dist/ 写临时探针 ⇒ 必须 @serial（pack-hygiene 同步豁免） | 0.25.4 | check-all.sh / pack-hygiene-gate.py |
| E315 | entry-resolve：零视野守卫——0/0 不是通过 | 0.25.4 | entry-resolve.js |
| E316 | print-gate：切 print 媒体后 iframe 重排；产物残缺 ⇒ 作废重来限次重渲染，不比基线 | 0.25.4 | print-gate.js |
| E319 | 判据看「当下恰好有没有」不看「能不能抓」（剥注释 / 剥 style 同条规则） | 0.25.4 | prose-gate.py / delta-check.js |
| E325 | release-gate：不许退回长期令牌（7 天到期 ⇒ 发布断在半路） | 0.25.4 | release-gate.py |
| E327 | release-gate：发布契约三条实测事故之一 | 0.25.4 | release-gate.py |
| E366 | pdf-export 元反向：变异没做成却报通过＝空转 | 0.26.0 | pdf-export-gate.js |
| E382 | bump-version：版本字符串还会出现在文档站生成物（刷新后现算复验） | 0.26.0 | bump-version.py |
| E386 | bump-version：自检里 release-gate 失败必须让本脚本非 0 | 0.26.0 | bump-version.py |
| E396 | release-run：版本可见 ≠ 已发布完成（attestation 索引滞后于版本本体，第一次 404 之后 200） | 0.27.9 | release-run.sh |
| E747 | terms：十六进制颜色 #6E747E 里的 E747 前面是数字（判据咬错人比不咬更坏的实测） | 0.27.20 | terms.py |
| E997 | leak-scan 自检夹具：更高版本段被扫（占位术语，非错误编号） | 0.8.5 | leak-scan.py |
| E998 | leak-scan 自检夹具：已发布段被豁免（占位术语，非错误编号） | 0.8.5 | leak-scan.py |
| E999 | leak-scan 自检夹具：Unreleased 段被扫（占位术语，非错误编号） | 0.8.5 | leak-scan.py |
