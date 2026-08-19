import { describe, expect, test } from 'bun:test'
import { assertWindowsSigningIdentity, listCodeSigningThumbprints } from './check-windows-signing-identity.mjs'

const FAKE_CERT_OUTPUT = ['A1B2C3D4E5F60718293A4B5C6D7E8F9012345678', '9876543210FEDCBA9876543210FEDCBA9876543210', ''].join('\n')

describe('Windows Authenticode 签名身份闸', () => {
  test('env 指定指纹时直接放行（CI 无交互场景），不查证书存储', () => {
    const exec = () => {
      throw new Error('不应调用 exec：env 指纹已够')
    }
    const identities = assertWindowsSigningIdentity({ exec, env: { NARRACAT_WINDOWS_SIGNING_THUMBPRINT: 'A1B2' } })
    expect(identities).toEqual([{ thumbprint: 'A1B2', source: 'env' }])
  })

  test('无 env 指纹时查证书存储，列出所有带私钥证书', () => {
    const exec = () => FAKE_CERT_OUTPUT
    expect(listCodeSigningThumbprints({ exec })).toEqual([
      'A1B2C3D4E5F60718293A4B5C6D7E8F9012345678',
      '9876543210FEDCBA9876543210FEDCBA9876543210',
    ])
    expect(assertWindowsSigningIdentity({ exec, env: {} })).toHaveLength(2)
  })

  test('证书存储为空时 fail-loud，附办证指引', () => {
    const exec = () => ''
    expect(() => assertWindowsSigningIdentity({ exec, env: {} })).toThrow(/SmartScreen|证书/)
  })

  test('空白 env 指纹等同缺失，回落证书存储', () => {
    const exec = () => FAKE_CERT_OUTPUT
    expect(assertWindowsSigningIdentity({ exec, env: { NARRACAT_WINDOWS_SIGNING_THUMBPRINT: '   ' } })).toHaveLength(2)
  })
})
