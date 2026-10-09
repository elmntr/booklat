# Two-person build and merge workflow

Keep `plan.md` as the product brief. This file replaces its 3–4 person work allocation.

## Ten-hour split

| Hours | A: backend and speech | B: frontend and audio | Joint checkpoint |
|---|---|---|---|
| 0–1 | Test local ASR on deliberate miscues; choose model | Run scaffold; refine passage and session UI | Demo stream works on both laptops |
| 1–3 | VAD, ASR adapter, incremental aligner and tests | AudioWorklet, resampling to mono PCM16, mic errors | Agree audio framing, then test one real sentence |
| 3–5 | Validated scoring configuration, timestamps, stop flush | Real word events, results, teacher overrides | Full reading → stop → rescore |
| 5–7 | SQLite storage and CSV export | Roster UI, accessibility, disconnect handling | Restart and recover saved assessment |
| 7–8 | Tune speech and alignment | Polish and test microphone permissions | Freeze features |
| 8–10 | Fix blockers, package offline model assets | Demo script, backup recording | Three airplane-mode rehearsals |

Defer comprehension grading, phone access and extra models until the core loop works.

## Branches and small merges

After the repository's initial scaffold commit, each person uses a separate clone and
short branches such as `elmntr/backend-audio` and `elmntr/frontend-mic`.
Agree your default branch before pushing; the scaffold does not change repository settings.
Merge small PRs often. Pull the latest default branch before opening a new branch.
Do not share a mutable checkout, force-push another person's branch, or commit audio,
real learners, local databases, model weights, secrets, or dependency folders.

Backend owns schema changes. For a wire change:
1. Agree an example request/event/response in `docs/INTEGRATION.md`.
2. Update `server/schemas.py`, implementation and meaningful lifecycle tests.
3. Run `npm run contract`; include generated changes in the same PR.
4. Frontend owner updates consumers and reviews the change.
5. Run `npm run check` and `npm run contract:check`; merge only when green.

Prefer additive optional fields; coordinate removals or renamed fields in one PR.
Keep the demo adapter available when real speech is added, selected by explicit config.
Never present synthetic events as speech recognition. A failure to load a real model
must surface as a failure, not silently fall back to demo data.

## Ready-to-merge checklist

- Other owner can start both services using only README instructions.
- Schema and generated client match, and tests/build pass.
- Error/empty/stop/disconnect states are handled for the changed flow.
- The change doesn't require external services during an assessment.
- Explain behavior and validation in the PR, and note remaining integration work.
