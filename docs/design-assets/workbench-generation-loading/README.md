# Workbench Generation Loading Animation

Source:

- Created for GitHub issue #88.
- Remotion source lives in `remotion/`.
- No `.superpowers/` scratch files are execution dependencies.

Durable references:

- `assets/generation-loading-light.webm`
- `assets/generation-loading-light.png`
- `assets/generation-loading-dark.webm`
- `assets/generation-loading-dark.png`

Decision:

- Use a neutral abstract document-generation animation: page outline, subtle line emergence, and a restrained scan rhythm.
- Do not use logo, character animation, brand illustration, text baked into video, progress percentage, or object-specific variants.
- Use Remotion only as an offline asset creation tool. The Electron renderer consumes exported WebM / PNG files and does not depend on Remotion at runtime.
- Provide separate light and dark exports because transparent video colors are baked into the asset.

Usage:

- Treat this directory as the curated design handoff for #88.
- Runtime assets are copied to `src/assets/workbench/` after approval.
- Future edits should update the Remotion source and re-render the four exported assets.

Render:

```bash
cd docs/design-assets/workbench-generation-loading/remotion
bun install --no-cache
bun run render
```
