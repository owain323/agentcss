# icons —— 图标资产（Lucide 官方 SVG，35 个）

> **来源**：[icon-forge](https://github.com/owain323/agentcss) 配套工具从
> `lucide-static v1.73.0`（ISC 许可，可商用）**原样搬运**——AI 不碰图形，
> 每个 SVG 带 sha256 溯源。生成管线在 WorkBuddy 侧（icon-forge），
> 本目录只放**消费用的产出**。

## 用法

```html
<!-- 方式一：<img> 标签（最简单，无样式依赖） -->
<img src="path/to/icons/svg/chart-line.svg" width="24" height="24" alt="趋势图">

<!-- 方式二：inline SVG（可用 currentColor 继承文字颜色） -->
<!-- 把 SVG 文件内容粘贴进来，<svg> 已自带 stroke="currentColor" -->
```

## 尺寸与颜色

- viewBox 统一 `0 0 24 24`，`stroke="currentColor"`、`stroke-width="2"`——
  用 inline 方式时颜色自动跟随文字 `color`
- `<img>` 方式颜色固定为 SVG 文件内的 `currentColor`（即黑），需变色请用 inline

## 可访问名约定（0.27.22 起，icons-check 门禁核对）

- `<img>` 方式：`alt` 必填——语义场景用 manifest 的中文 label，装饰场景 `alt=""`
- inline 方式：纯装饰 `aria-hidden="true"`；需要被朗读时 `role="img"` + `aria-label`
- 不许出现「裸 SVG 无名」——`05-audit/icons-check.js` 逐个核对
  （文件完整性 / viewBox·stroke·线宽三统一 / demo 页注入 / a11y 约定，
  判据带喂坏夹具的 selftest）
- live 示例：[demo.html](demo.html)

## 查找

```bash
agentcss ai icons 利润          # 按中文名/关键词/分组搜
agentcss ai icons               # 全量列出
```

## 来源与更新

35 个图标全部从 [Lucide](https://lucide.dev) 官方 SVG 原样搬运（ISC 许可）。
每个文件的来源、sha256、中文标签见 `manifest.json`。
生成管线（含动画 / React 组件 / 门禁 / 反向控制）在 WorkBuddy 侧 icon-forge 工具，
本目录只放消费产出——**改图形请回 icon-forge，不在这里手编 SVG**。

## 与 CSS 的关系

图标是**独立 SVG 文件**，不进 CSS——体积天花板 172KB 是 CSS 的账，
图标不计入。需要调大小用 `width`/`height` 属性或外层容器样式。
