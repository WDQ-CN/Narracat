#!/bin/bash
# check-chapter-writer-output.sh — SubagentStop(chapter-writer) hook
#
# 职责：核对当前章正文文件——存在、非空、字数落在目标区间。
# 问题信息以 stdout 注入主会话触发补救；脚本始终 exit 0，不阻塞流程。
# 目标区间：config.yaml 的 words_per_chapter 的 70%-150%（宽松哨兵区间，
# 比派发指令里的目标区间更宽，只拦截明显失败）；缺省 1800-4000。
#
# 注：合同硬门已收敛到 novel_check_manuscript_contract / novel_update_progress 工具层；
# 本脚本只做即时诊断提示，恒 exit 0。

set -euo pipefail

cat > /dev/null 2>&1 || true

STATE_FILE=".narracat/state.yaml"
CONFIG_FILE=".narracat/config.yaml"

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

NNN=$(printf '%03d' "$CHAPTER")

VOL=$(python3 - "$STATE_FILE" "$CHAPTER" <<'PY' 2>/dev/null || true
import sys, yaml
with open(sys.argv[1]) as f:
    data = yaml.safe_load(f) or {}
mapping = (data.get("structure") or {}).get("chapter_to_volume") or {}
ch = int(sys.argv[2])
vol = mapping.get(ch, mapping.get(str(ch)))
print(vol if isinstance(vol, int) and vol > 0 else "")
PY
)

if [[ -n "$VOL" ]]; then
  FILE="manuscript/vol-$(printf '%02d' "$VOL")/ch-${NNN}.md"
else
  FILE=$(find manuscript -name "ch-${NNN}.md" -print -quit 2>/dev/null || true)
fi

if [[ -z "$FILE" || ! -f "$FILE" ]]; then
  echo "第 ${CHAPTER} 章正文文件未找到（期望路径 manuscript/vol-VV/ch-${NNN}.md）。需要重新生成本章正文。"
  exit 0
fi

WORDS=$(tr -d '[:space:]' < "$FILE" | wc -m | tr -d ' ')

if [[ "$WORDS" -eq 0 ]]; then
  echo "第 ${CHAPTER} 章正文文件为空（${FILE}）。需要重新生成本章正文。"
  exit 0
fi

WORD_MIN=1800
WORD_MAX=4000
if [[ -f "$CONFIG_FILE" ]]; then
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

if [[ "$WORDS" -lt "$WORD_MIN" ]]; then
  echo "第 ${CHAPTER} 章字数 ${WORDS} 低于目标区间下限 ${WORD_MIN}（${FILE}）。需要补写到目标区间。"
elif [[ "$WORDS" -gt "$WORD_MAX" ]]; then
  echo "第 ${CHAPTER} 章字数 ${WORDS} 高于目标区间上限 ${WORD_MAX}（${FILE}）。可适当精简。"
fi

python3 - "$FILE" "$CHAPTER" <<'PY' 2>/dev/null || true
import json
import re
import sys
from pathlib import Path

file_path = Path(sys.argv[1])
chapter = int(sys.argv[2])

try:
    raw_text = file_path.read_text(encoding="utf-8", errors="ignore")
except OSError:
    sys.exit(0)

# 章节正文理论上是纯正文；这里仍去掉 HTML 注释，避免后续机械元数据污染诊断。
body = re.sub(r"<!--.*?-->", "", raw_text, flags=re.S)
messages = []


def has_cjk(text):
    return bool(re.search(r"[一-鿿]", text))


left_quotes = body.count("“")
right_quotes = body.count("”")
if left_quotes != right_quotes:
    messages.append(
        f"第 {chapter} 章中文双引号不成对（左 {left_quotes} / 右 {right_quotes}）。人物对白应使用成对的 “……”。"
    )

# 仅当方角引号内含中文（像对白/称谓，而非装饰性符号）才提示，避免误伤
fang_segments = re.findall(r"「([^」\n]{1,120})」", body)
if any(has_cjk(segment) for segment in fang_segments):
    messages.append(
        f"第 {chapter} 章检测到方角引号「」疑似用于对白。正文人物对白统一改为中文弯双引号 “……”。"
    )

# ASCII 引号仅当包裹中文内容时才疑似「对白用错引号」；英文招牌 / 系统串 / 代码等不计入
ascii_double = re.findall(r'"([^"\n]{1,120})"', body)
ascii_single = re.findall(r"(?<![A-Za-z])'([^'\n]{1,120})'(?![A-Za-z])", body)
if any(has_cjk(segment) for segment in ascii_double) or any(has_cjk(segment) for segment in ascii_single):
    messages.append(
        f"第 {chapter} 章检测到 ASCII 引号疑似用于对白。人物对白统一使用中文弯双引号 “……”，对白内引用用 ‘……’。"
    )

dialogue_segments = re.findall(r"“([^”]{1,800})”", body)
visible_total = len(re.sub(r"\s+", "", body))
visible_dialogue = sum(len(re.sub(r"\s+", "", segment)) for segment in dialogue_segments)
dialogue_ratio = visible_dialogue / visible_total if visible_total else 0

pack_path = Path(".narracat") / "context-packs" / f"ch-{chapter:03d}.json"
outline_text = ""
character_count = 0

def flatten_text(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(flatten_text(item) for item in value)
    if isinstance(value, dict):
        return "\n".join(flatten_text(item) for item in value.values())
    return ""

if pack_path.exists():
    try:
        pack = json.loads(pack_path.read_text(encoding="utf-8"))
    except Exception:
        pack = {}
    outline_text = "\n".join(
        [
            flatten_text(pack.get("chapter_outline")),
            flatten_text(pack.get("style_directive")),
            flatten_text(pack.get("warnings")),
        ]
    )
    cards = pack.get("character_cards")
    if isinstance(cards, list):
        character_count = len(cards)
    elif isinstance(cards, dict):
        character_count = len(cards)

low_dialogue_scene = re.search(
    r"独处|低对话|对白占比应很低|对话占比应很低|减少对话|无对峙|无外部冲突|潜入|追逐|战斗|打斗|缠斗|厮杀|格斗|搏斗|对打|动作戏|清点|整理|情绪消化|环境负重|低张力|缓章|蒙太奇|快进|时间跳跃|闪回|回忆|赶路|独白",
    outline_text,
)
# 注意：「对话/对白」仅是把对白作为话题，不代表当前是多人对峙场景，故不计入多人判据，
# 否则「减少对话」「对白占比应很低」这类低对话章纲会被误判为多人互动章。
multi_person_scene = character_count >= 2 or re.search(
    r"对峙|争执|互怼|谈判|审问|相遇|见面|同处|两人|三人|众人|群像|拉扯|抢白|寒暄|质问",
    outline_text,
)

if visible_total and dialogue_ratio < 0.12 and multi_person_scene and not low_dialogue_scene:
    messages.append(
        f"第 {chapter} 章疑似普通多人互动章但现场对白偏少（仅作诊断，不要求按比例补齐）。建议把关键冲突改成对白、动作、沉默、打断或误解来发生，避免旁白替人物解释。"
    )

for message in messages:
    print(message)
PY

exit 0
