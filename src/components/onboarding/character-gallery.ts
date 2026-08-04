// 第三幕角色画廊的图源。用户把角色图放进 src/assets/onboarding/characters/ 即被自动加载；
// 未放图时画廊位置显示引导（见 FirstRunIntro）。规格见该目录 README。
import type { CircularGalleryItem } from '@/components/motion/CircularGallery'

const userCharacterModules = import.meta.glob('../../assets/onboarding/characters/*.{webp,png,jpg,jpeg}', {
  eager: true,
  query: '?url',
  import: 'default',
})

function deriveLabel(path: string): string {
  const file = path.split('/').pop() ?? ''
  return file.replace(/\.[^.]+$/, '')
}

export const characterGalleryItems: CircularGalleryItem[] = Object.entries(userCharacterModules)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, url]) => ({ image: url as string, text: deriveLabel(path) }))

export const hasCharacterImages = characterGalleryItems.length > 0
