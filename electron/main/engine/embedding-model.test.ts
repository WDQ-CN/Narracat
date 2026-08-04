import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  PACKAGED_EMBEDDING_MODEL_DIR,
  describeEmbeddingModelSource,
  resolveEmbeddingModelPath,
} from './embedding-model'

const WEIGHT_REL = join('Xenova', 'bge-base-zh-v1.5', 'onnx', 'model_quantized.onnx')
const weightAt = (root: string) => (candidate: string) => candidate === join(root, WEIGHT_REL)

describe('embedding model path resolution', () => {
  test('未打包模型时返回 undefined（回退按需下载）', () => {
    expect(
      resolveEmbeddingModelPath({ appRoot: '/app', resourcesPath: '/res', fileExists: () => false }),
    ).toBeUndefined()
  })

  test('打包态优先客户端内置资源目录', () => {
    const resourcesPath = '/res'
    const appRoot = join(resourcesPath, 'app.asar')
    const packagedRoot = join(resourcesPath, PACKAGED_EMBEDDING_MODEL_DIR)
    expect(
      resolveEmbeddingModelPath({ appRoot, resourcesPath, fileExists: weightAt(packagedRoot) }),
    ).toBe(packagedRoot)
  })

  test('开发态命中 build/embedding-model', () => {
    const appRoot = '/repo'
    const devRoot = join(appRoot, 'build', 'embedding-model')
    expect(
      resolveEmbeddingModelPath({ appRoot, resourcesPath: undefined, fileExists: weightAt(devRoot) }),
    ).toBe(devRoot)
  })

  test('权重缺失（仅目录在）仍判为未就绪', () => {
    const appRoot = '/repo'
    const devRoot = join(appRoot, 'build', 'embedding-model')
    // 目录存在但权重文件不在 → 不返回该路径
    expect(
      resolveEmbeddingModelPath({ appRoot, resourcesPath: undefined, fileExists: (c) => c === devRoot }),
    ).toBeUndefined()
  })
})

describe('embedding model source classification', () => {
  test('命中权重 → bundled-offline，含解析路径与候选', () => {
    const resourcesPath = '/res'
    const appRoot = join(resourcesPath, 'app.asar')
    const packagedRoot = join(resourcesPath, PACKAGED_EMBEDDING_MODEL_DIR)
    const source = describeEmbeddingModelSource({ appRoot, resourcesPath, fileExists: weightAt(packagedRoot) })
    expect(source.kind).toBe('bundled-offline')
    expect(source.modelPath).toBe(packagedRoot)
    expect(source.candidates).toContain(packagedRoot)
  })

  test('打包态缺权重 → missing，仍暴露已检查候选路径', () => {
    const resourcesPath = '/res'
    const appRoot = join(resourcesPath, 'app.asar')
    const source = describeEmbeddingModelSource({ appRoot, resourcesPath, fileExists: () => false })
    expect(source.kind).toBe('missing')
    expect(source.modelPath).toBeUndefined()
    expect(source.candidates.length).toBeGreaterThan(0)
  })

  test('开发态缺权重 → on-demand-download（回退按需下载）', () => {
    const source = describeEmbeddingModelSource({ appRoot: '/repo', resourcesPath: undefined, fileExists: () => false })
    expect(source.kind).toBe('on-demand-download')
    expect(source.modelPath).toBeUndefined()
  })
})
