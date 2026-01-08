---
description: Use Bun tooling/workflows for this repo (no Node.js/npm/vite).
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

Default to using Bun instead of Node.js. App/product details live in `PROJECT.md` (don’t duplicate them here).

## Commands

- Install: `bun install`
- Dev: `bun dev` (runs `bun --hot src/index.ts`)
- Build: `bun run build` (wraps `Bun.build` via `build.ts`)
- Start: `bun start`
- Typecheck: `bun run typecheck`

## Tooling Rules

- Use `bun <file>` / `bun run <script>` / `bunx <pkg> <cmd>` (avoid `node`, `npm`, `npx`, `pnpm`, `yarn`).
- Don’t add Vite/webpack/esbuild; this repo uses Bun’s HTML entrypoints + bundler.
- Bun loads `.env` automatically; avoid adding `dotenv` unless there’s a specific reason.

## Server / Frontend (repo conventions)

- Server entry: `src/index.ts` uses `serve` from `"bun"` with a `routes` map (avoid Express).
- Frontend entry: `src/index.html` imports `src/frontend.tsx`; HMR uses `import.meta.hot`.
- Tailwind: configured via `bun-plugin-tailwind` (see `bunfig.toml` and `build.ts`).

## Testing

If you add tests, use `bun test` (don’t introduce Jest/Vitest).

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```
