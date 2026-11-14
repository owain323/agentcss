# tooltip · 文字提示

补充说明，**不是**主要信息的载体。

## 🔴 一条铁律：tooltip 不承载必要信息

触屏设备**没有 hover** ⇒ tooltip 在手机上等于不存在。
凡是"用户必须知道"的内容，绝不能只放在 tooltip 里。

**怎么自己查**：tooltip 里的文字必须与触发元素的可见文字或 `aria-label`
**不重复**。重复了，就说明它本该直接可见。

> 这是本库唯一一条"用法约束"级别的规则，也是最常被违反的一条。

## 结构（JS 生成，不要手写）

```js
Tooltip.attach(按钮, '说明文字', 'top');
```

生成的结构：

```html
<button data-tooltip="说明文字" aria-describedby="tt1">…</button>
<div id="tt1" class="tooltip tooltip--top" role="tooltip">说明文字</div>
```

| 参数 | 取值 | 说明 |
|---|---|---|
| `el` | Element | 触发元素 |
| `text` | string | 纯文本（用 `textContent` 写入，**天然免疫注入**）|
| `place` | `bottom`（默认）/ `top` / `start` / `end` / `left` / `right`；`inset-inline-start` / `inset-inline-end` 也接受，分别映射到 `start` / `end` | 方位 |

`start` / `end` 是**内联轴**方位（随书写方向镜像）；`left` / `right` 是**物理**方位
（RTL 下仍是物理左 / 右，不镜像）。

类名说的是**气泡的位置**，小三角一律指向锚点：

| 类 | 气泡在哪 | 小三角 |
|---|---|---|
| `.tooltip--top` | 锚点**上方** | 气泡底缘，尖朝下 |
| `.tooltip--bottom` | 锚点**下方** | 气泡顶缘，尖朝上 |
| `.tooltip--inset-inline-start` | 锚点**内联起点侧**（LTR 在左 / RTL 在右） | 靠锚点一侧，尖朝锚点 |
| `.tooltip--inset-inline-end` | 锚点**内联终点侧**（LTR 在右 / RTL 在左） | 靠锚点一侧，尖朝锚点 |

⚠️ `--top` / `--bottom` 指的是**气泡在哪**，不是箭头朝哪。
（旧文档把这条写反过 —— 以为"`--top` 箭头朝上所以气泡在下方"，
对着 CSS 量过：`--top` 的小三角在气泡底缘、尖朝下，气泡在锚点上方。）

公开 API 是 `Tooltip.attach()` / `Tooltip.detach(el)` / `Tooltip.setLabels()`，
**没有** `show` / `hide` —— 显隐由 hover / focus / click 自动驱动。
`attach` 对同一元素幂等（重复调用不会双注册）；SPA 换页销毁元素前要
`detach`，否则 dismissable 栈只增不减。

## 🔴 用 `aria-describedby`，不是 `aria-label`

tooltip 与触发元素的关系是**描述**，不是**命名**。
`aria-label` 会**覆盖**元素本来的可访问名——按钮上的文字会被抹掉。

```js
el.setAttribute('aria-describedby', cur ? (cur + ' ' + id) : id);
```

⚠️ 已有 `aria-describedby` 时是**追加空格**，不是覆盖 —— 可能同时有多个描述。

`role="tooltip"` + `aria-live="polite"`：内容变化时读屏会念出来。

## 触发矩阵（attach() 路径）

| 输入 | 行为 |
|---|---|
| 悬停（可悬停设备） | 出；移开就关 |
| 键盘 `focus` | 出（**键盘必须可达**，只做 hover 等于对键盘用户不存在）；`blur` 关 |
| `click` | **只翻转"click 自己开的"**：focus/hover 刚弹出的那一下点击**不**翻转 —— 真指针 / 触屏的第一次点击必是"开"，click 开的再点一下才是关 |
| `Esc` | 关（WCAG 1.4.13 Content on Hover or Focus）|
| 点外部 | 关 |

