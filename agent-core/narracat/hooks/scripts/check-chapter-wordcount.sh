#!/bin/bash
# check-chapter-wordcount.sh — PostToolUse(Write) hook
#
# 职责：仅对 manuscript/vol-VV/ch-NNN.md 章节稿件做字数提示（中文字符数）。
# 其他文件（reviews/ / outline/ / bible/ / .narracat/ 等）silent exit 0 不打断流程。
# 目标区间：config.yaml 的 words_per_chapter 的 70%-150%；缺省 1800-4000。
# 提示以 stdout 注入主会话；脚本始终 exit 0，不阻塞流程。

set -euo pipefail

CHAPTER_REGEX='manuscript/(vol-[0-9]+/)?ch-?[0-9]+\.md$'

INPUT=$(cat || true)

FILE_PATH=$(printf '%s' "$INPUT" \
  | python3 -c 'import json,sys; d=json.loads(sys.stdin.read() or "{}"); print(d.get("tool_input",{}).get("file_path","") or "")' 2>/dev/null || echo "")

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

if [[ ! "$FILE_PATH" =~ $CHAPTER_REGEX ]]; then
  exit 0
fi

if [[ ! -f "$FILE_PATH" ]]; then
  exit 0
fi

WORD_MIN=1800
WORD_MAX=4000
CONFIG_FILE=".narracat/config.yaml"
if [[ -f "$CONFIG_FILE" ]] && python3 -c "import yaml" 2>/dev/null; then
  W=$(python3 - "$CONFIG_FILE" <<'PY' 2>/dev/null || true
import sys, yaml
with open(sys.argv[1]) as f:
    data = yaml.safe_load(f) or {}
w = data.get("words_per_chapter")
print(w if isinstance(w, int) and w > 0 else "")
PY
)
  if [[ -n "$W" ]]; then
    WORD_MIN=$(( W * 7 / 10 ))
    WORD_MAX=$(( W * 3 / 2 ))
  fi
fi

WORDS=$(tr -d '[:space:]' < "$FILE_PATH" | wc -m | tr -d ' ')

if [[ "$WORDS" -lt "$WORD_MIN" ]]; then
  echo "章节字数 ${WORDS} 低于目标区间下限 ${WORD_MIN}（${FILE_PATH}）。可能需要补写。"
elif [[ "$WORDS" -gt "$WORD_MAX" ]]; then
  echo "章节字数 ${WORDS} 高于目标区间上限 ${WORD_MAX}（${FILE_PATH}）。可能需要精简。"
fi

exit 0
