# Remotion Source

This standalone Remotion project generates the Workbench generation-state animation assets for issue #88.

Commands:

```bash
bun install --no-cache
bun run studio
bun run render
```

Rendered outputs are written to `../assets/`.

The composition is transparent and should be exported with:

- PNG frame rendering
- VP9 WebM codec
- `yuva420p` pixel format

The App runtime must not import this source project. It only imports the exported files copied into `src/assets/workbench/`.
