#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gate-verdict-gate.py — 「门禁有没有判红路径」（0.8.9 新增）

============================================================================
这道门禁防的是什么
----------------------------------------------------------------------------
本库已经有过**两次**同类事故，形状不同但根因相同：

  ① `css-imports` / `dead-class` 写在 `run_report` 下 ⇒ 退出码恒为 0
     ⇒ **在 check-all 里永远 PASS**，不管它打印什么。
     而 `css-imports` 抓到过真问题（暗色对比度 2.45:1）。
     ⚠️ 它**打印了 FAIL**，只是退出码说成功 —— 这正是最容易被忽略的形态：
        人看日志以为它报了，自动化按退出码以为它过了。

  ② `dead-class-gate` 读 `sys.argv[1]` 当路径，而 `--selftest` 恰好在那个位置
     ⇒ root 指向不存在的目录 ⇒ **什么都没扫到 ⇒ 判「没有真死类」**
     ⇒ 输出看起来完全正常（「✅ 没有真死类」），退出码 0。

  共同点：**门禁的输出与它的退出码不是同一件事**，
  而 check-all（以及所有 CI）只看退出码。

⇒ 这道门禁检查：**每道注册的门禁，代码里存在"判红并返回非 0"的路径**。
  没有 ⇒ 它不可能失败 ⇒ 它不是门禁，是一段会打印东西的脚本。

============================================================================
判据
----------------------------------------------------------------------------
对 check-all.sh 里注册的每道门禁脚本，检查源码里是否有判红路径：
  · Python:  `return 1` / `return 2` / `sys.exit(1)` / `SystemExit(1)`
             / `raise SystemExit(1)` / 非零 `exit(`
  · JS:      `process.exit(1)` / `process.exitCode = 1`
  · Shell:   `exit 1` / `return 1`

⚠️ 三条避免它自己变成假绿的约束：
  ① 只查**注册在 check-all 里的**脚本（库文件如 `_common.py` 不在此列）
  ② **必须报告查了几个**；一个都没查到 ⇒ 报「视野已空」而不是通过
  ③ 允许**列举式白名单**（豁免必须逐条写明理由），不接受宽泛条件

用法：
  python3 05-audit/gate-verdict-gate.py
  python3 05-audit/gate-verdict-gate.py --selftest
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHECK_ALL = os.path.join(ROOT, '05-audit', 'check-all.sh')

# 判红路径的形态。
#
# ⚠️ 第一版我写的是 `process\.exit\(\s*[1-9]` —— 实测**误报了 20+ 道门禁**，
#    因为本库有一批 `*-check.js` 判红是**间接**的：
#        process.exit(kit.report(r));      // ← kit.report 返回非 0 表示判红
#    它们的判红能力是真的（门禁日志里确实会 FAIL），
#    错的是我的判据只认字面数字。
#    ⇒ 改成「exit( 后面不是 0」，覆盖直接与间接两种。
#
# ⭐ 这一版改正很重要：**误报 20 道会让这道门禁立刻失去可信度**，
#    而它防的恰恰是"看起来在工作"这类问题 —— 自己误报就没资格谈这个。
VERDICT_PATTERNS = {
    '.py': [
        r'\breturn\s+[1-9]\b',                    # 返回非 0
        r'\breturn\s+(?!0\b)\w*\s*$',             # 返回变量（多为 bad/rc）
        r'\bsys\.exit\(\s*(?!0\s*\))[^)]+\)',     # 直接或间接
        r'\braise\s+SystemExit\(\s*[1-9]',
        r'\bSystemExit\(\s*[1-9]',
    ],
    '.js': [
        r'process\.exit\(\s*(?!0\s*\))[^)]*\)',   # exit(0) 之外的都算
        r'process\.exitCode\s*=\s*(?!0\b)\w',
        r'\bthrow\s+new\s+Error\(',
    ],
    '.mjs': [
        r'process\.exit\(\s*(?!0\s*\))[^)]*\)',
        r'process\.exitCode\s*=\s*(?!0\b)\w',
        r'\bthrow\s+new\s+Error\(',
    ],
    '.sh': [
        r'\bexit\s+[1-9]',
        r'\bexit\s+\$\{?\w*(\b|fail|bad)',
        r'\breturn\s+[1-9]',
    ],
}

# 列举式白名单：豁免**必须逐条写明理由**，不接受宽泛条件。
#
# ⚠️ 判据：只有当"退出码由**别的机制**负责"时才豁免，
#    而不是"它看起来不重要"。每一条都要能被独立核实。
ALLOW_NO_VERDICT = [
    ('unit',
     '由 `node --test` 运行 —— 退出码由**测试框架**决定：'
     '有失败用例时 node --test 自己 exit 1，测试文件本身不需要判红路径。'
     '实测核实：故意让一个断言失败，node --test 的退出码确实是 1。'),
]


