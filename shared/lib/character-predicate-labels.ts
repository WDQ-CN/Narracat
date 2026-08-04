/**
 * 引擎抽取事实的受控谓词（agent-core memory-keeper.md「受控词表」12 项）→ 作者可读中文标签。
 *
 * 词表维度有作者/策展人起的中文 display_name，正常路径用不到本映射；这里只服务「非词表回退」
 * 展示：老书无词表、词表未覆盖的抽取谓词分组、v1 扁平卡、extras 区——此前这些位置直接裸展示
 * 英文谓词名（identity/possession…），作者看不懂（拆旧刀3 真机走查回报）。
 *
 * `x-` 前缀是模型自拟谓词的受控出口（自拟内容通常已是中文），剥前缀展示；词表外未知 key
 * 原样返回（词表维度 key 的 display_name 由词表自己负责，不经本映射）。
 */
const CHARACTER_PREDICATE_LABELS: Record<string, string> = {
  identity: '身份',
  location: '所在地',
  possession: '持有物',
  goal: '目标',
  injury: '伤势',
  ability: '能力',
  status: '状态',
  secret: '秘密',
  reputation: '名声',
  oath: '誓约',
  debt: '恩怨债',
  relationship: '关系',
}

export function characterPredicateLabel(predicate: string): string {
  const label = CHARACTER_PREDICATE_LABELS[predicate]
  if (label) return label
  if (predicate.startsWith('x-') && predicate.length > 2) return predicate.slice(2)
  return predicate
}
