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
/**
 * 生成单条文本的 embedding 向量
 * @returns Float32Array(768) 或 null（模型不可用时）
 */
export declare function embed(text: string): Promise<Float32Array | null>;
/**
 * 批量生成 embedding 向量
 * @returns Float32Array[] 或 null（模型不可用时）
 */
export declare function embedBatch(texts: string[]): Promise<Float32Array[] | null>;
/**
 * 获取 embedding 维度
 */
export declare function getEmbeddingDim(): number;
/**
 * 检查 embedding 是否可用
 * 注意：首次调用 embed() 前返回 false（因为延迟加载尚未执行）
 */
export declare function isEmbeddingAvailable(): boolean;
/**
 * 重置状态（用于测试）
 */
export declare function resetEmbedding(): void;
