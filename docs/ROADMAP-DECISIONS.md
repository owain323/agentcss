# 剩余项裁决 · 决策材料（0.27.19）

> 2026-11-19 三角色评审（工程官 / 质量门神 / 产品官，"软件工坊"方法论）后，
> 主理人合并裁决的**遗留项终态**。口径【事实】= 仓库/npm 可查；【判断】= 分析。
> 用户锚（npm 下载 537 次全为镜像脉冲、GitHub 0/0/0，2026-11-19 实测）：
> 真实用户 = 作者本人 + 作者环境里的便宜模型。每一项的"为谁"只认这两个身份。

## 卡一 · maturity ladder（40/41 全 stable，阶梯退化）

**现状**：maturity 是算出来的（demo / 专属门禁 / statesOnDomAttributes /
behaviorDebt 四判据，maturity-gate 看守）；41 个组件全部 stable ⇒ strict 档
与 standard 档实际无差别。
**选项**：① 保持退化不动（阶梯在第一个 beta 组件出现时自然分化）；② 收紧判据
提前分化（需要点名"哪个组件其实没到 stable"）；③ 1.0 冻结。
**默认建议**：① 不动——点名不出第一个该降级的组件（【判断】读判据通过率：
41 组件 demo/门禁/行为债全绿），收紧是给不存在的区分度需求刷分。
**为什么机器关不了**：判据全绿 ⇒ 门禁无法替人回答"要不要人为造 beta"。

## 卡二 · CHANGELOG 打包策略

**现状**：CHANGELOG.md 429 KB（0.27.19 实测）随 npm 包发（release-gate ⑨
守着"对外文档都进包"）；`docs/GUIDANCE.md` 曾写 352 KB——已修正。
**选项**：① 整本随包（现状）；② 近 N 版随包 + 站点全本（npm=版本快照 /
站点=滚动文档，RELEASE-PROCESS §1 的渠道语义现成）。
**默认建议**：① 不动。npm 无外部升级场景（0 star / 0 fork，镜像脉冲下载），
"找不到记录"事件一次都没发生过——没有工单依据。触发条件：出现第一个真实
外部使用者，或包体积成为实测痛点（pack-smoke 有账）。
**为什么机器关不了**：决策取决于"未来是否有外部使用者"，机器判不了未来。

## 卡三 · ESM 1.0

**现状**：esm/ 19 个 .mjs 全由 gen-esm.py 生成（--check 门禁在）；
types/index.d.ts 声明；package.json description 已含 machine-readable contract。
**选项**：① 宣告 1.0（语义冻结，约束作者自己的升级自由——每次破坏性
改动都得 major）；② 保持 0.x + 机读契约（当前形态已经传达"稳定"）。
**默认建议**：②——一年保质期内，冻结成本 > 诚实信号收益【判断】。
触发条件：出现第二个真实使用者，或 ESM 消费端实证案例出现。
**为什么机器关不了**：语义冻结是承诺，不是可测性质。

## 卡四 · 冻结项终态（每项一条"为什么机器关不了"）

