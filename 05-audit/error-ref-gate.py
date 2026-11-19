#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
error-ref-gate.py — 代码里每个 E### 引用必须能在台账索引里解析（WO-18）

===========================================================================
🔴 为什么需要
---------------------------------------------------------------------------
  内部失误台账（ERRORS.md）**不随仓分发**，而代码里有两百多处 `E###`
  引用（"见 ERRORS E31"、"E155 教训"、"E123 形态"……）。外部读者、
  新接手的人拿到的是一个**死索引**：看得见编号，找不到内容。

  0.27.21（WO-18）起：`docs/ERRORS-INDEX.md` 是每个被引用编号的最小解析
  （编号 / 一句话 / CHANGELOG 首提版本 / 关联判据），随包分发。
  本门禁保证它**永远不落后于代码**：代码里出现一个索引里没有的编号 ⇒ 红。

===========================================================================
判据
---------------------------------------------------------------------------
  ① 扫描范围：仓库全部代码文件（.py/.js/.mjs/.sh），05-audit/ 也扫
     （leak-scan 的教训 E26：把工具目录当盲区，缺口正好开在盲区里）。
  ② 编号边界与 terms.py 的 INTERNAL_ID_RE 同一课：
       前面不能是 [0-9A-Za-z#_-]（十六进制颜色 #6E747E、标识符 parts_E123_x
       不咬），后面不能是字母数字。
       ⚠️ 台账命名空间收 1-3 位（E8 / E31 / E123 都是真条目）；宽度放宽到
          1-3 位后 pdf-export / app-shell 的**本地用例标号**（E1-E25）也在
          视野内 —— 索引对它们逐一登记并标注多义。
  ③ `noqa:` 行跳过（E712/E731 是 PEP8 码，不是台账编号）。
  ④ 零视野守卫（E315）：一个代码文件都没扫到 / 一个编号都没找到 ⇒ 红。
     0/0 不是通过 —— 那是扫描器坏了，不是仓库干净。

自检：--selftest 在临时目录构造合成树（不碰真仓库）。
"""
import sys
import os
import io
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, 'docs', 'ERRORS-INDEX.md')

SCAN_DIRS = ('05-audit', '01-tokens', '02-primitives', '03-patterns',
             '04-recipes', '09-assets', 'adapters', 'esm', 'docs',
             'benchmark', 'guide', 'ai')
SCAN_EXCLUDE = ('node_modules', 'fixtures', 'vendor', '__pycache__')
EXTS = ('.py', '.js', '.mjs', '.sh')

# 编号边界：与 terms.INTERNAL_ID_RE 同一课，宽度 1-3 位
E_CODE = re.compile(r'(?<![0-9A-Za-z#_\-])E\d{1,3}(?![0-9A-Za-z])')

# 本文件自己持有反向控制的样本串 ⇒ 扫描时跳过（与 gate-selfcheck 同一取舍）
SELF = 'error-ref-gate.py'


def _iter_code_files(root):
    for d in SCAN_DIRS:
        base = os.path.join(root, d)
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [x for x in dirnames
                           if x not in SCAN_EXCLUDE
                           and not x.startswith('.')]
            for fn in filenames:
                if not fn.endswith(EXTS) or fn == SELF:
                    continue
                yield os.path.join(dirpath, fn)


def index_codes(index_path):
    """从 docs/ERRORS-INDEX.md 的表格里取出已登记的编号集合。"""
    txt = io.open(index_path, encoding='utf-8').read()
    codes = set()
    for line in txt.split('\n'):
        s = line.strip()
        if not s.startswith('|'):
            continue
        m = re.match(r'^\|\s*(E\d{1,3})\s*\|', s)
        if m:
            codes.add(m.group(1))
    return codes


def scan_refs(root):
    """返回 [(rel, lineno, code), …]。noqa 行跳过（PEP8 码不在此命名空间）。"""
    refs = []
    for p in _iter_code_files(root):
        rel = os.path.relpath(p, root).replace(os.sep, '/')
        try:
            txt = io.open(p, encoding='utf-8', errors='replace').read()
        except Exception:
            continue
        for i, l in enumerate(txt.split('\n'), 1):
            if 'noqa' in l:
                continue
            for m in E_CODE.finditer(l):
                refs.append((rel, i, m.group(0)))
    return refs


def main(root=None, index_path=None):
    root = root or ROOT
    index_path = index_path or INDEX
    print('  === E### 引用 → 台账索引 ===')
    print('')

    if not os.path.isfile(index_path):
        print('  X 找不到 %s' % os.path.relpath(index_path, root))
        return 1
    registered = index_codes(index_path)
    if not registered:
        print('  X 索引里一个编号都没解析出来 ⇒ 判据视野已空，不许判通过')
        return 1

    refs = scan_refs(root)
    files = len(set(r[0] for r in refs))
    if not refs:
        print('  X 代码里一个 E### 都没找到 ⇒ 扫描视野为空，0/0 不是通过'
              '（E315）')
        return 1

    from collections import Counter
    dist = Counter(r[2] for r in refs)
    dangling = sorted(set(r[2] for r in refs if r[2] not in registered))
    if dangling:
        print('  🔴 %d 个编号在索引里**查不到**（死引用）：' % len(dangling))
        for code in dangling[:12]:
            where = ['%s:%d' % (r[0], r[1])
                     for r in refs if r[2] == code][:3]
            print('     · %-6s %s' % (code, '  '.join(where)))
        if len(dangling) > 12:
            print('     …… 另有 %d 个' % (len(dangling) - 12))
        print('')
        print('     ⇒ 在 docs/ERRORS-INDEX.md 登记它（编号 / 一句话 /')
        print('        CHANGELOG 首提版本 / 关联判据）。索引落后于代码 =')
        print('        新的教训又不随仓可解析了。')
        print('')
        print('  实查 %d 处引用（%d 个文件）/ 已登记 %d 个编号'
              % (len(refs), files, len(registered)))
        return 1

    print('  OK 代码里的 %d 处 E### 引用（%d 个编号 / %d 个文件）全部可解析'
          % (len(refs), len(dist), files))
    print('')
    print('  实查 %d 处引用 / 已登记 %d 个编号（索引含 %d 个仅历史条目）'
          % (len(refs), len(registered),
             max(0, len(registered) - len(dist))))
    return 0


def _selftest():
    """反向控制：临时树里证明 ① 有编号没登记 ⇒ 红 ② 全登记 ⇒ 绿
    ③ 空树（零视野）⇒ 红（0/0 不是通过）。"""
    import shutil
    import tempfile

    NL = chr(10)
    bad = 0
    tmp = tempfile.mkdtemp(prefix='eref-')
    try:
        os.makedirs(os.path.join(tmp, '05-audit'))
        os.makedirs(os.path.join(tmp, 'docs'))
        idx = os.path.join(tmp, 'docs', 'ERRORS-INDEX.md')
        gate = os.path.join(tmp, '05-audit', 'some-gate.py')

        def write(p, s):
            with io.open(p, 'w', encoding='utf-8', newline=NL) as f:
                f.write(s)

        write(idx, '| 编号 | 一句话 |' + NL +
              '|------|--------|' + NL +
              '| E31 | 同一判定写两遍必然漂移 |' + NL +
              '| E999 | 夹具占位（非错误编号） |' + NL)

        # ① 有编号没登记 ⇒ 红
        write(gate, 'import sys' + NL +
              'if bad:' + NL +
              '    sys.exit(1)  # 见 ERRORS E777（索引里没有）' + NL)
        rc = main(root=tmp, index_path=idx)
        ok = rc == 1
        print('  %s ① 未登记编号（E777）⇒ %s'
              % ('OK ' if ok else '🔴 ',
                 '正确报红' if ok else '没报红'))
        if not ok:
            bad += 1

        # ② 全登记 ⇒ 绿
        write(gate, 'import sys' + NL +
              'if bad:' + NL +
              '    sys.exit(1)  # 见 ERRORS E31（已登记）' + NL +
              '# 边界反例：#6E747E / parts_E999_x / noqa: E712 都不咬' + NL)
        rc = main(root=tmp, index_path=idx)
        ok = rc == 0
        print('  %s ② 全登记 + 边界不咬 ⇒ %s'
              % ('OK ' if ok else '🔴 ',
                 '通过' if ok else '误报'))
        if not ok:
            bad += 1

        # ③ 空树（没有代码文件）⇒ 红
        os.remove(gate)
        rc = main(root=tmp, index_path=idx)
        ok = rc == 1
        print('  %s ③ 零视野（无代码文件）⇒ %s'
              % ('OK ' if ok else '🔴 ',
                 '正确报红（0/0 不是通过）' if ok else '静默通过'))
        if not ok:
            bad += 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print('')
    print('  %s' % ('反向控制全部通过 ⇒ 这道门禁有鉴别力' if not bad
                    else '🔴 %d 条反向控制没通过' % bad))
    return 1 if bad else 0


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    if '--selftest' in sys.argv:
        sys.exit(_selftest())
    sys.exit(main())
