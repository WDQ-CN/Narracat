import { describe, expect, test } from 'bun:test'
import { isManifestPath, resolveUpstreamUrl } from './index.ts'

const BASE = 'https://github.com/pantsbang-yannik/narracat-novel-agent/releases'

describe('resolveUpstreamUrl', () => {
  // 清单不带版本号，必须恒指「最新 release」——这是整套更新的入口。
  test('mac 清单指向 latest', () => {
    expect(resolveUpstreamUrl('/mac-arm64/latest-mac.yml')).toBe(`${BASE}/latest/download/latest-mac.yml`)
  })

  test('带版本号的包指向该版本的 tag', () => {
    expect(resolveUpstreamUrl('/mac-arm64/NarraCat-0.1.1880-mac-arm64.zip')).toBe(
      `${BASE}/download/v0.1.1880/NarraCat-0.1.1880-mac-arm64.zip`,
    )
  })

  test('blockmap 同样按版本号解析', () => {
    expect(resolveUpstreamUrl('/mac-arm64/NarraCat-0.1.1880-mac-arm64.zip.blockmap')).toBe(
      `${BASE}/download/v0.1.1880/NarraCat-0.1.1880-mac-arm64.zip.blockmap`,
    )
  })

  test('dmg 同样按版本号解析', () => {
    expect(resolveUpstreamUrl('/mac-arm64/NarraCat-0.1.1880-mac-arm64.dmg')).toBe(
      `${BASE}/download/v0.1.1880/NarraCat-0.1.1880-mac-arm64.dmg`,
    )
  })

  test('Windows 平台目录已预留可用', () => {
    expect(resolveUpstreamUrl('/win-x64/latest.yml')).toBe(`${BASE}/latest/download/latest.yml`)
  })

  // 下面都是必须拒绝的：Worker 是公网入口，不能被当成任意 URL 的转发器。
  test('未知平台目录拒绝', () => {
    expect(resolveUpstreamUrl('/linux-x64/latest.yml')).toBeNull()
  })

  test('路径穿越拒绝', () => {
    expect(resolveUpstreamUrl('/mac-arm64/../../etc/passwd')).toBeNull()
    expect(resolveUpstreamUrl('/mac-arm64/..%2Fsecret')).toBeNull()
    // 变异测试证实：以上两条、以及看起来像是「2 段 + 含 ..」的 '/mac-arm64/..'，
    // 全都先被别的检查拦下（前者段数 !== 2，后者文件名 '..' 本就不匹配
    // ASSET_NAME_PATTERN），根本走不到 `..` 检查这一行——删掉该行这些用例仍然
    // 全绿。真正命中该分支需要一个「文件名本身匹配 NarraCat 产物命名、但内部
    // 又含连续两个点」的路径：ASSET_NAME_PATTERN 的扩展名部分 [a-z0-9.]+ 本身
    // 允许出现点号，所以 'NarraCat-1.2.3-mac-arm64..zip' 能通过命名格式校验，
    // 全靠 `..` 检查单独拦截。删掉该行会让这一条真正变红。
    expect(resolveUpstreamUrl('/mac-arm64/NarraCat-1.2.3-mac-arm64..zip')).toBeNull()
  })

  test('层级不对的路径拒绝', () => {
    expect(resolveUpstreamUrl('/')).toBeNull()
    expect(resolveUpstreamUrl('/mac-arm64')).toBeNull()
    expect(resolveUpstreamUrl('/mac-arm64/sub/dir/file.zip')).toBeNull()
  })

  test('文件名不符合产物命名的拒绝', () => {
    expect(resolveUpstreamUrl('/mac-arm64/random.txt')).toBeNull()
    expect(resolveUpstreamUrl('/mac-arm64/NarraCat-notaversion-mac-arm64.zip')).toBeNull()
  })
})

describe('isManifestPath', () => {
  test('清单要认出来（它决定缓存策略）', () => {
    expect(isManifestPath('/mac-arm64/latest-mac.yml')).toBe(true)
    expect(isManifestPath('/win-x64/latest.yml')).toBe(true)
  })

  test('包不是清单', () => {
    expect(isManifestPath('/mac-arm64/NarraCat-0.1.1880-mac-arm64.zip')).toBe(false)
  })
})
