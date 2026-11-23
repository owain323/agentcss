# 安全策略

## 报告漏洞

**请不要在 GitHub 上开公开 issue 报告漏洞。**

发到私有渠道：[security advisory](https://github.com/owain323/agentcss/security/advisories/new)

## 我们会怎么回应

| 阶段 | 时限 |
|---|---|
| 确认收到 | 3 个工作日内 |
| 初步判断（是否受影响、影响多大） | 10 个工作日内 |
| 修复发布 | 确认后 30 天内；有人在用且危害高则更快 |

超过时限没有回应，你可以直接在 advisory 里催。

## 这个库的攻击面有多大

说实话很小，但不为零：

- **运行时依赖：0 个。** 本库是纯 CSS + 可选行为脚本，`package.json` 的
  `dependencies` 是空的。这意味着常见的供应链攻击（依赖被投毒）在这里没有入口。
- **构建期依赖**：`package-lock.json` 里是 devDependencies（typescript、puppeteer-core、
  axe-core 等），只在开发和跑门禁时用。它们**不会被使用者安装**。
- **真实面**：
  - **HTML 注入点 —— 现在有门禁守着**。全库共 21 处 `.innerHTML` /
    `.insertAdjacentHTML`，按"装的是什么"分四类：清空型（赋空串）、
    escaped（插值过 `esc()`）、internal（只有常量/内部量）、raw-html（有意的
    HTML 入口）。每个非清空型注入点都必须在紧邻上一行写
    `/* @html-sink <kind> — <理由> */`，否则 `xss-sink-gate.py` 红。
    ⇒ 这不能证明 `esc()` 一定对，但它能保证：**新增一个未声明的注入点，
    必须显式改标记或改文档**，不会静默进来。
  - **CSS 注入** —— 把不可信内容插进 `class` 属性时同理（本库不读 `class` 里的值，
    所以这不是可利用路径，只是习惯问题）。
  - **DOM 监听泄漏** —— 组件反复挂载/卸载时可能累积监听（部分组件的 `destroy()`
    正在补齐中，见 CHANGELOG）

⇒ 也就是说：**本库不太可能成为供应链攻击的一环**。

## 分发包里不放什么

`npm install agentcss` 拿到的东西里不含下面任何一类，而且不是承诺 —— 是每次
提交都会重跑的判据：

| 不放的东西 | 守着它的判据 |
|---|---|
| 用户目录、计算机名、邮箱、网络共享路径 | `leak-scan.py` 的四条**形状**判据（任意盘符；不依赖开发机上的词表，所以在 CI 与干净克隆上同样生效） |
| 开发者本机的具体目录 | 同上。只有 `<盘符>:/Program Files` 与 `<盘符>:/Windows` 被视为「任何机器上都一样」而放行，其余绝对路径一律算身份 |
| 面向维护者的文档（不随包分发） | `pack-hygiene-gate.py` 的具名清单；自检会遍历清单，**每加一份都必须当场被证明拦得住** |
| 发布前的代号类禁词 | `publish-tag-guard.py` 的身份闸：清单未加载即拒绝发布 |

发现分发包里出现本机信息，按漏洞报告（见文首），不要开 issue 贴截图。

## HTML 入口（sink）

下面两处会把字符串**当 HTML 解析**。它们是**有意的 API**，不是疏漏 ——
`popover` 要能放任意块级内容，`drawer` 要能放整页内容，只收文本就废了。

| 文件 | 入口 | 净化钩子 | 谁负责净化 |
|---|---|---|---|
| `02-primitives/popover/popover.js` | `opts.html` | `opts.sanitize` / `Popover.setSanitizer(fn)` | 调用方（或接钩子） |
| `03-patterns/drawer/drawer.js` | `opt.unsafeHtml`（0.27.24 新增，显式） | `opt.sanitize` / `Drawer.setSanitizer(fn)` | 调用方（或接钩子） |
| `03-patterns/drawer/drawer.js` | `opt.content`（字符串）—— 🔴 0.27.24 弃用 | `opt.sanitize` / `Drawer.setSanitizer(fn)` | 调用方（或接钩子） |

**0.27.24 起抽屉正文有安全默认**：`Drawer.open({ text })` 用 `textContent`，
用户输入可以直接放；只有 `unsafeHtml` / 弃用的 `content` 走 HTML 解析。
弃用告警每次会话只打一次。

**0.26.0 起有钩子，但默认不改变行为**：不传 `sanitize`、也不调 `setSanitizer()`
时，两处仍然直接把字符串当 HTML 解析 —— 与 0.25.x 完全一致（静默"自动净化"
会让既有页面里的 `<b>` / `<svg>` 突然消失，那也是一种破坏）。
接 DOMPurify 只需一行：

```js
Popover.setSanitizer(function (html) { return DOMPurify.sanitize(html); });
Drawer.setSanitizer(function (html) { return DOMPurify.sanitize(html); });
```

逐次覆盖优先于模块级：`Popover.attach(el, { html: s, sanitize: fn })`。

**为什么本库不做净化**：净化需要一个 HTML 解析器或一份允许列表实现，而本库的目标是
零运行时依赖 + Chromium 97 可用。给一个"看起来安全"的半吊子净化，比明确说
"这是调用方的责任"更危险。

调用方该怎么做：内容来自用户输入时，先净化（如 DOMPurify）再传；只想放纯文本时，
用 `textContent` 或先转义，不要走这两个参数。

> 这张表与代码**双向**核对：登记了却没有对应注入点 ⇒ 红（防陈旧登记）；
> 有 raw-html 注入点却没登记 ⇒ 红。判据在 `05-audit/xss-sink-gate.py`。

## 支持的版本

| 版本 | 支持 |
|---|---|
| `master` 分支最新 | ✅ |
| 打过的 tag（`v0.8.8` 起） | ✅ 修安全相关缺陷并回移植 |
| `v0.8.8` 之前 | ❌ 无 tag、无锚点，无法可靠回溯 |

**本库已发布到 npm**：包名 `agentcss`，首次发布 2026-10-18（`0.0.0-stage`），
`dist-tags.latest` 指向最新稳定版；从 `0.16.0` 起的版本带 **SLSA provenance**
（`npm view agentcss@<版本> dist.attestations` 可查，证明产物由本仓库的
release 工作流构建，不是本地 `npm publish` 上传的）。
安装方式见 `README.md` 的「安装」一节；装哪个版本可以 `npm view agentcss version` 查。

### 版本与提交点的锚点

`v0.8.8` 起每个版本都打 **annotated tag**，由 `release-gate` 的
`[10] git tag 锚点` 判据守着（它还会核对 tag 指向的提交里 `VERSION`
就是那个版本 —— 只查"tag 存在"的话，给任意提交打个 tag 也能过）。

`v0.8.8` 之前的版本**不补打**：那些提交不在本仓库的可达历史里
（历史被 squash 过），按日期猜锚点会造出假锚点 —— 比没有锚点更糟。

## 关于「无障碍」这个卖点

本库把无障碍写进了门禁（焦点可见、读屏标签、对比度）。如果你发现：

- 某个组件在键盘下走不通
- 焦点环看不见
- 对比度实测不达标

这**既是 bug 也是安全问题**（对依赖读屏的用户是阻断性的），请按上面的渠道报告，
并在标题里写 `a11y`，会优先处理。
