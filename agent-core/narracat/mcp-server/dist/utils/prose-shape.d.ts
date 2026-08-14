export interface ProseShapeFinding {
    id: string;
    label: string;
    /** 命中详情，含可定位的段号 / 例句片段；不含阈值数字 */
    detail: string;
    hint: string;
}
/**
 * 扫描正文的句段形状。返回命中的形状清单（可为空），供冷 pass 定位改写。
 * 只看形状，不判文笔好坏；所有判定都跳过 markdown 标题与列表行。
 */
export declare function scanProseShape(text: string): ProseShapeFinding[];
