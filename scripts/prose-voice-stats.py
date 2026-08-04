#!/usr/bin/env python3
"""对话呈现形态量化对照：真人网文 vs 我们的成稿。

考察三件事（对应产品主人点出的症状）：
1. 疑问句对话的收尾标点：真人用「？」还是像我们一样用「。」
2. 对话提示语（dialogue tag）形态：前置「她问道：“…”」/ 后置「“…”她说」/ 裸对话无 tag
3. 句长分布与极短句占比
"""
import re
import sys
from pathlib import Path

QUESTION_MARKERS = re.compile(r"吗|呢|什么|谁|哪|几|怎么|怎样|为什么|多少|是不是|有没有|能不能|要不要")
SPEECH_VERB = r"说|问|道|答|应|喊|叫|骂|嘟囔|开口|回|吼|笑道|反问|嘀咕|念|嚷"
# 前置 tag：引号前 20 字内出现「…说/问/道」+ 可选冒号
PRE_TAG = re.compile(rf"(?:{SPEECH_VERB})\s*[：:]?\s*$")
# 后置 tag：引号后 20 字内出现说话动词
POST_TAG = re.compile(rf"^[^“”。！？\n]{{0,12}}(?:{SPEECH_VERB})")
DIALOGUE = re.compile(r"“([^”]{1,200})”")


def unify_quotes(text: str) -> str:
    """三种引号（弯/直角/半角）归一成弯引号，否则统计会漏掉整章对话。"""
    text = text.replace("「", "“").replace("」", "”")
    out, open_ = [], True
    for ch in text:
        if ch == '"':
            out.append("“" if open_ else "”")
            open_ = not open_
        else:
            out.append(ch)
    return "".join(out)
SENT_SPLIT = re.compile(r"[。！？…]+")


NAMING_BEFORE = re.compile(r"(?:叫|名为|写着|标着|所谓|简介|门牌|备注栏|名字是|四个字|六个字|这句话|叫做)\s*$")
EXPRESSIVE = re.compile(r"！|？|…|——")


def real_dialogues(text: str) -> list[str]:
    """只取真对白。

    引号在中文正文里同时承担专名（「概率统计研究社」）、概念引用（「他做了什么」的问题）
    与比喻（表情介于「我知道自己倒霉」和「太离谱了」之间）——把它们一并当台词统计，会把
    对白密度、疑问句标点、表演标点率全部稀释成无意义的数字。判据：独立成段的引号（对话流）
    或前后带说话动词；排除命名类前缀与无句末标点的极短引号。
    """
    out: list[str] = []
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        for m in DIALOGUE.finditer(line):
            inner = m.group(1).strip()
            if not re.search(r"[一-鿿]", inner):
                continue
            before, after = line[: m.start()], line[m.end() :]
            if NAMING_BEFORE.search(before):
                continue
            if len(inner) <= 6 and not re.search(r"[。！？…”]$", inner):
                continue
            standalone = line.startswith("“") and line.rstrip().endswith("”") and len(line) - len(inner) < 12
            tagged = bool(PRE_TAG.search(before.rstrip())) or bool(POST_TAG.search(after.lstrip()))
            if standalone or tagged:
                out.append(inner)
    return out


def read_text(p: Path) -> str:
    for enc in ("utf-8", "gb18030", "utf-16"):
        try:
            return p.read_text(encoding=enc)
        except (UnicodeDecodeError, UnicodeError):
            continue
    return p.read_bytes().decode("utf-8", errors="ignore")


