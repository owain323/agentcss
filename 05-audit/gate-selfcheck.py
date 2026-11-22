#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gate-selfcheck.py — 门禁运行器自身的门禁（检查项 J9）

===========================================================================
🔴 为什么需要
---------------------------------------------------------------------------
  评审在 check-all.sh 里发现三个问题，**都是门禁自己的**：
    ① 4 条 run 写在 exit 之后 ⇒ **永不执行**（却显示"已接入"）
    ② hygiene 同名出现两次 ⇒ 报告里分不清是哪一道
    ③ set -u 下用到未初始化的变量 ⇒ 失败路径会中途崩掉

  ⭐ 讽刺之处：这是一个**以门禁为核心卖点**的库，
     而它的门禁运行器自己有「看起来在跑、其实没跑」的门禁。

===========================================================================
判据
---------------------------------------------------------------------------
  ① exit 之后**不得**再有 run（不可达 = 假通过）——两条腿：
      (a) run 在**最后一个 exit 词元**（任意列位，剥注释）之后 ⇒ 死代码；
      (b) **第 0 列裸 exit**（无条件顶层退出）落在 run 区间中间 ⇒ 其后全死。
      🔴 0.27.21旧实现只认「strip 后以 exit 开头的最后一行」：
         被**函数体内的失败退出**（check-all.sh 服务身份校验的 `exit 2`）
         覆盖 ⇒ 198 条正常注册的门禁被误判为"永不执行"（实测假红，
         这道门禁自己成了全量里最红的一道）。
         缩进 exit 在函数/分支里是**失败路径**，不是流程终点——
         只有不缩进的裸 exit 才截断主流程。
  ② run 名称**不得重复**（重复 = 报告歧义）
      🔴 解析单源到 `_gateindex.py`（E31）。旧正则只认字面
         `run "名字"`，run_report / VAR= 前缀 / 循环批量注册对它隐形
         ⇒ 重名检测对那三类注册失明。
  ③ set -u 下用到的变量**必须已初始化**——**有牙**：
      旧实现只 print `!` 警告、不进 bad ⇒ 这条判据**不可能失败**，
      是一段会打印东西的脚本。扫描器同时修了三类误报源：
        - 注释里的用法（CODEBUDDY_* 只活在注释里）也计数 ⇒ 剥注释；
        - case 分支赋值（`--serial)  PARALLEL=1`）与复合行赋值
          （`then _GATE_BASE=…`）漏计 ⇒ 逐行 findall；
        - 一行多赋值（`T_NAME=(); T_CMD=(); …`）只认第一个 ⇒ 同上；
        - `${VAR:-默认}` 守卫形态不计（守卫恰恰是 set -u 的正确写法）。
  ④ CHANGELOG 版本标题的解析**只允许一份**（`_changelog.py`）

🔴 第 ④ 条是 0.8.9 加的，起因是真事故（见 `ERRORS.md` E43）：
  `bump-version.py` / `doc-facts-gate.py` / `release-gate.py`
  **各写了一份版本标题正则**，而且松紧不同。
  CHANGELOG 格式一改，三处以**三种不同方式**坏掉，其中两种是
  **静默失去鉴别力**（判据还在跑，什么都没查）。
  ⇒ 同一判定写两遍必然漂移（E31）—— 这条判据让第四份写不出来。

自检：--selftest 在临时目录里构造夹具（P0-1 的教训：反向控制不碰真仓库），
  覆盖 ①a / ①b / ② / ③ 的判红路径 + 一个「函数内缩进 exit 不许截断」
  的不误报回归（就是 198 假红事故的形状）。
