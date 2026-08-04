#!/usr/bin/env node
/**
 * Embedding 向量健康自检入口
 *
 * 主动跑一次「模型加载 → 向量生成 → sqlite-vec 扩展 → 检索往返」全链路，
 * 把结构化结果以 sentinel 行写到 stdout，由 App 侧探针
 * （electron/main/orchestrator/embedding-probe.ts）spawn 并解析。
 *
 * 为何需要主动自检：embedding 模型是懒加载，空库启动不触发 embed()，
 * 仅看启动日志无法判断语义检索此刻是否真的可用（#312 静默降级教训）。
 *
 * 不依赖项目记忆库：用内存 db 自建 memory_vec 做端到端往返，可离线、随处跑。
 * 模型来源由 App 经 NARRACAT_EMBEDDING_MODEL_PATH 注入（打包档内置离线模型）。
 *
 * 输出契约（src/types/narracat.ts 的 EmbeddingSelfTestReport 必须镜像本结构）：
 * 单行 `NARRACAT_EMBEDDING_SELFTEST_JSON:{...}` 写到 stdout。其余库噪声走 stderr，
 * 解析端按 sentinel 提取，故 transformers/onnx 的杂项输出不污染契约。
 */
export declare const SELFTEST_SENTINEL = "NARRACAT_EMBEDDING_SELFTEST_JSON:";
interface SelfTestStep {
    ok: boolean;
    detail?: string;
    error?: string;
}
export interface EmbeddingSelfTestReport {
    ok: boolean;
    modelLoad: SelfTestStep & {
        modelName?: string;
        dim?: number;
    };
    embed: SelfTestStep & {
        dim?: number;
        normalized?: boolean;
        durationMs?: number;
    };
    sqliteVec: SelfTestStep;
    retrieval: SelfTestStep & {
        hit?: boolean;
        topDistance?: number;
    };
}
export interface EmbeddingSelfTestOptions {
    /** sqlite 驱动注入（App utilityProcess worker 传根 N-API better-sqlite3 实例工厂——引擎自带
     * node-ABI 驱动在 Electron ABI 进程内 DLOPEN 必败；缺省用引擎自带驱动，CLI spawn 语义不变）。 */
    createDatabase?: () => unknown;
}
/**
 * 执行四项全链路自检并汇总结果。导出供单测以假向量验证契约（不加载真模型），
 * 以及 App memory worker 进程内直调（sqlite 注入式，见 EmbeddingSelfTestOptions）。
 */
export declare function runEmbeddingSelfTest(options?: EmbeddingSelfTestOptions): Promise<EmbeddingSelfTestReport>;
export {};
