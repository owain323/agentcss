#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
icon-gate.py — 图标规格检查

背景
------------------
来源参考：「动物森友会」有素材库，本库起步时没有 —— 没有这类资产之后干活很累。
建了 `09-assets/`，图标必须满足：

| 要求 | 原因 |
|---|---|
| `viewBox="0 0 24 24"` | 与 Lucide 一致，混用不出接缝 |
| `width="1em" height="1em"` | **跟随字号** —— 写死 px 会出现"大图标过细、小图标过粗" |
| `fill="none"` | 线性风格；不设会被某些 UA 填成黑块 |
| `stroke="currentColor"` | **颜色随文字走**，暗色模式自动跟随，不需要两份图 |
| `stroke-width="2"` | 与 Lucide 同粗细，混用才匀 |
| `stroke-linecap/linejoin="round"` | 端点圆润，与库的整体气质一致 |
| `role="img"` + `aria-label` | 装饰性图标才该 `aria-hidden`；有语义的必须有名字 |
| **禁硬编码颜色** | `#fff` 之类会破坏暗色模式与 currentColor |

**查不出、必须人眼看的是"语义清不清晰"** ——
本门禁只能保证"它是对的、它能用"，保证不了"它画得好"。

用法：python 05-audit/icon-gate.py
"""
import sys
import os
import re
import glob
import io
import json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 🔴 踩过的坑：`Q = r'''["']'''` 看起来是"匹配单双引号"，
#    但把它拼进 `[^' + Q + ']+`（= `[^["']]+`）后，字符类里**同时含两种引号**，
#    于是排除集把所有引号都排掉了 —— 字符串被切成两段，`aria-label="门禁"` 匹配不上。
#    教训：拼正则片段时，字符类的内容要和上下文一起想，不能只看单块。
DQ = chr(34)   # "
SQ = chr(39)   # '
Q = '[' + DQ + SQ + ']'
NOTQ = '[^' + DQ + SQ + ']'
RULES = {
    'viewBox 24x24': r'viewBox\s*=\s*' + Q + r'0 0 24 24' + Q,
    'width=1em': r'width\s*=\s*' + Q + r'1em' + Q,
    'height=1em': r'height\s*=\s*' + Q + r'1em' + Q,
    'fill=none': r'fill\s*=\s*' + Q + r'none' + Q,
    'stroke=currentColor': r'stroke\s*=\s*' + Q + r'currentColor' + Q,
    'stroke-width=2': r'stroke-width\s*=\s*' + Q + r'2' + Q,
    'linecap=round': r'stroke-linecap\s*=\s*' + Q + r'round' + Q,
    'linejoin=round': r'stroke-linejoin\s*=\s*' + Q + r'round' + Q,
    'role=img': r'role\s*=\s*' + Q + r'img' + Q,
    'aria-label': r'aria-label\s*=\s*' + Q + NOTQ + '+' + Q,
}
HARD_COLOR = re.compile(r'(?:fill|stroke)\s*[=:]\s*["\']?#', re.I)
SHAPES = re.compile(r'<(?:path|rect|circle|line|polyline|polygon)\b')


def main():
    # 🔴 参数约定（0.8.9 · 外部审计 P0-1）：`--` 开头的当 flag，不当路径。
    # 🔴 事故：check-all.sh 传 `--dir <目录列表>`，旧写法把 argv[1]
    #   （字面量 "--dir"）当 root ⇒ root=<cwd>/--dir 不存在
    #   ⇒ glob 到 0 个文件 ⇒ 走进「没有图标可查」⇒ return 0 ⇒ 判 PASS。
    #
    # ⭐ 本脚本扫的目录**固定是 09-assets**（图标资产按定义在那儿），
    #   所以 root 恒为库根；位置参数只用来校验调用方是否真的想扫这一块。
    # 🔴 曾经试过"root = 第一个位置参数"，结果 root 变成 01-tokens
    #   ⇒ 去 01-tokens 下面找 09-assets ⇒ 同样扫 0 个文件 ⇒ 同样假绿。
    raw = [a for a in sys.argv[1:] if not a.startswith('-')]
    args = [a for a in raw if os.path.isdir(a)]
    # 🔴 传了路径但一个都不存在 ⇒ 明确报红（不能静默当成"没传参数"）
    if raw and not args:
        print('❌ 传入的路径都不存在：%s' % raw)
        print('   这是**假绿**：不是"图标合规"，是"什么都没检查"。')
        return 1
    if args and not any(a.rstrip('/').endswith('09-assets') for a in args):
        print('❌ 传入的目录里没有 09-assets：%s' % args)
        print('   本门禁只检查图标资产，它们按定义位于 09-assets/。')
        print('   （若只想全量检查，直接不带参数运行即可）')
        return 1

    # ⭐ 扫描范围（0.8.9 修）：全库的 .svg，不只 09-assets。
    # 🔴 原来固定扫 09-assets/，而那个目录下**一个 svg 都没有**
    #    （图标以内联 SVG 写在组件 JS 里）⇒ 这道门禁一直在扫一个空目录。
    #    之前因为"扫不到就说没有图标可查 ⇒ return 0"而被掩盖成假绿。
    # ⇒ 改成扫全库：现在会真的检查 04-recipes/longform/agc-memory.svg，
    #    将来放进 09-assets 的图标也自动纳入。
    files = sorted(glob.glob(os.path.join(ROOT, '**', '*.svg'), recursive=True))
    # 🔴 排除目录要全（0.8.9 补）：我把glob 扩到"全库"之后，
    #   `npm install` 装进来的 node_modules 里也有 .svg
    #   （playwright 自带的浏览器图标）⇒ 一次安装就让这道门禁报出 4 处假红。
    #   ⇒ 凡是「扫全库」的门禁，**必须同时排除依赖目录**，
    #      否则它扫的是别人的代码。
    EXCLUDE_DIRS = ('dist', '.git', 'node_modules', '.workbuddy')
    files = [f for f in files
             if not any(os.sep + d + os.sep in f for d in EXCLUDE_DIRS)]
    # 🔴 豁免：文章里的**示意图**不是图标。
    #   `04-recipes/longform/agc-memory.svg` 是 600×120 的示意图
    #   （矩形 + 一行说明文字），它按设计就该有自己的尺寸与配色，
    #   "必须 24×24 / stroke=currentColor"是给**图标**的规格，对它无意义。
    #   ⭐ 豁免按**用途**写，不按文件名写死—— 将来文章里再插示意图同样适用。
    EXEMPT = [p for p in files
              if os.path.relpath(p, ROOT).replace(os.sep, '/')
              .startswith('04-recipes/')]
    icon_files = [f for f in files if f not in EXEMPT]
    # 🔴 零文件守卫 —— 但本门禁有一个**合法的空态**：
    #   本库起步时没有独立图标资产（图标以内联 SVG 写在组件 JS 里），
    #   这道门禁是为「将来放进 09-assets 的图标」预先备下的。
    # ⇒ 空态要**说清是哪一种空**：
    #   · 没有独立图标 → 待用门禁，正常（但必须写明"暂无从检查"）
    #   · 路径传错     → 假绿，必须判红（上面已拦）
    # 🔴 之前这里 return 0 并说「没有图标可查」，而它守的 09-assets/
    #    当年一个 svg 都没有 ⇒ 一直在扫空目录，且看不出来。
    if not icon_files:
        print('（本库当前没有独立图标资产 —— 图标以内联 SVG 写在组件 JS 里）')
        print('  全库 svg 共 %d 个，其中 %d 个是文章示意图（已豁免）。'
              % (len(files), len(EXEMPT)))
        print('  本门禁为「将来放进 09-assets 的图标」预置，'
              '暂无从检查 —— 这是**待用**，不是"通过"。')
        return 0
    print('（扫了 %d 个图标，跳过 %d 个文章示意图）'
          % (len(icon_files), len(EXEMPT)))
    bad = 0
    for f in icon_files:
        s = open(f, encoding='utf-8').read()
        rel = os.path.relpath(f, ROOT).replace(os.sep, '/')
        miss = [k for k, p in RULES.items() if not re.search(p, s)]
        hard = HARD_COLOR.findall(s)
        n = len(SHAPES.findall(s))
        if n == 0:
            miss.append('没有图形元素')
        ok = not miss and not hard
        if not ok:
            bad += 1
        print('  [%s] %-40s %s'
              % ('OK  ' if ok else 'FAIL', rel,
                 ('规格齐全（%d 个图形）' % n) if ok
                 else '缺：' + '、'.join(miss) + (' | 硬编码颜色' if hard else '')))
    print('')
    if bad:
        print('%d 个图标规格不合规。' % bad)
        return 1
    # 🔴 0.27.18 错账修正：原来写 len(files)（含豁免的示意图）⇒
    #    打印"36 个全部通过"而实际图标只有 35 个——汇总与明细对不上。
    print('图标规格：%d 个全部通过。' % len(icon_files))

    # 🔴 0.27.18 溯源在库复核：manifest.body ↔ SVG 本体逐条比对。
    #    sha256 记的是**上游原文件**的哈希（本机离线重算不出），
    #    但 body 是 manifest 与入仓文件**两边都有**的几何——
    #    换版本/手改 SVG 没人报警的缺口就在这里堵上。
    # 🔴 0.27.19 锁值三方一致（质量门神 R3-4 指出的缺口）：此前
    #    manifest.count / icons 数组长度 / svg 目录文件数三个数字
    #    谁都不查——手加 svg 或手改 count 都没人报警。
    man_path = os.path.join(ROOT, '09-assets', 'icons', 'manifest.json')
    lock_probe = []
    if os.path.isfile(man_path):
        man0 = json.load(io.open(man_path, encoding='utf-8'))
        svg_dir = os.path.join(ROOT, '09-assets', 'icons', 'svg')
        svg_n = len([f for f in os.listdir(svg_dir) if f.endswith('.svg')])             if os.path.isdir(svg_dir) else -1
        if man0.get('count') != len(man0.get('icons', [])):
            lock_probe.append('manifest.count=%r 与 icons 数组长度 %d 不一致'
                              % (man0.get('count'), len(man0.get('icons', []))))
        if len(man0.get('icons', [])) != svg_n:
            lock_probe.append('icons 数组 %d 条与 svg 文件数 %d 不一致'
                              % (len(man0.get('icons', [])), svg_n))
    if lock_probe:
        print('锁值校验：三方不一致 ——')
        for x in lock_probe:
            print('  ✗ ' + x)
        return 1
    print('锁值校验：manifest.count = icons 数组 = svg 文件数，三方一致。')
    man_path = os.path.join(ROOT, '09-assets', 'icons', 'manifest.json')
    if os.path.isfile(man_path):
        man = json.load(io.open(man_path, encoding='utf-8'))
        # 🔴 0.27.18 映射澄清：入仓文件名 = manifest 的 `name`（alert.svg），
        #    `source` 是 lucide 上游原名（triangle-alert）——溯源链是
        #    name.svg → (sha256) → lucide-static 的 source.svg。
        by_name = {ic.get('name'): ic for ic in man.get('icons', [])}
        prob = []
        seen_name = set()
        for f in icon_files:
            rel = os.path.relpath(f, ROOT).replace(os.sep, '/')
            if not rel.startswith('09-assets/icons/svg/'):
                continue
            name = os.path.splitext(os.path.basename(f))[0]
            seen_name.add(name)
            ic = by_name.get(name)
            if not ic:
                prob.append(rel + '：manifest.json 没有这一条（溯源断链）')
                continue
            want = re.sub(r'\s+', ' ', (ic.get('body') or '')).strip()
            m = re.search(r'<svg[^>]*>(.*)</svg>', open(f, encoding='utf-8').read(), re.S)
            got = re.sub(r'\s+', ' ', m.group(1)).strip() if m else ''
            if not want:
                prob.append(rel + '：manifest.body 为空')
            elif want != got:
                prob.append(rel + '：manifest.body 与 SVG 本体不一致（手改/换版本未同步）')
        for name in sorted(set(by_name) - seen_name):
            prob.append('manifest 有 %s 但 09-assets/icons/svg/%s.svg 缺失'
                        % (name, name))
        if prob:
            print('溯源复核：%d 条不一致 ——' % len(prob))
            for x in prob:
                print('  ✗ ' + x)
            return 1
        print('溯源复核：manifest.body ↔ SVG 本体 %d/%d 一致。'
              % (len(seen_name), len(by_name)))
    print('⚠ 规格合规 != 画得好 —— 语义清晰度必须人眼看。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
