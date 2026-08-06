import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import type { ForceGraphMethods, NodeObject } from 'react-force-graph-3d'
import { RotateCcw } from 'lucide-react'
import SpriteText from 'three-spritetext'
import { IconTooltip } from '@/components/ui/icon-tooltip'
import {
  CanvasTexture,
  Color,
  Group,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Object3D,
} from 'three'
import type { MemoryGraphSnapshot } from '@shared/types/memory-graph'
import {
  buildVisibleGraph,
  isCategoryNodeId,
  isOnFocusChain,
  type CanvasLink,
  type CanvasNode,
} from '@/lib/memory-graph-layers'

/**
 * 记忆星图 3D 画布（只读展示层）。本文件是全 App 唯一引入 three.js 的地方，只由
 * MemoryGraphView 经动态 import() 载入——保证 three.js 走独立 chunk，不进主 bundle、
 * 不拖慢启动。
 *
 * 分层展开：默认只画角色星座（角色节点 + 关系连线）；点击某个角色，它的事实作为星尘
 * 展开环绕，同时镜头飞向它——3D 里节点会前后遮挡、深度不可感，靠"悬浮即放大 + 点击即
 * 飞向"两个手段把点选与迷路问题按住。再点空白处收起回全景。
 *
 * 性能纪律（真机实测"打开星图后整个客户端都变卡"后定的）：库的渲染循环每帧无条件重绘、
 * 没有脏检查，所以本组件自己做按需渲染——静止即 pauseAnimation()，用户一动即恢复；
 * 并把渲染像素比压到 MAX_PIXEL_RATIO。曾经的待机自转已删除：它让渲染永远停不下来，
 * 与按需渲染直接冲突，而 Electron 的 GPU 进程是全应用共用的，一个不肯停的 3D 画布
 * 会把整个客户端拖卡。
 */

/**
 * 配色纪律：**大面积灰 + 极少量强调色**。
 *
 * 全场默认是同一档灰——星图的信息量在"点与线连成的形状"，不在每颗星什么颜色。只有
 * 用户当前点开的那个角色和它的事实才上色，于是视线自动落到那一簇上；一进来就 12 种
 * 谓词 12 种亮色，等于把重点平摊到没有重点。
 */
const IDLE_CHARACTER_COLOR = '#7c879b'
const IDLE_FACT_COLOR = '#4d5769'
/** 被点开的角色本身：接近白，是全场唯一的最亮点。 */
const FOCUS_CHARACTER_COLOR = '#eaf0fb'

/** 展开后事实星尘的强调色，按谓词区分——只在这一簇里出现，故仍然读得出层次。 */
const PREDICATE_COLORS: Record<string, string> = {
  secret: '#b98cf0',
  relationship: '#e0b062',
  goal: '#5aa8e0',
  identity: '#93c46b',
  location: '#4fb3c4',
  possession: '#8d97a8',
  injury: '#e07f8e',
  ability: '#4fbcae',
  status: '#6b9fdd',
  reputation: '#d381a8',
  oath: '#d9bb5e',
  debt: '#dc9463',
}
const FALLBACK_FACT_COLOR = '#6b7789'
/**
 * 无操作多久后**停掉渲染循环**（毫秒）。
 *
 * 这是本组件最重要的性能开关。库的 tick 每帧无条件 `renderer.render()`，没有任何脏检查
 * （three-render-objects.mjs:266）——画面完全静止时也照样 60fps 烧 GPU。在 Electron 里
 * 这会连累整个应用的合成，表现为"打开星图后整个客户端都变卡"。
 *
 * 所以：静止一段时间就 pauseAnimation()，用户一动（指针/滚轮/点击）立刻 resumeAnimation()。
 * 代价是暂停期间悬浮高亮不更新——但触发恢复的正是指针移动本身，所以用户感知不到。
 */
const IDLE_PAUSE_MS = 2200

/**
 * 渲染像素比上限。库默认 `Math.min(2, devicePixelRatio)`（three-render-objects.mjs:585），
 * 在 Retina 上就是 2 —— 满宽画布按 4 倍像素量渲染，是 GPU 开销的绝对大头。降到 1.5 能省
 * 掉约四成片元工作，点线图对分辨率又不像照片那么敏感。嫌糊就把这个数调回 2。
 */
const MAX_PIXEL_RATIO = 1.5

/**
 * ⚠️ nodeVal 是「体积」不是「半径」——三方库源码 three-forcegraph.mjs:1157
 * `var radius = Math.cbrt(val) * state.nodeRelSize;`（其 props 定义处原话注释：volume per val unit）。
 * 所以想让半径变成 k 倍，nodeVal 要乘 k³，不是乘 k。下面的常量全部按「先定半径、再换算体积」写，
 * 改数值时请沿用这个方向，别直接把倍率写进 nodeVal。
 */
const NODE_REL_SIZE = 4
/**
 * 事实星尘的 nodeVal（体积）→ 半径 cbrt(0.25)*4 ≈ 2.52，约为「零事实角色」半径 5.77 的四成多。
 * 星尘必须明显小于角色星球，展开后才分得清谁是人、谁是挂在人身上的事——恒定 1.6 时半径 4.68，
 * 跟配角星球几乎一样大，一片糊。
 */
const FACT_NODE_VAL = 0.25

/**
 * 圆点精灵的边长 = 星球直径 × 此系数。
 *
 * 这块方片同时是**射线拾取的命中区**（three 的 Sprite.raycast 按整片算，不看贴图透明度），
 * 所以系数只比 1 略大：贴图边缘那圈抗锯齿之外不留多余空白，命中区就贴着可见的圆点。
 */
