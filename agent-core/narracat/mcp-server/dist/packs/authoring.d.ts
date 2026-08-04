export interface TypicalScenario {
    id: string;
    name: string;
    outline: string;
}
export interface TypicalVoice {
    id: string;
    name: string;
    voice: Record<string, string>;
}
export declare const AUTHORING_TECHNIQUE_TAGS: readonly ["对话设计", "心理刻画", "环境描写", "动作细节", "节奏控制", "情感渲染", "视角运用", "悬念设置"];
export declare const AUTHORING_EMOTION_TAGS: string[];
export declare function loadTypicalScenarios(): TypicalScenario[];
export declare function loadTypicalVoices(): TypicalVoice[];
export interface AuthoringPreviewResult {
    id: string;
    name: string;
    selected: boolean;
    reason: string;
}
/**
 * craft 草稿卡干跑预览：把卡条目适配成 CraftPoolEntry（origin 固定 user，与官方池一并
 * 参与 selectCraftPacks 竞争），逐个典型情境跑一遍选卡，报每个情境是否会选中这张卡。
 * path/absolute_path 用占位——选卡只依赖 triggers/emotion_tags/exclusions/priority/origin。
 */
export declare function previewCraftCard(card: {
    id: string;
    triggers: string[];
    emotion_tags: string[];
    exclusions: string[];
    priority: number;
}): AuthoringPreviewResult[];
/**
 * persona 草稿卡干跑预览：把卡条目适配成 PersonaPoolEntry（origin 固定 user，path 留空
 * 由 selectPersona 容错为空 body），逐个典型声音画像跑一遍选卡，报每个画像是否会选中这张卡。
 */
export declare function previewPersonaCard(card: {
    id: string;
    name: string;
    keywords: string[];
}): AuthoringPreviewResult[];
