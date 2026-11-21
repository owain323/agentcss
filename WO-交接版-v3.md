# WO 工单执行 · 交接版 v3（0.27.23 基线）

> **给下一个 AI 的第一句话**：v2 的全部工作已收口并发布（0.27.22 + 0.27.23），
> 三域（PDF打印 / 图标 / 视觉基线）已推到 A。你接手的是**最后一公里**：
> 夜间矩阵的 4 个待诊断项（每个都已在台账挂了证据与诊断工具），
> 以及两件作者动作。先读本文档第 0 节的三条纪律再动手。

---

## 0. 你必须知道的三件事

# 规则 | 内容
---|---
1 | **不许放宽任何判据**——所有修复都是改代码或加判据。判据域修正（如 inline 元素跳过）必须写明「为什么这是域修正而非放宽」
2 | **每个红先在本地复现再修**——`FL_ENGINE=<引擎> MODE=component bash 05-audit/check-all.sh`。本地绿 ≠ CI 绿（驱动组合/字体度量差异真实存在），CI 红先拉日志详情
3 | **改完必须当场复验**——本仓三次实测：补丁半途未落盘 / 生成器回写覆盖手改 / 注释插进开标签破坏解析。流程：改 → 跑该门禁 → 绿 → 才提交

## 1. 当前状态（全部实测，2026-11-22）

| 项 | 值 |
|---|---|
| HEAD / tag | `c4062f8+`（台账末尾）· 最新 release tag = **v0.27.23** |
| npm | **0.27.23 已发布**，provenance=ok，回执 `release-run.sh verify = 0` |
| 本地全量 | **264 道全部通过 EXIT=0**（264 = 261 + icons ×2 新门禁） |
| CI 主线 | 快门禁 ✓ 发布资格 ✓ API 契约 ✓（Linux 像素比对真跑绿） |
| 夜间矩阵 | 三引擎仍有少量红——**全部在台账挂证据**，见下 |
| 工作树 | 干净；`internal/`（gitignore）里有 WO-HANDOFF.md 本地留档 |

## 2. 三域状态（都到 A，各自的"最后一公里"）

### PDF/打印 —— A（本轮新增：基线平台分集）
- 基线按平台各存一套：`print-baseline-win32.json` / `print-baseline-linux.json`（已落地，print-gate 按平台取）
- record-baseline.yml 已加 print 录制步（⚠️ 提交步必须 `git add` 带上
  `05-audit/print-baseline-*.json`——首跑漏 add 白录过一次）
- print-gate render 等 `document.images` 完成（未加载图片的 alt 灰色替代
  是对比度假红与 run 数漂移的共同根因——已修）
- media 代表收口：icons demo 进 print 样本（预算 6 = 4×1.4）
- print-adv 在 Linux 走第三态（对抗夹具等值断言按 win32 度量校准）

### 图标 —— A（本轮从零建成运行时层）
- demo 页（35 图标 ×2 消费方式）+ `icons-check` 门禁（8 夹具 selftest）
- 生成器：`05-audit/fixtures/icons-demo-gen.py`——**demo 是生成物，改 demo
  请改生成器再重跑**（手改会被覆盖，实测三次）
- 同步门禁：`run "icons-demo-gen" @serial $PY ... --check`（make-tiersnippet 先例）
- sha256 是 icon-forge 侧源文件溯源，本地不可验（门禁里写明不断言）

### 视觉基线核对 —— A
- Linux 像素比对闭环已实证（CI quick/发布资格在 Linux runner 真跑真绿）
- browser.js 两 launch 分支钉 `locale: zh-CN`（原生 date 控件旋钮名跟浏览器
  UI locale 走，不钉则快照跨机器必漂——已修）
- a11y 转录归一：原生 date 控件旋钮名 → `<date-part>`（浏览器 chrome 非作者内容）

## 3. 你接手的待诊断项（4 个，全在台账挂证据）

台账：`docs/CI-COMPONENT-TRIAGE.md`（先读它，每项有根因证据与已试手段）

| # | 门禁 | 引擎 | 现象 | 已试/建议 |
|---|------|------|------|----------|
| 1 | clicktest | chromium（CI 专属，Windows 复现不了） | card「hover 抬起 transform=无」——hover 后样式没应用 | 已加双 rAF settle + **中心命中元素诊断**（note 会带 hover 点命中的元素）——先跑一轮 nightly 拿命中元素再修 |
| 2 | switch-geom | webkit（CI Linux 专属，Windows webkit 不复现） | OFF 态滑块渲染在右（应左）——间隙 左20 右2 | WebKit-Linux 渲染差异，证据在 CI 日志；需 Linux 环境或渲染层分析 |
| 3 | skel-lever | chromium+webkit（Linux） | sparkline 页 320px 溢出 6px，无元素名 | **已修**：溢出时报最宽三元素——下一轮 nightly 会自指认元素（大概率是 `pre.code` 或 `g-meta` 类）→ 修该元素 |
| 4 | a11y-ax | chromium（Linux CI） | date-range 旋钮名漂移 | **已修**：转录归一 `<date-part>` + locale 钉定——下一轮 nightly 确认 |

**注意**：3/4 两项的修复已在本树落地（未经 CI 实证），先 dispatch 一轮
`gh workflow run gate.yml --ref master` 拿三引擎余量，再决定是否继续。

