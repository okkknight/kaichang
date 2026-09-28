# Handoff Pack

This repository intentionally keeps a compact handoff set so future sessions can resume quickly.

## Current Snapshot

- The product is still the Chinese-first opening generator, and the default generation path is now a single provider call with raw-input-led prompting, light normalization, and hard validation.
- The current opening path now emits candidates slot by slot through a progressive structured flow, and the frontend renders each candidate as soon as it arrives instead of waiting for all 4.
- `TASK-2026-03-29-005` simplified that slot flow further by removing the per-slot 3x retry, the opening-quality hard gate, and the slot-level fake fallback; if a slot truly fails, the request now errors directly after preserving already streamed cards.
- The single-candidate structured tool-call parser still exists for each slot, but the active execution path is no longer a single batch call.
- The refine path now mirrors that structured approach with `emit_refined_opening`, and the UI only reads `refinedText` so process text does not leak into the preview.
- Front-end self-review is removed; scoring, evaluation, learning, and feedback stay in the backend.
- Real / recovered / fallback / mock states are still surfaced in the UI, but the active route no longer depends on the older batch / repair / compress / retry / fallback orchestration.
- The latest smoke pass confirmed the simplified path returns `200` for the standard Chinese test prompts, and the browser now shows cards arriving progressively before the request completes.
- The "content too short" check is now a soft quality hint instead of a hard failure, so short candidates can still be returned when other gates pass.
- Some raw-input-led prompts can still trip the prompt-echo gate on the live/simplified path; when that happens, the UI now clears the current candidate/request state instead of keeping the previous results on screen.
- The remaining questions are now quality-side: mock output still has some template flavor, and the real provider still needs a live-key regression pass before the simplification can be considered fully signed off.
- The current open problem is not just “whether the app can generate”, but “whether each generation stays specific, on-theme, structurally natural, and not overly template-shaped once the real provider is reintroduced”.
- The latest smoke input for the campus-love prompt now returns four structured candidates through the tool-call parser, which fixes the earlier requirement-fragment misparse.
- This snapshot is now the stable reviewer handoff point for the current state of the app: the browser hydration issue has been cleared, the input counter updates correctly, and the generate button enables again in the verified environment.
- `TASK-2026-03-29-002` is now independently verified as passed: refine uses structured tool-call output, the UI only consumes `refinedText`, and build/typecheck pass in the current workspace.
- `TASK-2026-03-29-003` is now resolved on the real provider path: with `MOCK_LLM=0` and the live MiniMax key on the current 3000 service, `/api/refine-opening` returns structured `refinedText` successfully.
- `TASK-2026-03-29-004` is now independently verified as passed: generation streams candidate cards progressively, the first cards appear before complete, and both the 3000 service and browser UI were checked on the current build.
- `TASK-2026-03-29-005` is now independently verified as passed: the simplified progressive path no longer uses per-slot retry, rule hard gates, or slot-level fake fallback, and a real slot failure now fails directly while earlier streamed cards remain visible.
- `TASK-2026-03-29-006` keeps that progressive flow but now persists each emitted candidate before the `candidate` progress event goes out, so refine / copy / feedback can resolve the row as soon as the card appears.
- The latest smoke verified the new timing on the current 3000 service: the first streamed candidate could be refined, copied, and recorded for feedback immediately, even before the overall request finished.
- `TASK-2026-03-29-006` was also reviewed as the correct follow-up task for the stale-refine issue: the task stays narrowly focused on aligning candidate emission with persistence and does not widen into refine, prompt, or UI changes.
- `TASK-2026-03-29-006` is now accepted on the current 3015 service as well: the first candidate row exists in `OpeningCandidate` before the UI renders it, and refine succeeds against that ID during the same generation stream.
- After each completed task, refresh this handoff pack so the next session does not have to reconstruct the current state from scratch.

## Read In This Order

1. [`PROJECT_CONTEXT.md`](../../PROJECT_CONTEXT.md)
2. [`docs/handoff/CHANGELOG.md`](../../docs/handoff/CHANGELOG.md)
3. The product docs if you need deeper product intent:
   - [`kaichang_PRD.md`](../../kaichang_PRD.md)
   - [`kaichang_technical_design.md`](../../kaichang_technical_design.md)

## Why This Exists

- Give future agents one source of truth for project shape and current state.
- Avoid duplicated status docs.
- Keep the repo easy to resume after interruptions.
- The pack is intentionally compact and should stay that way unless the project clearly outgrows it.
- Preserve the current open risks so future agents do not assume mock-template flavor or real-path regressions are already solved.
