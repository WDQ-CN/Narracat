import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, copyFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { detectSourceSignatures, lintCorpusDeid } from './corpus-deid-lint.mjs'

test('detectSourceSignatures 抓原始语料文件路径(.txt)', () => {
  assert.ok(detectSourceSignatures('**文件:** `某目录/100本小说/某书.txt`').length >= 1)
})

test('detectSourceSignatures 抓本地语料库目录名', () => {
  assert.ok(detectSourceSignatures('参见 小说知识库 里的样本').some((h) => h.includes('本地语料库目录名')))
})

test('detectSourceSignatures 抓来源署名(作者：)', () => {
  assert.ok(detectSourceSignatures('### 某书 — 作者：某某').some((h) => h.includes('来源署名')))
})

test('detectSourceSignatures 干净工具壳文本零误报', () => {
  const clean = '按 technique+emotion 调用 novel_query_style_reference。\n值域：对话设计 / 心理刻画。学机制不抄句子。'
  assert.deepEqual(detectSourceSignatures(clean), [])
})

function fixtureRoot({ leakDoc } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cdl-'))
  const refs = join(root, 'skills/novel-style-reference/references')
  const extracts = join(refs, 'corpus/extracts')
  mkdirSync(extracts, { recursive: true })
  writeFileSync(
    join(extracts, 'WK-001-extracts.json'),
    JSON.stringify({ work_id: 'WK-001', extracts: [{ id: 'WK-001-001', paragraph: 'x', annotation: 'y', technique: ['对话设计'] }] }),
  )
  writeFileSync(join(refs, 'corpus/index.json'), JSON.stringify({ meta: { total_works: 1 }, works: [{ id: 'WK-001' }] }))
  // SKILL.md 在 skill 根（references 之上）——护栏须覆盖它
  writeFileSync(join(root, 'skills/novel-style-reference/SKILL.md'), '---\nname: x\n---\n按手法+情感检索。\n')
  if (leakDoc) writeFileSync(join(refs, leakDoc.name), leakDoc.body)
  return root
}

test('lintCorpusDeid 干净 fixture 通过', () => {
  const root = fixtureRoot()
  const r = lintCorpusDeid(root)
  rmSync(root, { recursive: true, force: true })
  assert.equal(r.ok, true)
})

test('lintCorpusDeid 抓到 references 下渗入书名/路径的研究文档', () => {
  const root = fixtureRoot({
    leakDoc: { name: 'leak.md', body: '## 高价值语料\n- 某书 — 作者：某某\n  文件: 某目录/某书.txt\n' },
  })
  const r = lintCorpusDeid(root)
  rmSync(root, { recursive: true, force: true })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('leak.md')))
})

test('lintCorpusDeid 不误扫 corpus/ 子目录(已由 extracts/index/query 专项检测)', () => {
  const root = fixtureRoot()
  // 在 corpus/ 内放一个含 .txt 字样的维护文档，不应被 skill 文档扫描重复命中
  writeFileSync(
    join(root, 'skills/novel-style-reference/references/corpus/README.md'),
    '入库标准：原始 .txt 语料只存 gitignore 私有台账。\n',
  )
  const r = lintCorpusDeid(root)
  rmSync(root, { recursive: true, force: true })
  assert.equal(r.ok, true)
})

// main-guard 回归：脚本路径含空格时，import.meta.url(已 %20 转义) 不可与裸 file://+argv[1] 字面比较，
// 否则 CLI 分支静默不执行、exit 0——护栏失效却无声。spawn 真脚本验证它确实跑了 lint。
test('main-guard 在带空格路径下仍执行 lint（spawn 回归）', () => {
  // realpathSync 消除 macOS /var→/private/var 软链：否则 node 会 realpath import.meta.url，
  // 与未规整的 argv[1] 路径前缀不一致，干扰对「空格」维度的纯粹验证。
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cdl with space-')))
  const scriptsDir = join(root, 'scripts')
  const extracts = join(root, 'skills/novel-style-reference/references/corpus/extracts')
  mkdirSync(scriptsDir, { recursive: true })
  mkdirSync(extracts, { recursive: true })
  writeFileSync(
    join(extracts, 'WK-001-extracts.json'),
    JSON.stringify({ work_id: 'WK-001', extracts: [{ id: 'WK-001-001', paragraph: 'x', annotation: 'y', technique: ['对话设计'] }] }),
  )
  writeFileSync(join(root, 'skills/novel-style-reference/references/corpus/index.json'), JSON.stringify({ meta: {}, works: [{ id: 'WK-001' }] }))
  writeFileSync(join(root, 'skills/novel-style-reference/SKILL.md'), '---\nname: x\n---\n壳\n')
  copyFileSync(fileURLToPath(new URL('./corpus-deid-lint.mjs', import.meta.url)), join(scriptsDir, 'corpus-deid-lint.mjs'))

  const r = spawnSync(process.execPath, [join(scriptsDir, 'corpus-deid-lint.mjs')], { encoding: 'utf8' })
  rmSync(root, { recursive: true, force: true })

  // 干净 fixture：main-guard 触发 → exit 0 且输出成功标志；坏 guard 会静默无输出（断言失败）。
  assert.equal(r.status, 0)
  assert.match(r.stdout, /corpus-deid-lint/)
})
