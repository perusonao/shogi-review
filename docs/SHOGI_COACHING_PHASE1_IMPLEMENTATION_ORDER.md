# Phase 1 Implementation Order

1. Audit current queue/D1/KIF persistence and fingerprint semantics.
2. Write failing tests for source survival and retry.
3. Add minimal backward-compatible persistence/status changes.
4. Add retry contract.
5. Update PWA state wording/actions.
6. Run regression/security/idempotency tests.
7. Review overlap with Issue #5 and latest main.
8. Post result to Issue; merge only after gates pass.
