## Crypto Bubble View Monorepo

Workspace layout:
- `apps/web`: Next.js site (deploy to Vercel)
- `apps/extension`: Chrome extension assets
- `packages/core`: Shared bubble logic (TypeScript)

Scripts (run from repo root):
- `npm run dev:web`
- `npm run build:web`
- `npm run lint:web`

Next steps: wire web/extension to consume `@cryptobubble/core`, add extension build pipeline, and consolidate shared styles.
