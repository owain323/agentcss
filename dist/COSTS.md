# 采纳成本表

> 这个文件由 `05-audit/dist-cost-gate.py` **生成**，不要手改（改了门禁会红）。
> 数字口径：**dist 里的 min 产物，gzip 9 级**。

## 一、为什么单独算这一笔

采用一个组件要付三笔钱：`tokens`（必付）+ 组件 CSS + 组件 JS（可选）。

实测两笔账，一笔不省：

- `tokens` 源码版 gzip **24.9 KB** → min 版 **3.1 KB**（省 88%）——
  源码多的那部分**全是注释**（全库 CSS 有 70% 是注释，字节口径），而注释是给维护者的，不是给浏览器的。
- tokens 的 min 版 3.1 KB **比任何一个组件自己都贵** ⇒
  "只用一个组件"的真实起步价就是它。不公开这张表，等于让人盲买。

## 二、明码标价

| 档 | 组件 | tokens（必付） | CSS | JS | **合计** | 源码版合计 | 差 |
|---|---|---:|---:|---:|---:|---:|---:|
| primitive | `badge` | 3.1 KB | 0.5 KB | — | **3.6 KB** | 27.6 KB | −24.0 KB |
| primitive | `button` | 3.1 KB | 1.0 KB | — | **4.1 KB** | 31.2 KB | −27.2 KB |
| primitive | `card` | 3.1 KB | 0.9 KB | — | **4.0 KB** | 29.0 KB | −24.9 KB |
| primitive | `choice` | 3.1 KB | 1.1 KB | — | **4.2 KB** | 31.1 KB | −26.9 KB |
| primitive | `combobox` | 3.1 KB | 1.0 KB | 7.4 KB | **11.5 KB** | 37.0 KB | −25.5 KB |
| primitive | `date-range` | 3.1 KB | 0.8 KB | 2.9 KB | **6.8 KB** | 32.6 KB | −25.8 KB |
| primitive | `delta` | 3.1 KB | 0.3 KB | — | **3.4 KB** | 27.6 KB | −24.2 KB |
| primitive | `input` | 3.1 KB | 1.1 KB | — | **4.1 KB** | 28.8 KB | −24.7 KB |
| primitive | `metric` | 3.1 KB | 0.5 KB | — | **3.6 KB** | 28.1 KB | −24.5 KB |
| primitive | `popover` | 3.1 KB | 0.8 KB | 2.3 KB | **6.2 KB** | 32.8 KB | −26.6 KB |
| primitive | `progress` | 3.1 KB | 0.8 KB | — | **3.9 KB** | 29.1 KB | −25.3 KB |
| primitive | `select` | 3.1 KB | 0.9 KB | 9.0 KB | **13.0 KB** | 38.5 KB | −25.5 KB |
| primitive | `separator` | 3.1 KB | 0.2 KB | — | **3.3 KB** | 26.1 KB | −22.8 KB |
| primitive | `skeleton` | 3.1 KB | 0.5 KB | — | **3.6 KB** | 26.8 KB | −23.2 KB |
| primitive | `switch` | 3.1 KB | 0.9 KB | — | **3.9 KB** | 33.7 KB | −29.7 KB |
| primitive | `timeline` | 3.1 KB | 0.5 KB | — | **3.6 KB** | 28.1 KB | −24.5 KB |
| primitive | `upload` | 3.1 KB | 1.4 KB | 4.8 KB | **9.3 KB** | 44.2 KB | −34.9 KB |
| pattern | `accordion` | 3.1 KB | 1.3 KB | 1.8 KB | **6.2 KB** | 39.3 KB | −33.1 KB |
| pattern | `content` | 3.1 KB | 1.0 KB | — | **4.1 KB** | 29.8 KB | −25.7 KB |
| pattern | `drawer` | 3.1 KB | 0.8 KB | 3.4 KB | **7.3 KB** | 36.0 KB | −28.7 KB |
| pattern | `dropdown` | 3.1 KB | 0.8 KB | 3.7 KB | **7.5 KB** | 35.6 KB | −28.1 KB |
| pattern | `form-validation` | 3.1 KB | 0.8 KB | 2.3 KB | **6.1 KB** | 34.2 KB | −28.0 KB |
| pattern | `list` | 3.1 KB | 0.6 KB | — | **3.7 KB** | 27.2 KB | −23.6 KB |
| pattern | `nav` | 3.1 KB | 1.3 KB | 2.8 KB | **7.1 KB** | 37.2 KB | −30.0 KB |
| pattern | `overlay` | 3.1 KB | 1.2 KB | 4.0 KB | **8.3 KB** | 42.7 KB | −34.4 KB |
| pattern | `pagination` | 3.1 KB | 0.8 KB | 2.8 KB | **6.6 KB** | 36.0 KB | −29.4 KB |
| pattern | `reveal` | 3.1 KB | 0.3 KB | 1.3 KB | **4.7 KB** | 30.3 KB | −25.5 KB |
| pattern | `states` | 3.1 KB | 0.9 KB | — | **4.0 KB** | 29.3 KB | −25.3 KB |
| pattern | `tabs` | 3.1 KB | 0.7 KB | 2.1 KB | **5.9 KB** | 32.4 KB | −26.5 KB |
| pattern | `tooltip` | 3.1 KB | 0.5 KB | 3.2 KB | **6.8 KB** | 37.5 KB | −30.7 KB |
| pattern | `tree` | 3.1 KB | 0.6 KB | 3.3 KB | **7.1 KB** | 34.9 KB | −27.8 KB |

## 三、全库

- 全部组件都用上（min，含 tokens 一份）：**84.8 KB**
- 源码版（带注释）全库 gzip：422.9 KB

> ⚠️ 源码版那个数字**不是**要付的钱：它包含我们的注释（全库 CSS 有 70% 是注释，字节口径）。
> 它的用途只有一个 —— 让人看清"dist 到底省了多少"。

