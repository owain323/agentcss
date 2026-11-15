#!/bin/bash
# MANUAL-ONLY: android-bench 的手动门禁入口 —— 需要 adb 可见的模拟器/真机；CI（Linux）无台子，不进 check-all 队列
# android-bench 手动门禁 —— 真安卓 Chrome 上跑行为契约
# ============================================================================
# 为什么不进 check-all 队列：CI 是 Linux（无模拟器、无 Chrome APK），
# 挂进任何 MODE 都会让 CI 必红。这是**有台子的机器上发版前手动跑**的一档。
#
# 前提（三者缺一就是 SKIP，不算失败）：
#   1. ANDROID_BENCH 指向台子根目录（默认 <台子根目录>，内含 sdk/）
#   2. 模拟器已启动且 `adb devices` 可见（bash android-bench/boot.sh）
#   3. 宿主 8000 端口跑着 05-audit/http-serve.py（仓库根启动）
#
# 用法：bash 05-audit/android-bench/run-gate.sh
# 退出码：全部通过 0；任一失败 1；无设备 2（跳过）
# ============================================================================
ADB="${ANDROID_BENCH:-<台子根目录>}/sdk/platform-tools/adb.exe"
DEV=$("$ADB" devices 2>/dev/null | grep -c "device$")
if [ "$DEV" -lt 1 ]; then
  echo "  [SKIP] android-bench：无可用设备（启动模拟器：bash <台子根目录>/boot.sh）"
  exit 2
fi
HERE="$(cd "$(dirname "$0")" && pwd)"
node "$HERE/run-all.mjs"
