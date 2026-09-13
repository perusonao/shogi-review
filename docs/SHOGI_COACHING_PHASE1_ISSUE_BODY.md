# Phase 1 Durable KIF First — Implementation

Priority: P0
Environment: 🔀 Hybrid (Cloud implementation; Windows final E2E only if required)
Recommended AI: Codex / GPT-5.6 Sol / High

Goal: improve `棋譜保存 → 分析` in the coaching loop by guaranteeing that one pasted KIF becomes a durable source before analysis and remains retryable after downstream failure.

Read latest origin/main and `docs/SHOGI_COACHING_PRODUCT_SSOT.md`, `SHOGI_COACHING_ROADMAP.md`, and all `SHOGI_COACHING_PHASE1*` planning docs. Audit actual current D1/queue/PWA/worker code before choosing schema.

Implement minimal backward-compatible durable source persistence, storage-vs-analysis states, idempotent retry from stored source, and clear iPhone status UI. Preserve existing security/outbound-worker architecture.

Do not change engine nodes/PV policy, B-strict, Reason Evidence, production skill rank, existing analysis JSON, or cloud-hosting architecture. Do not bulk reanalyze.

Acceptance is defined by `SHOGI_COACHING_PHASE1_ACCEPTANCE.md`; tests by `..._TEST_MATRIX.md`; security by `..._SECURITY.md`; review by `..._REVIEW_GATE.md`.

Post baseline main, commit/PR, design chosen after audit, test results, idempotency/failure results, UI result, security result, Windows E2E state, and final DONE/REVIEW_REQUIRED/WAITING_FOR_PC/BLOCKED verdict to the Issue. Issue comment is completion SSOT.
