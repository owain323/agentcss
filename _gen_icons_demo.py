#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一次性生成 09-assets/icons/demo.html（生成后本脚本删除，不进树）"""
import io, json

d = json.load(io.open('09-assets/icons/manifest.json', encoding='utf-8'))
icons = d['icons']
semantic = [i for i in icons if i.get('semantic')][:3] or icons[:3]
semantic_names = set(i['name'] for i in semantic)

imgs, slots, semantic_slots, rows = [], [], [], []
for it in icons:
    imgs.append('      <li><img src="svg/%s.svg" width="24" height="24" alt="%s"><code>%s</code></li>'
                % (it['name'], it['label'], it['name']))
    if it['name'] in semantic_names:
        semantic_slots.append('      <span class="icon-slot" data-icon="%s" role="img" aria-label="%s（图标）"></span>'
                              % (it['name'], it['label']))
    else:
        slots.append('      <span class="icon-slot" data-icon="%s" aria-hidden="true"></span>' % it['name'])
    rows.append('      <tr><td><code>%s.svg</code></td><td>%s</td><td>%s</td><td>%s</td></tr>'
                % (it['name'], it['name'], it['label'], it['group']))

TPL = """<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>icons · 图标资产</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="../../01-tokens/tokens.css">
<link rel="stylesheet" href="../../01-tokens/typography.css">
<link rel="stylesheet" href="../../01-tokens/page.css">
<link rel="stylesheet" href="../../04-recipes/table/table.css">
<style>
.icon-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
             gap: var(--sp-2); list-style: none; padding: 0; margin: 0 0 var(--sp-4); }
.icon-grid li { display: flex; align-items: center; gap: var(--sp-2);
                padding: var(--sp-2); border: 1px solid var(--border-decor);
                border-radius: var(--r-sm); background: var(--surface); }
.icon-slot { display: inline-flex; width: 24px; height: 24px; }
.icon-slot svg { width: 24px; height: 24px; }
.icon-demo-color { padding: var(--sp-3); background: var(--accent); color: #fff;
                   border-radius: var(--r-sm); margin: 0 0 var(--sp-4); }
.icon-demo-color .icon-slot { margin-inline-end: var(--sp-2); }
</style>
</head>
<body class="page">
<main class="wrap">
    <h1>icons · 图标资产</h1>
    <p class="lede">__COUNT__ 个 Lucide 图标：独立 SVG 文件 + manifest 溯源，两种消费方式与一条可访问名约定</p>
    <ul class="g-meta"><li><a href="README.md"><code>README.md</code></a></li><li><a href="manifest.json"><code>manifest.json</code></a></li></ul>

    <h2 id="s1">方式一：<code>&lt;img&gt;</code> 标签（无样式依赖）</h2>
    <p>每个图标一个 <code>alt</code>（= manifest 的中文 label）。装饰场景由使用方改写为 <code>alt=""</code>。</p>
    <ul class="icon-grid">
__IMGS__
    </ul>

    <h2 id="s2">方式二：inline SVG（currentColor 继承文字颜色）</h2>
    <p>下面的 <code>.icon-slot</code> 由本页脚本按 manifest 注入几何——与文档化的消费流一致。
       装饰性图标 <code>aria-hidden="true"</code>；语义性图标 <code>role="img"</code> + <code>aria-label</code>。</p>
    <div class="icon-demo-color" data-icon-color-demo>
      <p style="margin:0 0 var(--sp-2)"><strong>颜色继承演示</strong>：stroke 跟随容器的文字颜色（当前 #fff）。</p>
__SEMANTIC_SLOTS__
    </div>
    <div class="icon-grid">
__SLOTS__
    </div>

    <h2 id="s3">a11y 约定（本页负责证什么）</h2>
    <ul>
      <li><code>&lt;img&gt;</code> 方式：<code>alt</code> 必填——语义场景用中文 label，装饰场景 <code>alt=""</code>。</li>
      <li>inline 方式：纯装饰 <code>aria-hidden="true"</code>；需要被朗读时
          <code>role="img"</code> + <code>aria-label</code>（本页的三个语义示例）。</li>
      <li>不许出现「裸 SVG 无名」——下方表格与两个网格由
          <code>icons-check</code> 门禁逐个核对。</li>
    </ul>

    <h2 id="s4">manifest 全量（__COUNT__ 条）</h2>
    <div class="table" tabindex="0" role="region" aria-label="图标清单（可横向滚动）"><table>
      <thead><tr><th>文件</th><th>name</th><th>label</th><th>分组</th></tr></thead>
      <tbody id="manifest-rows">
__ROWS__
      </tbody>
    </table></div>
</main>
<script>
(function () {
  'use strict';
  fetch('manifest.json').then(function (r) { return r.json(); }).then(function (m) {
    var byName = {};
    m.icons.forEach(function (it) { byName[it.name] = it; });
    document.querySelectorAll('.icon-slot').forEach(function (slot) {
      var it = byName[slot.getAttribute('data-icon')];
      if (!it) return;
      slot.innerHTML = '<svg viewBox="' + m.viewBox + '" fill="none" stroke="currentColor" '
        + 'stroke-width="' + m.strokeWidth + '" stroke-linecap="round" stroke-linejoin="round" '
        + 'aria-hidden="true" focusable="false">' + it.body + '</svg>';
    });
    var tbody = document.getElementById('manifest-rows');
    if (tbody) {
      tbody.innerHTML = m.icons.map(function (it) {
        return '<tr><td><code>' + it.name + '.svg</code></td><td><code>' + it.name
          + '</code></td><td>' + it.label + '</td><td>' + it.group + '</td></tr>';
      }).join('');
    }
  });
})();
</script>
</body>
</html>
"""

html = (TPL
        .replace('__COUNT__', str(d['count']))
        .replace('__IMGS__', chr(10).join(imgs))
        .replace('__SEMANTIC_SLOTS__', chr(10).join(semantic_slots))
        .replace('__SLOTS__', chr(10).join(slots))
        .replace('__ROWS__', chr(10).join(rows)))
io.open('09-assets/icons/demo.html', 'w', encoding='utf-8', newline=chr(10)).write(html)
print('demo written:', len(html), 'bytes,', d['count'], 'icons, semantic slots:', len(semantic_slots))
