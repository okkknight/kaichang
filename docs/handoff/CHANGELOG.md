# Changelog

## 2026-03-25

- Established the compact handoff pack with `PROJECT_CONTEXT.md`, `docs/handoff/README.md`, and this append-only changelog.
- Scaffolded the A-phase MVP for `开场`, including the Next.js app shell, opening generation domain, MiniMax provider abstraction, Prisma schema, and MVP UI components.
- Verified the local MVP path with `npm run typecheck`, `npm run build`, `npm run prisma:generate`, and a repo-local SQLite initialization script behind `npm run db:push`.
- Smoke-tested the main flow end to end: opening generation, candidate copy, and persistence to the local SQLite database.
