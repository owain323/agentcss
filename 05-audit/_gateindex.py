#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
_gateindex.py — check-all.sh 注册表的**唯一**解析器（E31：同一判定写两遍必然漂移）

===========================================================================
消费者
---------------------------------------------------------------------------
  gate-verdict-gate.py   逐道门禁查判红路径（实查 vs 注册）
  gate-selfcheck.py      判据 ① 可达性 / ② 重名检测（WO-16）

🔴 为什么抽出来
---------------------------------------------------------------------------
  两个消费者各自写过一份 `run "name"` 正则。WO-16 实测：gate-selfcheck
  判据 ② 的正则只认字面 `run` —— `run_report` 注册、`VAR= 前缀` 注册、
  `for g in …` 循环批量注册的门禁对重名检测**全部隐形**。
  解析只此一份，谁要新的认法就改这里，两个消费者同时受益。

认三种注册形态（与 gate-verdict-gate 的历史判据一字不差地搬过来）：
  ① 逐条：`run "名字" 命令...` / `run_report "名字" ...`（含 `VAR=值` 前缀）
  ② 循环批量：`for g in a b c; do run "$g" ...; done` —— 把模板里的 $g
     用每个真名替换展开
  ③ `run "$g"` 模板行本身**不算**注册（那是循环体内部，不是注册点）
"""
import io
import re

# 逐条注册：行首可有若干 `VAR=值` 前缀（WO-02b），然后 run / run_report
_RUN_LINE = re.compile(
    r'^\s*(?:\w+=\S+\s+)*(run|run_report)\s+"([^"]+)"\s+(.+?)\s*$', re.M)
# 循环批量注册：for g in ...; do ... run "$g" ... done
_FOR_BLOCK = re.compile(
    r'^\s*for g in ([^;]+); do\s*\n(.*?)\n\s*done', re.M | re.S)
_FOR_RUN = re.compile(r'^\s*run\s+"\$g"\s+(.+?)\s*$', re.M)


def registered_pairs(check_all_path):
    """解析 check-all.sh 的全部注册，按出现顺序返回 [(name, cmdline)]。

    ⚠️ 返回**有序列表**且**不去重**：gate-selfcheck 判据 ②（重名检测）
       需要看见重复；dict 视图会把重名静默折叠——那正是要抓的病。
    """
    txt = io.open(check_all_path, encoding='utf-8').read()
    pairs = []
    for m in _RUN_LINE.finditer(txt):
        # 跳过 `run "$g" ...`（循环体内部的模板，不是注册；真展开在下面）
        if '$' in m.group(2):
            continue
        pairs.append((m.group(2), m.group(3)))
    for m in _FOR_BLOCK.finditer(txt):
        names = [x.strip().strip('"\'') for x in m.group(1).split()]
        body = m.group(2)
        for run_m in _FOR_RUN.finditer(body):
            tpl = run_m.group(1)
            for name in names:
                if name:
                    pairs.append((name, tpl.replace('$g', name)))
    return pairs


def registered_gates(check_all_path):
    """去重视图：名字 → 命令行（gate-verdict-gate 用）。"""
    return dict(registered_pairs(check_all_path))


def script_of(cmdline):
    """从命令行里找出 .py/.js/.mjs/.sh 脚本路径。

    ⚠️ 必须先剥引号：循环注册的模板展开后会带引号
       （`run "$g" $PY "05-audit/$g.py"` ⇒ token 是 `"05-audit/tierA-gate.py"`），
       而 `endswith('.py')` 对带引号的 token 是 False ⇒ 静默跳过。
    """
    for tok in cmdline.split():
        tok = tok.strip('"\'')
        if tok.endswith(('.py', '.js', '.mjs', '.sh')):
            return tok
    return None
