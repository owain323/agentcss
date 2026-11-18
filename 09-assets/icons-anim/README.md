# icons-anim · 图标动效（CSS 路线）

给 `09-assets/icons/` 的静态图标加**纯 CSS** 动效。0.27.18 的裁决兑现：
SMIL 批次（WorkBuddy icon-forge 产出）不进本库——SMIL 时间线不受
`prefers-reduced-motion` 控制、也不受库内 `0.01ms` 全局灭活管；
CSS 动画三个自动成立：media query 生效、motion.py 有管辖权、可被门禁审计。

## 用法

```html
<link rel="stylesheet" href="…/09-assets/icons-anim/icons-anim.css">

<!-- 必须 inline SVG：<img> 外链不受页面 CSS 作用 -->
<svg class="icon-anim icon-anim--draw" role="img" aria-label="…" viewBox="0 0 24 24" …>
  …官方 path（原样，不改几何）…
</svg>
```

| 类 | 效果 | 时长 | 循环 |
|---|---|---|---|
| `icon-anim--draw` | 描边自绘（子形状依次画出） | `--dur-slow` 280ms × 错峰 | 一次 |
| `icon-anim--breathe` | 呼吸（透明度 0.35↔1，相邻形状反相） | 2s | 循环 |
| `icon-anim--popin` | 浮入（上升 2px + 淡入） | `--dur-base` 180ms | 一次 |
| `icon-anim--spin` | 旋转（加载态） | 1.6s | 循环 |

## 硬约束（门禁守着）

1. **几何零改动**：动画层只碰 `stroke-dasharray/offset`、`opacity`、
   `transform`——CSS 改不了几何属性；`09-assets/icons/` 的 SVG 与 manifest
   由 icon-gate 守（sha256 + body 逐条比对），动画层对它们零 diff。
2. **fail-open**：动画缺位（keyframes 剥离 / 本文件没引 / UA 不支持）时
   图标**完整可见**——动画不是可见性的来源。draw 基础态 offset=0。
3. **reduced-motion 全灭**：`@media (prefers-reduced-motion: reduce)` 下
   四模式全部静止、图标完整可见。**不登记**进 motion-policy 的 keep 清单
   ——图标动画纯装饰，reduced 应全灭。
4. **不进 AI 面**：类名清单不写入 llms / components.json 语义段 /
   START-HERE——消费方是人，`ai-surface` 预算不受影响。
   （components.json 里只有本资产组件的登记条目本身。）

## 与 icon-forge 的关系

- icon-forge 的 SMIL 批次（`dist/anim/*.svg` + `dist/react-anim/*.tsx`）
  已在 0.27.19 重建（undefined 污染 / 硬编码色 / popin 越界样条 / draw
  fail-closed 全修），**供其他消费方使用**；本目录的 CSS 路线是 agentcss
  库内的唯一动效通道。