⭐ 这些来源是**三份独立的所有权**，不是"谁最后来谁说了算"：
hover / focus / click 各持一份，任一持有就显示，**全部释放**才收。
所以「click 钉住后鼠标进出一次」和「焦点还在、鼠标移出」都不会把气泡弄没 ——
后者是 WCAG 1.4.13 的 persistent 要求。`blur` 释放 focus 与 click 两份，
指针仍停在锚点上时 hover 那份继续持有。

触屏没有 hover：点按合成的 mouse 事件被 touchstart 后 700ms 的抑制窗挡住，
触屏只走 click / focus。手写兄弟结构的纯 CSS 路径（见 tooltip.css）
仍只有 hover / focus-visible 驱动，没有 JS 保护。

## 🔴 定位前必须先入 DOM

游离元素的 `getBoundingClientRect()` **全是 0**。

实测踩过：`top` 方位的气泡与锚点完全重叠 —— 原因就是先量尺寸、
后插进 DOM。正确顺序是**先挂上去、藏起来量，量完再显示**。

## 显隐靠 `data-state`，别写 `display`

```css
.tooltip[data-state="open"] { … }
```

JS 只切`data-state`，显隐与动画全交给 CSS。
写 `style.display` 会把过渡动画彻底干掉。

## 降级

| 场景 | 处理 |
|---|---|
| `prefers-color-scheme: dark` | 已适配 |
| `prefers-reduced-motion: reduce` | 已关闭动效 |
| 触屏（无 hover） | 只走 click / focus（JS 端有触屏抑制窗，不靠 CSS hover）|

## 成熟度与行为债（如实列出）

成熟度以 `ai/components.json` 的 tooltip 条目为准（生成器按门禁与行为债现状算，
这里不重复写死 —— 写死就会漂）。0.8.6 收编统一行为层后，
原先两条"手写债"（`dismissable:manual` / `focus-return:manual`）**已经还清**：
Esc / 点外部 / 焦点归位都走 dismissable + focus-return 核，
`Tooltip.detach()` 也补上了销毁路径。还剩这些限制，如实列出：

| 限制 | 含义 | 现在的行为 |
|---|---|---|
| `position:no-flip` | 定位不做视口避让 | 靠视口边缘时气泡会被裁掉一角，不自动翻转 |
| `position:no-reposition` | 打开后不跟随滚动 / 改尺寸重算 | 滚动页面时气泡留在原坐标，与锚点脱开 |
| `css-sibling:manual` | 手写兄弟结构是纯 CSS 路径，没有 JS | 只有 hover / focus-visible 驱动，Esc / 点外部关不掉 —— 要完整行为请用 `Tooltip.attach()` |

## 反例

- ❌ **把必须知道的信息只放在 tooltip 里** —— 触屏没有 hover，键盘用户也未必停留。
  判据很硬：tooltip 的文字**不能**与触发元素的可见文字/`aria-label` 重复 ——
  一旦重复，说明它承载了本该可见的信息
- ❌ **只做 hover、不做 focus** —— 键盘用户永远看不到（WCAG 1.4.13 要求 focus 也能出）
- ❌ **Esc 关不掉** —— WCAG 1.4.13 的硬性要求：hover/focus 出现的内容必须可以关掉
- ❌ **用 `display: none` 隐藏气泡** —— 读屏读不到；淡入用透明度
- ❌ **`role="tooltip"` 不给 `aria-label`** —— 光靠内容拿不到可访问名，读屏只会念"提示"（0.8.9 补的）
- ❌ **触屏只靠 hover 触发** —— 触屏上 hover 会"粘住"不褪；触屏必须走 JS 的 click / focus

---

## 门禁

`05-audit/tooltip-check.js`（契约 `gates` 里登记的唯一一道）——
覆盖 `aria-describedby` 关联、`Esc` 关闭、键盘 Tab 触发，以及
悬停弹出 / 一次点击打开（不双翻转）/ 点外部关闭 / `detach` 清理
`__flDismiss` 栈四条行为判据。