# Workbench Runtime Assets

Production renderer assets for Workbench-specific UI states.

Current assets:

- `generation-loading-light.webm`
- `generation-loading-light.png`
- `generation-loading-dark.webm`
- `generation-loading-dark.png`

Source handoff:

- `docs/design-assets/workbench-generation-loading/`

Usage:

- Import through Workbench components with Vite asset URLs.
- Keep Remotion source under the design handoff directory; the renderer only consumes exported WebM / PNG files.
- Use PNG fallbacks for reduced-motion and video error states.
