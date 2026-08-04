# NarraCat Brand Assets

Runtime brand assets imported by the renderer or used as source material for packaged app identity.

Current files:

- `narracat-mark.webp`: black-and-white NarraCat mark, 1024x1024 lossless WebP with alpha.
- `narracat-about-banner.webp`: 1200x438 About-page brand story banner.

Usage rules:

- Renderer UI should use brand primitives such as `BrandMark` and `BrandLockup`, not direct image imports in page code.
- About-page brand story media should use `BrandStoryBanner`, not direct page imports.
- Keep this mark product-level. Do not use it inside project cards, Markdown reading surfaces, Agent messages, or status badges.
- If an SVG source is added later, keep the component API stable so pages do not depend on the source file format.
