# -*- coding: utf-8 -*-
"""
assets-catalog-gate.py — `ai assets` 清单与磁盘/契约的交叉对账
============================================================================
五条判据（0.27.18 起判据本体抽成 judge() 纯函数）：
  ① 磁盘上 4 个资产层的子目录数  ==  CLI 输出里这 4 层的条数
  ② `components.json` 的每个 id   ⊆   CLI 输出
  ③ CLI 里 type=component 的一项一  ∈   `components.json`
  ④ `01-tokens` 的 .css/.js 文件数 ==  CLI 里 layer=01-tokens 的条数
  ⑤ 每条 desc 非空

--selftest（0.27.18 重做）：
  旧版在 ①-⑤ 全部跑完之后才"删一条数一数"——只证明了"条数会变"，
  判据本体有没有牙从未被测（恒真假牙）。现在把**坏数据真喂回同一份
  judge()**：基准必须绿；抹掉一条资产层条目 ⇒ ① 必须红；清空一条
  描述 ⇒ ⑤ 必须红。两个变异任何一个不红 = selftest 红。

用法：
  python 05-audit/assets-catalog-gate.py
  python 05-audit/assets-catalog-gate.py --selftest
"""

import io
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAYERS = ('02-primitives', '03-patterns', '04-recipes', '09-assets')
FAILS = []


def fail(msg):
    FAILS.append(msg)


def load_cli():
    """跑 `ai assets --json`，拿机器可读清单。"""
    proc = subprocess.run(
        ['node', os.path.join(ROOT, 'ai', 'cli.js'), 'assets', '--json'],
        cwd=ROOT, capture_output=True, text=True, encoding='utf-8', timeout=60)
    if proc.returncode != 0:
        fail('ai assets 退出码 %d：%s' % (proc.returncode, (proc.stderr or '').strip()[:200]))
        return None
    try:
        return json.loads(proc.stdout)
    except Exception as e:
        fail('ai assets --json 输出不是合法 JSON：%s' % e)
        return None


def disk_dirs():
    out = set()
    for layer in LAYERS:
        d = os.path.join(ROOT, layer)
        if not os.path.isdir(d):
            fail('资产层缺失：%s' % layer)
            continue
        for n in os.listdir(d):
            # 与 ai/cli.js 同一个通用规则：下划线/点开头是临时或隐藏目录
            if n.startswith('_') or n.startswith('.'):
                continue
            if os.path.isdir(os.path.join(d, n)):
                out.add((layer, n))
    return out


def tokens_on_disk():
    """01-tokens 的实条目数：目录 + 顶层 .css/.js（与 CLI 口径一致）。"""
    tk = os.path.join(ROOT, '01-tokens')
    n = 0
    if os.path.isdir(tk):
        for name in os.listdir(tk):
            if name.startswith('_') or name.startswith('.'):
                continue
            p = os.path.join(tk, name)
            if os.path.isdir(p):
                n += 1
            elif name.endswith(('.css', '.js')):
                n += 1
    return n


def contract_ids():
    doc = json.load(io.open(os.path.join(ROOT, 'ai', 'components.json'),
                            encoding='utf-8'))
    return set(c['id'] for c in doc['components'])


def judge(rows, dd, doc_ids, disk_tk):
    """①-⑤ 判据本体（纯函数）：输入 CLI 行与磁盘/契约事实，返回失败清单。

    🔴 0.27.18：抽成纯函数——selftest 要把**坏数据真喂回同一份判据**。
    """
    fails = []
    cli_n = sum(1 for r in rows if r.get('layer') in LAYERS)
    if len(dd) != cli_n:
        fails.append('① 磁盘 4 层目录 %d 个，ai assets 只列出 %d 个' % (len(dd), cli_n))
        listed = set((r['layer'], r['id']) for r in rows if r.get('layer') in LAYERS)
        for layer, n in sorted(dd - listed):
            fails.append('   未列出：%s/%s' % (layer, n))

    cli_ids = set(r['id'] for r in rows if r.get('type') == 'component')
    for missing in sorted(doc_ids - cli_ids):
        fails.append('② 契约里有 %s，ai assets 没列出' % missing)
    for extra in sorted(cli_ids - doc_ids):
        fails.append('③ ai assets 把 %s 标成 component，但它不在契约里' % extra)

    cli_tk = sum(1 for r in rows if r.get('layer') == '01-tokens')
    if disk_tk != cli_tk:
        fails.append('④ 01-tokens 实际 %d 项（目录+css+js），ai assets 列出 %d 项'
                     % (disk_tk, cli_tk))

    for e in (r['id'] for r in rows if not (r.get('desc') or '').strip()):
        fails.append('⑤ %s 没有描述（AI 无法判断它做什么）' % e)
    return fails


def main():
    selftest = '--selftest' in sys.argv

    rows = load_cli()
    if rows is None:
        return report(selftest)

    dd = disk_dirs()
    doc_ids = contract_ids()
    disk_tk = tokens_on_disk()

    if not selftest:
        FAILS.extend(judge(rows, dd, doc_ids, disk_tk))
        return report(selftest)

    # ---- selftest：基准绿 + 两个变异红（坏数据真喂回 judge()）----
    if not rows:
        fail('selftest：没有条目，无法做反向控制')
        return report(True)

    base = judge(rows, dd, doc_ids, disk_tk)
    if base:
        fail('selftest：基准数据就红（%s）——先修基准再谈判别力' % base[0])
        return report(True)
    print('  [OK] 基准 %d 条全绿（判据在真数据上不误报）' % len(rows))

    # 变异 ①：抹掉一个资产层条目 ⇒ 判据① 必须红
    victim = next(r for r in rows if r.get('layer') in LAYERS)
    m1 = [r for r in rows if r is not victim]
    f1 = judge(m1, dd, doc_ids, disk_tk)
    ok1 = any(x.startswith('①') for x in f1)
    print('  %s 变异① 抹掉 %s/%s ⇒ %s'
          % ('[OK]' if ok1 else '🔴', victim.get('layer'), victim['id'],
             '判据① 抓到' if ok1 else '没抓到（没牙）'))
    if not ok1:
        fail('selftest：变异① 判据没红')

    # 变异 ②：清空一条描述 ⇒ 判据⑤ 必须红
    v2 = next(r for r in rows if (r.get('desc') or '').strip())
    m2 = [dict(r) for r in rows]
    for r in m2:
        if r['id'] == v2['id']:
            r['desc'] = ''
    f2 = judge(m2, dd, doc_ids, disk_tk)
    ok2 = any(x.startswith('⑤') for x in f2)
    print('  %s 变异② 清空 %s 的描述 ⇒ %s'
          % ('[OK]' if ok2 else '🔴', v2['id'],
             '判据⑤ 抓到' if ok2 else '没抓到（没牙）'))
    if not ok2:
        fail('selftest：变异② 判据没红')

    return report(True)


def report(selftest):
    tag = '[selftest] ' if selftest else ''
    if FAILS:
        print('  %s资产目录与磁盘/契约不一致：' % tag)
        for f in FAILS:
            print('    ' + f)
        return 1
    if not selftest:
        print('  [OK] 资产目录与磁盘/契约一致（%d 层对账）' % len(LAYERS))
    return 0


if __name__ == '__main__':
    sys.exit(main())
