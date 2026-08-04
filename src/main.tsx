import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { initTheme } from './lib/theme.ts'
import './styles/globals.css'

initTheme()

// 非 mac 平台加载渐变 fallback 背景（mac 用 vibrancy 透到桌面）
if (typeof navigator !== 'undefined' && !/Mac/.test(navigator.platform)) {
  await import('./styles/fallback-bg.css')
}

const root = document.getElementById('root')
if (!root) throw new Error('Root element #root not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
