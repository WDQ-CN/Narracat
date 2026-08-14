/**
 * 洁净词库（正文散文指纹扫描器数据源）
 *
 * 与 handlers/validators.ts 里的两条硬密度门（破折号 / 「不是…是…」对仗）不同，本词库
 * 只做 finding-only 提示：不产生 ToolErrorItem、不影响任何 ok 判定，纯粹给冷 pass 提供
 * 「这里有 AI 味词，往哪个方向改」的具名线索。
 *
 * 词条来源：`skills/novel-antipattern/references/blacklist.md`（已退役 skill 的离线词表
 * 参考资料）「高风险词」一节里与本词库主题相符、且不与「中性节拍词免杀红线」冲突的词
 * 保守并入 lyric_abstract 类目；短句排比 / 高风险结构模式等统计型模式有意不搬——那是
 * v2 统计线的活。
 *
 * 中性节拍词免杀红线（种子文件明示，禁止出现在任何 terms 里）：
 * 突然 / 这一刻 / 此刻 / 下一秒 / 无比 / 彻底 / 不由得
 */
export interface LexiconCategory {
    id: string;
    label: string;
    mode: "term" | "regex";
    terms?: string[];
    pattern?: string;
    replace_hint: string;
}
export declare const PROSE_FINGERPRINT_LEXICON: LexiconCategory[];
