/**
 * 配置读取模块
 *
 * 从环境变量和项目 config.yaml 读取 NovelMemory 运行所需的配置。
 * 使用正则从 YAML 提取字段，避免引入 YAML 解析器依赖。
 *
 * config.yaml 字段（init 创建，setup 填充）：
 *   novel_id / title / genre / language / automation_level /
 *   estimated_total_chapters / words_per_chapter / style_profile / genre /
 *   voltage_bestof / style_anchor_auto_fallback
 */
import { readFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
function matchIntField(content, field) {
    const m = content.match(new RegExp(`^${field}:\\s*["']?(\\d+)["']?\\s*(#.*)?$`, "m"));
    if (!m)
        return null;
    const value = parseInt(m[1], 10);
    return Number.isInteger(value) && value > 0 ? value : null;
}
function matchStringField(content, field) {
    const m = content.match(new RegExp(`^${field}:\\s*["']?([^\\s"'#]+)["']?`, "m"));
    if (!m)
        return null;
    const value = m[1];
    return value === "null" || value === "~" ? null : value;
}
export async function loadConfig(configPathOverride) {
    const configPath = configPathOverride || process.env.NOVEL_CONFIG_PATH || ".narracat/config.yaml";
    const absolutePath = resolve(configPath);
    let content;
    try {
        content = await readFile(absolutePath, "utf-8");
    }
    catch {
        throw new Error(`无法读取配置文件: ${absolutePath}\n` +
            `请确认项目已通过 /narracat:init 初始化，或设置环境变量 NOVEL_CONFIG_PATH 指向 config.yaml 路径。`);
    }
    const novelId = matchStringField(content, "novel_id");
    if (!novelId) {
        throw new Error(`配置文件 ${absolutePath} 中未找到 novel_id 字段。\n` +
            `请确认 config.yaml 包含 novel_id 配置项。`);
    }
    // 数据库文件与 config.yaml 同目录；projectRoot 是 config 目录的父目录（即 .narracat 的 parent）
    const configDir = dirname(absolutePath);
    const dbPath = join(configDir, "memory.db");
    const projectRoot = dirname(configDir);
    return {
        novelId,
        dbPath,
        projectRoot,
        estimatedTotalChapters: matchIntField(content, "estimated_total_chapters"),
        wordsPerChapter: matchIntField(content, "words_per_chapter"),
        styleProfile: matchStringField(content, "style_profile"),
        // 默认关闭：自动取样拿的是 AI 自产正文，写手「学本书语感」会学到上一章的病灶并逐章放大
        // （真机实测：被取样章均句长 12 字、疑问句 75% 用句号，下一章恶化到 10.1 字 / 49% 句子 ≤6 字）。
        // 本书样章只认作者主动标记；显式写 style_anchor_auto_fallback: true 才恢复自动取样。
        styleAnchorAutoFallback: matchStringField(content, "style_anchor_auto_fallback") === "true",
        genre: matchStringField(content, "genre"),
        voltageBestofPresentInConfig: matchStringField(content, "voltage_bestof") !== null,
    };
}
