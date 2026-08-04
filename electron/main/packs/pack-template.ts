// 模板样例包（B2 刀2 spec §6.2）：随应用内置为代码内联内容，不进包库，
// 仅供「制作能力包」指南页导出为 .narracatpack 供创作者解包改造。
// 三类卡各 1 张真实可用的小样例；不含 benchmark 卡（v1 benchmark 仅官方来源）。
// [evidence] 摘录区保持为空——非空摘录导出会被版权红线拦截（pack-store findEvidenceViolations）。

import AdmZip from 'adm-zip'
import { TEMPLATE_PACK_ID, type ExportPackResult } from '@shared/types/capability-pack'

export const TEMPLATE_PACK_VERSION = '0.1.0'

const MANIFEST = {
  pack_format_version: 1,
  id: TEMPLATE_PACK_ID,
  name: '模板样例包',
  author: '你的名字',
  version: TEMPLATE_PACK_VERSION,
  description: '把这个包解开改成你自己的：三类卡各一张可用小样例，README 教你每一步。',
  changelog: '0.1.0：首个版本。改包后记得更新版本号并在这里写变更说明。',
  cards: [
    {
      type: 'persona',
      id: 'template-voice-plain',
      name: '样例声音·白描冷静',
      path: 'cards/voice-plain.md',
      keywords: ['冷静', '白描', '克制', '旁观', '简洁'],
    },
    {
      type: 'craft',
      id: 'template-craft-scene-cut',
      path: 'cards/craft-scene-cut.md',
      triggers: ['场景切换', '转场', '换地点', '时间跳跃'],
      beat_types: ['transition'],
      technique_tags: ['转场设计'],
      emotion_tags: [],
      exclusions: [],
      priority: 3,
    },
    {
      type: 'structure',
      id: 'template-structure-chapter-hook',
      path: 'cards/structure-chapter-hook.md',
      dimension: 'D1',
      stage: 'stage-1',
      one_line: '每章结尾留一个未解决的具体问题，下一章开头先回应它',
    },
  ],
} as const

const VOICE_CARD = `你说话不带形容词堆砌。

你看见什么写什么：动作、物件、光线、距离。人物的情绪你从来不点破，你只写他做了什么——手停在门把上三秒，杯子放下的时候比拿起来重。读者自己会懂。

你不催节奏，也不拖。一句话能说完的事不用两句。
`

const CRAFT_CARD = `[runtime]
机制名：硬切转场
注解：场景切换不写过渡（"与此同时""另一边"都不要），直接切到新场景的第一个具体动作或画面，让读者靠上下文自己接上。
适用场景：双线叙事切线、时间跳跃、章内换地点。
不可迁移边界：情绪需要绵延的段落（如告别后的余韵）不适用硬切，会显得冷血。

[evidence]
`

const STRUCTURE_CARD = `[runtime]
机制名：章尾问题钩
注解：每章结尾抛出一个具体的、未解决的问题（不是抽象悬念，是"门后站着谁""这封信写了什么"级别的具体问题），下一章开头三段内必须回应它——回应不等于解决，可以是问题升级。
适用场景：连载节奏的章间衔接。
不可迁移边界：卷末收束章允许例外（要给读者喘息的完成感）。

[evidence]
`

const README = `# 模板样例包

这是一个**能干活的最小能力包**：三类卡各一张，导入后就能在书里启用生效。
把它当模板：解开 zip，替换成你自己的内容，就是你的第一个能力包。

## 这个包里有什么

| 文件 | 是什么 |
|---|---|
| \`pack.json\` | 包的身份证 + 卡片目录（机器读这个选卡） |
| \`cards/voice-plain.md\` | 声音卡：一段"你是谁"的第二人称人格描写 |
| \`cards/craft-scene-cut.md\` | 写法卡：一个可复用的写作机制（\`[runtime]\` 区） |
| \`cards/structure-chapter-hook.md\` | 剧作卡：一条章法纪律 |
| \`README.md\` | 你现在读的这个——改成介绍你的包 |

## 改造三步

1. **改 \`pack.json\`**：换掉 \`id\`（全局唯一，别用 \`official-\` 开头）、\`name\`、\`author\`（必填）、\`version\`（semver）。
2. **改卡片**：每张卡的 \`id\` 全局唯一；\`path\` 必须是包内相对路径；manifest 里的关键词/触发场景决定什么时候选中你的卡——写准它们。
3. **打包分享**：把整个文件夹压成 zip，后缀改成 \`.narracatpack\`，就能在别人的 NarraCat 里导入。

## 红线（导入/导出时会被机器校验）

- \`[evidence]\` 摘录区必须为空才能导出分享——版权责任在作者。
- 卡正文别写指挥引擎的话（改流程、跳过校验），没有生效通道，还会被 lint 拦。
- 装好的包是不可变的：要改内容，改版本号重新导入。
`

const TEMPLATE_PACK_FILES: ReadonlyArray<{ path: string; content: string }> = [
  { path: 'pack.json', content: `${JSON.stringify(MANIFEST, null, 2)}\n` },
  { path: 'README.md', content: README },
  { path: 'cards/voice-plain.md', content: VOICE_CARD },
  { path: 'cards/craft-scene-cut.md', content: CRAFT_CARD },
  { path: 'cards/structure-chapter-hook.md', content: STRUCTURE_CARD },
]

export function buildTemplatePackZip(): Buffer {
  const zip = new AdmZip()
  for (const file of TEMPLATE_PACK_FILES) zip.addFile(file.path, Buffer.from(file.content, 'utf8'))
  return zip.toBuffer()
}

export async function exportCapabilityPackTemplate(input: { targetPath: string }): Promise<ExportPackResult> {
  try {
    const zip = new AdmZip(buildTemplatePackZip())
    zip.writeZip(input.targetPath)
    return { status: 'ok', filePath: input.targetPath }
  } catch (error) {
    return { status: 'invalid', message: `模板包导出失败：${error instanceof Error ? error.message : String(error)}` }
  }
}