const DOT_QUAD_FACTOR = 1.12
/** 悬浮时放大到几倍（作用在精灵缩放上，不走库的 nodeVal 重建几何）。 */
const HOVER_GLOW_SCALE = 1.45
/** 悬浮缩放每帧向目标逼近的比例，越大越快。0.18 ≈ 4 帧走完大半，跟手但不生硬。 */
const HOVER_LERP_RATE = 0.18
/** 角色标签只给"有分量"的角色常驻，其余靠悬浮/点开时临时显形——参考图里灰点都是不带字的。 */
const LABEL_MIN_FACTS = 3

/**
 * 不在当前链路上的节点压到多暗。
 *
 * 还得看得见、点得中（用户要能直接跳去另一个角色），所以不是隐藏而是压暗。
 *
 * ⚠️ 这个值与材质的 alphaTest 是联动的：alphaTest 比较的是**贴图 alpha × 材质 opacity**
 * 的最终值，一旦 DIM_OPACITY 低于 alphaTest，整个圆点会被全部丢弃、直接消失。所以
 * alphaTest 必须显著小于这里（见 DOT_ALPHA_TEST）。
 */
const DIM_OPACITY = 0.26
/**
 * 圆点材质的 alphaTest。作用是丢弃圆外的全透明区，让精灵可以照常写深度（点与点、
 * 点与线之间才有正确遮挡）。取值必须 < DIM_OPACITY，否则压暗的节点会整个消失。
 */
const DOT_ALPHA_TEST = 0.06
/** 透明度每帧向目标逼近的比例，和悬浮放大同一档手感。 */
const DIM_LERP_RATE = 0.16

/**
 * 点开角色后镜头「持续跟随」而不是一次性飞过去，因为目标一直在动。
 *
 * 点击角色会展开它的事实星尘 → graphData 变 → 力导向模拟重新起爆 → 全场节点持续移动
 * 数秒。原来的做法是按点击那一刻的坐标发一个 1200ms 的一次性镜头动画，等镜头飞到时
 * 那颗星早已漂走，于是"没有正确居中"。切换角色时最明显：收起旧星尘 + 展开新星尘引发的
 * 重排幅度更大。
 *
 * 所以改成每帧朝节点的**实时坐标**逼近，直到模拟冷却且镜头到位（或超时兜底）。
 */
const FOCUS_LERP_RATE = 0.12
/** 跟随的兜底时限：模拟迟迟不停也不能一直劫持镜头。 */
const FOCUS_MAX_MS = 6000
/** 跟随时保留用户当前的观察距离，但夹在这个区间里，保证目标既不贴脸也不成小点。 */
const FOCUS_DISTANCE_MIN = 70
const FOCUS_DISTANCE_MAX = 260
/** 镜头与注视点重合（拿不到方向）时的兜底距离。 */
const FOCUS_DISTANCE_FALLBACK = 140

/**
 * 节点贴图：**扁平实心圆点**，只在最外圈留一到两像素抗锯齿。
 *
 * 库默认节点是 `SphereGeometry` + `MeshLambertMaterial`（three-forcegraph.mjs:1），受灯光
 * 做兰伯特着色，暗底上是一颗有明暗面的塑料球；而加法混色的辉光又是另一个极端——糊、亮、
 * 廉价。参考图那种"高级"来自克制：纯黑底 + 扁平圆点 + 细线，靠疏密和形状说话，不靠发光。
 *
 * 贴图只建一次、全场共用（材质各自 new，只为染色）：每个节点一张 canvas 贴图会在展开
 * 主角（真机 167 条事实）时一次上传近两百张纹理。
 */
let dotTexture: CanvasTexture | null = null
function sharedDotTexture(): CanvasTexture {
  if (dotTexture) return dotTexture
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const half = size / 2
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    // 留 1px 余量，让圆周落在画布内、边缘的抗锯齿不被裁掉
    ctx.arc(half, half, half - 1, 0, Math.PI * 2)
    ctx.fill()
  }
  dotTexture = new CanvasTexture(canvas)
  return dotTexture
}

/** 画布内实际流转的节点：库在 CanvasNode 之上叠加运行时坐标字段。 */
type GraphNode = NodeObject<CanvasNode>
/** 连线在本文件里的具体形态：source/target 会被库改写成 GraphNode 引用。 */
type GraphLink = CanvasLink<GraphNode>

/**
 * 节点颜色随「当前点开了谁」变化：全场默认灰，只有被点开的角色与它的事实上色。
 * expandedId 为空（全景态）时，连事实都还没出现，整张图是纯灰的点线网。
 */
function predicateColor(predicate: string | null): string {
  return (predicate ? PREDICATE_COLORS[predicate] : undefined) ?? FALLBACK_FACT_COLOR
}

/**
 * 节点颜色随「当前展开到哪一层」变化：全场默认灰，只有被点开的那条路径上色。
 * 分簇与事实都按谓词着色，于是"哪一类"在颜色上一眼可辨。
 */
function nodeColorOf(node: CanvasNode, expandedId: string | null): string {
  if (node.kind === 'character') {
    return node.id === expandedId ? FOCUS_CHARACTER_COLOR : IDLE_CHARACTER_COLOR
  }
  // 分簇与事实只在它们所属的角色被展开时才出现，出现即是焦点路径，直接上谓词色
  if (node.ownerId !== expandedId && node.kind === 'fact') return IDLE_FACT_COLOR
  return predicateColor(node.predicate)
}

/**
 * 星点体积。三档尺寸要拉开，才看得出层级：角色最大、分簇居中、事实最小。
 * 都按数量做开方压缩，避免主角/大类把其它挤没。
 */
