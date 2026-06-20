# AI Storyboard

![MIT License](https://img.shields.io/badge/license-MIT-green)

An agentic desktop app for building image **storyboards** — ordered sequences of
images generated with ComfyUI text-to-image models, with first-class support for
**Ideogram 4's structured JSON prompt format**.

A sibling of `ai-video-editor`; it reuses the same stack (Bun + Hono server,
React 19 + Vite client, Drizzle + SQLite, Zustand, Tailwind 4, Electron) and the
same LLM-agent loop, ComfyUI integration, and styleguide subsystem — but is
built around images-in-a-sequence instead of a video timeline.

## What it does

- **Create a project** by choosing an image size the Ideogram way: pick an
  aspect ratio (1:1, 16:9, 9:16, …) and a megapixel target (1MP / 2MP), which
  compute the concrete width/height for every frame.
- **Build the board** one frame at a time with the agent chat, or have the agent
  plan a whole storyboard (it proposes a plan and asks before generating).
- **Refine each image** in an editor where the Ideogram layout's bounding boxes
  render as draggable/resizable overlays on the picture. Edit a region's
  description / text / palette, tweak the high-level + style descriptions and the
  color palette, or edit the raw layout JSON directly (CodeMirror, two-way
  synced) — then generate / regenerate through ComfyUI.
- **View the sequence** as a responsive grid with an adjustable column count and
  drag-to-reorder.

## Ideogram layout

Each frame stores a structured layout that is serialized verbatim as the
ComfyUI prompt for Ideogram workflows:

```jsonc
{
  "high_level_description": "…overall scene…",
  "style_description": "…aesthetic, lighting, medium, palette…",
  "color_palette": ["#aabbcc"],
  "compositional_deconstruction": [
    { "bounding_box": [y_min, x_min, y_max, x_max], "description": "…", "text": "literal text" }
  ]
}
```

Bounding boxes are `[y_min, x_min, y_max, x_max]` on a 0–1000 grid, top-left
origin. Non-Ideogram t2i workflows fall back to a plain-text prompt per image.

## Develop

```bash
bun install
bun run db:push        # create / sync the SQLite schema
bun run dev            # server (http://localhost:3084) + client (http://localhost:5176)
```

Then open Settings to configure your LLM provider and ComfyUI base URL, register
an Ideogram v4 t2i workflow (set its prompt node), and mark it default.

### Scripts

- `bun run dev` — server + Vite client
- `bun run db:push` / `bun run db:studio` — Drizzle schema sync / inspector
- `bun run dev:electron` — build + launch the Electron desktop app
- `bun run package` — build a distributable Electron app

## License

[MIT](LICENSE) — use it at work, fork it, sell what you build with it.

