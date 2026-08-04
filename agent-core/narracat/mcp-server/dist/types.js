/**
 * NovelMemory MCP Server 类型定义
 *
 * SQLite 行类型 + 工具处理器签名 + 统一错误返回形状。
 */
export function errorResponse(errors) {
    return { ok: false, errors };
}
export function singleError(field, expected, actual, hint) {
    return { ok: false, errors: [{ field, expected, actual, hint }] };
}