def registered_gates():
    """从 check-all.sh 解析出注册的门禁（名字 → 命令行）。

    🔴 0.27.21（WO-16 ②）：解析器抽到 `_gateindex.py` 单源（E31）——
       gate-selfcheck 的重名检测也曾各写一份正则，只认字面 `run`，
       run_report / VAR= 前缀 / 循环批量注册的门禁对它全部隐形。
       认法明细见 `_gateindex.registered_pairs` 的 docstring。
    """
    import _gateindex
    return _gateindex.registered_gates(CHECK_ALL)


def script_of(cmdline):
    """从命令行里找出脚本路径 —— 单源在 `_gateindex.script_of`。"""
    import _gateindex
    return _gateindex.script_of(cmdline)


def _strip_py(src):
    """py：注释/docstring/字符串**原位替换为空格** + AST 常量假 If 折为空行。

    🔴 0.27.21（WO-02）：不能用 token join——join 会把 `sys.exit(1)` 变成
    `sys . exit ( 1 )`，`sys\\.exit\\(` 这类多 token 模式全部失配
    （实测：join 版把 100+ 道有牙的 py 门禁误报成"不可能失败"）。
    正解：保持字节偏移不变，只把剥掉的内容换成等长空格。"""
    # 先做 AST 常量假 If 折叠（按行置空，保留换行结构）
    try:
        import ast as _ast
        tree = _ast.parse(src)
        drop = []
        for node in _ast.walk(tree):
            if isinstance(node, _ast.If):
                t = node.test
                if isinstance(t, _ast.Constant) and t.value in (False, 0):
                    drop.append((node.lineno, node.end_lineno))
        lines = src.split('\n')
        for (a, b) in drop:
            for i in range(a - 1, min(b, len(lines))):
                lines[i] = ""
        src = '\n'.join(lines)
    except Exception:
        pass
    # tokenize 定位注释/字符串区间 → 原位替换为空格
    # 🔴 0.27.21（WO-02）：跨行 STRING（docstring）需要按 (row, col) 换算
    #   绝对偏移量覆写——只用 start[1]/end[1]（col）会漏掉跨行区间。
    try:
        import io as _io
        import tokenize as _tk
        src_lines = src.split('\n')
        line_starts = [0]  # 每行首字符在 src 中的绝对偏移
        for ln in src_lines:
            line_starts.append(line_starts[-1] + len(ln) + 1)
        chars = list(src)
        for tok in _tk.generate_tokens(_io.StringIO(src).readline):
            if tok.type in (_tk.COMMENT, _tk.STRING):
                a_off = line_starts[tok.start[0] - 1] + tok.start[1]
                b_off = line_starts[tok.end[0] - 1] + tok.end[1]
                for j in range(a_off, min(b_off, len(chars))):
                    if chars[j] != '\n':
                        chars[j] = ' '
        return ''.join(chars)
    except Exception:
        return src




def _strip_js(src):
    """js/mjs：状态机剥注释与字符串字面量 + 删 if(false)/if(0) 死块。"""
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ''
        if c == '/' and nxt == '/':
            while i < n and src[i] != '\n':
                i += 1
            continue
        if c == '/' and nxt == '*':
            j = src.find('*/', i + 2)
            i = n if j < 0 else j + 2
            continue
        if c in ('"', "'", '`'):
            q = c
            i += 1
            while i < n:
                if src[i] == '\\':
                    i += 2
                    continue
                if src[i] == q:
                    i += 1
                    break
                if q != '`' and src[i] == '\n':
                    break
                i += 1
            out.append('""')
            continue
        out.append(c)
        i += 1
    r = ''.join(out)
    for lit in ('if (false)', 'if(false)', 'if (0)', 'if(0)'):
        while True:
            j = r.find(lit)
            if j < 0:
                break
            k = r.find('{', j)
            if k < 0:
                break
            depth = 0
            e = k
            while e < len(r):
                if r[e] == '{':
                    depth += 1
                elif r[e] == '}':
                    depth -= 1
                    if depth == 0:
                        break
                e += 1
            r = r[:j] + r[e + 1:]
    return r


def _strip_sh(src):
    """sh：整行注释剥除（.sh 判据形态简单：exit/return 非零，行级够用；
    行尾注释与 $# 一类不剥——避免误伤 $ 位变量，宁可保守）。"""
    out = []
    for ln in src.split('\n'):
        if ln.lstrip().startswith("#"):
            continue
        out.append(ln)
    return '\n'.join(out)