function nodeVolume(node: CanvasNode): number {
  if (node.kind === 'character') return 3 + Math.sqrt(node.factCount) * 1.4
  if (node.kind === 'category') return 0.9 + Math.sqrt(node.factCount) * 0.5
  return FACT_NODE_VAL
}

/** 库最终画出的球半径——挂常驻文字标签时要按它算偏移，否则标签会插进星球里。 */
function nodeRadius(node: CanvasNode): number {
  return Math.cbrt(nodeVolume(node)) * NODE_REL_SIZE
}

/**
 * tooltip 文本经 float-tooltip 的 `.html()`（= innerHTML，见 float-tooltip.mjs:218）注入 DOM，
 * 不是 textContent。事实正文里一个 `<` 就够把后面的字吞成标签；更要紧的是这些文本是 LLM 写进
 * memory.db 的内容，不转义等于给模型输出开了一条进 renderer DOM 的路。
 */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 取连线一端的节点 id。传进库时这两端是 id 字符串，**库会在运行时把它们原地改写成
 * 节点对象引用**，所以两种形态都要认；认不出就返回空串（判定按"不在链路上"处理）。
 */
function linkEndId(end: GraphLink['source']): string {
  if (typeof end === 'string') return end
  if (end && typeof end === 'object' && 'id' in end) {
    const id = (end as { id?: unknown }).id
    return typeof id === 'string' ? id : ''
  }
  return ''
}

/**
 * 连线是否在当前链路上。
 *
 * - 全景态：无链路概念，全部算在内。
 * - 关系线：两端只要有一端是被展开的角色就算——用户在看这个角色时，它与谁有关系正是
 *   要保留的上下文；两个陌生角色之间的线才该退到背景里。
 * - 归属线：只有连着链路内节点的才算（角色→当前分簇、当前分簇→它的事实）。
 */
function isLinkOnFocusChain(
  link: GraphLink,
  expandedId: string | null,
  expandedCategoryId: string | null,
): boolean {
  if (!expandedId) return true
  const source = linkEndId(link.source)
  const target = linkEndId(link.target)
  if (link.kind === 'relationship') return source === expandedId || target === expandedId
  // 归属线：分簇档是「角色→分簇」，事实档还多一层「分簇→事实」
  if (source === expandedId) return !expandedCategoryId || target === expandedCategoryId
  return source === expandedCategoryId
}

function nodeTooltip(node: CanvasNode): string {
  if (node.kind === 'character') return `${escapeHtml(node.label)}（${node.factCount} 条记忆）`
  if (node.kind === 'category') return `${escapeHtml(node.label)}（${node.factCount} 条）`
  const chapter = node.chapter ? ` · 第 ${node.chapter} 章` : ''
  return `${escapeHtml(node.predicateLabel ?? '')}：${escapeHtml(node.label)}${chapter}`
}

