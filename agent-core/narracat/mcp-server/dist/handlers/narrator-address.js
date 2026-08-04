/**
 * 叙述人称受控值域 —— 叙述声音卡 address 字段的 value 取值。
 *
 * enum SSOT 在 schemas/premise-cards.json 的 $defs.narrator_address（英文 snake_case，
 * 中文归渲染层）。本模块为引擎侧消费方提供：
 *  ① 入库校验值集 NARRATOR_ADDRESS_VALUES（novel_submit_premise 校验 narrator_voice 卡）；
 *  ② 渲染短语 narratorAddressPhrase（喂写手 style_directive / 喂 architect 腔调节，统一中文）。
 * App 侧另有 schema-field-labels 的徽标映射，经对照测试与 schema 枚举绑定防漂移。
 */
export const NARRATOR_ADDRESS_VALUES = [
    "first_person",
    "third_limited",
    "third_omniscient",
    "multi_pov",
];
const NARRATOR_ADDRESS_PHRASES = {
    first_person: "第一人称",
    third_limited: "第三人称限知",
    third_omniscient: "第三人称全知",
    multi_pov: "多视角切换",
};
export function isNarratorAddress(value) {
    return NARRATOR_ADDRESS_VALUES.includes(value);
}
/** 枚举值 → 中文短语（喂模型的渲染层）；未知值原样返回，不抛错。 */
export function narratorAddressPhrase(value) {
    return NARRATOR_ADDRESS_PHRASES[value] ?? value;
}
