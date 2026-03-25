# Project Context

## What This Is

`开场` is a Chinese-first web app that helps users generate strong opening paragraphs when they are stuck at the first sentence. The MVP focuses on a single closed loop: input idea -> analyze intent -> choose opening strategies -> generate multiple candidates -> show cards -> copy -> persist records.

## What This Is Not

- Not a general chat assistant
- Not a full article generator
- Not a writing editor or collaboration suite
- Not a knowledge base or RAG product

## Current State

- Repo is scaffolded for the A-phase MVP.
- Hand-off pack is established.
- Core generation domain, API routes, UI shell, and Prisma schema are present.
- MiniMax is wired through an Anthropic-compatible provider layer with a mock fallback for local development when secrets are missing.
- Local SQLite schema initialization is handled by `npm run db:push`, which is a repo script backed by `scripts/init-db.mjs`.
- `npm run typecheck` and `npm run build` both pass in the current workspace.
- The generation and copy flows were smoke-tested against the local SQLite database.

## Architecture

- `app/` owns the web UI and route handlers.
- `components/` owns the landing input, style selector, and opening cards.
- `server/opening/` owns the generation pipeline:
  - input analysis
  - strategy selection
  - prompt building
  - candidate ranking
  - orchestration
- `server/llm/` owns provider abstraction and MiniMax integration.
- `server/db/` owns Prisma access and persistence helpers.

## Key Files

- [`app/page.tsx`](/Users/linpeiwen/knightspace/kaichang/app/page.tsx)
- [`app/api/generate-openings/route.ts`](/Users/linpeiwen/knightspace/kaichang/app/api/generate-openings/route.ts)
- [`server/opening/generate-openings.ts`](/Users/linpeiwen/knightspace/kaichang/server/opening/generate-openings.ts)
- [`server/opening/analyze-input.ts`](/Users/linpeiwen/knightspace/kaichang/server/opening/analyze-input.ts)
- [`server/opening/strategy-engine.ts`](/Users/linpeiwen/knightspace/kaichang/server/opening/strategy-engine.ts)
- [`server/opening/prompt-builder.ts`](/Users/linpeiwen/knightspace/kaichang/server/opening/prompt-builder.ts)
- [`server/opening/rank-candidates.ts`](/Users/linpeiwen/knightspace/kaichang/server/opening/rank-candidates.ts)
- [`server/llm/providers/minimax.ts`](/Users/linpeiwen/knightspace/kaichang/server/llm/providers/minimax.ts)
- [`prisma/schema.prisma`](/Users/linpeiwen/knightspace/kaichang/prisma/schema.prisma)

## Verified Commands

- Verified in this session:
  - `npm run typecheck`
  - `npm run build`
  - `npm run db:push`
  - `npm run prisma:generate`
- Smoke-tested via local HTTP:
  - `POST /api/generate-openings`
  - `POST /api/copy-event`

## Runtime Notes

- `MOCK_LLM=1` is available for local development if a real MiniMax key is not configured.
- The database is currently set up for local SQLite at `prisma/dev.db` to keep the MVP self-contained. It can be migrated to PostgreSQL later without changing the domain layer.
- Copy and quota tracking are based on a guest session cookie for the MVP.

## Working Rules For Future Agents

- Keep the A-phase flow intact and explicit.
- Preserve the separation between input analysis, strategy selection, prompt building, ranking, and provider access.
- Do not collapse the product into a chat UI.
- If changing the provider behavior, keep the mock fallback usable for local work.
- Update the changelog only with durable facts, not transient work notes.
