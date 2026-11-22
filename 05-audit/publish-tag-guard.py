#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
publish-tag-guard.py — `npm publish` 只允许从**与版本号同号的 annotated tag** 发出
（2026-11-23 新增）

===========================================================================
🔴 为什么需要它
---------------------------------------------------------------------------
  本仓库的发布路径只有一条（`publish.sh` 头部与 release.yml 都这么写）：
     打 annotated tag `v<版本>` → release.yml 跑门禁 → `npm publish --provenance`
  并且上一轮已经把 `publish.sh` 里那条 `npm publish` 删掉了 —— 因为
  **仓库里存在第二条发布路径，等于后门开在文档旁边**。

  但那条注释同时承认了一个诚实的边界：
     「持有 npm token 的人仍可在任何机器上手发，仓库内的判据拦不住。」

  这句话的前半段拦不住（token 在谁手里就是谁的），后半段其实拦得住一半：
  **只要 `npm publish` 是在仓库里敲的**，`prepublishOnly` 就会先跑本脚本。
  于是"手发"至少要有四项一致（版本号、VERSION、CHANGELOG、HEAD 上的 tag），
  发出去的包才可能被追溯到一个提交。手发最坏的形态不是"发了"，而是
  "发了但仓库里查无此版本" —— 那会让 npm 与源码永久对不上账。

  ⚠️ 诚实边界（别把这道守卫当保险箱）：
     · 在仓库外（拷一份源码、临时目录）敲 `npm publish` 仍不受约束；
     · `--ignore-scripts` 会跳过 prepublishOnly —— 这属于故意绕过，不是漏洞。
     · 本脚本不联网、不查 npm：它回答"这次 publish 该不该发生"，
       不回答"npm 上现在是什么"。

===========================================================================
判据（四条全过才放行）
---------------------------------------------------------------------------
   ① VERSION 文件 == package.json.version
   ② CHANGELOG 最新条目 == package.json.version（发出去的包要有对应说明）
   ③ HEAD 上有 `v<version>` 这个 tag（否则这次发布无法回溯到提交）
   ④ 该 tag 是 **annotated**（轻量 tag 没有打 tag 的人与时间）

===========================================================================
用法
---------------------------------------------------------------------------
   python3 05-audit/publish-tag-guard.py              # 已挂在 publish:check 链首
   python3 05-audit/publish-tag-guard.py --selftest   # 反向控制（六种状态）

   ✅ 唯一放行的发版路径：
       1. python3 05-audit/bump-version.py 0.27.25
       2. 写 CHANGELOG 条目（bump 只把它归入 [Unreleased]，内容要人写）
       3. git commit && git push
       4. git tag -a v0.27.25 -m "0.27.25" && git push origin v0.27.25
       5. release.yml 在 tag 上跑门禁 → `npm publish --provenance`
