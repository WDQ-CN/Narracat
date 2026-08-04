# NarraCat Illustrations

Production renderer illustrations for NarraCat empty states and feature guidance.

Source:

- Derived from an internal design asset (`image5.png`).
- `agents.webp` is the approved Library home desktop character cutout supplied for the home UI refresh.

Asset rules:

- WebP with transparent background.
- Square guidance illustrations use a 512x512 canvas.
- `agents.webp` keeps its source 800x650 cutout canvas; the green banner panel, copy, and metrics are rendered in code.
- Subject centered with consistent safe padding for square guidance illustrations.
- Maximum subject size is about 400px on the longest side for square guidance illustrations.
- File names describe UI usage or scene intent, for example `empty-library.webp`, `agent-guide.webp`, or the current scene names.

Usage:

- Import these files from renderer code with Vite, for example from `@/assets/illustrations/narracat/<name>.webp`.
- Keep future NarraCat illustration additions in this folder unless a feature needs its own more specific asset group.
- Do not store exploratory mockups or unapproved candidates here; use `docs/design-assets/<feature>/` for handoff assets.
