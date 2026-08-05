/**
 * novel_query_style_reference 工具实现
 *
 * 从 novel-style-reference 语料库中按写作手法 + 情感氛围组合检索真人写作范例。
 * 此工具不依赖小说记忆数据库，直接读取 JSON 语料文件到内存索引。
 */

import { queryStyleReference } from "../corpus-loader.js";
import { singleError } from "../types.js";
import type { ToolContext } from "../types.js";

export async function novelQueryStyleReference(
  args: Record<string, unknown>,
  _ctx: ToolContext,
): Promise<unknown> {
  const technique = args["technique"] as string[] | undefined;
  const emotion = args["emotion"] as string[] | undefined;
  const limit = args["limit"] as number | undefined;

  if (!technique || !Array.isArray(technique) || technique.length === 0) {
    return singleError(
      "technique",
      "至少 1 个手法标签的字符串数组",
      JSON.stringify(technique ?? null),
      "传入手法标签数组，如 [\"对话设计\", \"节奏控制\"]",
    );
  }

  if (emotion !== undefined && !Array.isArray(emotion)) {
    return singleError(
      "emotion",
      "字符串数组（可省略）",
      JSON.stringify(emotion),
      "emotion 必须是数组，如 [\"紧张\"]；不需要过滤时省略该参数",
    );
  }

  const result = await queryStyleReference({
    technique: technique.map((t) => String(t)),
    emotion: emotion ? emotion.map((e) => String(e)) : undefined,
    limit: limit !== undefined ? Number(limit) : undefined,
  });

  if (result.unavailable) {
    return {
      ok: true,
      query: { technique, emotion: emotion ?? [] },
      results: [],
      total_matches: 0,
      note: "范例服务暂不可用（离线、未配置凭证或服务异常），稍后可重试",
    };
  }

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
