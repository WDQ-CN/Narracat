#!/usr/bin/env bash
# 任务书机械 lint（PostToolUse Write）：只对 .narracat/staging/ch-*.brief.md 生效。
# 禁系统词泄漏进写手视野：字段名 / 工具名 / pack 引用 / 伏笔编号 / 内部路径变量名 / 英文确定度枚举。
# 首次命中 exit 2 打回重写（stderr 反馈给模型）；同一轮内的第二次命中放行带警示（防死锁）。
# 判定状态用 marker 文件 .narracat/staging/.brief-lint-warned-ch-NNN 承载，纯机械无 LLM。
#
# 硬门纪律（ADR-0009）：本脚本只用 bash 内建 + coreutils（grep/sed/find），不依赖系统
# python 解释器——硬门解析器/时间判定若绕道用户 PATH 上可能不存在的解释器，会静默失效退化。
#
# 防陈旧 marker 静默放行：marker 只在 5 分钟（find -mmin -5）内视为「同一轮重写」；
# 同一轮的打回→重写间隔是同一次 Write 调用内的秒级操作，远小于该阈值。跨 run 残留的
# marker（例如上一次中断在「请人工处理后重新执行」、marker 从未被清理）已远超阈值，
# 命中时按首次重新拦截并刷新 marker 时间戳，不会让全新一轮的第一次命中被误判成第二次
# 而静默放行。
set -euo pipefail
INPUT=$(cat)
FILE_PATH=$(printf '%s' "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)
case "$FILE_PATH" in
  *.narracat/staging/ch-*.brief.md) ;;
  *) exit 0 ;;
esac
[ -f "$FILE_PATH" ] || exit 0
MARKER="$(dirname "$FILE_PATH")/.brief-lint-warned-$(basename "$FILE_PATH" .brief.md)"
FORBIDDEN='novel_[a-z_]+|craft_pack_hints|style_directive|through_line_anchor|previous_chapter_briefs|ending_snippet|payoff_beat|storyline_focus|foreshadowing_touch|foreshadowing_due|word_count_range|chapter_outline|style_examples|reference_path|pack_id|pack_path|manuscript_path|outline_path|semantic_context|state_changes|planned_state_changes|heartbeat_moment|continuation_hook|emotional_tone|character_cards|opening_snippet|core_foreshadowing|core_experience|current_arc_tension|current_antagonist_agent|mechanism_note|arc_summaries|matched_triggers|key_events|world_rules|derived_relationships|character_relationships|\b(canon|tentative|open)\b|[A-Z]-[A-Z0-9]+(-[A-Z0-9]+)*'
HITS=$(grep -nE "$FORBIDDEN" "$FILE_PATH" | head -10 || true)
if [ -z "$HITS" ]; then
  rm -f "$MARKER"
  exit 0
fi
if [ -f "$MARKER" ]; then
  MARKER_FRESH=$(find "$MARKER" -mmin -5 2>/dev/null)
  if [ -n "$MARKER_FRESH" ]; then
    rm -f "$MARKER"
    echo "任务书仍含系统词（已放行，请在完成输出附警示）：$HITS"
    exit 0
  fi
  # marker 已超龄：视为跨 run 残留，落到下面按首次重新拦截
fi
touch "$MARKER"
echo "任务书里出现了系统词，写手不该读到这些。把下列命中处翻成自然语言后重新 Write 同一路径：$HITS" >&2
exit 2
