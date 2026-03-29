# Project Context

## What This Is

`开场` is a Chinese-first web app that helps users generate strong opening paragraphs when they are stuck at the first sentence. The MVP focuses on a single closed loop: input idea -> analyze intent -> choose opening strategies -> generate multiple candidates -> show cards -> copy -> persist records.

## What This Is Not

- Not a general chat assistant
- Not a full article generator
- Not a writing editor or collaboration suite
- Not a knowledge base or RAG product

## Current State

- Repo is past the A/B/C/D/E/F/G/H/H+ loops and is now in a hard simplification pass around the opening core.
- Hand-off pack is established and should stay compact.
- Core generation domain, API routes, UI shell, Prisma schema, feedback routes, refine route, history/analytics routes, and logging helpers are present.
- Front-end self-review cards were removed; scoring now stays in the backend for analysis and learning, while main-request sorting is no longer coupled to evaluation output.
- `generateOpenings()` now resolves to the simplified one-call path in [`server/opening/generate-openings.ts`](/Users/linpeiwen/knightspace/kaichang/server/opening/generate-openings.ts): raw input enters a minimal prompt, the provider is called once, the returned text is lightly normalized, and only then is it hard-validated.
- The simplified opening path now uses a forced Anthropic-style tool call named `emit_opening_candidates` for candidate generation, and the parser only accepts that structured JSON payload instead of guessing from loose text blocks.
- The refine route now uses the same structured tool-call pattern with `emit_refined_opening`, and the frontend only consumes the returned `refinedText` field instead of any analysis or thinking text.
- The active path no longer uses the previous batch / repair / compress / retry / fallback orchestration. Those helpers still exist lower in the file for historical context, but they are no longer on the exported execution path.
- Input analysis has been thinned, but it is still not a no-op passthrough: content type, style hints, length preference, and a compatibility `semanticTheme` field still exist for downstream modules.
- The latest P0 task downgraded the "content too short" gate from hard failure to soft quality feedback, so short candidates can now return normally while repeat-expansion and prompt-echo checks still block bad outputs.
- The simplified generation path can still reject some raw-input-led prompts as prompt echo when the model mirrors the task too closely; that failure now clears the UI candidate list instead of leaving stale results on screen.
- The latest validated smoke input now returns four structured opening candidates through the tool-call path instead of mis-parsed requirement fragments.
- MiniMax is wired through an Anthropic-compatible provider layer, with `real`, `recovered`, `fallback`, and `mock` modes still available for development and debugging.
- Recent-output signature memory and hard gating still exist in helper layers and the legacy code area, but they should not be treated as the main guarantee of output quality.
- Learning still combines copy/select and feedback signals, with guest/session-level preference profiles and lightweight feedback weighting.
- Local SQLite schema initialization is handled by `npm run db:push`, backed by `scripts/init-db.mjs`.
- `npm run typecheck` and `npm run build` both pass in the current workspace.
- The generation, copy, feedback, refine, and selection flows were smoke-tested against the local SQLite database and browser UI. The latest generation-core pass specifically revalidated the standard Chinese opening inputs after the simplification changes.
- Copy events persist the selected candidate and generation request link, while copy errors remain mapped to business errors.
- Real-provider validation is now passing for both generation and refine in the current workspace, but the MiniMax-compatible refine path needs a larger output budget because the model spends a large chunk of tokens on thinking metadata before emitting the forced tool call.
- Current remaining product risk is mostly quality-side: mock output still has some template flavor, and the refine route should keep generous token headroom so the forced structured tool call can land reliably in real provider mode.
- This workspace snapshot is now treated as the current stable handoff point after the browser hydration issue was verified and the input counter / generate-button flow was confirmed working again in the active server process.
- `TASK-2026-03-29-002` has been independently verified and passed: refine now uses structured tool-call output, surfaces only `refinedText`, and the workspace passes `npm run build` and post-build `npm run typecheck`.
- `TASK-2026-03-29-003` is now resolved on the real provider path: with `MOCK_LLM=0` and the live MiniMax key on the current 3000 service, `/api/refine-opening` returns structured `refinedText` successfully.

## Architecture

- `app/` owns the web UI and route handlers.
- `components/` owns the landing input, style selector, and opening cards.
- `server/opening/` owns the generation pipeline:
  - input analysis
  - strategy selection
  - prompt building
  - candidate ranking
  - orchestration
