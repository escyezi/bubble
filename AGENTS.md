# Agent Guide (Bubble)

This repo is a Bun + React (frontend) project. For product behavior, UX, and module responsibilities, read `PROJECT.md` first (avoid duplicating or contradicting it).

## Key Docs

- `PROJECT.md`: canonical description of app behavior and file responsibilities.
- `plan/*.md`: refactor/maintenance plans (keep TODOs updated if you execute them).
- `CLAUDE.md`: Bun-first workflow notes.

## Commands (Bun)

- Dev: `bun dev`
- Build: `bun run build`
- Start: `bun start`
- Typecheck (baseline acceptance): `bun run typecheck`

## Architecture Notes (repo-specific)

- State management: Valtio (`src/bubble/state/state.ts` exports `bubbleState`).
- `src/bubble/state/actions.ts`: thin orchestrator only; avoid re-introducing large module-level mutable state here.
- Hydration: `src/bubble/state/hydration.ts` owns `ensureHydrated()` and the storage instance.
- Persistence: `src/bubble/state/persistence.ts` owns subscriptions/debounce/flush and `pausePersistence()`.
- Runtime (stream + typing engine): `src/bubble/state/runtime.ts` owns AbortController/timers/queues and reporting runtime errors.

## Storage Invariants (consistency-first)

- Storage selection is **startup-only**: if Dexie/IndexedDB initializes successfully, use Dexie for all operations; `localStorage` is only a fallback when IndexedDB is unavailable.
- Do **not** implement “per-operation fallback to localStorage” (it can create split-brain data inconsistency).
- Dexie schema currently uses versioned migrations; update versions intentionally and keep changes minimal.
- “Current conversation” is an explicit pointer (do not infer solely by `updatedAt` except as a migration/last-resort path).

## Persistence / Serialization

- Never persist Valtio proxies. Use snapshotting + cloning (see `src/bubble/state/persistence.ts`) before writing.
- If a persistence write fails, treat it as an error (surface via global error reporting); do not silently “pretend saved”.

## Error Handling (do not swallow)

- Global error reporting lives in `src/bubble/state/errors.ts` (`reportGlobalError`, `clearGlobalError`).
- UI: `src/bubble/components/GlobalErrorModal.tsx` is rendered by `src/bubble/BubbleApp.tsx`.
- Browser-level capture is installed via `src/bubble/errorHooks.ts` (`useGlobalErrorHandlers`).
- When adding new async flows, prefer: catch → `reportGlobalError(err, "<context>")` → rethrow or otherwise keep failure observable.

## Coding Expectations

- Keep changes small and scoped; avoid unrelated refactors.
- Maintain existing UI/interaction unless explicitly asked to change it.
- Prefer TypeScript-safe changes; `bun run typecheck` should pass.
- Avoid adding new dependencies unless necessary; if added, explain why.

