# 素材（图表与可视化）

> 这一层放**按需取用**的可视化能力 —— 用哪个拿哪个，互不牵连。
> 本库内置 **35 个 Lucide 官方 SVG 图标**（`09-assets/icons/svg/`，ISC 许可，
> sha256 逐个溯源到 lucide-static v1.73.0）。生成管线在 icon-forge（AI 不碰图形），
> 本目录只放消费产出。原先"不内置"的立场在 0.27.16 变更——
> 理由与判据见 `05-audit/CHANGELOG` 或下方「图标」一节。

## 这一层有什么

<!-- ==== ASSET-LIST-BEGIN ==== -->
| 目录 | 它解决什么 |
|---|---|
| `09-assets/bar/` | 柱状图，含图表规范的裁剪铁律 |
| `09-assets/echarts-adapter/` | 把令牌喂给 ECharts，按需引入；本库不含 ECharts |
| `09-assets/icons/` | 35 个 Lucide 官方 SVG 图标（icon-forge 产出，sha256 溯源；AI 不碰图形） |
| `09-assets/model-viewer/` | 惰性加载的 3D 模型查看器 |
| `09-assets/scientific-plot/` | 二维科学绘图：坐标轴 / 误差棒 / 置信区间带 / 对数轴 |
| `09-assets/sparkline/` | 迷你趋势线，没有坐标轴的走势提示 |
<!-- ==== ASSET-LIST-END ==== -->

> 上面这张表由 `python 05-audit/fix-start-here.py` 生成，与 `ai/START-HERE.md` 同源。
> 新增目录后先在那份脚本里补一句「它解决什么」，再跑脚本。

每个目录下都有 `demo.html`。起个静态服务就能直接看：

```bash
python -m http.server 8000
# 然后打开 http://127.0.0.1:8000/09-assets/sparkline/demo.html
```

## 从 JS 画东西时：主题色要按**作用域**读

本库的主题是容器级的 —— `[data-theme="dark"]` 可以只罩住一块区域。
所以 JS 资产**不能**只读 `document.documentElement`：

```js
// ❌ 暗容器里的图表会拿到浅色令牌（实测 1.01:1，字看不见）
getComputedStyle(document.documentElement).getPropertyValue('--text-primary')

// ✅ 由渲染目标往上找作用域
getComputedStyle(el.closest('[data-theme]') || document.documentElement)
  .getPropertyValue('--text-primary')
```

判"当前是明还是暗"要量 `--paper` 的**亮度**，不要读 `data-theme` 属性、也不要拿令牌值和字面量比
（`theme-toggle.js` 只把 `data-theme-current` 写在 `:root` 上，容器永远读不到）。
`theme-scope-gate` 的 ⑥ 会检查这一点：新加的 JS 资产若从根读颜色，门禁直接红。

## 图标：内置 35 个 Lucide 官方 SVG（0.27.16 起）

0.27.15 之前本库不内置图标（没好来源、怕 AI 画歪）。0.27.16 起 icon-forge
管线就位（Lucide 官方 SVG 原样搬运 + sha256 溯源 + 反向控制），
内置从"风险"变成了"有真值源的资产"。

要"关闭""警告""箭头"这类图形时，两种方式：

**内联 SVG**（原推荐，仍然有效）——
自己找 SVG 粘进来。零外部请求、currentColor 自动跟随暗色、
描边粗细随字号变。适合只要 1~2 个图形的场景。

**用内置 35 个**（0.27.16 起）——
`<img src="…/icons/svg/chart-line.svg" width="24" height="24" alt="…">`。
文件在 `09-assets/icons/svg/`，manifest.json 有 sha256 溯源。
适合需要一批风格统一的图标、且不想自己找/校验的场景。

三条硬收益（零外部请求、currentColor、描边随字号）对 **inline 方式** 仍然成立；
`<img>` 方式丢掉 currentColor 但零 JS 依赖。
反例（仍然成立）：

- **零外部请求** —— 不能外链的页面（精简档）依然能用
- 颜色随 `currentColor`，**暗色模式自动跟随**
- 描边粗细随字号变，不会出现"小图标过粗、大图标过细"

反例（不要这样做）：

```html
<!-- ❌ 引入字体：一个大文件 + FOUT + 违反零外部资产 -->
<link rel="stylesheet" href="//cdn.example.com/icons.css">
<i class="icon icon-close"></i>

<!-- ❌ 引入图片：无法跟随 currentColor，暗色模式下要换图 -->
<img src="close.png" alt="">
```

### 规格

按下面这套参数内联，与 Lucide 混用看不出接缝：

```
viewBox   0 0 24 24
width     1em          ← 跟随字号，不是固定 px
height    1em
fill      none
stroke    currentColor
stroke-width  2
stroke-linecap  round
stroke-linejoin round
```

图标本体请自备：从 [lucide.dev](https://lucide.dev) 取（**ISC 协议**，商用无需署名），
按上面规格内联进页面即可。本库不提供图标文件，也不设图标目录。

## 一条已经做过的决定

**不做"签名图标"**（本库自画的品牌性图形）。

画过 3 个后停了，原因不是画不好，而是**没有使用场景**：
全库没有任何地方引用它们 —— 有真实场景才画得出来，脱离场景画出来的图形读不出概念。

⇒ 什么时候再做：等真出现一个现成图标库没有、而我们确实需要的概念时，画那一个。
在那之前，先把现成图标用起来更有价值。
