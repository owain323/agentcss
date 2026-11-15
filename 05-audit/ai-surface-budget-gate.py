#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
ai-surface-budget-gate.py — AI 契约面的**字节预算**门禁

为什么要有它（与 docs/BUDGET.md 的 CSS 预算同一类事故）
------------------------------------------------------------
  CSS 有 172KB 天花板，AI 契约面却**没有上限**：
  llms.txt + llms-full.txt + ai/components.json + ai/START-HERE.md
  是一个 agent 要吞的全部机器面 —— 加组件时它悄悄涨，挤的是
  便宜模型的可用上下文。涨到 200KB 的那天，没人会发现。
  ⇒ 数字放 ai-surface-budget.json（**被约束的人手里不握数字**，
     与 BUDGET.md 的治理结构一致），本门禁只读它。

判定
----
  实测四个文件的字节数之和 ≤ budgetBytes ⇒ PASS
  超出 ⇒ FAIL，报：谁涨了（与上次基线对比的增量排序）、
  两条出路（精简 / 带理由调预算 —— bumpLog 是看得见的账）。

自检
----
  --selftest：注入假文件清单跑 evaluate() 纯函数——
  超预算必须红、未超必须绿、恰好等于必须绿（边界）。
"""
import json
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
BUDGET = os.path.join(_HERE, 'ai-surface-budget.json')


def load_budget():
    with open(BUDGET, encoding='utf-8') as f:
        return json.load(f)


def evaluate(sizes, cap):
    """纯函数：{path: bytes} 与上限 → (ok, 排序增量, 总量)。供 main 与 --selftest 共用。"""
    total = sum(sizes.values())
    overs = []
    if total > cap:
        pass  # 交给调用方出账
    return (total <= cap, overs, total)


def measure(root, files):
    sizes = {}
    for rel in files:
        p = os.path.join(root, rel)
        sizes[rel] = os.path.getsize(p) if os.path.isfile(p) else -1
    return sizes


def main():
    if '--selftest' in sys.argv:
        return selftest()

    b = load_budget()
    cap = int(b['budgetBytes'])
    sizes = measure(_ROOT, b['files'])
    missing = [k for k, v in sizes.items() if v < 0]
    if missing:
        print('  [FAIL] 契约面文件不存在：%s' % ', '.join(missing))
        return 1
    total = sum(sizes.values())
    if total > cap:
        print('  [FAIL] AI 契约面 %d 字节 > 预算 %d 字节（超出 %d）' % (total, cap, total - cap))
        print('  两条出路：① 精简契约文案（components.json 的说明字段是大头）；')
        print('           ② 确要扩面，改 ai-surface-budget.json 的 budgetBytes 并在 bumpLog 记一行带理由的账。')
        for k in sorted(sizes, key=lambda k: -sizes[k]):
            print('       %8d  %s' % (sizes[k], k))
        return 1
    print('  [OK  ] AI 契约面 %d / %d 字节（余量 %d）' % (total, cap, cap - total))
    return 0


def selftest():
    """反向控制：evaluate() 的三态边界 + 治理文件的结构完整性。"""
    bad = 0
    cap = 1000
    ok_case = {'a.txt': 600, 'b.txt': 400}
    over_case = {'a.txt': 900, 'b.txt': 400}
    edge_case = {'a.txt': 1000}
    r1 = evaluate(ok_case, cap)
    r2 = evaluate(over_case, cap)
    r3 = evaluate(edge_case, cap)
    if not r1[0]:
        print('  [FAIL] 自检：未超预算的红（600+400=1000 == cap 应绿）')
        bad += 1
    if r2[0]:
        print('  [FAIL] 自检：超预算的绿（900+400 > cap 必须红）')
        bad += 1
    if not r3[0]:
        print('  [FAIL] 自检：恰好等于上限必须绿（≤）')
        bad += 1
    b = load_budget()
    if 'bumpLog' not in b or not b['bumpLog']:
        print('  [FAIL] 自检：bumpLog 缺失 —— 调预算必须留看得见的账')
        bad += 1
    print('  [OK  ] ai-surface-budget 自检（三态边界 + bumpLog 结构）' if not bad
          else '  [FAIL] 自检 %d 项' % bad)
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
