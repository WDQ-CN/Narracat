/**
 * 叙述人称受控值域 —— 叙述声音卡 address 字段的 value 取值。
 *
 * enum SSOT 在 schemas/premise-cards.json 的 $defs.narrator_address（英文 snake_case，
 * 中文归渲染层）。本模块为引擎侧消费方提供：
 *  ① 入库校验值集 NARRATOR_ADDRESS_VALUES（novel_submit_premise 校验 narrator_voice 卡）；
 *  ② 渲染短语 narratorAddressPhrase（喂写手 style_directive / 喂 architect 腔调节，统一中文）。
 * App 侧另有 schema-field-labels 的徽标映射，经对照测试与 schema 枚举绑定防漂移。
 */
export declare const NARRATOR_ADDRESS_VALUES: readonly ["first_person", "third_limited", "third_omniscient", "multi_pov"];
export type NarratorAddress = (typeof NARRATOR_ADDRESS_VALUES)[number];
export declare function isNarratorAddress(value: string): value is NarratorAddress;
/** 枚举值 → 中文短语（喂模型的渲染层）；未知值原样返回，不抛错。 */
export declare function narratorAddressPhrase(value: string): string;