- `server/opening/opening-quality.ts` owns the lightweight quality gate for drift and summary-like output.
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
- [`server/opening/output-signatures.ts`](/Users/linpeiwen/knightspace/kaichang/server/opening/output-signatures.ts)
- [`server/opening/feedback-preference.ts`](/Users/linpeiwen/knightspace/kaichang/server/opening/feedback-preference.ts)
- [`server/opening/preference-learning.ts`](/Users/linpeiwen/knightspace/kaichang/server/opening/preference-learning.ts)
- [`server/opening/llm-quality-evaluator.ts`](/Users/linpeiwen/knightspace/kaichang/server/opening/llm-quality-evaluator.ts)
- [`server/opening/opening-quality.ts`](/Users/linpeiwen/knightspace/kaichang/server/opening/opening-quality.ts)
- [`server/llm/providers/minimax.ts`](/Users/linpeiwen/knightspace/kaichang/server/llm/providers/minimax.ts)
- [`server/db/generation-repo.ts`](/Users/linpeiwen/knightspace/kaichang/server/db/generation-repo.ts)
- [`server/logger.ts`](/Users/linpeiwen/knightspace/kaichang/server/logger.ts)
- [`server/errors.ts`](/Users/linpeiwen/knightspace/kaichang/server/errors.ts)
- [`prisma/schema.prisma`](/Users/linpeiwen/knightspace/kaichang/prisma/schema.prisma)
- [`app/api/feedback/route.ts`](/Users/linpeiwen/knightspace/kaichang/app/api/feedback/route.ts)
- [`app/api/history/route.ts`](/Users/linpeiwen/knightspace/kaichang/app/api/history/route.ts)
- [`app/api/analytics/simple/route.ts`](/Users/linpeiwen/knightspace/kaichang/app/api/analytics/simple/route.ts)
- [`app/api/refine-opening/route.ts`](/Users/linpeiwen/knightspace/kaichang/app/api/refine-opening/route.ts)

## Verified Commands

- Verified in this session:
  - `npm run typecheck`
  - `npm run build`
  - `npm run db:push`
  - `npm run prisma:generate`
- Smoke-tested via local HTTP:
  - `POST /api/generate-openings`
  - `POST /api/copy-event`
- Additional preview checks:
  - simplified preview path returns `200` for the standard novel/essay smoke inputs in `MOCK_LLM=1` mode
  - provider-output normalization now tolerates light formatting drift instead of failing immediately on code fences / `content:` labels / extra whitespace
  - real preview mode was not fully revalidated in this workspace because no live provider key was available during the latest pass
- Browser-verified inputs:
  - novel: `我想写一个关于海上女船长的小说，主角表面强势，内心很怕失去控制，开头要有宿命感、画面感和一点压迫感。`
  - essay: `我想写一篇关于凌晨失眠和自我和解的随笔，氛围要安静克制，重点是独处时的心绪变化。`
  - article: `我想写一篇公众号文章，主题是拖延症怎么和一个总在临近截止才开始的人共处，要求开头直接一点，带一点观点和提问。`

## Runtime Notes

- `MOCK_LLM=1` is available for local development if a real MiniMax key is not configured.
- `llmMode` / `generationState` / `evaluationState` are surfaced to the UI so mock, recovered, fallback, and pending states can be distinguished.
- The app is usually easier to validate in `npm run build && npm start` production-preview mode when dev hot reload is noisy.
- The database is currently set up for local SQLite at `prisma/dev.db` to keep the MVP self-contained. It can be migrated to PostgreSQL later without changing the domain layer.
- Copy and quota tracking are based on a guest session cookie for the MVP.
- The "content too short" gate is now a soft signal in rule evaluation instead of a hard rejection; if generation still fails, inspect prompt echo, duplicate-output, and template-like gates first.
- Failed generation requests now clear the current candidate/request state in the UI so previous results are not mistaken for the latest attempt.
- Refine requests now fail loudly if the model does not return structured `refinedText`, which keeps the preview from leaking analysis, reasoning, or other process text into the UI.
- `next build` may reintroduce `.next/types/**/*.ts` into `tsconfig.json`; after build verification, restore the repo's direct typecheck include list so `npm install && npm run typecheck` still works without a prior build.
- The current major risk is still split in two:
  - mock mode is stable enough for smoke testing but should not be mistaken for final product quality
  - refine should retain a generous output budget because MiniMax can spend most of the quota on thinking before it emits the forced tool call
- Background evaluation, feedback learning, and copy tracking are intentionally backend-only; the UI should stay lightweight and avoid self-review blocks.
- Recent-output signature memory and hard gating exist, but they are not the main thing to trust for output quality; if candidate quality regresses, verify raw-input handling and provider parsing first.
- The highest-priority open product issue is still candidate quality: outputs can remain too close to the user prompt, too templated in mock mode, or too abstract in legacy helper paths even though the simplified route is now more direct.

## Working Rules For Future Agents

- Keep the A-phase flow intact and explicit.
- Preserve the separation between input analysis, strategy selection, prompt building, ranking, and provider access.
- Do not collapse the product into a chat UI.
- If changing the provider behavior, keep the mock fallback usable for local work.
- Keep feedback/learning/evaluation in the backend unless the issue explicitly requires UI exposure.
- When candidate diversity or topic fidelity regresses, prefer fixing the root of the analysis/prompt/provider coupling before widening templates or relaxing quality gates globally.
- Treat repeated theme clusters, generic semantic anchors, template-like recovered outputs, and real-path parse failures as real product bugs, even if the UI shows `real`.
- After every completed task, append a concise changelog entry and refresh the source-of-truth handoff notes before moving on.
- Update the changelog only with durable facts, not transient work notes.