export function MemoryGraphCanvas({
  graph,
  projectPath,
}: {
  graph: MemoryGraphSnapshot
  /** 用于判断「是否换了一本书」——换书才该丢弃已收敛的星座坐标，见 nodeCacheRef。 */
  projectPath: string
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const graphRef = useRef<ForceGraphMethods<CanvasNode> | undefined>(undefined)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [expandedId, setExpandedId] = useState<string | null>(null)
  /** 第三档：被点开的那个分簇（id 形如 cat:<角色>:<谓词>）；null = 停在类别这一层。 */
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null)
  /** 被点开、正在展示卡片的节点。存节点对象本身而非 id：库把实时坐标写在这个对象上，卡片要跟着它走。 */
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const lastInteractionRef = useRef(0)
  const isDraggingRef = useRef(false)
  /**
   * 悬浮态只进 ref、不进 state：悬浮放大改由本组件按帧插值精灵缩放来做，React 完全不必
   * 重渲染。这一步顺带拆掉了原来的陷阱——过去放大靠"改 nodeVal → 库重跑 digest 重建几何"，
   * 既是瞬跳（无过渡，手感生硬），又逼得 nodeVal 必须依赖 hoveredId 才生效。
   */
  const hoveredIdRef = useRef<string | null>(null)
  /** id → 该节点的三维对象与动画状态，供每帧插值与卡片定位取用。 */
  const nodeObjectsRef = useRef(
    new Map<
      string,
      {
        group: Group
        glow: Sprite
        label: SpriteText | null
        baseScale: number
        scale: number
        /** 当前已写进材质的颜色，用来跳过重复写入——Color.set(字符串) 每次都要解析一遍 CSS 颜色。 */
        colorHex: string
        /** 当前透明度（链路外的节点压暗），每帧向目标插值。 */
        opacity: number
      }
    >(),
  )
  const cardRef = useRef<HTMLDivElement | null>(null)
  /** selected 的 ref 镜像：每帧循环只挂载一次，闭包里读 state 会永远拿到挂载那刻的旧值。 */
  const selectedRef = useRef<GraphNode | null>(null)
  selectedRef.current = selected
  /** 同理：每帧循环要按"当前点开了谁"决定配色与标签显隐，闭包读 state 会拿到旧值。 */
  const expandedRef = useRef<string | null>(null)
  expandedRef.current = expandedId
  const expandedCategoryRef = useRef<string | null>(null)
  expandedCategoryRef.current = expandedCategoryId
  /** id → 节点数据，供每帧循环取 predicate/factCount 算颜色与标签；三维对象上不带这些字段。 */
  const nodeByIdRef = useRef(new Map<string, CanvasNode>())

  /** 正在跟随的节点（点开某角色后镜头持续朝它的实时坐标逼近）；null = 镜头交还给用户。 */
  const focusRef = useRef<{ node: GraphNode; deadline: number } | null>(null)
  const engineStoppedRef = useRef(false)
  const renderingRef = useRef(true)
  const resumeRendering = useCallback(() => {
    lastInteractionRef.current = Date.now()
    if (renderingRef.current) return
    renderingRef.current = true
    graphRef.current?.resumeAnimation()
  }, [])
  const handleEngineStop = useCallback(() => {
    engineStoppedRef.current = true
  }, [])

  // 画布尺寸跟随容器（ForceGraph3D 需要显式宽高）
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) setSize({ width: rect.width, height: rect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // 节点对象缓存：按 id 跨渲染复用同一个对象引用。3d-force-graph 会把收敛后的 x/y/z
  // 坐标原地写回传入的节点对象；如果每次因 expandedId 切换重算都 {...node} 出全新对象，
  // 库会把它们当成从未定位过的新节点，在原地随机撒开重新起爆模拟——观感是点一下角色，
  // 全景所有星球被炸散重新弹开。展开/收起时对已见过的 id 复用缓存里那份"已经被库写过
  // 坐标"的对象，新出现的事实星尘才建新对象（新对象获得随机初始位置正是"星尘展开"动画
  // 想要的效果，不是 bug）。
  //
  // graph 引用变化时**按 id 增量维护、不整体清空**：星图现在会跟着 Agent 跑完自动重拉
  // （见 MemoryGraphView 的 reloadKey），每次 refetch 都拿到全新的 DTO 数组。若那时清空缓存，
  // 用户每写完一章就会眼看着整张星图炸开重排一次——刷新是"长出新星"，不是"重新创世"。
  // 所以：老 id 保住坐标只就地刷新数据字段（DTO 字段与库写的 x/y/z/vx/__threeObj 不重名，
  // Object.assign 覆盖不到坐标），消失的 id 淘汰掉，新 id 才建新对象随机入场。
  // 唯一该整体作废的是**换了一本书**——那时旧坐标毫无意义，按 projectPath 判定。
  const nodeCacheRef = useRef(new Map<string, CanvasNode>())
  const cachedGraphRef = useRef<MemoryGraphSnapshot | null>(null)
  const cachedProjectPathRef = useRef(projectPath)

  // 分层展开：默认只给角色星座；展开某角色时并入它的事实星尘与归属连线。
  // 分层展开的取舍与三档语义见 @/lib/memory-graph-layers（纯函数，有单测）。这里只负责
  // 把「跨渲染复用节点对象」这件渲染层的事注入进去。
  const visible = useMemo(() => {
    if (cachedProjectPathRef.current !== projectPath) {
      nodeCacheRef.current = new Map()
      cachedProjectPathRef.current = projectPath
    }
    const cache = nodeCacheRef.current
    if (cachedGraphRef.current !== graph) {
      cachedGraphRef.current = graph
      const liveIds = new Set(graph.nodes.map((node) => node.id))
      for (const id of [...cache.keys()]) {
        // 分簇是合成的、不在 graph.nodes 里，不能拿真实 id 集合去淘汰——否则 Agent 写完
        // 一章重拉数据时，整层分簇的坐标会被清掉、当场炸开重排。它们的存活由 expandedId
        // 决定（换角色时 id 前缀不再匹配，自然不再被渲染），残留在换书时统一清空。
        if (isCategoryNodeId(id)) continue
        if (!liveIds.has(id)) cache.delete(id)
      }
    }

    const built = buildVisibleGraph<GraphNode>({
      graph,
      expandedId,
      expandedCategoryId,
      resolveNode: (node) => {
        const cached = cache.get(node.id)
        // 就地覆盖数据字段（factCount 可能随新章增长），坐标与库的运行时字段原样保留
        if (cached) return Object.assign(cached, node)
        const created = { ...node }
        cache.set(node.id, created)
        return created
      },
    })
    // 每帧循环要按 id 反查节点数据算颜色与标签
    nodeByIdRef.current = built.index
    return { nodes: built.nodes, links: built.links }
  }, [graph, expandedId, expandedCategoryId, projectPath])

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      resumeRendering()

      // 事实星尘：只出卡片，不动镜头也不改展开态。飞向一颗挂在类别下的小星尘会让人
      // 瞬间失去方位（周围全是同族星尘，看不出自己飞到哪了），而它的正文本来就是要读的，
      // 卡片给到就够。
      if (node.kind === 'fact') {
        setSelected((previous) => (previous?.id === node.id ? null : node))
        return
      }

      // 分簇：往下钻一档，摊开这一类的事实；再点是收回这一档（不退到全景）。
      if (node.kind === 'category') {
        if (expandedCategoryId === node.id) {
          setExpandedCategoryId(null)
          setSelected(null)
          return
        }
        setExpandedCategoryId(node.id)
        setSelected(node)
        focusRef.current = { node, deadline: Date.now() + FOCUS_MAX_MS }
        return
      }

      // 再点已展开的角色是「收起」：那是退回全景，不该配一个"飞过去放大"的镜头——
      // 动作与语义相反，用户会以为自己又展开了一次。
      if (expandedId === node.id) {
        setExpandedId(null)
        setExpandedCategoryId(null)
        setSelected(null)
        return
      }
      // 换一个角色：第三档必须一起清掉，否则会残留上一个角色的分簇 id
      setExpandedId(node.id)
      setExpandedCategoryId(null)
      setSelected(node)
      // 交给每帧循环持续跟随这颗星的实时坐标：这里不能算一次坐标就发一次性镜头动画，
      // 因为展开星尘会让模拟重新起爆、目标持续移动（见 FOCUS_LERP_RATE 处的说明）。
      focusRef.current = { node, deadline: Date.now() + FOCUS_MAX_MS }
    },
    [expandedId, expandedCategoryId, resumeRendering],
  )

  /**
   * 回到全景：收起已展开的角色、关掉卡片、把镜头拉到能装下整张图。
   *
   * 3D 里最容易发生的事就是转着转着不知道自己在哪、或者把图转出了画面——有个一键回到
   * 已知状态的出口，比教用户怎么转回去有用得多。
   */
  const handleResetView = useCallback(() => {
    resumeRendering()
    focusRef.current = null
    setExpandedId(null)
    setExpandedCategoryId(null)
    setSelected(null)
    graphRef.current?.zoomToFit(700, 60)
  }, [resumeRendering])

  const handleBackgroundClick = useCallback(() => {
    resumeRendering()
    setExpandedId(null)
    setSelected(null)
  }, [])

  // Esc 关卡片（不收起星尘——两件事分开，按一下只退一层）
  useEffect(() => {
    if (!selected) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selected])

  // 拖拽期间持续续期交互时间戳：onPointerDown 只在按下瞬间刷新一次不够——用户长按环绕
  // 超过 IDLE_SPIN_RESUME_MS 时，若中途不续期，自转会在其仍握着鼠标时抢先把镜头拉去
  // 自转轨迹，与正在响应拖拽的 OrbitControls 争夺镜头。监听挂在 window 而非容器 div，
  // 是因为拖拽经常会滑出画布边界——容器自身的 pointermove 在那种情况下收不到事件；
  // 挂 window 是纯旁路监听（只读时间戳，不 preventDefault/stopPropagation），不会
  // 干扰库内部 OrbitControls 自己的指针事件处理。
  useEffect(() => {
    function refreshWhileDragging() {
      if (isDraggingRef.current) resumeRendering()
    }
    function endDrag() {
      isDraggingRef.current = false
      resumeRendering()
    }
    window.addEventListener('pointermove', refreshWhileDragging)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    return () => {
      window.removeEventListener('pointermove', refreshWhileDragging)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
    }
  }, [])


  // 渲染像素比：库默认在 Retina 上取 2（three-render-objects.mjs:585），满宽画布等于
  // 按 4 倍像素量渲染，是 GPU 开销的绝对大头。setPixelRatio 之后必须重新 setSize 才会
  // 真正换掉绘制缓冲区尺寸（three 的 setPixelRatio 只改内部字段）；updateStyle 传 false，
  // 别动库已经设好的 CSS 尺寸。
  useEffect(() => {
    const controls = graphRef.current
    if (!controls || size.width === 0 || size.height === 0) return
    const renderer = controls.renderer()
    const ratio = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1)
    if (renderer.getPixelRatio() !== ratio) {
      renderer.setPixelRatio(ratio)
      renderer.setSize(size.width, size.height, false)
    }
  }, [size.width, size.height])

  // 按需渲染：静止就停，用户一动就续。
  //
  // 这是"打开星图后整个客户端都变卡"的正解。库的 tick 每帧无条件 renderer.render()，
  // 没有脏检查（three-render-objects.mjs:266），画面完全静止时也在 60fps 烧 GPU；
  // Electron 里 GPU 进程是全应用共用的，于是整个客户端跟着卡。
  //
  // 力导向模拟还没冷却时不能停——那会把布局定格在半途。库自带 cooldownTime 到点会自行
  // 停止模拟，这里用 onEngineStop 记下那一刻。
  useEffect(() => {
    const timer = setInterval(() => {
      const controls = graphRef.current
      if (!controls || !renderingRef.current) return
      if (!engineStoppedRef.current) return
      // 镜头正在跟随目标时不能停渲染，否则动画会定格在半路
      if (focusRef.current) return
      if (Date.now() - lastInteractionRef.current < IDLE_PAUSE_MS) return
      renderingRef.current = false
      controls.pauseAnimation()
    }, 400)
    return () => clearInterval(timer)
  }, [])

  // 布局重启（展开/收起/换书拿到新数据）时模拟会重新起爆，得把冷却标记清掉并恢复渲染，
  // 否则会停在"上一次已冷却"的判断上，把重排过程定格。
  useEffect(() => {
    engineStoppedRef.current = false
    resumeRendering()
  }, [visible, resumeRendering])

  // 每帧循环，干两件事：
  // ① 悬浮放大按帧向目标插值——过去靠改 nodeVal 让库重建几何，是一步瞬跳（生硬），
  //    现在只动精灵的 scale，库完全不参与，过渡连续且零重建开销；
  // ② 把选中节点的世界坐标投影成屏幕坐标，驱动卡片跟着那颗星走。
  //
  // 卡片位置直接写 DOM style 而不进 state：每帧 setState 会让整棵组件树每帧重渲染。
  useEffect(() => {
    let raf = 0
    // 复用同一批向量，避免每帧 new 出一堆临时对象喂给 GC
    const projected = new Vector3()
    const focusGoal = new Vector3()
    const focusDir = new Vector3()
    const focusDesired = new Vector3()
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const controls = graphRef.current
      const entries = nodeObjectsRef.current

      // 悬浮插值 + 标签显隐 + 清理已被库销毁的条目（展开/收起会换掉一批节点对象）。
      // 这些都在这里做而不是靠改 props：改 props 会让库整场重建节点对象，成本比每帧
      // 遍历两百个条目高几个数量级。
      const hoveredId = hoveredIdRef.current
      const nodeById = nodeByIdRef.current
      for (const [id, entry] of entries) {
        if (!entry.group.parent) {
          entries.delete(id)
          continue
        }
        const focused = id === hoveredId
        const target = focused ? HOVER_GLOW_SCALE : 1
        if (Math.abs(entry.scale - target) > 0.001) {
          entry.scale += (target - entry.scale) * HOVER_LERP_RATE
          const d = entry.baseScale * entry.scale
          entry.glow.scale.set(d, d, 1)
        }
        // 悬浮的那颗提亮到近白，其余回到它按"是否被点开"该有的颜色。
        // ⚠️ 只在颜色真变了时才写：Color.set(字符串) 每次都要解析一遍 CSS 颜色，
        // 无脑每帧给两百个节点各解析一次是实打实的主线程开销。
        const node = nodeById.get(id)
        if (node) {
          const nextHex = focused ? FOCUS_CHARACTER_COLOR : nodeColorOf(node, expandedRef.current)
          if (nextHex !== entry.colorHex) {
            entry.glow.material.color.set(nextHex)
            entry.colorHex = nextHex
          }
          if (entry.label) {
            // 分簇标签一律常驻（这一层就八九个节点，类别名与条数正是它要回答的）；
            // 角色标签只给有分量的，其余靠悬浮/展开临时显形
            const labelVisible =
              node.kind === 'category' ||
              focused ||
              id === expandedRef.current ||
              node.factCount >= LABEL_MIN_FACTS
            if (entry.label.visible !== labelVisible) entry.label.visible = labelVisible
          }

          // 链路外压暗：让"当前钻进了哪一支"一眼可见。悬浮的那颗永远保持全亮——
          // 用户正指着它，压暗会让人以为点不中。
          const dimTarget =
            focused || isOnFocusChain(node, expandedRef.current, expandedCategoryRef.current)
              ? 1
              : DIM_OPACITY
          if (Math.abs(entry.opacity - dimTarget) > 0.002) {
            entry.opacity += (dimTarget - entry.opacity) * DIM_LERP_RATE
            entry.glow.material.opacity = entry.opacity
            if (entry.label) entry.label.material.opacity = entry.opacity
          }
        }
      }

      // 镜头跟随：朝目标节点的**实时**坐标逼近，而不是点击那一刻的快照坐标。
      // 保留用户当前的观察方向（只平移、不换视角），比"沿原点射线飞过去"少很多眩晕感；
      // 距离沿用用户自己缩放到的远近，只做区间夹取。
      const focus = focusRef.current
      if (focus && controls) {
        const camera = controls.camera()
        const orbitTarget = (controls.controls() as { target?: Vector3 } | undefined)?.target
        if (orbitTarget) {
          focusGoal.set(focus.node.x ?? 0, focus.node.y ?? 0, focus.node.z ?? 0)
          focusDir.copy(camera.position).sub(orbitTarget)
          let distance = focusDir.length()
          if (distance < 1e-3) {
            // 镜头与注视点重合时方向不可求，给一个兜底方向，否则 normalize 出 NaN
            focusDir.set(0, 0, 1)
            distance = FOCUS_DISTANCE_FALLBACK
          }
          distance = Math.min(FOCUS_DISTANCE_MAX, Math.max(FOCUS_DISTANCE_MIN, distance))
          focusDesired.copy(focusDir).normalize().multiplyScalar(distance).add(focusGoal)
          camera.position.lerp(focusDesired, FOCUS_LERP_RATE)
          orbitTarget.lerp(focusGoal, FOCUS_LERP_RATE)
          const settled =
            camera.position.distanceTo(focusDesired) < 0.5 && orbitTarget.distanceTo(focusGoal) < 0.5
          // 模拟已冷却（节点不再漂）且镜头到位才算跟完；否则等兜底时限
          if ((engineStoppedRef.current && settled) || Date.now() > focus.deadline) {
            focusRef.current = null
          }
        }
      }

      // 卡片跟随
      const card = cardRef.current
      if (!card) return
      const node = selectedRef.current
      const entry = node ? entries.get(node.id) : undefined
      if (!controls || !node || !entry) {
        card.style.opacity = '0'
        card.style.pointerEvents = 'none'
        return
      }
      projected.set(node.x ?? 0, node.y ?? 0, node.z ?? 0).project(controls.camera())
      // ⚠️ 必须自己投影拿 z：库的 graph2ScreenCoords 只返回 {x, y}
      // （three-render-objects.mjs:423-431），节点转到相机背后时投影坐标会翻折，
      // 卡片会跳到画面另一侧的错误位置。NDC z > 1 即在相机背后／远平面外。
      if (projected.z > 1) {
        card.style.opacity = '0'
        card.style.pointerEvents = 'none'
        return
      }
      const x = ((projected.x + 1) * size.width) / 2
      const y = ((1 - projected.y) * size.height) / 2
      // 抬到星球上方：光晕半径随悬浮缩放变化，卡片跟着抬免得压住星
      const lift = (entry.baseScale * entry.scale) / 2 + 10
      card.style.opacity = '1'
      card.style.pointerEvents = 'auto'
      card.style.transform = `translate3d(${x}px, ${y - lift}px, 0) translate(-50%, -100%)`
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [size.width, size.height])

  /**
   * ⚠️ 下面这批 accessor 的记忆化不是可有可无的"顺手优化"，也不能一刀切都记忆化，改前先读：
   *
   * react-kapsule 用**恒等比较**判断 prop 有没有变（react-kapsule.mjs:32
   * `prevPropsRef.current[p] !== props[p]`），内联箭头函数每次 render 都是新引用 → 每次都判为
   * "变了" → 灌进 three-forcegraph 触发 digest。而 three-forcegraph.mjs:1129-1131 里，
   * `nodeThreeObject` / `nodeThreeObjectExtend` 一变就 `state.nodeDataMapper.clear()`
   * ——不是 update，是把全部节点对象销毁重建（含每个角色的 SpriteText：一张 2D canvas + 一次
   * GPU 贴图上传）。真机展开主角是 194 节点 + 167 连线，鼠标每扫过一颗星就整场重建一遍。
   *
   * 所以这批**全部**用 useCallback([]) 钉死引用，一个都不要留成内联箭头。
   *
   * （历史：悬浮放大曾经靠"让 nodeVal 依赖 hoveredId → 引用变 → digest 重跑"实现，于是
   * nodeVal 成了这里唯一不能记忆化的例外，且每次悬浮都要重建几何、放大还是一步瞬跳。
   * 现在放大改由本组件按帧插值精灵 scale 完成，库完全不参与，那个例外与陷阱一并消失了。）
   */
  const nodeLabelAccessor = useCallback((node: CanvasNode) => nodeTooltip(node), [])
  // nodeVal 已与悬浮解绑（放大改由每帧插值精灵缩放实现），但**不能删**：库拿它算连线端点
  // 的收口半径（three-forcegraph.mjs:916-917），删了连线会一路画进星球圆心。
  const nodeValAccessor = useCallback((node: CanvasNode) => nodeVolume(node), [])
  const nodeThreeObjectAccessor = useCallback((node: CanvasNode): Object3D => {
    const diameter = nodeRadius(node) * 2 * DOT_QUAD_FACTOR
    const dot = new Sprite(
      new SpriteMaterial({
        map: sharedDotTexture(),
        color: new Color(IDLE_CHARACTER_COLOR),
        transparent: true,
        // alphaTest 把圆外的全透明区直接丢弃，于是可以照常写深度：圆点之间、圆点与连线之间
        // 都按真实前后关系遮挡（参考图里点是实心、压住线的）。纯 transparent 不写深度要靠
        // 渲染器排序，近两百个精灵时排序开销与穿插错误都躲不掉。
        depthWrite: true,
        alphaTest: DOT_ALPHA_TEST,
      }),
    )
    dot.scale.set(diameter, diameter, 1)

    const group = new Group()
    group.add(dot)

    // 标签给角色与分簇，不给事实。
    // - 角色：默认只常驻在"有分量"的那些上——参考图里成片的灰点都是不带字的，27 个角色
    //   全挂名字会把画面糊满；其余的名字在悬浮/点开时由每帧循环临时显形。
    // - 分簇：一律常驻并带条数（「秘密 12」）。这一层总共才八九个节点，而"哪一类、有多少"
    //   正是这层唯一要回答的问题，藏进 tooltip 等于白分了这一层。
    // - 事实：不挂。摊开的一类可能有几十条，标签会叠成一片糊，正文走卡片与 tooltip。
    let label: SpriteText | null = null
    if (node.kind === 'character' || node.kind === 'category') {
      const isCategory = node.kind === 'category'
      label = new SpriteText(isCategory ? `${node.label} ${node.factCount}` : node.label)
      label.color = isCategory ? '#dbe3f2' : '#c8d2e4'
      label.textHeight = isCategory ? 2.8 : 3.2
      label.position.set(0, diameter / 2 + 2.6, 0)
      label.visible = isCategory || node.factCount >= LABEL_MIN_FACTS
      group.add(label)
    }

    nodeObjectsRef.current.set(node.id, {
      group,
      glow: dot,
      label,
      baseScale: diameter,
      scale: 1,
      colorHex: IDLE_CHARACTER_COLOR,
      opacity: 1,
    })
    return group
  }, [])
  const handleNodeHover = useCallback((node: GraphNode | null) => {
    // 悬浮也是交互：用户不拖不点、只把鼠标停在星上读卡片/tooltip 时，若不续期，
    // 4 秒后自转会启动，星星在光标底下漂走，得追着点。
    resumeRendering()
    hoveredIdRef.current = node?.id ?? null
  }, [])
  // 连线是参考图里真正的主角：成片细灰线织出的网决定了整张图的"形状"。关系线略亮，
  // 归属线（角色→它的分簇/事实）更暗，免得展开时抢掉星座本身。
  //
  // 链路外的连线同样要退到背景里。这里靠**压暗颜色**而不是调透明度：linkOpacity 是
  // 全局 prop、给不了单条，而背景是纯黑，颜色压暗在观感上等同于变淡，还省掉一层混合。
  //
  // 读 ref 而非闭包变量是刻意的：本回调记忆化成 []（引用一变会让库整场重建连线对象），
  // 而展开状态变化必然带来 graphData 变化、进而触发库重跑一遍 accessor，所以取到的
  // 一定是新值（three-forcegraph.mjs:1185 的 hasAnyPropChanged 列表含 graphData）。
  const linkColorAccessor = useCallback((link: GraphLink) => {
    const onChain = isLinkOnFocusChain(link, expandedRef.current, expandedCategoryRef.current)
    if (link.kind === 'relationship') return onChain ? '#5c6880' : '#262d3a'
    return onChain ? '#3a4356' : '#1e232d'
  }, [])
  // 关系名同样进 float-tooltip 的 innerHTML，同样要转义
  const linkLabelAccessor = useCallback(
    (link: GraphLink) => (link.label ? escapeHtml(link.label) : ''),
    [],
  )

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full"
      // 用户一上手就把镜头交还给他：否则自动跟随会跟正在拖拽/缩放的操作抢镜头。
      // （点节点触发的跟随是在 onNodeClick 里重新设的，不受这里影响——库的节点点击
      //  事件在 pointerup 之后才派发。）
      onPointerDown={() => {
        isDraggingRef.current = true
        focusRef.current = null
        resumeRendering()
      }}
      onWheel={() => {
        focusRef.current = null
        resumeRendering()
      }}
      data-memory-graph-canvas="true"
    >
      {size.width > 0 && size.height > 0 ? (
        <ForceGraph3D<CanvasNode, GraphLink>
          ref={graphRef}
          width={size.width}
          height={size.height}
          graphData={visible}
          backgroundColor="#000000"
          showNavInfo={false}
          // 关掉多重采样抗锯齿：全屏 MSAA 在满宽画布上很贵，而这张图只有圆点和细线——
          // 圆点的边缘抗锯齿已经烘在贴图里了，去掉 MSAA 的观感损失主要落在细线上，
          // 与降像素比一起换来的帧率更值。想找回极致锐利就把这里删掉、并把上面的
          // MAX_PIXEL_RATIO 调回 2。
          rendererConfig={{ antialias: false }}
          // 力导向模拟跑够 4 秒就收工。默认 15 秒——那期间既在算力学又不能暂停渲染，
          // 而这张图的规模两三秒就稳住了。
          cooldownTime={4000}
          onEngineStop={handleEngineStop}
          nodeLabel={nodeLabelAccessor}
          nodeVal={nodeValAccessor}
          onNodeHover={handleNodeHover}
          // 显式钉住半径换算基准（库默认也是 4），让 NODE_REL_SIZE 的算术在源码里自洽
          nodeRelSize={NODE_REL_SIZE}
          // 不 extend：默认的兰伯特球体要被完全替换掉，不是在它外面再套一层。
          // （nodeColor / nodeOpacity / nodeResolution 也随之去掉——只作用于默认球体，
          //  我们的圆点颜色由每帧循环直接写材质，留着是误导）
          nodeThreeObjectExtend={false}
          nodeThreeObject={nodeThreeObjectAccessor}
          linkColor={linkColorAccessor}
          linkOpacity={0.55}
          // ⚠️ linkWidth 必须是 0：库里 `useCylinder = !!linkWidth`
          // （three-forcegraph.mjs:1257），只要非 0，**每条连线**都会变成一个
          // CylinderGeometry 网格（真机展开主角是 167 条）。0 才走廉价的 Line +
          // LineBasicMaterial，既省一大截性能，也正是参考图那种一像素细线的观感。
          linkWidth={0}
          linkLabel={linkLabelAccessor}
          onNodeClick={handleNodeClick}
          onBackgroundClick={handleBackgroundClick}
        />
      ) : null}

      {/* 回到全景：3D 里转迷路是常态，留一个一键回到已知状态的出口。放右下角，
          与右上角的全屏按钮分开，避免两个镜头类操作挤在一起误触。 */}
      <div className="absolute bottom-4 right-4 z-10">
        <IconTooltip label="回到全景">
          <button
            type="button"
            onClick={handleResetView}
            aria-label="回到全景"
            className="flex size-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/45 backdrop-blur-sm transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white/85"
            data-memory-graph-reset="true"
          >
            <RotateCcw className="size-3.5" />
          </button>
        </IconTooltip>
      </div>

      {/* 卡片挂在容器左上角，位置每帧由 transform 驱动（见上面的 rAF 循环），不进 state。
          opacity 初始 0：首帧还没投影出坐标，先别让它闪在左上角。 */}
      <div
        ref={cardRef}
        className="pointer-events-none absolute left-0 top-0 z-10 w-[min(19rem,70%)] opacity-0 transition-opacity duration-150 will-change-transform"
        data-memory-graph-card="true"
      >
        {selected ? <MemoryGraphNodeCard node={selected} /> : null}
      </div>
    </div>
  )
}

