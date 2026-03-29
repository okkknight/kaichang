# Changelog

## 2026-03-25

- Established the compact handoff pack with `PROJECT_CONTEXT.md`, `docs/handoff/README.md`, and this append-only changelog.
- Scaffolded the A-phase MVP for `开场`, including the Next.js app shell, opening generation domain, MiniMax provider abstraction, Prisma schema, and MVP UI components.
- Verified the local MVP path with `npm run typecheck`, `npm run build`, `npm run prisma:generate`, and a repo-local SQLite initialization script behind `npm run db:push`.
- Smoke-tested the main flow end to end: opening generation, candidate copy, and persistence to the local SQLite database.
- Tightened A1 failure handling so invalid copy candidates return business errors, generation failures mark requests as `failed`, and fresh installs can run `npm run typecheck` directly after `npm install`.
- Advanced B-stage quality control so opening generation now uses explicit contentType and strategyType planning, stronger prompt anchoring, lightweight quality scoring, and copy-side selection tracking without adding login, history, or commercialization features.

## 2026-03-27

- Added backend-only quality controls for the opening pipeline, including LLM evaluation, asynchronous evaluation refresh, and removal of the front-end self-review block from candidate cards.
- Added feedback-driven ranking and lightweight guest/session preference learning, then later hardened the feedback signal with time decay, de-duplication, and confidence weighting so short bursts of repeated feedback do not overpower ranking.
- Added refine, history, analytics, and feedback routes, plus UI entry points for copy/like/dislike/refine actions and reason tags.
- Added visible `mock` / `recovered` / `fallback` state banners so non-real paths are clear during development and QA.
- Added recent-output signature memory and then hardened it into a cross-request uniqueness constraint so repeated template簇 are rewritten before final release.
- Improved MiniMax recovery handling so real-path parsing failures, recovered outputs, and fallback outputs are distinguishable instead of all collapsing into the same generic error surface.
- Switched the local validation workflow toward production-preview checks when dev hot reload makes API readiness noisy, while preserving `npm run typecheck` and `npm run build` as standard verification steps.

## 2026-03-28

- Refreshed the project handoff pack to reflect the current state of the repo, including the backend-only evaluation/learning pipeline, the latest hard-gate work on repeated output簇, and the remaining product risk around template-like candidate repetition.
- Documented that the opening pipeline can still over-abstract specific prompts into shared semantic anchors, which can make real / recovered / fallback output families feel repetitive even when the UI shows a non-mock mode.
- Confirmed the current workspace still passes `npm run build` and `npm run typecheck` in the verified environment, while local validation remains centered on the Chinese opening-generator smoke tests.
- Began the P0 generation-core refactor toward topic-faithful briefs and concrete entry angles, with `semanticTheme` demoted to compatibility-only status and the main pipeline re-centered on preserving题面 rather than abstracting it away.
- Hardened the generation pipeline so recent-output avoidance acts as a hard constraint during final candidate release, and refreshed the local production preview after the refactor passed `npm run typecheck` and `npm run build`.
- Reworked the handoff pack again after independent verification showed the "extreme simplification" pass was still not stable: the real generation path can still fail on ordinary inputs, input analysis remains more structured than pure raw-input passthrough, and the mock path still produces templated-looking openings.
- Updated the source-of-truth project context to call out the current highest-priority risks more explicitly: real-path parse failures, over-abstract analysis, template-like fallback families, and candidate diversity regressions across repeated requests.
- Landed the next P0 stabilization pass on the simplified generation path: raw input now dominates `coreIntent`/`summary`, prompt construction is thinner and raw-input-led, provider outputs are normalized before validation, and single-candidate failures no longer automatically turn the whole request into `502`.
- Replaced the previous mock "writing-tutorial" phrasing with lighter raw-input-centered openings so local smoke tests are less misleading, while keeping mock mode clearly separate from real provider quality.
- Revalidated the standard Chinese smoke inputs in `MOCK_LLM=1` mode after the stabilization pass; both returned `200` with four candidates and no longer failed on the third or fourth slot because of duplicate/format drift.
- Refreshed the handoff pack to note that the next required verification is a live-key real-provider regression pass, because this workspace did not expose a usable MiniMax/Anthropic key during the latest update.

## 2026-03-29

