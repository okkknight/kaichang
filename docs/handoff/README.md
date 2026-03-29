# Handoff Pack

This repository intentionally keeps a compact handoff set so future sessions can resume quickly.

## Current Snapshot

- The product is still the Chinese-first opening generator, and the default generation path is now a single provider call with raw-input-led prompting, light normalization, and hard validation.
- The current opening path now forces a single `emit_opening_candidates` tool call and only accepts the structured JSON payload from that tool, instead of guessing candidates from loose text.
- The refine path now mirrors that structured approach with `emit_refined_opening`, and the UI only reads `refinedText` so process text does not leak into the preview.
- Front-end self-review is removed; scoring, evaluation, learning, and feedback stay in the backend.
- Real / recovered / fallback / mock states are still surfaced in the UI, but the active route no longer depends on the older batch / repair / compress / retry / fallback orchestration.
- The latest smoke pass confirmed the simplified path returns `200` for the standard Chinese test prompts in `MOCK_LLM=1` mode.
- The "content too short" check is now a soft quality hint instead of a hard failure, so short candidates can still be returned when other gates pass.
- Some raw-input-led prompts can still trip the prompt-echo gate on the live/simplified path; when that happens, the UI now clears the current candidate/request state instead of keeping the previous results on screen.
- The remaining questions are now quality-side: mock output still has some template flavor, and the real provider still needs a live-key regression pass before the simplification can be considered fully signed off.
- The current open problem is not just “whether the app can generate”, but “whether each generation stays specific, on-theme, structurally natural, and not overly template-shaped once the real provider is reintroduced”.
- The latest smoke input for the campus-love prompt now returns four structured candidates through the tool-call parser, which fixes the earlier requirement-fragment misparse.
- This snapshot is now the stable reviewer handoff point for the current state of the app: the browser hydration issue has been cleared, the input counter updates correctly, and the generate button enables again in the verified environment.
- `TASK-2026-03-29-002` is now independently verified as passed: refine uses structured tool-call output, the UI only consumes `refinedText`, and build/typecheck pass in the current workspace.
- `TASK-2026-03-29-003` is now resolved on the real provider path: with `MOCK_LLM=0` and the live MiniMax key on the current 3000 service, `/api/refine-opening` returns structured `refinedText` successfully.
- After each completed task, refresh this handoff pack so the next session does not have to reconstruct the current state from scratch.

## Read In This Order

1. [`PROJECT_CONTEXT.md`](/Users/linpeiwen/knightspace/kaichang/PROJECT_CONTEXT.md)
2. [`docs/handoff/CHANGELOG.md`](/Users/linpeiwen/knightspace/kaichang/docs/handoff/CHANGELOG.md)
3. The product docs if you need deeper product intent:
   - [`kaichang_PRD.md`](/Users/linpeiwen/knightspace/kaichang/kaichang_PRD.md)
   - [`kaichang_technical_design.md`](/Users/linpeiwen/knightspace/kaichang/kaichang_technical_design.md)

## Why This Exists

- Give future agents one source of truth for project shape and current state.
- Avoid duplicated status docs.
- Keep the repo easy to resume after interruptions.
- The pack is intentionally compact and should stay that way unless the project clearly outgrows it.
- Preserve the current open risks so future agents do not assume mock-template flavor or real-path regressions are already solved.
