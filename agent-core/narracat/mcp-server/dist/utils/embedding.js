/**
 * 本地 Embedding 模块
 *
 * 使用 Transformers.js 加载 ONNX 格式的 bge-base-zh-v1.5 模型，
 * 在 Node.js 进程内生成 768 维文本向量。
 *
 * 设计要点：
 * - 延迟加载：首次调用 embed() 时才初始化模型
 * - 优雅降级：模型不可用时返回 null，调用方自行处理
 * - 模型选型：在真实小说记忆语料上横向对比 bge-small / bge-base / Qwen3-Embedding-0.6B
 *   后选定 bge-base（查准最高，且 768 维=既有向量表维度，免维度重建）。详见 ADR-0023
 *   与 eval/embedding/。CLS pooling 是 bge 架构原生池化方式。
 * - 加载来源（ADR-0024）：若环境变量 NARRACAT_EMBEDDING_MODEL_PATH 指向打包进客户端的
 *   本地模型目录，则纯本地加载（allowRemoteModels=false，离线、免下载）；否则回退到
 *   按需从 HuggingFace 下载到 ~/.narracat/models（开发态友好）。打包档用 q8 量化（~98MB）。
 */
import { pipeline, env } from "@huggingface/transformers";
import { join } from "node:path";
import { homedir } from "node:os";
// 模型配置
const MODEL_NAME = "Xenova/bge-base-zh-v1.5";
const EMBEDDING_DIM = 768;
const MODEL_CACHE_DIR = join(homedir(), ".narracat", "models");
// 打包进客户端的本地模型根目录（{root}/Xenova/bge-base-zh-v1.5/...）；由 App 注入。
const LOCAL_MODEL_PATH = process.env.NARRACAT_EMBEDDING_MODEL_PATH?.trim();
// 延迟初始化的 pipeline 实例
let extractor = null;
let initFailed = false;
/**
 * 初始化 embedding pipeline（延迟加载）
 */
async function getExtractor() {
    if (extractor)
        return extractor;
    if (initFailed)
        return null;
    try {
        if (LOCAL_MODEL_PATH) {
            // 打包档：纯本地加载，禁联网（离线、免下载）
            env.localModelPath = LOCAL_MODEL_PATH;
            env.allowRemoteModels = false;
        }
        else {
            // 开发档：按需从 HuggingFace 下载到缓存目录
            env.cacheDir = MODEL_CACHE_DIR;
        }
        extractor = (await pipeline("feature-extraction", MODEL_NAME, { dtype: "q8" }));
        console.error(`[NovelMemory] Embedding 模型已加载: ${MODEL_NAME}${LOCAL_MODEL_PATH ? "（本地打包，离线）" : "（缓存/下载）"}`);
        return extractor;
    }
    catch (error) {
        initFailed = true;
        console.error(`[NovelMemory] Embedding 模型加载失败，语义检索将降级为纯 FTS 模式: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}
/**
 * 生成单条文本的 embedding 向量
 * @returns Float32Array(768) 或 null（模型不可用时）
 */
export async function embed(text) {
    const ext = await getExtractor();
    if (!ext)
        return null;
    const output = await ext(text, { pooling: "cls", normalize: true });
    return new Float32Array(output.data);
}
/**
 * 批量生成 embedding 向量
 * @returns Float32Array[] 或 null（模型不可用时）
 */
export async function embedBatch(texts) {
    const ext = await getExtractor();
    if (!ext)
        return null;
    const results = [];
    for (const text of texts) {
        const output = await ext(text, { pooling: "cls", normalize: true });
        results.push(new Float32Array(output.data));
    }
    return results;
}
/**
 * 获取 embedding 维度
 */
export function getEmbeddingDim() {
    return EMBEDDING_DIM;
}
/**
 * 检查 embedding 是否可用
 * 注意：首次调用 embed() 前返回 false（因为延迟加载尚未执行）
 */
export function isEmbeddingAvailable() {
    return extractor !== null && !initFailed;
}
/**
 * 重置状态（用于测试）
 */
export function resetEmbedding() {
    extractor = null;
    initFailed = false;
}