- Collapsed the active opening generation path down to a single provider call with raw-input-led prompting, light normalization, and hard validation; the exported `generateOpenings()` now routes through the simplified path instead of the older batch / repair / compress / retry orchestrator.
- Kept the legacy batch / repair / compress / fallback helpers in the source file for now, but they are no longer on the active execution path and should be treated as dead historical code until explicitly removed.
- Updated the handoff pack to reflect that the main remaining risks are quality-side rather than availability-side: mock output still shows template flavor, and real-provider behavior still needs a live-key regression pass.
- Verified the simplified path with `npm run build` and `npm run typecheck`, and confirmed the local preview server is still serving the app on port 3000.
- Removed the hard failure gate on short opening candidates so length now acts as soft quality feedback; prompt echo, repeat expansion, and other non-length quality checks still remain active.
- Rechecked the Chinese smoke inputs after the gate change and confirmed short candidates can now return normally in `MOCK_LLM=1` mode.
- Fixed the front-end generation state so failed requests clear stale candidates/request metadata instead of leaving the previous successful results on screen.
- Reconfirmed in local production preview that the simplified live path can still fail on prompt-echo-like outputs for some inputs; the visible UI no longer misattributes those stale candidates to the failed attempt.
- Replaced the loose opening-parser with a forced `emit_opening_candidates` tool call on the Anthropic-compatible provider, so the model now returns structured candidate JSON instead of numbered requirement fragments.
- Revalidated the campus-love smoke input after the parser change; it now returns four structured opening candidates through the tool-call path.
- Marked this snapshot as the current stable handoff point after independently rechecking the browser hydration issue and confirming the input counter / generate-button flow works again in the active server process.
- Added a structured refine-opening path that mirrors the candidate tool-call flow with `emit_refined_opening`, and tightened the route to accept only `refinedText` from the model.
- Revalidated the refine flow in `MOCK_LLM=1` mode; clicking a candidate's refine action now returns a plain opening text payload without analysis or thinking text in the response.
- Reviewed `TASK-2026-03-29-002` independently: the refine path now uses structured tool-call output with `emit_refined_opening`, returns only `refinedText`, and passes `npm run build` plus `npm run typecheck` after build.
- Rechecked `TASK-2026-03-29-002` on the real provider path with `MOCK_LLM=0` and a live `MINIMAX_API_KEY`; the refine endpoint now fails with `模型没有按结构化格式返回改写结果。`, so real-path verification is still blocked even though the mock path passes.
- Rechecked `TASK-2026-03-29-003` on the real provider path with `MOCK_LLM=0` and a live `MINIMAX_API_KEY`; the current 3000 service now returns structured `refinedText` successfully, so the live refine regression is resolved.
- Benchmarked the opening-generation latency path with live provider calls: analysis, prompt building, normalization, and persistence are all sub-20ms, while the model call dominates the wall time. On the current key, `MiniMax-M2.1-highspeed` and `MiniMax-M2.7-highspeed` are rejected as unsupported; `MiniMax-M2.5-highspeed` is the only usable model in this workspace. Within that model, `4` candidates at `1024` tokens is the stable baseline, `4` candidates at `700` tokens is slower, `3` candidates at `700` tokens is the fastest stable variant tested, and `512`/`600` token caps were too brittle because the tool call sometimes disappeared.
- `TASK-2026-03-29-004` split opening generation into per-candidate structured execution units, added progressive NDJSON streaming on `POST /api/generate-openings`, updated the page to append candidate cards as they arrive, and reverified the behavior in `npm run build`, `npm run typecheck`, the 3000 preview service, and the browser UI.
- Reviewer verification on the current build observed the progressive sequence directly in the browser: candidate cards appeared in order before completion, with the UI showing 2, then 3, then 4 cards as the request continued.
- `TASK-2026-03-29-005` then simplified that progressive flow further by removing the per-slot 3x retry, the opening-quality hard gate, and the slot-level fake fallback so failures now surface directly instead of being masked.
- Reviewer verification on the current build confirmed `TASK-2026-03-29-005` passed: build/typecheck succeeded, the progressive request still streamed 1-3 cards before completion, and the final slot failed directly without injecting fake正文 or fallback content.
- `TASK-2026-03-29-006` moved progressive persistence in front of the `candidate` progress event so each streamed candidate is already stored by the time the frontend sees it, keeping refine / copy / feedback lookups aligned with what the user already has on screen.
- Reviewer smoke on the current 3000 service confirmed the new persistence timing: the first streamed candidate could be refined, copied, and recorded for feedback immediately while the request was still in progress.
- Independently reviewed `TASK-2026-03-29-006` as the correct next fix boundary for the stale-refine bug; the task stays tightly scoped to progressive candidate persistence and avoids reopening prompt, refine, or UI work.
- Independently accepted `TASK-2026-03-29-006` on the current 3015 service: the first streamed candidate is already in `OpeningCandidate` before the client sees it, and refine succeeds against that ID while the generation stream is still active.
