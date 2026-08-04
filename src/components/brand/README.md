# Brand Components

品牌资产只能通过 `@/components/brand` 入口进入产品页面：

- `BrandMark`：只展示 `narracat-mark.webp` 原始图片，不额外包裹装饰容器，不做浅色 / 暗色模式的图片切换或颜色 remap。
- `BrandLockup`：组合 `BrandMark` 和 NarraCat 文字，用于产品级导航、About 或启动类低频场景。
- `BrandIllustration`：通过 `purpose` 读取 `brand-illustrations.ts` registry，不在页面里绑定具体图片文件名。
- `BrandStoryBanner`：封装 About 页品牌故事横幅，页面只表达布局，不直接绑定图片文件。

不要直接 import `src/assets/brand/*` 或 `src/assets/illustrations/narracat/*`。新增页面只从本目录入口导入品牌原语；新增插图用途时先扩展 `BrandIllustrationPurpose`、`BRAND_ILLUSTRATION_PURPOSES` 和 registry，再补测试。

持久规则见 `docs/design.md` 的「Logo 与品牌插图」。品牌插图默认是装饰性内容，语义交给空态标题、正文和 CTA；有内容的阅读态、Agent 消息和密集列表不放品牌插图。
