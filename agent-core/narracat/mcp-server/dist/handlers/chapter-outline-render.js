/**
 * 单章细纲的机械渲染（首行「# 第N章 …」是 App 锚点）。
 *
 * 写入侧（novel_submit_chapter_outline）与读取侧（WritingContextPack builder）共用同一渲染，
 * 保证写手看到的章纲文本与结构化 ch-NNN.json 一致——尤其 payoff_beat 等「重提已有章」时才补的字段：
 * 已存在的 .md 受保护不覆盖会变陈旧，读取侧从 .json 现渲染即可避免写手丢字段。
 *
 * 支持两种形态（按运行时 beats 字段是否为数组分支）：
 * - 旧形态（无 beats）：scenes 列表式，向后兼容存量 ch-NNN.json
 * - 新形态（有 beats）：positioning + beats 骨架式
 */
/** payoff_beat 英文枚举 → 中文展示标签（渲染层；枚举 SSOT 在 outline-structure.json） */
export const PAYOFF_BEAT_LABEL = {
    face_slap: "打脸",
    level_up: "升级突破",
    windfall: "机缘横财",
    fame: "扬名",
    reveal: "真相揭示",
    reunion: "重逢相认",
    counterattack: "绝地反击",
    sweet: "情感甜点",
};
/** end_hook 英文枚举 → 中文展示标签（渲染层；枚举 SSOT 在 outline-structure.json） */
export const END_HOOK_LABEL = {
    suspense: "悬念",
    danger: "危机",
    emotional: "情绪",
    none: "无",
};
/** payoff_intensity 英文枚举 → 中文展示标签（渲染层；枚举 SSOT 在 outline-structure.json） */
export const PAYOFF_INTENSITY_LABEL = {
    small: "小",
    medium: "中",
    large: "大",
};
// ---------------------------------------------------------------------------
// 旧形态渲染（原函数体原样搬入，一行不改）
// ---------------------------------------------------------------------------
function renderLegacy(ch, ctx) {
    const { storylineNames, foreshadowingDescriptions } = ctx;
    const lines = [
        `# 第${ch.chapter}章 ${ch.title}`,
        "",
        `- 价值转换: ${ch.value_shift}`,
        `- 情感赌注: ${ch.emotional_stakes}`,
        `- 戏剧焦点: ${ch.dramatic_focus}`,
    ];
    if (ch.payoff_beat) {
        const beatLabel = PAYOFF_BEAT_LABEL[ch.payoff_beat] ?? ch.payoff_beat;
        lines.push(`- 本章爽点: ${beatLabel}（${ch.payoff_beat}）`);
    }
    lines.push(`- 聚焦故事线: ${ch.storyline_focus
        .map((id) => {
        const name = storylineNames.get(id);
        return name ? `${id}「${name}」` : id;
    })
        .join("、")}`, `- 视角人物: ${ch.pov_character.name}`);
    if (ch.ending_note) {
        lines.push(`- 章末收尾: ${ch.ending_note}`);
    }
    lines.push("", "## 场景", "");
    ch.scenes.forEach((scene, idx) => {
        lines.push(`### 场景 ${idx + 1} · ${scene.location}`, "");
        lines.push(`- 出场角色: ${scene.characters.map((c) => c.name).join("、")}`);
        lines.push(`- 压力点: ${scene.pressure_point}`, "");
    });
    const touches = ch.foreshadowing_touch ?? [];
    if (touches.length > 0) {
        lines.push("## 伏笔动作", "");
        for (const ft of touches) {
            const desc = foreshadowingDescriptions.get(ft.id);
            lines.push(`- ${ft.id}: ${ft.action}${desc ? `（${desc}）` : ""}`);
        }
        lines.push("");
    }
    return lines.join("\n");
}
// ---------------------------------------------------------------------------
// 新形态渲染（beat 骨架式）
// ---------------------------------------------------------------------------
function renderNew(ch, ctx) {
    const { storylineNames, foreshadowingDescriptions } = ctx;
    const lines = [
        `# 第${ch.chapter}章 ${ch.title}`,
        "",
        "## 本章定位",
        "",
        ch.positioning,
        "",
        "## 场景骨架",
        "",
    ];
    ch.beats.forEach((b, i) => lines.push(`${i + 1}. ${b}`));
    if (ch.must_deliver && ch.must_deliver.length > 0) {
        lines.push("", "## 必须落地", "");
        for (const m of ch.must_deliver)
            lines.push(`- ${m}`);
    }
    lines.push("");
    if (ch.payoff_beat) {
        const beatLabel = PAYOFF_BEAT_LABEL[ch.payoff_beat] ?? ch.payoff_beat;
        const intensitySuffix = ch.payoff_intensity
            ? ` · 强度: ${PAYOFF_INTENSITY_LABEL[ch.payoff_intensity] ?? ch.payoff_intensity}`
            : "";
        lines.push(`- 本章爽点: ${beatLabel}（${ch.payoff_beat}）${intensitySuffix}`);
    }
    if (ch.end_hook) {
        const hookLabel = END_HOOK_LABEL[ch.end_hook] ?? ch.end_hook;
        lines.push(`- 章末钩: ${hookLabel}（${ch.end_hook}）`);
    }
    lines.push(`- 聚焦故事线: ${ch.storyline_focus
        .map((id) => {
        const name = storylineNames.get(id);
        return name ? `${id}「${name}」` : id;
    })
        .join("、")}`, `- 视角人物: ${ch.pov_character.name}`, `- 出场角色: ${ch.characters.map((c) => c.name).join("、")}`);
    const touches = ch.foreshadowing_touch ?? [];
    if (touches.length > 0) {
        lines.push("", "## 伏笔动作", "");
        for (const ft of touches) {
            const desc = foreshadowingDescriptions.get(ft.id);
            lines.push(`- ${ft.id}: ${ft.action}${desc ? `（${desc}）` : ""}`);
        }
    }
    const stateChanges = ch.state_changes ?? [];
    if (stateChanges.length > 0) {
        lines.push("", "## 本章状态变更", "");
        for (const sc of stateChanges) {
            const opLabel = sc.operation === "remove" ? "失去" : sc.operation === "add" ? "获得" : "变为";
            lines.push(`- ${sc.character.name}: ${sc.dimension} ${opLabel}「${sc.value}」${sc.reason ? `（${sc.reason}）` : ""}`);
        }
    }
    return lines.join("\n");
}
// ---------------------------------------------------------------------------
// 公共入口（签名不变，按形态分支）
// ---------------------------------------------------------------------------
/** 渲染单章细纲为 md 文本（不含落盘；写入侧与 WCP 读取侧共用，确保两侧一致）。 */
export function renderChapterOutlineMarkdown(ch, ctx) {
    // 旧形态（无 beats）走旧逻辑，向后兼容存量 ch-NNN.json
    if (!Array.isArray(ch.beats)) {
        return renderLegacy(ch, ctx);
    }
    return renderNew(ch, ctx);
}