| 项 | 终态 | 理由（含触发条件） |
|---|---|---|
| benchmark-records 真实跑批 | **✅ 已完成** | DeepSeek-chat 2026-11-20：T 组 18/30 (60%)，30 次调用零错误，benchmark/models/deepseek-chat.json 通过 --check-records。4 个 0% 任务（T01/T04/T06/T07）待归因（判据 vs 模型）。后续可加第二个模型对照 | 机制全就位且诚实（UNVERIFIED / RC=3 / "不编数字"）。缺的唯一东西是模型 API 权限【事实：README 原话】。给了 key：10 任务 × 20 attempts × 2 模型 ≈ 400 次调用，1 天出记录；不给：UNVERIFIED 是满分形态，再动它只会把"诚实"搅浑 |
| 工作流文章 | **✅ 素材已实测** | DeepSeek-chat 走通 T 组 benchmark（60% pass rate），冷启动数据已采集——文章素材从"假设"变为"实测" | 0 star/0 issue ⇒ "下一个使用者"不存在，文章读者为零。改形为"一次真实便宜模型跑通 START-HERE 三步"（喂 R4 首条记录 + 上手路径验收）——同样等模型 API。两事一源 |
| Firefox/WebKit 基线 | **砍** | 桌面引擎假绿已两次更正修完（SUPPORT.md 四档体系）；agentcss 实际消费场景是 Android WebView / 微信 XWEB——仓库自己写着"Android WebView 是最大空白"，补基线该去真机（0.27.19 已跑一轮），不是桌面 Firefox |
| icon catalog（2359 全量索引） | **冻结在 icon-forge** | ai-surface 余量仅 9.3 KB（0.27.19 实测 93054/102400）；全量索引必爆账。数据源与 SOURCE-LOCK 在 icon-forge 侧齐备，`ai icons` 查询 35 个已覆盖真实查询频率。触发条件：作者真实工作流中出现"锁外图标"需求 ≥ 2 次 |
| icon-add（门禁生成） | **冻结在 icon-forge** | 生成管线与数据源（_vendor 2359 + SOURCE-LOCK）都在 icon-forge 侧；agentcss 纪律"只放消费产出、改图形回 icon-forge"。agentcss 侧已交付 `ai icon-check`（唯一真源 icon-gate.py 的 CLI 包装 + 查询端冒烟） |
| announcement recipe | **冻结** | 无一次真实消费事件；新 recipe = 组件级全套成本（2-3 天起）。触发条件：真实页面需求出现 |
| LVGL kiosk 变体 | **永久冻结** | LVGL 是 C 嵌入式 GUI 库，不渲染 HTML/CSS——agentcss（CSS 库）对它无直接通路。这不是"待实测"而是"类别不匹配"。如果未来 LVGL 项目出现配套 Web UI（如设置面板），届时重新评估 | 全仓零 lvgl/kiosk 前科；LVGL 是 C 嵌入式 GUI，CSS 库是否够得着取决于"项目里哪一块真的渲染 HTML"——待 作者实测确认渲染环境后再谈（若确认有 webview，升为全场最高价值项） |
| md-render 图片内联 | **冻结待触发** | md-render 是 MANUAL-ONLY 工具；AC 已备（字节预算/回退开关/内联正确性三判据）。触发条件：一次真实的"md 里有本地图片导致产物离线打不开"事件 |
| MODE=full 提速 | **记账了结** | Top10 建账（selftest-all 164 / rtl-render 118 / beh-reverse 108 …）；BUDGET 300→900（0.27.19 实测 6 轮 675-874s，带日期注释）。worktree 并行化（1 天）挂在"门禁慢到被跳过"的真实事件上——当前是分钟级疼，不是天级疼 |

## 遗留清零状态（本页的机器对账）

| 项 | 状态 |
|---|---|
| R1 CSS 动画 | ✅ 已交付（icons-anim 组件 + 2 道门禁 + reduced 真浏览器验证） |
| R2 真机回归 | ✅ 已交付（bench35 26/26 + bench28 Chrome69 old-engine 5/5 + 鉴别力探针 + 留痕） |
| R3 三件套 | ✅ 缩水交付（icon-check + 锁值三方判据；catalog/icon-add 冻结在 icon-forge，理由见上） |
| R4 benchmark | 🧊 冻结待条件（模型 API）——本页显式声明 |
| R5 文章 | 🧊 冻结改形（同 R4 条件）——本页显式声明 |
| R6 引擎基线 | ❌ 砍（理由见上） |
| R7 提速 | ✅ 记账了结（BUDGET 900 + Top10 入档） |
| R8 决策材料 | ✅ 本页 |
| R9 | 🧊/❌ 混合（见卡四） |

> 下一版动作只剩：给了模型 API ⇒ 跑 benchmark + quickstart 实测；
> LVGL 渲染环境实测确认。其余全部关闭。
