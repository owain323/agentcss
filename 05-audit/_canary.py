# -*- coding: utf-8 -*-
"""_canary.py — :8000 身份校验共享库（0.27.21）

105 个 :8000 消费点里只有 ~5 个校验"跑的是不是本仓"——其余裸连。
把 check-all.sh 的 _same_tree/_is_gate_server 抽出来供单跑门禁复用。

用法（在门禁进入判据前调用一次）：
    from _canary import assert_ours
    assert_ours()          # 不通过时 sys.exit(3)——是服务的错，不是判据的错

🔴 为什么 exit 3 不是 1：服务不对 = **观测条件错误** = 判据没跑成，
   不许冒充"产品不合格"（与 check-all.sh:359 的第三态立法对齐）。
"""
import os
import subprocess
import sys

# 🔴 0.27.21：BASE 从环境变量来（_probe.py 独占空闲端口后传下来）；
#    硬编码版本在 CI 上对不上探测实际用的那台服务（同 _canary.js）。
BASE = os.environ.get('BASE') or 'http://127.0.0.1:8000'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _curl(*args):
    try:
        return subprocess.run(
            ['curl', '-s', '--max-time', '3'] + list(args),
            capture_output=True, text=True, timeout=10,
            cwd=ROOT).stdout or ''
    except Exception:
        return ''


def same_tree():
    """:8000 的 index.html 与本地 index.html 字节一致（不是看返回码）"""
    idx = os.path.join(ROOT, 'index.html')
    if not os.path.isfile(idx):
        return False
    remote = _curl(BASE + '/index.html')
    with open(idx, 'rb') as f:
        return remote.encode('utf-8') == f.read()


def is_gate_server():
    """:8000 的响应带 X-FL-Gate-Server 身份戳（http-serve.py 签发）"""
    try:
        r = subprocess.run(
            ['curl', '-sI', '--max-time', '3', BASE + '/index.html'],
            capture_output=True, text=True, timeout=10, cwd=ROOT)
        return 'x-fl-gate-server' in (r.stdout or '').lower()
    except Exception:
        return False


def is_ours():
    return same_tree() and is_gate_server()


def assert_ours():
    """不通过时 sys.exit(3)——观测条件错误，不是产品不合格。"""
    if is_ours():
        return
    if not same_tree():
        print('  [EXIT 3] :8000 上跑的是**另一棵树**（index.html 字节与本地不一致）'
              '—— 是服务的错，不是判据的错')
    elif not is_gate_server():
        print('  [EXIT 3] :8000 不是门禁服务器（缺 X-FL-Gate-Server 身份戳）'
              '—— 是服务的错，不是判据的错')
    else:
        print('  [EXIT 3] :8000 不可达 —— 是服务的错，不是判据的错')
    print('  ⇒ 先 bash 05-audit/with-server.sh 或 python 05-audit/http-serve.py 8000')
    sys.exit(3)