def analyze(text: str, label: str, sample_chars: int | None = None):
    # 取中段样本，避开卷首简介/作者的话
    if sample_chars and len(text) > sample_chars * 3:
        mid = len(text) // 2
        text = text[mid - sample_chars // 2 : mid + sample_chars // 2]

    text = unify_quotes(text)
    han = len(re.findall(r"[一-鿿]", text))
    if han < 500:
        return None

    # ---- 1) 疑问对话的收尾标点 ----
    q_with_qmark = q_with_period = q_other = 0
    # ---- 2) tag 形态 ----
    pre = post = bare = 0

    for m in DIALOGUE.finditer(text):
        inner = m.group(1)
        before = text[max(0, m.start() - 20) : m.start()]
        after = text[m.end() : m.end() + 20]

        if QUESTION_MARKERS.search(inner):
            if inner.rstrip().endswith("？"):
                q_with_qmark += 1
            elif inner.rstrip().endswith("。"):
                q_with_period += 1
            else:
                q_other += 1

        has_pre = bool(PRE_TAG.search(before.rstrip()))
        has_post = bool(POST_TAG.search(after.lstrip()))
        if has_pre:
            pre += 1
        elif has_post:
            post += 1
        else:
            bare += 1

    total_dlg = pre + post + bare
    q_total = q_with_qmark + q_with_period + q_other

    # ---- 3) 句长 ----
    sents = [s.strip() for s in SENT_SPLIT.split(re.sub(r"[“”\n]", "", text)) if s.strip()]
    lens = [len(re.findall(r"[一-鿿]", s)) for s in sents]
    lens = [n for n in lens if n > 0]
    avg = sum(lens) / len(lens) if lens else 0
    ultra_short = sum(1 for n in lens if n <= 6) / len(lens) * 100 if lens else 0
    short = sum(1 for n in lens if n <= 10) / len(lens) * 100 if lens else 0
    long_ = sum(1 for n in lens if n >= 25) / len(lens) * 100 if lens else 0

    # ---- 4) 孤立成行的提示语（如单独一行「她说。」）----
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    lone_tag = sum(
        1
        for l in lines
        if len(re.findall(r"[一-鿿]", l)) <= 6
        and re.search(rf"(?:{SPEECH_VERB})[。\.]?$", l)
        and "“" not in l
    )

    # 真对白指标（严格判据；上面的 total_dlg 是含专名引用的宽口径，两者不可混用）
    reals = real_dialogues(text)
    rn = len(reals)
    def rpct(pat: str) -> float:
        return sum(1 for d in reals if re.search(pat, d)) / rn * 100 if rn else 0.0

    return {
        "label": label,
        "real_dlg": rn,
        "real_dlg_per_1k": rn / han * 1000 if han else 0.0,
        "expressive_pct": rpct(EXPRESSIVE.pattern),
        "excl_pct": rpct("！"),
        "real_q_pct": rpct("？"),
        "ellipsis_pct": rpct("…"),
        "real_end_period_pct": (sum(1 for d in reals if d.endswith("。")) / rn * 100) if rn else 0.0,
        "han": han,
        "dlg": total_dlg,
        "dlg_per_1k": total_dlg / han * 1000,
        "pre_pct": pre / total_dlg * 100 if total_dlg else 0,
        "post_pct": post / total_dlg * 100 if total_dlg else 0,
        "bare_pct": bare / total_dlg * 100 if total_dlg else 0,
        "q_total": q_total,
        "q_qmark_pct": q_with_qmark / q_total * 100 if q_total else 0,
        "q_period_pct": q_with_period / q_total * 100 if q_total else 0,
        "avg_sent": avg,
        "ultra_short_pct": ultra_short,
        "short_pct": short,
        "long_pct": long_,
        "lone_tag": lone_tag,
        "lone_tag_per_1k": lone_tag / han * 1000,
    }


def main():
    rows = []
    for spec in sys.argv[1:]:
        label, path = spec.split("=", 1)
        p = Path(path).expanduser()
        if not p.exists():
            print(f"跳过（不存在）: {path}", file=sys.stderr)
            continue
        r = analyze(read_text(p), label, sample_chars=60000)
        if r:
            rows.append(r)

    hdr = (
        f"{'样本':<24}{'汉字':>7}{'均句长':>8}{'≤6字%':>7}{'≥25字%':>8}"
        f"{'真台词/千字':>12}{'带表演标点%':>13}{'！%':>6}{'？%':>6}{'……%':>7}{'句号收尾%':>10}{'孤立tag/千字':>12}"
    )
    print(hdr)
    print("-" * len(hdr))
    for r in rows:
        print(
            f"{r['label']:<24}{r['han']:>7}{r['avg_sent']:>8.1f}{r['ultra_short_pct']:>7.0f}{r['long_pct']:>8.0f}"
            f"{r['real_dlg_per_1k']:>12.1f}{r['expressive_pct']:>13.0f}{r['excl_pct']:>6.0f}{r['real_q_pct']:>6.0f}"
            f"{r['ellipsis_pct']:>7.0f}{r['real_end_period_pct']:>10.0f}{r['lone_tag_per_1k']:>12.2f}"
        )


if __name__ == "__main__":
    main()
