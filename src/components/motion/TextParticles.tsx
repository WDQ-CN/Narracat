/* eslint-disable @typescript-eslint/no-explicit-any */
// 基于 React Bits «Particles»（ogl）的运动（3D 球内漂浮 + 旋转），但把圆点换成中文字符：
// 用字符 atlas 纹理，每个 POINT 按 charIndex 采样对应汉字。营造“一百万字”意象。
import { useEffect, useRef } from 'react'
import { Camera, Geometry, Mesh, Program, Renderer, Texture } from 'ogl'
import { cn } from '@/lib/cn'

const GLYPHS = Array.from(
  '故事人间风云山海剑心魂梦字章节伏笔情仇生死爱恨悲欢离合江湖庙堂少年红颜白发苍生天地玄黄星辰大海笔墨春秋花月刀光剑影侠骨柔肠恩怨情长岁月山河朝暮诗书礼乐忠义仁勇生灵万象',
)

const BRAND_RGB: [number, number, number] = [0.016, 0.784, 0.325]
const MUTED_RGB: [number, number, number] = [0.54, 0.54, 0.58]

function buildGlyphAtlas() {
  const cell = 64
  const cols = Math.ceil(Math.sqrt(GLYPHS.length))
  const rows = Math.ceil(GLYPHS.length / cols)
  const canvas = document.createElement('canvas')
  canvas.width = cols * cell
  canvas.height = rows * cell
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#ffffff'
  ctx.font = `${Math.floor(cell * 0.78)}px "MiSans", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  GLYPHS.forEach((ch, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    ctx.fillText(ch, col * cell + cell / 2, row * cell + cell / 2)
  })
  return { canvas, cols, rows }
}

const vertex = /* glsl */ `
  attribute vec3 position;
  attribute vec4 random;
  attribute vec3 color;
  attribute float charIndex;

  uniform mat4 modelMatrix;
  uniform mat4 viewMatrix;
  uniform mat4 projectionMatrix;
  uniform float uTime;
  uniform float uSpread;
  uniform float uBaseSize;
  uniform float uSizeRandomness;

  varying vec3 vColor;
  varying float vCharIndex;
  varying float vAlpha;

  void main() {
    vColor = color;
    vCharIndex = charIndex;

    vec3 pos = position * uSpread;
    pos.z *= 10.0;

    vec4 mPos = modelMatrix * vec4(pos, 1.0);
    float t = uTime;
    mPos.x += sin(t * random.z + 6.28 * random.w) * mix(0.1, 1.5, random.x);
    mPos.y += sin(t * random.y + 6.28 * random.x) * mix(0.1, 1.5, random.w);
    mPos.z += sin(t * random.w + 6.28 * random.y) * mix(0.1, 1.5, random.z);

    vec4 mvPos = viewMatrix * mPos;
    gl_PointSize = (uBaseSize * (1.0 + uSizeRandomness * (random.x - 0.5))) / length(mvPos.xyz);
    vAlpha = 0.35 + 0.55 * random.y;
    gl_Position = projectionMatrix * mvPos;
  }
`

const fragment = /* glsl */ `
  precision highp float;

  uniform sampler2D uAtlas;
  uniform float uCols;
  uniform float uRows;

  varying vec3 vColor;
  varying float vCharIndex;
  varying float vAlpha;

  void main() {
    float col = mod(vCharIndex, uCols);
    float row = floor(vCharIndex / uCols);
    vec2 cell = vec2(1.0 / uCols, 1.0 / uRows);
    vec2 uv = (vec2(col, row) + gl_PointCoord) * cell;
    vec4 tex = texture2D(uAtlas, uv);
    if (tex.a < 0.06) discard;
    gl_FragColor = vec4(vColor, tex.a * vAlpha);
  }
`

export interface TextParticlesProps {
  /** 字符粒子数 */
  count?: number
  /** 字号基准（越大字越大） */
  baseSize?: number
  /** 分布范围 */
  spread?: number
  /** 漂浮速度 */
  speed?: number
  /** 字号随机度 */
  sizeRandomness?: number
  /** 品牌绿字符占比（其余中性灰） */
  brandRatio?: number
  cameraDistance?: number
  disableRotation?: boolean
  className?: string
}

export function TextParticles({
  count = 220,
  baseSize = 900,
  spread = 11,
  speed = 0.12,
  sizeRandomness = 1,
  brandRatio = 0.4,
  cameraDistance = 20,
  disableRotation = false,
  className,
}: TextParticlesProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const renderer = new Renderer({ dpr: Math.min(window.devicePixelRatio || 1, 2), depth: false, alpha: true })
    const gl = renderer.gl
    container.appendChild(gl.canvas)
    gl.clearColor(0, 0, 0, 0)

    const camera = new Camera(gl, { fov: 15 })
    camera.position.set(0, 0, cameraDistance)

    const resize = () => {
      renderer.setSize(container.clientWidth, container.clientHeight)
      camera.perspective({ aspect: gl.canvas.width / gl.canvas.height })
    }
    window.addEventListener('resize', resize, false)
    resize()

    const { canvas: atlasCanvas, cols, rows } = buildGlyphAtlas()
    const atlas: any = new Texture(gl, {
      image: atlasCanvas,
      generateMipmaps: false,
      flipY: false,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR,
    })

    const positions = new Float32Array(count * 3)
    const randoms = new Float32Array(count * 4)
    const colors = new Float32Array(count * 3)
    const charIndices = new Float32Array(count)

    for (let i = 0; i < count; i++) {
      let x: number, y: number, z: number, len: number
      do {
        x = Math.random() * 2 - 1
        y = Math.random() * 2 - 1
        z = Math.random() * 2 - 1
        len = x * x + y * y + z * z
      } while (len > 1 || len === 0)
      const r = Math.cbrt(Math.random())
      positions.set([x * r, y * r, z * r], i * 3)
      randoms.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4)
      const rgb = Math.random() < brandRatio ? BRAND_RGB : MUTED_RGB
      colors.set(rgb, i * 3)
      charIndices[i] = Math.floor(Math.random() * GLYPHS.length)
    }

    const geometry = new Geometry(gl, {
      position: { size: 3, data: positions },
      random: { size: 4, data: randoms },
      color: { size: 3, data: colors },
      charIndex: { size: 1, data: charIndices },
    })

    const program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        uTime: { value: 0 },
        uSpread: { value: spread },
        uBaseSize: { value: baseSize },
        uSizeRandomness: { value: sizeRandomness },
        uAtlas: { value: atlas },
        uCols: { value: cols },
        uRows: { value: rows },
      },
      transparent: true,
      depthTest: false,
    })

    const particles = new Mesh(gl, { mode: gl.POINTS, geometry, program })

    let animationFrameId = 0
    let lastTime = performance.now()
    let elapsed = 0

    const update = (t: number) => {
      animationFrameId = requestAnimationFrame(update)
      if (document.hidden) return
      const delta = t - lastTime
      lastTime = t
      elapsed += delta * speed

      program.uniforms.uTime.value = elapsed * 0.001

      if (!disableRotation) {
        particles.rotation.x = Math.sin(elapsed * 0.0002) * 0.1
        particles.rotation.y = Math.cos(elapsed * 0.0005) * 0.15
        particles.rotation.z += 0.01 * speed
      }

      renderer.render({ scene: particles, camera })
    }
    animationFrameId = requestAnimationFrame(update)

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(animationFrameId)
      if (container.contains(gl.canvas)) container.removeChild(gl.canvas)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [count, baseSize, spread, speed, sizeRandomness, brandRatio, cameraDistance, disableRotation])

  return <div ref={containerRef} className={cn('relative h-full w-full', className)} />
}
