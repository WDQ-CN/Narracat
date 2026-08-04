#!/bin/bash
# check-memory-keeper-receipt.sh — SubagentStop(memory-keeper) hook
#
# 职责：核对当前章入库回执 .narracat/receipts/ch-NNN.json 是否存在且非空
# （该文件由 novel_commit_chapter 工具机械写入）。
# 缺失信息以 stdout 注入主会话触发补救；脚本始终 exit 0，不阻塞流程。

set -euo pipefail

cat > /dev/null 2>&1 || true

STATE_FILE=".narracat/state.yaml"

[[ -f "$STATE_FILE" ]] || exit 0
python3 -c "import yaml" 2>/dev/null || exit 0

CHAPTER=$(python3 - "$STATE_FILE" <<'PY' 2>/dev/null || true
import sys, yaml
with open(sys.argv[1]) as f:
    data = yaml.safe_load(f) or {}
ch = (data.get("progress") or {}).get("in_progress_chapter")
print(ch if isinstance(ch, int) and ch > 0 else "")
PY
)
[[ -n "$CHAPTER" ]] || exit 0

RECEIPT=".narracat/receipts/ch-$(printf '%03d' "$CHAPTER").json"

if [[ ! -s "$RECEIPT" ]]; then
  echo "第 ${CHAPTER} 章入库回执未找到（${RECEIPT}）。本章入库未完成，需要 memory-keeper 重新提交本章数据。"
fi

exit 0
