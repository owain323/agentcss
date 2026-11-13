# 采纳成本表

> 这个文件由 `05-audit/dist-cost-gate.py` **生成**，不要手改（改了门禁会红）。
> 数字口径：**dist 里的 min 产物，gzip 9 级**。

## 一、为什么单独算这一笔

采用一个组件要付三笔钱：`tokens`（必付）+ 组件 CSS + 组件 JS（可选）。

实测两笔账，一笔不省：

- `tokens` 源码版 gzip **24.0 KB** → min 版 **3.1 KB**（省 87%）——
  源码多的那部分**全是注释**（全库 CSS 有 70% 是注释，字节口径），而注释是给维护者的，不是给浏览器的。
- tokens 的 min 版 3.1 KB **比任何一个组件自己都贵** ⇒
  "只用一个组件"的真实起步价就是它。不公开这张表，等于让人盲买。

## 二、明码标价

| 档 | 组件 | tokens（必付） | CSS | JS | **合计** | 源码版合计 | 差 |
|---|---|---:|---:|---:|---:|---:|---:|
| primitive | `badge` | 3.1 KB | 0.5 KB | — | **3.5 KB** | 26.7 KB | −23.2 KB |
| primitive | `button` | 3.1 KB | 1.0 KB | — | **4.0 KB** | 30.4 KB | −26.3 KB |
| primitive | `card` | 3.1 KB | 0.9 KB | — | **4.0 KB** | 28.1 KB | −24.1 KB |
| primitive | `choice` | 3.1 KB | 1.1 KB | — | **4.2 KB** | 30.2 KB | −26.0 KB |
| primitive | `combobox` | 3.1 KB | 1.0 KB | 6.6 KB | **10.7 KB** | 35.3 KB | −24.6 KB |
| primitive | `date-range` | 3.1 KB | 0.8 KB | 2.9 KB | **6.7 KB** | 31.8 KB | −25.0 KB |
| primitive | `delta` | 3.1 KB | 0.3 KB | — | **3.3 KB** | 26.7 KB | −23.4 KB |
| primitive | `input` | 3.1 KB | 1.0 KB | — | **4.1 KB** | 27.9 KB | −23.8 KB |
| primitive | `metric` | 3.1 KB | 0.5 KB | — | **3.5 KB** | 27.2 KB | −23.7 KB |
| primitive | `popover` | 3.1 KB | 0.8 KB | 2.3 KB | **6.2 KB** | 31.9 KB | −25.7 KB |
| primitive | `progress` | 3.1 KB | 0.8 KB | — | **3.8 KB** | 28.3 KB | −24.4 KB |
| primitive | `select` | 3.1 KB | 0.8 KB | 4.4 KB | **8.3 KB** | 36.1 KB | −27.8 KB |
| primitive | `separator` | 3.1 KB | 0.2 KB | — | **3.3 KB** | 25.3 KB | −22.0 KB |
| primitive | `skeleton` | 3.1 KB | 0.5 KB | — | **3.6 KB** | 25.9 KB | −22.4 KB |
| primitive | `switch` | 3.1 KB | 0.9 KB | — | **3.9 KB** | 32.8 KB | −28.9 KB |
| primitive | `timeline` | 3.1 KB | 0.5 KB | — | **3.6 KB** | 27.2 KB | −23.7 KB |
| primitive | `upload` | 3.1 KB | 1.4 KB | 4.8 KB | **9.2 KB** | 43.3 KB | −34.1 KB |
| pattern | `accordion` | 3.1 KB | 1.3 KB | 1.8 KB | **6.2 KB** | 38.4 KB | −32.3 KB |
| pattern | `content` | 3.1 KB | 1.0 KB | — | **4.1 KB** | 28.9 KB | −24.8 KB |
| pattern | `drawer` | 3.1 KB | 0.8 KB | 3.2 KB | **7.0 KB** | 34.5 KB | −27.5 KB |
| pattern | `dropdown` | 3.1 KB | 0.8 KB | 3.6 KB | **7.5 KB** | 34.1 KB | −26.7 KB |
| pattern | `form-validation` | 3.1 KB | 0.8 KB | 2.0 KB | **5.8 KB** | 32.5 KB | −26.6 KB |
| pattern | `list` | 3.1 KB | 0.6 KB | — | **3.7 KB** | 26.4 KB | −22.7 KB |
| pattern | `nav` | 3.1 KB | 1.3 KB | 2.6 KB | **6.9 KB** | 35.4 KB | −28.5 KB |
| pattern | `overlay` | 3.1 KB | 1.2 KB | 3.8 KB | **8.0 KB** | 41.4 KB | −33.3 KB |
| pattern | `pagination` | 3.1 KB | 0.8 KB | 2.8 KB | **6.6 KB** | 34.9 KB | −28.3 KB |
| pattern | `reveal` | 3.1 KB | 0.3 KB | 1.2 KB | **4.6 KB** | 28.5 KB | −24.0 KB |
| pattern | `states` | 3.1 KB | 0.9 KB | — | **3.9 KB** | 28.3 KB | −24.4 KB |
| pattern | `tabs` | 3.1 KB | 0.7 KB | 2.1 KB | **5.8 KB** | 31.5 KB | −25.7 KB |
| pattern | `tooltip` | 3.1 KB | 0.5 KB | 2.4 KB | **6.0 KB** | 32.9 KB | −27.0 KB |
| pattern | `tree` | 3.1 KB | 0.6 KB | 3.3 KB | **6.9 KB** | 33.4 KB | −26.4 KB |

## 三、全库

- 全部组件都用上（min，含 tokens 一份）：**77.2 KB**
- 源码版（带注释）全库 gzip：406.4 KB

> ⚠️ 源码版那个数字**不是**要付的钱：它包含我们的注释（全库 CSS 有 70% 是注释，字节口径）。
> 它的用途只有一个 —— 让人看清"dist 到底省了多少"。