"""
import io
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _changelog  # noqa: E402


def git(*args):
    """→ (returncode, stdout.strip())。git 不可用也不抛异常。"""
    try:
        p = subprocess.run(['git'] + list(args), cwd=ROOT,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return p.returncode, p.stdout.decode('utf-8', 'replace').strip()
    except OSError:
        return 127, ''


def read_version():
    p = os.path.join(ROOT, 'VERSION')
    if not os.path.isfile(p):
        return None
    return io.open(p, encoding='utf-8').read().strip()


def read_pkg_version():
    p = os.path.join(ROOT, 'package.json')
    if not os.path.isfile(p):
        return None
    try:
        return json.load(io.open(p, encoding='utf-8')).get('version')
    except Exception:
        return None


def read_changelog_top():
    p = os.path.join(ROOT, 'CHANGELOG.md')
    if not os.path.isfile(p):
        return None
    return _changelog.latest_version(io.open(p, encoding='utf-8').read())


def head_tags():
    """→ [(tag 名, 对象类型)]，只含指向 HEAD 的 tag。'tag' = annotated。"""
    code, out = git('tag', '--points-at', 'HEAD')
    if code != 0 or not out:
        return []
    tags = []
    for name in out.splitlines():
        name = name.strip()
        if not name:
            continue
        c, t = git('for-each-ref', 'refs/tags/%s' % name, '--format=%(objecttype)')
        tags.append((name, t if c == 0 else '?'))
    return tags


def judge(version, vfile, cl_top, tags):
    """纯函数：→ (问题列表, 通过时的证据行)。

    `tags` 是 [(名字, 对象类型)]；这样设计是为了让 `--selftest` 能伪造状态，
    不用在真仓库上建/删 tag（那种自检 = 自残）。
    """
    probs = []
    if not version:
        probs.append('package.json 里没有 version')
        return probs, ''

    if vfile != version:
        probs.append('VERSION 文件是 %r，package.json 是 %r —— 两处版本号不一致'
                     % (vfile, version))
    if cl_top != version:
        probs.append('CHANGELOG 最新条目是 %r，package.json 是 %r —— '
                     '发出去的包没有对应的变更说明' % (cl_top, version))

    want = 'v%s' % version
    names = [n for n, _ in tags]
    if want not in names:
        probs.append('HEAD 上没有 `%s` 这个 tag —— 这次 publish 无法回溯到提交。'
                     '正确路径：bump-version → 写 CHANGELOG → commit → '
                     '`git tag -a %s` → `git push origin %s`（由 release.yml 发）'
                     % (want, want, want))
    else:
        kind = dict(tags).get(want)
        if kind != 'tag':
            probs.append('`%s` 是轻量 tag（对象类型 %r）—— 没有打 tag 的人与时间。'
                         '用 `git tag -a %s -m "%s"` 重建'
                         % (want, kind, want, version))

    if probs:
        return probs, ''
    return [], 'HEAD 指向 %s（annotated）· VERSION = package.json = CHANGELOG = %s' \
        % (want, version)


def run():
    version = read_pkg_version()
    vfile = read_version()
    cl_top = read_changelog_top()
    tags = head_tags()
    probs, evidence = judge(version, vfile, cl_top, tags)

    print('  === publish-tag-guard ===')
    print('      package.json = %s' % version)
    print('      VERSION      = %s' % vfile)
    print('      CHANGELOG    = %s' % cl_top)
    print('      HEAD tags    = %s' % (', '.join(
        '%s(%s)' % (n, t) for n, t in tags) or '（无）'))

    if probs:
        print('  [FAIL] 拒绝发布：')
        for p in probs:
            print('    · %s' % p)
        print('  ⚠️ 不要用 `npm publish --ignore-scripts` 或 `--force` 绕这道守卫。')
        print('     绕过一次，npm 上就多一个"仓库里查无此版本"的包。')
        return 1
    print('  [PASS] %s' % evidence)
    return 0


def selftest():
    """反向控制：六种状态逐条判，全对才算本脚本可信。"""
    print('  === publish-tag-guard 反向控制 ===')
    V = '0.27.25'
    cases = [
        ('全部一致', V, V, V, [('v0.27.25', 'tag')], 0),
        ('没有 tag', V, V, V, [('v0.27.24', 'tag')], 1),
        ('轻量 tag', V, V, V, [('v0.27.25', 'commit')], 1),
        ('CHANGELOG 落后', V, V, '0.27.24', [('v0.27.25', 'tag')], 1),
        ('VERSION 落后', V, '0.27.23', V, [('v0.27.25', 'tag')], 1),
        ('没有版本号', None, None, None, [], 1),
    ]
    bad = 0
    for name, ver, vf, cl, tags, want in cases:
        probs, _ = judge(ver, vf, cl, tags)
        got = 0 if not probs else 1
        ok = got == want
        print('    %s %-14s 期望 %s 实际 %s%s' % (
            '✓' if ok else '✗', name, 'FAIL' if want else 'PASS',
            'FAIL' if got else 'PASS',
            '' if ok else '  ← %s' % (probs[0] if probs else '')))
        if not ok:
            bad += 1
    print('  %s  %d/%d' % ('[FAIL]' if bad else '[PASS]', len(cases) - bad, len(cases)))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(selftest() if '--selftest' in sys.argv else run())