/** 点开某个星后浮在它上方的卡片：角色给规模，事实给正文与章号。 */
function MemoryGraphNodeCard({ node }: { node: CanvasNode }) {
  // 卡片上的色点用该谓词的强调色本身：卡片只在这颗星被点开时出现，此刻它正是全场上色的那一簇
  const accent = predicateColor(node.predicate)
  return (
    <div className="rounded-xl border border-white/12 bg-[#0b1020]/92 px-3.5 py-3 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.85)] backdrop-blur-sm">
      {node.kind === 'character' ? (
        <>
          <div className="text-sm font-semibold leading-tight text-white/92">{node.label}</div>
          <div className="mt-1.5 text-xs leading-relaxed text-white/50">
            {node.factCount > 0 ? `记着 ${node.factCount} 件事，按类别分在周围` : '还没记下关于它的事'}
          </div>
        </>
      ) : node.kind === 'category' ? (
        <>
          <div className="flex items-center gap-1.5">
            <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
            <span className="text-sm font-semibold leading-tight text-white/92">{node.label}</span>
          </div>
          <div className="mt-1.5 text-xs leading-relaxed text-white/50">
            {`这一类记着 ${node.factCount} 件事，点开逐条看`}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-1.5">
            <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
            <span className="text-[11px] leading-none text-white/55">{node.predicateLabel ?? ''}</span>
            {node.chapter ? (
              <span className="ml-auto text-[11px] leading-none text-white/35">第 {node.chapter} 章</span>
            ) : null}
          </div>
          <div className="mt-2 text-sm leading-relaxed text-white/88">{node.label}</div>
        </>
      )}
    </div>
  )
}
