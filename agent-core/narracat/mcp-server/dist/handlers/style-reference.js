/**
 * novel_query_style_reference 工具实现
 *
 * 从 novel-style-reference 语料库中按写作手法 + 情感氛围组合检索真人写作范例。
 * 此工具不依赖小说记忆数据库，直接读取 JSON 语料文件到内存索引。
 */
import { queryStyleReference } from "../corpus-loader.js";
import { singleError } from "../types.js";
export async function novelQueryStyleReference(args, _ctx) {
    const technique = args["technique"];
    const emotion = args["emotion"];
    const limit = args["limit"];
    if (!technique || !Array.isArray(technique) || technique.length === 0) {
        return singleError("technique", "至少 1 个手法标签的字符串数组", JSON.stringify(technique ?? null), "传入手法标签数组，如 [\"对话设计\", \"节奏控制\"]");
    }
    if (emotion !== undefined && !Array.isArray(emotion)) {
        return singleError("emotion", "字符串数组（可省略）", JSON.stringify(emotion), "emotion 必须是数组，如 [\"紧张\"]；不需要过滤时省略该参数");
    }
    const result = queryStyleReference({
        technique: technique.map((t) => String(t)),
        emotion: emotion ? emotion.map((e) => String(e)) : undefined,
        limit: limit !== undefined ? Number(limit) : undefined,
    });
    return {
        ok: true,
        query: {
            technique,
            emotion: emotion ?? [],
        },
        results: result.results,
        total_matches: result.total_matches,
    };
}
