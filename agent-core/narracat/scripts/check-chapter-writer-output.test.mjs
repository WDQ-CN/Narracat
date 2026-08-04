import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const agentCoreRoot = join(import.meta.dir, '..')
const hookPath = join(agentCoreRoot, 'hooks', 'scripts', 'check-chapter-writer-output.sh')

async function makeProject({ body, outline = '', characterCards = [] }) {
  const root = await mkdtemp(join(tmpdir(), 'narracat-chapter-hook-'))
  await mkdir(join(root, '.narracat', 'context-packs'), { recursive: true })
  await mkdir(join(root, 'manuscript', 'vol-01'), { recursive: true })

  await writeFile(
    join(root, '.narracat', 'state.yaml'),
    ['progress:', '  in_progress_chapter: 1', 'structure:', '  chapter_to_volume:', '    1: 1', ''].join('\n'),
    'utf-8',
  )
  await writeFile(join(root, '.narracat', 'config.yaml'), 'words_per_chapter: 3000\n', 'utf-8')
  await writeFile(
    join(root, '.narracat', 'context-packs', 'ch-001.json'),
    JSON.stringify(
      {
        chapter_outline: outline,
        character_cards: characterCards,
      },
      null,
      2,
    ),
    'utf-8',
  )
  await writeFile(join(root, 'manuscript', 'vol-01', 'ch-001.md'), body, 'utf-8')

  return root
}

function runHook(cwd) {
  const result = spawnSync('bash', [hookPath], {
    cwd,
    input: '{}',
    encoding: 'utf-8',
  })
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

describe('check-chapter-writer-output dialogue diagnostics', () => {
  test('accepts paired Chinese curved quotes and nested single quotes', async () => {
    const root = await makeProject({
      body: '第一章 雨夜\n\n“我听见他说‘别回头’。”她把门抵住，“所以我回头了。”\n\n风从门缝里钻进来，他没有再问。',
      outline: '两人同处，靠现场对白推进试探。',
      characterCards: [{ name: '她' }, { name: '他' }],
    })

    const output = runHook(root)

    expect(output).not.toContain('中文双引号不成对')
    expect(output).not.toContain('ASCII 引号')
    expect(output).not.toContain('方角引号')
  })

  test('reports ASCII quote dialogue', async () => {
    const root = await makeProject({
      body: '第一章 雨夜\n\n"别动。"他说。\n\n她没有动。',
      outline: '两人对峙。',
      characterCards: [{ name: '她' }, { name: '他' }],
    })

    expect(runHook(root)).toContain('ASCII 引号')
  })

  test('reports fang quote dialogue', async () => {
    const root = await makeProject({
      body: '第一章 雨夜\n\n「别动。」他说。\n\n她没有动。',
      outline: '两人对峙。',
      characterCards: [{ name: '她' }, { name: '他' }],
    })

    expect(runHook(root)).toContain('方角引号')
  })

  test('reports unpaired Chinese curved quotes', async () => {
    const root = await makeProject({
      body: '第一章 雨夜\n\n“别动。\n\n她没有动。',
      outline: '两人对峙。',
      characterCards: [{ name: '她' }, { name: '他' }],
    })

    expect(runHook(root)).toContain('中文双引号不成对')
  })

  test('reports low dialogue only as a soft signal for ordinary multi-person scenes', async () => {
    const root = await makeProject({
      body: '第一章 雨夜\n\n沈砚进了藏经阁。陆昭站在窗边，手里压着经卷。两个人隔着一张案，谁都没有先开口。案上的玉佩被灯火照出一道旧痕，屋外巡夜的脚步声一下一下压过来。',
      outline: '两人对峙。沈砚和陆昭在藏经阁同处，关键冲突来自质问与试探。',
      characterCards: [{ name: '沈砚' }, { name: '陆昭' }],
    })

    expect(runHook(root)).toContain('现场对白偏少')
  })

  test('does not report low dialogue for solitude or low-dialogue scenes', async () => {
    const root = await makeProject({
      body: '第一章 旧物\n\n沈砚一个人在丹房里清点遗物。药柜的铜环凉得发硬，旧册页边缘被火燎过，翻开时落下一点灰。他站了很久，把那支银簪重新放回盒底。',
      outline: '独处，低张力，情绪消化章。对话占比应很低，靠动作和环境负重。',
      characterCards: [{ name: '沈砚' }],
    })

    expect(runHook(root)).not.toContain('现场对白偏少')
  })

  test('does not report low dialogue for dialogue-driven scenes', async () => {
    const root = await makeProject({
      body: '第一章 对质\n\n“你昨夜在后山。”沈砚说。\n\n陆昭笑了一下：“师弟，这话谁教你的？”\n\n“没人教。”\n\n“那就更可惜。”陆昭把经卷合上，“你问错人了。”\n\n沈砚把玉佩推过去：“那你看着它，再说一遍。”',
      outline: '两人对峙，靠对白和动作推进质问。',
      characterCards: [{ name: '沈砚' }, { name: '陆昭' }],
    })

    expect(runHook(root)).not.toContain('现场对白偏少')
  })

  test('does not flag ascii quotes around english signage or system strings in narration', async () => {
    const root = await makeProject({
      body: '第一章 门牌\n\n门口挂着一块牌子，上面写着 "Welcome Home"。沈砚盯着屏幕上跳出的 "E_FATAL" 看了很久，没有说话。',
      outline: '独处，主角查看线索。',
      characterCards: [{ name: '沈砚' }],
    })

    expect(runHook(root)).not.toContain('ASCII 引号')
  })

  test('does not report low dialogue for action scenes that reduce dialogue', async () => {
    const root = await makeProject({
      body: '第一章 缠斗\n\n沈砚与刺客在屋脊上缠斗，刀光一闪一闪，谁也没有开口。雨水顺着檐角砸下来，他翻身避开一记直刺，反手扣住对方的腕。',
      outline: '主角与刺客缠斗，减少对话，全靠动作推进。',
      characterCards: [{ name: '沈砚' }, { name: '刺客' }],
    })

    expect(runHook(root)).not.toContain('现场对白偏少')
  })

  test('does not report low dialogue for time-skip or montage chapters', async () => {
    const root = await makeProject({
      body: '第一章 闭关\n\n时间快进，主角闭关修炼三月。春去秋来，丹炉的火没有熄过。他出关那日，山下的桃花已经谢了。',
      outline: '时间快进，主角闭关修炼三月的蒙太奇过场。',
      characterCards: [{ name: '沈砚' }, { name: '陆昭' }],
    })

    expect(runHook(root)).not.toContain('现场对白偏少')
  })
})
