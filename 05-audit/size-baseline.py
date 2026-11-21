#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
size-baseline.py — 体积基线与回归门禁

===========================================================================
🔴 为什么需要这道门禁（K10）
---------------------------------------------------------------------------
  现有 `perf-gate.py` 查的是**绝对阈值**：
      单文件 ≤ 24KB、全量 ≤ 120KB、单页内联 ≤ 8KB

  ⭐ 但那是「现在通过」级别的检查。真实风险是：
      改一行 CSS 让某个属性多写一遍、体积悄悄涨 2KB
      —— 只要没冲破绝对阈值，**没有任何门禁会拦**。

  成熟做法（MUI 那一档）：
      每次提交都记录体积快照，
      并检查**相对上一次**的变化幅度。
  ⭐ 一句话：
      「现在通过」是及格线，
      「不许偷偷把性能带坏」才是持续预算。

===========================================================================
用法
---------------------------------------------------------------------------
  python3 05-audit/size-baseline.py --record    # 记录当前基线
  python3 05-audit/size-baseline.py            # 与基线比对（默认）
  python3 05-audit/size-baseline.py --allow-growth 8   # 允许增长 8%
===========================================================================
"""
import sys
import os
import io
import json
import gzip

# 按**内容**读字节（行尾无关）—— 与 dist / doc-facts 共用同一份（决策项 D4 第①步）
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _bytes                                          # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASELINE = os.path.join(ROOT, '05-audit', 'size-baseline.json')

# 纳入统计的目录（vendor 第三方代码不算我们自己的体积）
# 🔴 0.27.18：09-assets 纳入账本 —— 此前 940KB vendor+glb 与 35KB icons
#    完全在体积账本外（vendor 有上面的排除规则，glb/svg 不在 EXTS，
#    计入的是我们自己的 js/css：sparkline / model-viewer / bar /
#    echarts-adapter / scientific-plot）。增长要能被看见。
DIRS = ('01-tokens', '02-primitives', '03-patterns', '04-recipes', '09-assets')
EXTS = ('.css', '.js')

# ⭐ 单个改动允许的增长比例 —— 超过就要解释
DEFAULT_TOLERANCE = 5.0     # %


def collect():
    """收集 (相对路径, 原始字节, gzip 字节)"""
    out = {}
    for d in DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            # ⭐ 第三方代码不算我们的体积
            if 'vendor' in dirpath.replace(os.sep, '/'):
                continue
            for f in filenames:
                if not f.endswith(EXTS):
                    continue
                p = os.path.join(dirpath, f)
                rel = os.path.relpath(p, ROOT).replace(os.sep, '/')
                try:
                    # 🔴 归一化读取（0.8.9 · D4 第①步）：
                    #   原来 `open(p,'rb').read()` 量的是**磁盘字节**，
                    #   而工作区行尾是混合的（实测 300 CRLF / 80 LF）
                    #   ⇒ 这份基线一旦录下就绑定了这台机器：
                    #     别人 clone 出来（行尾不同）字节数就变 ⇒ 假红。
                    raw = _bytes.read_norm(p)
                except Exception:
                    continue
                out[rel] = {
                    'raw': len(raw),
                    # ⭐ 线上传输量看的是 gzip，不是原始大小
                    'gzip': len(gzip.compress(raw, 9)),
                }
    return out


def total(data, key='gzip'):
    return sum(v[key] for v in data.values())


def fmt(n):
    return '%.1f KB' % (n / 1024.0)


def selftest():
    """文件级判据的自检——临时合成树 + 真跑 main()，逐分支断言退出码。

    🔴 为什么存在：判据与注释的矛盾（比率项单独拦小文件）活了 12 个版本，
       因为这道门禁的日常输出是 OK——写错的分支日常一百次也看不出来。
       selftest-all 按源码字面量自动发现 --selftest ⇒ 每次自检批都会
       端到端跑到这里（与 budget-selftest 用临时账本逼 perf-gate 同一手法）。
    """
    import shutil
    import subprocess
    import tempfile
    import hashlib

    here = os.path.dirname(os.path.abspath(__file__))
    tmp = tempfile.mkdtemp(prefix='size-baseline-selftest-')
    bad = []
    try:
        # ROOT 由脚本位置推导 ⇒ 把脚本复制进临时树，量的是副本自己的树
        os.makedirs(os.path.join(tmp, '01-tokens'))
        os.makedirs(os.path.join(tmp, '05-audit'))
        for f in ('size-baseline.py', '_bytes.py'):
            shutil.copy(os.path.join(here, f), os.path.join(tmp, '05-audit', f))

        def put(rel, n, filler='/* x */\n'):
            """写入 n 字节左右的合成内容（默认高可压缩——专门暴露 raw 视角）"""
            p = os.path.join(tmp, rel.replace('/', os.sep))
            io.open(p, 'w', encoding='utf-8', newline='').write(filler * (n // len(filler)))

        def run(*args):
            r = subprocess.run(
                [sys.executable, os.path.join('05-audit', 'size-baseline.py')] + list(args),
                cwd=tmp, capture_output=True, text=True)
            return r.returncode, r.stdout

        put('01-tokens/small.css', 300)   # 300B 小文件
        put('01-tokens/mid.css', 3000)    # 3KB 中文件
        if run('--record')[0] != 0:
            bad.append('基线记录失败')

        # case 1｜小文件 +500B：比率爆表（~+50%），绝对增量 <1KB
        #   ⇒ 修后放行。旧判据（d > tol 单独拦）在此红——这就是修掉的毛刺。
        put('01-tokens/small.css', 800)
        if run()[0] != 0:
            bad.append('case1 小文件 +500B 被拦（判据又写回比率项了？）')

        # case 2｜中文件 +600B（+20%，绝对 <1KB）⇒ 修后放行
        put('01-tokens/mid.css', 3600)
        if run()[0] != 0:
            bad.append('case2 中文件 +600B/+20% 被拦（同上）')

        # case 3｜+4KB 重复注释：gzip 几乎不动，raw 实打实（+4KB > 1KB）
        #   ⇒ rabs 必须拦——「复制粘贴型膨胀」是这道门禁的本职（K10）
        put('01-tokens/mid.css', 3000 + 4096)
        rc, out = run()
        if rc == 0 or 'mid.css' not in out:
            bad.append('case3 复制粘贴型膨胀（raw +4KB）没被拦——绝对门槛失效')

        # case 4｜+2KB 不可压缩文本（sha256 十六进制串）：gzip/raw 双超
        #   ⇒ dabs 必须拦
        big = ''.join(hashlib.sha256(('k%d' % i).encode()).hexdigest() for i in range(64))
        p = os.path.join(tmp, '01-tokens', 'mid.css')
        io.open(p, 'a', encoding='utf-8', newline='').write('/* ' + big + ' */\n')
        rc, out = run()
        if rc == 0 or 'mid.css' not in out:
            bad.append('case4 不可压缩 +2KB 没被拦——dabs 门槛失效')

        if bad:
            for c in bad:
                print('  X ' + c)
            print('  ⇒ size-baseline 文件级判据自检失败')
            return 1
        print('  OK 文件级判据自检 4 用例全过（小额放行 ×2 / 重复注释拦截 / 不可压缩拦截）')
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    if '--selftest' in sys.argv:
        return selftest()
    arg_tol = None
    if '--allow-growth' in sys.argv:
        i = sys.argv.index('--allow-growth')
        try:
            arg_tol = float(sys.argv[i + 1])
        except (IndexError, ValueError):
            print('  X --allow-growth 需要一个数字（百分比）')
            return 2
    record = '--record' in sys.argv
    tol = arg_tol if arg_tol is not None else DEFAULT_TOLERANCE

    cur = collect()
    if not cur:
        print('  X 没收集到任何文件')
        return 1

    if record or not os.path.isfile(BASELINE):
        data = {
            'tolerance_percent': tol,
            'files': cur,
            'total_raw': total(cur, 'raw'),
            'total_gzip': total(cur, 'gzip'),
        }
        io.open(BASELINE, 'w', encoding='utf-8', newline='').write(
            json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + '\n')
        print('  已记录基线：%d 个文件' % len(cur))
        print('     原始 %s · gzip %s' % (fmt(data['total_raw']),
                                            fmt(data['total_gzip'])))
        return 0

    base = json.load(io.open(BASELINE, encoding='utf-8'))
    told = base.get('tolerance_percent', DEFAULT_TOLERANCE)
    if arg_tol is None:
        tol = told

    bfiles = base.get('files', {})
    print('  === 体积基线比对（容差 %.1f%%）===' % tol)
    print('')

    bad = 0

    # ① 总量
    # ⭐⭐ 关键：只看 **gzip 比率**会漏判。
    #   实测：加 4KB 重复注释，gzip 只涨 0.1KB（+0.06%）⇒ 比率门禁失效。
    #   重复内容正是最常见的"悄悄变大"（复制粘贴的样式），
    #   gzip 恰好把它压掉 ⇒ 必须同时看**绝对增量**与**原始体积**。
    cg, bg = total(cur, 'gzip'), base.get('total_gzip', 0)
    craw, braw = total(cur, 'raw'), base.get('total_raw', 0)
    abs_gz = cg - bg
    abs_raw = craw - braw
    # 允许的绝对增长：基线的 5%，且不超过 16KB
    allow_abs = max(1024 * 16, int(bg * tol / 100.0))
    ratio = (cg - bg) * 100.0 / bg if bg else 0
    # ⭐ **raw 才是抓「重复内容型膨胀」的主力** ——
    #   复制粘贴的样式，gzip 几乎压不动（实测 4KB → 0.1KB）。
    raw_allow = max(1024 * 8, int(braw * tol / 100.0))
    over = abs_gz > allow_abs or ratio > tol or abs_raw > raw_allow
    print('  %s gzip 总体积  %s → %s  (绝对 %+0.1f KB / 允许 %0.1f KB，比率 %+.2f%%)'
          % ('X ' if over else 'OK ', fmt(bg), fmt(cg),
             abs_gz / 1024.0, allow_abs / 1024.0, ratio))
    print('     %s 原始总体积  %s → %s  (绝对 %+0.1f KB / 允许 %0.1f KB)'
          % ('X ' if abs_raw > raw_allow else 'OK ',
             fmt(braw), fmt(craw), abs_raw / 1024.0, raw_allow / 1024.0))
    if over:
        bad += 1
    print('')

    # ② 单文件
    grew = []
    for rel, v in cur.items():
        b = bfiles.get(rel)
        if not b or not b.get('gzip'):
            continue
        d = (v['gzip'] - b['gzip']) * 100.0 / b['gzip']
        # ⭐ 单文件同样看绝对增量（1KB 门槛）：
        #   小文件涨 50% 可能只有几百字节，不值得拦；
        #   但涨 3KB 一定是有人复制粘贴了。
        dabs = v['gzip'] - b['gzip']
        # ⭐ raw 涨 1KB 就报（重复内容在 raw 视角下是实打实的）
        rabs = v['raw'] - b['raw']
        # 🔴 0.27.24 修判据与注释的矛盾（0.27.11 起的债，12 个版本原地不动）：
        #   上面注释写的意图是「小文件涨 50% 可能只有几百字节，不值得拦」，
        #   代码却一直是 `d > tol or dabs > 1024 or rabs > 1024` —— 比率项
        #   单独就能拦：小文件涨 5% 即红（实测 typography.css +410B ⇒
        #   +13.2% 被拦）。两轮（0.27.11 / 0.27.24）都只能「重录基线」绕行，
        #   判断成本转给下一个人。
        #   ⇒ 对齐注释的意图：gzip 或 raw 任一**绝对**增量 > 1KB 才拦。
        #   这是判据域修正，不是放宽——要抓的「复制粘贴型膨胀」在 raw 视角
        #   是实打实的（4KB 重复注释 gzip 只 +0.1KB 但 raw +4KB ⇒ rabs 拦住），
        #   大额增长仍被双绝对门槛拦住；比率只剩展示作用。总量侧（①）不动：
        #   总量的 5% 是几十 KB，比率项在总量尺度上语义成立。
        #   判据本身现在有自检（--selftest，selftest-all 自动发现）——
        #   这条矛盾能活 12 版，就是因为文件级逻辑没有反向控制。
        if dabs > 1024 or rabs > 1024:
            grew.append((rel, b['gzip'], v['gzip'], d))
    if grew:
        grew.sort(key=lambda x: -(x[2] - x[1]))
        print('  X 以下文件超出容差：')
        for rel, b0, c0, d in grew[:8]:
            print('     %-44s %s → %s (%+.1f%%)' % (rel[:44], fmt(b0), fmt(c0), d))
        bad += len(grew)
    else:
        print('  OK 单文件绝对增量均在 1KB 门槛内')

    # ③ 新增文件（也要记账，否则体积只增不减）
    added = [r for r in cur if r not in bfiles]
    if added:
        print('')
        print('  ! 新增 %d 个文件（已计入总量，但请确认是必要的）:' % len(added))
        for r in added[:6]:
            print('     %-44s %s' % (r[:44], fmt(cur[r]['gzip'])))
    removed = [r for r in bfiles if r not in cur]
    if removed:
        print('')
        print('  · 已删除 %d 个文件（体积下降）' % len(removed))

    print('')
    if bad:
        print('  => 体积超出预算。')
        print('     如果是有意的，请重录基线：')
        print('       python3 05-audit/size-baseline.py --record')
        print('     如果是无意的，就是一次性能回归。')
        return 1
    print('  OK 未超出体积预算')
    return 0


if __name__ == '__main__':
    sys.exit(main())