def _evidence_text(ext, src):
    if ext == '.py':
        return _strip_py(src)
    if ext in ('.js', '.mjs'):
        return _strip_js(src)
    if ext == '.sh':
        return _strip_sh(src)
    return src


def main():
    gates = registered_gates()
    if not gates:
        print('  🔴 视野已空：从 check-all.sh 解析不出任何门禁')
        print('     ⇒ 这道门禁没在核对任何东西，不应判通过')
        return 1

    print('  === 门禁判红路径检测 ===')
    print('')
    checked = 0
    no_verdict = []
    skipped = []

    for name in sorted(gates):
        rel = script_of(gates[name])
        if not rel:
            skipped.append((name, '命令行里找不到脚本路径'))
            continue
        p = os.path.join(ROOT, rel)
        ext = os.path.splitext(rel)[1]
        if ext not in VERDICT_PATTERNS:
            skipped.append((name, '不认识的扩展名 %s' % ext))
            continue
        if not os.path.isfile(p):
            no_verdict.append((name, rel, '**文件不存在**'))
            continue
        if name in [x[0] for x in ALLOW_NO_VERDICT]:
            skipped.append((name, '白名单豁免'))
            continue

        src = io.open(p, encoding='utf-8', errors='replace').read()
        # 🔴 0.27.21（WO-02 第 1+3 步）：在**剥除注释/字符串/死分支后的证据
        #    文本**上匹配——全文匹配让注释里的 `# return 1`、docstring、
        #    `if False:` 死分支都"看起来有牙"（六用例矩阵实测 5 类绕过全绿）。
        ev = _evidence_text(ext, src)
        hit = None
        for pat in VERDICT_PATTERNS[ext]:
            if re.search(pat, ev):
                hit = pat
                break
        checked += 1
        if not hit:
            no_verdict.append((name, rel, '找不到任何判红路径'))

    if no_verdict:
        print('  🔴 以下门禁**不可能失败**（退出码恒为 0）：')
        for name, rel, why in no_verdict:
            print('     · %-18s %-34s %s' % (name, rel, why))
        print('')
        print('     ⇒ 一道不可能失败的门禁不是门禁，是一段会打印东西的脚本。')
        print('       它的问题恰恰在于**看起来在工作** —— 人看日志以为它报了，')
        print('       自动化按退出码以为它过了。')
        print('       （本库已发生过两次：css-imports / dead-class 挂在 run_report 下；')
        print('         dead-class 参数解析出错后什么都扫不到却判「没有真死类」。）')
    else:
        print('  OK  注册的 %d 道门禁都有判红路径' % checked)

    if skipped:
        print('')
        print('  — 跳过 %d 道（不是"通过"，是"本门禁不适用"）：' % len(skipped))
        for name, why in skipped[:10]:
            print('     · %-20s %s' % (name, why))
        if len(skipped) > 10:
            print('     …… 另有 %d 道' % (len(skipped) - 10))

    print('')
    print('  实查 %d 道 / 注册 %d 道' % (checked, len(gates)))
    if checked == 0:
        print('  🔴 实查 0 道 ⇒ 判据视野已空，不应判通过')
        return 1
    return 1 if no_verdict else 0