## 4. 本仓的关键机制（接手必读）

| 机制 | 位置 | 要点 |
|---|---|---|
| 夜间矩阵 | gate.yml browsers job | `MODE=component bash check-all.sh` 三引擎（chromium/firefox/webkit），PR/push 跳过 |
| 基线平台分集 | shot-baseline.py / print-gate.js | 视觉 `_baseline-<平台>-<态>`、print `print-baseline-<platform>.json`——**按录制平台比对** |
| Linux 基线录制 | record-baseline.yml | dispatch → runner 录 → **推到 baseline/linux-<runid> 分支** → 本地 fetch 分支 checkout `10-review/shots/` + `05-audit/print-baseline-*.json` → commit → push |
| 生成物同步 | icons-demo-gen.py / split-tokens.py / make-tiersnippet.py | demo/tierA/core 都是生成物——改源头重跑，**别手改生成物** |
| 共享垫片 | browser.js shimPage | playwright 的 firefox/webkit 用 Proxy 直通 puppeteer API——缺方法就补垫片（模式见 emulateMediaType） |
| CDP 门禁 | browser.js requireChromium | CDP 仅 Chromium 有实现 ⇒ 非 chromium 引擎入口第三态（exit 3） |
| 第三态立法 | E153 | 跑不了 ≠ 通过 ≠ 失败——exit 3 + 显式原因 |
| 可诊断性 | _probe.py / accent-gate / skel-lever / clicktest | 失败时吐子进程真实输出/命中元素——**先可诊断再修**（本轮三次靠它破案） |

## 5. 已知坑（三轮实测的增量，v2 的坑位表仍有效）

| 坑 | 解法 |
|---|---|
| **手改 demo/生成物被生成器覆盖** | 改源头（生成器模板）重跑——实测三次回写丢失 |
| **补丁半途未落盘** | python 断言失败会让整段补丁不写入——改完必须当场跑该门禁复验 |
| `git add -A` 卷入根目录一次性脚本 | repo-hygiene/legacy-api 会红（probe 脚本被当成组件代码扫）——一次性脚本写完即删或先加 .gitignore |
| HTML 注释别插进开标签内部 | `<!-- -->` 在标签内破坏解析，run 数 +13 的假漂移 |
| 解释器选错（node 跑 .py / python 跑 .js / .sh） | 跑门禁前先 `ls` 确认扩展名 |
| bash heredoc 里 python 正则的转义地狱 | 正则含量多的补丁用 Write 工具写 .py 文件执行，别内联 |
| `X | tail` 吃掉退出码 | 判退出码一律 `> /tmp/x.log 2>&1; echo $?` |
| 夜间矩阵的 CI 日志要在 run **完成后**才能取 | 进行中只有 steps 结论；`gh run view --job <id> --log` 等 completed |

## 6. 遗留的作者动作（只有作者能做）

1. **吊销轮换 DeepSeek key**——v2 交接文档曾明文携带并推上公开仓，
   历史里的 key 不因后续修复失效
2. 历史重写（force push）与否——等 key 轮换后作者决策

## 7. 验证过的发布流（0.27.23 实测，照抄即可）

```bash
python 05-audit/bump-version.py 0.27.X        # CHANGELOG 会生成 TODO 节——必须实填！
# 实填 CHANGELOG 后：
python 05-audit/gen-ai-contract.py && python 05-audit/gen-llms.py && python 05-audit/fix-start-here.py
python 05-audit/build-dist.py && python 05-audit/dist-cost-gate.py --update
python 05-audit/gen-docs.py && python 05-audit/gen-esm.py
node 05-audit/a11y-ax.js                       # 快照核对（漂了就 --update）
python 05-audit/shot-baseline.py --update      # win32 三态
python 05-audit/size-baseline.py --record
MODE=full bash 05-audit/check-all.sh           # 期望 0 FAIL（tag 锚点中间态除外）
git add -A && git commit -m "release 0.27.X: …" && git push origin master
gh workflow run record-baseline.yml -f dir=all # Linux 基线对齐发布指纹
# 等 run 完 → fetch baseline/linux-<runid> 分支 → checkout shots+print 基线 → commit → push
gh workflow run gate.yml --ref master          # 确认 CI 全绿（quick/发布资格）
git tag -d v0.27.X && git push origin :refs/tags/v0.27.X
NEW_SHA=$(git rev-parse HEAD) && git tag -a v0.27.X -m "source-commit: $NEW_SHA"
git push origin v0.27.X                        # release.yml 自动发布
bash 05-audit/release-run.sh verify            # 期望 verify=0
```

⚠️ 发布流实测细节：
- **指纹在 bump 后通常不变**（版本串不在 CSS/JS/HTML 指纹域）——Linux 基线
  是否要对齐以 `visual-stamp` 实际输出为准，别凭记忆跳步骤
- **GitHub Release 的正文拒绝 TODO 模板**（工程官 S3）——CHANGELOG 不实填
  会在「建 Release」一步红
- **npm 版本不可重发**——发布中途修东西必须 bump 新版本号重来，
  tag↔provenance 的精确匹配是回执判据（0.27.21 白发布的教训）

---

*交接版 v3 · 2026-11-22 · 基线 v0.27.23（master c4062f8+）· 前执行者：ZCode*
