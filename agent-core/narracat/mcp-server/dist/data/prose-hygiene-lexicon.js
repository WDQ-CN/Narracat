/**
 * 洁净词库 v1（正文散文指纹扫描器数据源）
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
export const PROSE_FINGERPRINT_LEXICON = [
    {
        id: "adverb_universal",
        label: "万能副词",
        mode: "term",
        terms: ["缓缓", "微微", "轻轻", "淡淡", "静静", "默默", "悄悄", "慢慢", "渐渐", "暗暗"],
        replace_hint: "删掉副词，用前置动作或结果暗示速度与力度",
    },
    {
        id: "gaze_template",
        label: "神态模板",
        mode: "term",
        terms: ["眸中闪过", "眼底掠过", "瞳孔微缩", "瞳孔骤缩", "嘴角勾起", "嘴角上扬", "眼神一凝", "目光一闪"],
        replace_hint: "换成该角色专属的微动作，同一角色全书复用同一件",
    },
    {
        id: "action_cliche",
        label: "动作套话",
        mode: "term",
        terms: [
            "深吸一口气",
            "皱起眉头",
            "叹了口气",
            "缓缓开口",
            "沉声说道",
            "心头一跳",
            "浑身一震",
            "脚步一顿",
            "身形一滞",
            "倒吸一口凉气",
        ],
        replace_hint: "写这个角色此刻真实会做的具体动作，不用通用身体反应",
    },
    {
        id: "turn_template",
        label: "转折模板",
        mode: "term",
        terms: ["就在这时", "就在此刻", "然而下一刻", "殊不知", "话虽如此", "正当此时"],
        replace_hint: "删掉套话，让转折由内容自己发生",
    },
    {
        id: "lyric_abstract",
        label: "空洞抒情词",
        mode: "term",
        // 基线（brief 必含，逐字照抄）：仿佛/莫名/难以言说/深邃/无法形容/说不清
        // 并入自种子文件「高风险词」：似乎在告诉他（同属抽象暗示式抒情，具体理由见任务报告）
        terms: ["仿佛", "莫名", "难以言说", "深邃", "无法形容", "说不清", "似乎在告诉他"],
        replace_hint: "落到具体的画面、动作或体感，不写抽象感受",
    },
    {
        id: "emotion_label",
        label: "情绪标签句",
        mode: "regex",
        pattern: "(?:他|她)(?:感到|感觉|只觉|心中一阵|心里一阵)[一-鿿]{1,8}",
        replace_hint: "改成生理反应 + 当下意图 + 下一动作，让读者自己读出情绪",
    },
    {
        id: "said_tag",
        label: "说话标签",
        mode: "term",
        terms: ["说道", "淡淡道", "沉声道", "轻声道", "冷冷道", "缓缓道"],
        replace_hint: "多数换成前置动作（他把杯子一放。「不去。」），保留的不超过对话三成",
    },
];