"""
import sys
import os
import io
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SH = os.path.join(ROOT, '05-audit', 'check-all.sh')

# 环境自带的变量（不算"未初始化"）
BUILTIN = {
    'PATH', 'HOME', 'PWD', 'TMPDIR', 'USER', 'SHELL', 'LANG', 'IFS',
    'BASH_SOURCE', 'OSTYPE', 'PYTHONPATH', 'RANDOM', 'SECONDS', 'LINENO',
}
# 本库约定的环境变量（由运行者提供）
ALLOWED_ENV = {'NODE_PATH', 'NODE_DIR', 'NODE_MODULES', 'PW_PATH',
               'TIMING', 'PY', 'AUDIT_REF', 'GITHUB_TOKEN', 'GH_TOKEN',
               'NUMBER_OF_PROCESSORS'}

# 判据 ④ 用的谓词：这一行是不是"自己解析 CHANGELOG 版本标题"的正则？
# 形状 = 同行里同时出现 ① 正则调用 ② `##` ③ `\d+\.\d+\.\d+` 的**转义形式**。
# ⚠️ 只按"转义形式"认（`\\d+\\.\\d+`），所以**不会**命中
#    普通字符串里的 `0.8.8` 或注释里的说明文字。
CALL = ('re.search(', 're.match(', 're.finditer(', 're.compile(',
        'search(', 'match(', 'finditer(')


def is_version_regex_line(l):
    return (re.search(r'\\d\+\s*\\\.\s*\\d\+\s*\\\.\s*\\d\+', l) is not None
            and '##' in l
            and any(c in l for c in CALL))


# ⚠️ 也要跳过本文件：它**持有反向控制的样本串**（下面 `_dup_probe` 里的
#    那三条），否则判据会把自己的 fixture 当成"又写了一份"。
#    代价：本文件里真出现第四份解析器时抓不到 —— 可接受，
#    因为本文件本来就不解析 CHANGELOG。
def dup_parsers(skip=('_changelog.py', 'gate-selfcheck.py'), audit_dir=None):
    """除 `_changelog.py` 外，自己解析 CHANGELOG 版本标题的地方。"""
    hits = []
    d = audit_dir or os.path.join(ROOT, '05-audit')
    for f in sorted(os.listdir(d)):
        if not f.endswith('.py') or f in skip:
            continue
        txt = io.open(os.path.join(d, f), encoding='utf-8',
                      errors='replace').read()
        for i, l in enumerate(txt.split('\n'), 1):
            if is_version_regex_line(l):
                hits.append((f, i, l.strip()[:66]))
    return hits


def _dup_probe():
    """反向控制：合成"又写了一份"的两种真实形状 ⇒ 必须都被识别。"""
    samples = [
        # 实测踩到的第一、二份的形状
        r"    m = re.search(r'^##\s+(\d+\.\d+\.\d+)\b', text, re.M)",
        r"    for m in re.finditer(r'^##\s+(\d+\.\d+\.\d+)', text[:pos], re.M):",
        # 第三份（release-gate）
        r"        m = re.search(r'##\s*\[?v?(\d+\.\d+\.\d+)\]?', cl)",
    ]
    # 反例：普通版本号字符串 / 注释里提到版本号 ⇒ **不许**被识别
    negatives = [
        "version = '0.8.8'",
        "# 版本号在四处（VERSION / package.json / …）",
        "    print('      CHANGELOG      = %s' % cl_ver)",
    ]
    return (all(is_version_regex_line(s) for s in samples)
            and not any(is_version_regex_line(s) for s in negatives))


# ---------------------------------------------------------------------------
# ① 的文本分析（独立成函数，--selftest 直接单测它）
# ---------------------------------------------------------------------------
_RUN_LINE = re.compile(r'^run(?:_report)?\s+"')
_EXIT_WORD = re.compile(r'\bexit\b')
_BARE_EXIT = re.compile(r'^exit\s*(\d+)?\s*$')


def _analyze_reachability(lines):
    """返回 (last_exit_lineno, [死尾 run 行号], [截断型裸 exit 行号])。

    行号从 0 起。剥注释：整行注释跳过、行内 `#` 后丢弃
    （bash 的 `#` 只有在词首才开注释——这里保守按行内首个 `#` 处理，
    `${#arr}` / `$#` 里没有 `exit` 一词，不受影响）。
    """
    exits, bare, runs = [], [], []
    for i, l in enumerate(lines):
        if l.lstrip().startswith('#'):
            code = ''
        else:
            code = l.split('#', 1)[0]
        if _EXIT_WORD.search(code):
            exits.append(i)
            if _BARE_EXIT.match(code):
                bare.append(i)
        if _RUN_LINE.match(l):
            runs.append(i)
    last_exit = max(exits) if exits else None
    dead_tail = [i for i in runs if last_exit is not None and i > last_exit]
    truncated = [b for b in bare
                 if any(r < b for r in runs) and any(r > b for r in runs)]
    return last_exit, dead_tail, truncated


def _analyze_vars(lines):
    """返回 set -u 视角下"用到但未见赋值"的变量名集合。

    只做行级保守分析（这是门禁，不是 shell 解释器）：
      赋值 = 逐行剥注释后 findall `词=`（含 case 分支 / 复合行 / 一行多赋值）
             + `for x in` + `read -r x y`；
      用法 = `$x` 与 `${x…}`；`${x:-默认}` / `${x-默认}` 是**守卫**，不计
             （守卫正是 set -u 下的正确写法，计数会永久假红）。
    """
    assigned = set()
    for l in lines:
        code = '' if l.lstrip().startswith('#') else l.split('#', 1)[0]
        for m in re.finditer(r'([A-Za-z_]\w*)=', code):
            assigned.add(m.group(1))
        for m in re.finditer(r'for\s+([A-Za-z_]\w*)\s+in', code):
            assigned.add(m.group(1))
        for m in re.finditer(r'read\s+(?:-[a-zA-Z]+\s+)*([^\n;|&]+)', code):
            for v in m.group(1).split():
                if re.match(r'^[A-Za-z_]\w*$', v):
                    assigned.add(v)

    used = set()
    for l in lines:
        code = '' if l.lstrip().startswith('#') else l.split('#', 1)[0]
        for m in re.finditer(r'\$\{([A-Za-z_]\w*)([:}])', code):
            if m.group(2) == '}':          # ${x} 裸形态
                used.add(m.group(1))
            # ':' 开头的是 ${x:-默认}/${x:=默认}/… —— 守卫，不计
        for m in re.finditer(r'\$([A-Za-z_]\w*)', code):
            used.add(m.group(1))
    return (u for u in used
            if u not in assigned and u not in BUILTIN
            and u not in ALLOWED_ENV)


def main(sh_path=None, audit_dir=None):
    sh = sh_path or SH
    print('  === 门禁运行器自检 ===')
    print('')
    if not os.path.isfile(sh):
        print('  X 找不到 check-all.sh')
        return 1
    src = io.open(sh, encoding='utf-8').read()
    lines = src.split('\n')
    bad = 0

    # ---------- ① exit 之后不得有 run（收集全部 exit 位置，两条腿）----------
    last_exit, dead_tail, truncated = _analyze_reachability(lines)
    if last_exit is None:
        print('  [1] X 找不到 exit 退出点')
        bad += 1
    else:
        if dead_tail:
            print('  [1] X 最后一个 exit（第 %d 行）之后还有 %d 条门禁'
                  '（**永不执行**）：' % (last_exit + 1, len(dead_tail)))
            for i in dead_tail[:5]:
                print('        %s' % lines[i].strip()[:58])
            bad += 1
        if truncated:
            for b in truncated:
                after = sum(1 for i, l in enumerate(lines)
                            if i > b and _RUN_LINE.match(l))
                print('  [1] X 第 %d 行有无条件顶层 exit，把 run 清单截成两段'
                      ' ⇒ 其后 %d 条**永不执行**' % (b + 1, after))
            bad += 1
        if not dead_tail and not truncated:
            print('  [1] OK exit 之后无门禁（全部可达；函数内失败退出不截断主流程）')

    # ---------- ② run 名称不得重复（解析单源 _gateindex）----------
    import _gateindex
    names = [n for n, _ in _gateindex.registered_pairs(sh)]
    dup = sorted(set(n for n in names if names.count(n) > 1))
    if dup:
        print('  [2] X 门禁名称重复：%s' % ', '.join(dup))
        print('        （同名会让报告无法分辨是哪一道）')
        bad += 1
    else:
        print('  [2] OK %d 条门禁名称唯一（run_report / VAR= / 循环批量都算）'
              % len(names))

    # ---------- ③ set -u 的变量必须已初始化（🔴 这条判据现在有牙）----------
    has_u = re.search(r'^\s*set\s+-[a-z]*u', src, re.M) is not None
    if not has_u:
        print('  [3] - 未启用 set -u，跳过')
    else:
        undef = sorted(_analyze_vars(lines))
        if undef:
            print('  [3] X set -u 下未初始化的变量：%s' % ', '.join(undef[:8]))
            print('        （只在失败路径用到时，失败会中途崩掉而非报出）')
            bad += 1
        else:
            print('  [3] OK 未发现未初始化变量')

    # ---------- ④ CHANGELOG 解析只允许一份 ----------
    hits = dup_parsers(audit_dir=audit_dir)
    if hits:
        print('  [4] X 有 %d 处**自己解析 CHANGELOG 版本标题**（应只用 '
              '`_changelog.py`）：' % len(hits))
        for f, i, t in hits[:5]:
            print('        %s:%d  %s' % (f, i, t))
        print('        ⇒ 同一判定写两遍必然漂移（ERRORS.md E43 / E31）')
        bad += 1
    else:
        print('  [4] OK CHANGELOG 版本标题只有一份解析器（`_changelog.py`）')

    # 反向控制：合成样本必须被抓到（否则这条判据是瞎的）
    if not _dup_probe():
        print('  [4] X 反向控制失效：合成样本没被识别成"又写了一份"')
        bad += 1

    print('')
    if bad:
        print('  => 门禁运行器自身有 %d 处问题' % bad)
        return 1
    print('  OK 门禁运行器自身无问题')
    return 0


def _selftest():
    """反向控制：临时目录里构造 check-all.sh 夹具，证明四条判据都长牙。

    覆盖矩阵（0.27.21）：
      ①a 死尾：run 在最后一个 exit 之后   ⇒ 红
      ①b 截断：裸顶层 exit 落在 run 中间  ⇒ 红
      ①回 归：函数内**缩进** exit（服务身份校验形状）不许截断  ⇒ 绿
      ②   重名（含 run_report 形态重名）  ⇒ 红
      ③   set -u 下用到未赋值变量         ⇒ 红
      绿   的同时证明不误报——198 假红事故的回归闸。
    """
    import shutil
    import tempfile

    NL = chr(10)
    OK_GATES = 'run "ok1" python3 05-audit/ok1.py' + NL + \
               'run "ok2" python3 05-audit/ok2.py' + NL
    # ⚠️ 尾段不许引用未赋值变量（$1 是位置参数，用法扫描不收数字下标）——
    #    否则"不误报"夹具自己会踩 ③ 判红。
    DISPATCH = ('if [ "$1" = x ]; then exit 1; fi' + NL +
                'exit 0' + NL)

    def fix(body):
        return '#!/usr/bin/env bash' + NL + 'set -u' + NL + body

    cases = [
        ('①a 死尾：最后一个 exit 之后还有 run',
         fix(OK_GATES + 'exit 0' + NL +
             'run "dead" python3 05-audit/dead.py' + NL), 1),
        ('①b 截断：裸顶层 exit 落在 run 中间',
         fix(OK_GATES + 'exit 0' + NL +
             'run "dead" python3 05-audit/dead.py' + NL + 'exit 1' + NL), 1),
        ('①回归：函数内缩进 exit 不许截断（198 假红事故形状）',
         fix('start_server() {' + NL +
             '  if [ "$1" = bad ]; then' + NL +
             '    exit 2' + NL +
             '  fi' + NL +
             '}' + NL +
             OK_GATES + DISPATCH), 0),
        ('② 重名（两条 run_report 同名）',
         fix(OK_GATES +
             'run_report "dup" python3 05-audit/dup.py' + NL +
             'run_report "dup" python3 05-audit/dup2.py' + NL + DISPATCH), 1),
        ('③ set -u 下用到未赋值变量',
         fix(OK_GATES + 'echo "$NEVER_ASSIGNED"' + NL + DISPATCH), 1),
        ('③ 不误报：守卫形态 ${x:-默认} 是正确写法',
         fix(OK_GATES + 'echo "${MAYBE:-fallback}"' + NL + DISPATCH), 0),
    ]
    bad = 0
    tmp = tempfile.mkdtemp(prefix='selfchk-')
    try:
        os.makedirs(os.path.join(tmp, '05-audit'))
        sh_path = os.path.join(tmp, '05-audit', 'check-all.sh')
        for label, body, want_rc in cases:
            with io.open(sh_path, 'w', encoding='utf-8', newline=NL) as f:
                f.write(body)
            rc = main(sh_path=sh_path, audit_dir=os.path.join(tmp, '05-audit'))
            ok = (rc == want_rc)
            print('  %s %s ⇒ %s'
                  % ('OK ' if ok else '🔴 ', label,
                     ('预期 rc=%d' % want_rc) if ok else
                     ('得 rc=%d、期望 %d' % (rc, want_rc))))
            if not ok:
                bad += 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print('')
    print('  %s' % ('反向控制全部通过 ⇒ 这道门禁有鉴别力' if not bad
                    else '🔴 %d 条反向控制没通过' % bad))
    return 1 if bad else 0


if __name__ == '__main__':
    # 🔴 0.27.18：本文件判据输出含中文与制表符——默认 GBK 管道下
    # print 直接 UnicodeEncodeError（实测 selftest 崩在 ①，②③ 根本没跑）。
    # 显式 reconfigure 成 UTF-8（带 replace 兜底），不依赖环境变量。
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    if '--selftest' in sys.argv:
        sys.exit(_selftest())
    sys.exit(main())