def selftest():
    NLQ = chr(10)
    """反向控制：证明这道门禁会红，且不误报。

    ⚠️ 在**临时目录**里构造（P0-1 的教训：反向控制有副作用，
       而 selftest 恰恰也在动文件 —— 不碰真仓库）。
    """
    import shutil
    import tempfile

    global ROOT, CHECK_ALL
    real = (ROOT, CHECK_ALL)
    tmp = tempfile.mkdtemp(prefix='verdict-')
    bad = 0
    try:
        os.makedirs(os.path.join(tmp, '05-audit'))

        def write_check_all(body):
            with io.open(os.path.join(tmp, '05-audit', 'check-all.sh'),
                         'w', encoding='utf-8') as f:
                f.write(body)

        def write_gate(fn, body):
            with io.open(os.path.join(tmp, '05-audit', fn),
                         'w', encoding='utf-8') as f:
                f.write(body)

        ROOT = tmp
        CHECK_ALL = os.path.join(tmp, '05-audit', 'check-all.sh')

        # ① 门禁没有判红路径 ⇒ 必须报
        write_check_all('run "nov"   python3 05-audit/nov.py\n')
        write_gate('nov.py', "print('看起来在检查')\nreturn_ = 0\n")
        rc = main()
        ok = (rc == 1)
        print('')
        print('  %s ① 门禁无判红路径 ⇒ %s'
              % ('OK ' if ok else '🔴 ', '正确报红' if ok else '没报红（没牙）'))
        if not ok:
            bad += 1

        # ② 有判红路径（含被排除的 exit(0) 形状）⇒ 不许报
        #    🔴 0.27.18：旧版本这里前一对 write 是死代码（写完立即被
        #    覆盖），"exit(0) 不许误报"这个负向子方向从未被真正喂给判据。
        #    现在一个夹具同时含两种形状：if bad: sys.exit(1)（真判红）
        #    + 末尾 sys.exit(0)（必须被模式排除，不能当成没牙）。
        write_check_all('run "yes"   python3 05-audit/yes.py\n')
        write_gate('yes.py', 'import sys\nif bad:\n    sys.exit(1)\nsys.exit(0)\n')
        rc2 = main()
        ok2 = (rc2 == 0)
        print('  %s ② 有 sys.exit(1) ⇒ %s'
              % ('OK ' if ok2 else '🔴 ', '不误报' if ok2 else '误报'))
        if not ok2:
            bad += 1

        # ③ 视野已空（一条都解析不出）⇒ 必须报，不许判通过
        write_check_all('# 什么都没注册\n')
        rc3 = main()
        ok3 = (rc3 == 1)
        print('  %s ③ 视野已空 ⇒ %s'
              % ('OK ' if ok3 else '🔴 ', '正确报红' if ok3 else '静默通过'))
        if not ok3:
            bad += 1

        # 🔴 0.27.21（WO-02 六用例矩阵）：注释/docstring/死分支里的判红
        # 不许冒充有牙——剥除后必须变红。反例三连 + 阳性对照已在 ①②。
        cases_456 = [
            ('④ in_comment',
             "print('looks real')" + NLQ + "# return 1" + NLQ +
             "print('still no verdict')"),
            ('⑤ in_docstring',
             "print('looks real')" + NLQ + '"""' + NLQ + "return 1" + NLQ +
             '"""' + NLQ + "print('still')"),
            ('⑥ dead_branch',
             "import sys" + NLQ + "print('looks')" + NLQ +
             "if False:" + NLQ + "    sys.exit(1)" + NLQ +
             "print('no verdict')"),
        ]
        for label, code in cases_456:
            write_check_all('run "fx"   python3 05-audit/fx.py' + NLQ)
            write_gate('fx.py', code + NLQ)
            rcf = main()
            okf = (rcf == 1)
            print('  %s %s ⇒ %s'
                  % ('OK ' if okf else '🔴 ', label,
                     '剥除后变红' if okf else '仍绿（剥离漏了）'))
            if not okf:
                bad += 1

        # 🔴 0.27.21（补足 9 用例）：三种**注册形态**各测一遍。
        #    每例都配一道健康门禁垫底——否则注册解析退化时无牙门禁
        #    直接从视野里消失，`checked == 0` 也判红，两种结局不可区分，
        #    用例就退化成"怎么跑都绿"。垫底后：解析退化 ⇒ 只剩健康门禁
        #    ⇒ rc==0 ⇒ 用例红；解析正常 ⇒ 无牙被点名 ⇒ rc==1 ⇒ 用例绿。
        OK_PY = 'import sys' + NLQ + 'if bad:' + NLQ + '    sys.exit(1)' + NLQ \
                + 'sys.exit(0)' + NLQ
        NOVERDICT_PY = "print('looks real')" + NLQ + "return_ = 0" + NLQ
        reg_cases = [
            ('⑦ run_report 注册',
             'run "ok"        python3 05-audit/ok.py' + NLQ +
             'run_report "fx" python3 05-audit/fx.py' + NLQ),
            ('⑧ VAR= 前缀注册（WO-02b）',
             'run "ok"   python3 05-audit/ok.py' + NLQ +
             'PY=python3 run "fx" python3 05-audit/fx.py' + NLQ),
            ('⑨ 循环批量注册展开',
             'run "ok" python3 05-audit/ok.py' + NLQ +
             'for g in fx; do' + NLQ +
             '  run "$g"    python3 "05-audit/$g.py"' + NLQ +
             'done' + NLQ),
        ]
        for label, body in reg_cases:
            write_check_all(body)
            write_gate('ok.py', OK_PY)
            write_gate('fx.py', NOVERDICT_PY)
            rcr = main()
            okr = (rcr == 1)
            print('  %s %s ⇒ %s'
                  % ('OK ' if okr else '🔴 ', label,
                     '无牙被点名' if okr else '漏查（注册形态解析退化）'))
            if not okr:
                bad += 1
    finally:
        ROOT, CHECK_ALL = real
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
        sys.exit(selftest())
    sys.exit(main())
