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
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { embed, getEmbeddingDim } from "./utils/embedding.js";
import { initVecTable, vecInsert, vecSearch } from "./utils/vec.js";
export const SELFTEST_SENTINEL = "NARRACAT_EMBEDDING_SELFTEST_JSON:";
const MODEL_NAME = "Xenova/bge-base-zh-v1.5";
const PROBE_TEXT = "向量健康自检：主角在风雪夜揭开身世之谜，与旧友重逢。";
function l2Norm(v) {
    let sum = 0;
    for (const x of v)
        sum += x * x;
    return Math.sqrt(sum);
}
/**
 * 执行四项全链路自检并汇总结果。导出供单测以假向量验证契约（不加载真模型），
 * 以及 App memory worker 进程内直调（sqlite 注入式，见 EmbeddingSelfTestOptions）。
 */
export async function runEmbeddingSelfTest(options = {}) {
    const report = {
        ok: false,
        modelLoad: { ok: false },
        embed: { ok: false },
        sqliteVec: { ok: false },
        retrieval: { ok: false },
    };
    const expectedDim = getEmbeddingDim();
    // 1 + 2：模型加载 + 向量生成。embed() 内部懒加载模型，首次调用即触发加载。
    let queryEmbedding = null;
    try {
        const start = performance.now();
        queryEmbedding = await embed(PROBE_TEXT);
        const durationMs = Math.round(performance.now() - start);
        if (!queryEmbedding) {
            report.modelLoad.error = "embed() 返回 null：模型加载失败或不可用";
        }
        else {
            report.modelLoad.ok = true;
            report.modelLoad.modelName = MODEL_NAME;
            report.modelLoad.dim = expectedDim;
            const dim = queryEmbedding.length;
            const norm = l2Norm(queryEmbedding);
            const normalized = Math.abs(norm - 1) < 0.05;
            report.embed.dim = dim;
            report.embed.normalized = normalized;
            report.embed.durationMs = durationMs;
            report.embed.ok = dim === expectedDim && normalized;
            if (dim !== expectedDim) {
                report.embed.error = `维度异常：期望 ${expectedDim}，实际 ${dim}`;
            }
            else if (!normalized) {
                report.embed.error = `向量未归一：L2 范数 ${norm.toFixed(3)}`;
            }
        }
    }
    catch (error) {
        report.modelLoad.error = error instanceof Error ? error.message : String(error);
    }
    // 3：sqlite-vec 扩展加载
    let db = null;
    try {
        db = (options.createDatabase ? options.createDatabase() : new Database(":memory:"));
        sqliteVec.load(db);
        report.sqliteVec.ok = true;
    }
    catch (error) {
        report.sqliteVec.error = error instanceof Error ? error.message : String(error);
    }
    // 4：检索自检——向量写入 + KNN 命中（端到端）
    if (db && report.sqliteVec.ok && queryEmbedding && report.embed.ok) {
        try {
            const inited = initVecTable(db, queryEmbedding.length);
            if (!inited) {
                report.retrieval.error = "memory_vec 初始化失败（sqlite-vec 扩展不可用）";
            }
            else {
                const novelId = "selftest-novel";
                const sourceId = "selftest-1";
                vecInsert(db, "facts", sourceId, novelId, "semantic", queryEmbedding);
                const results = vecSearch(db, queryEmbedding, novelId, { limit: 1 });
                const hit = results.length > 0 && results[0].sourceId === sourceId;
                report.retrieval.ok = hit;
                report.retrieval.hit = hit;
                if (results.length > 0)
                    report.retrieval.topDistance = results[0].distance;
                if (!hit)
                    report.retrieval.error = "KNN 未命中刚写入的向量";
            }
        }
        catch (error) {
            report.retrieval.error = error instanceof Error ? error.message : String(error);
        }
    }
    if (db)
        db.close();
    report.ok =
        report.modelLoad.ok &&
            report.embed.ok &&
            report.sqliteVec.ok &&
            report.retrieval.ok;
    return report;
}
function emit(report, exitCode) {
    // 不强制 process.exit()：onnxruntime/better-sqlite3 仍在原生清理时被强杀会触发 SIGABRT(134)，
    // 反让 App 探针把健康跑判成「进程异常」。改设 process.exitCode 让事件循环自然 drain 后按该码退出
    // （实测自检 ~0.4s 干净退出，onnx 不吊事件循环）。App 侧据 exitCode===0 判 process.ok。
    process.exitCode = exitCode;
    process.stdout.write(SELFTEST_SENTINEL + JSON.stringify(report) + "\n");
}
async function main() {
    try {
        // 能产出报告即 exit 0（是否降级由报告 ok 字段承载）；只有彻底产不出报告才 exit 1。
        emit(await runEmbeddingSelfTest(), 0);
    }
    catch (error) {
        const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
        emit({
            ok: false,
            modelLoad: { ok: false, error: `自检进程异常：${message}` },
            embed: { ok: false },
            sqliteVec: { ok: false },
            retrieval: { ok: false },
        }, 1);
    }
}
// 仅作为脚本被直接 spawn 时运行；被单测 import 时不自启。
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    void main();
}
