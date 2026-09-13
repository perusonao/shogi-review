# Phase 1 Acceptance

1. PWA submit success means original KIF has already been durably stored.
2. Storage status and analysis status are separate concepts.
3. Engine/worker/publish failure cannot delete the original KIF.
4. A failed analysis can be retried using the stored KIF without repaste.
5. Retry is idempotent: no duplicate game, source KIF, analysis artifact, or calibration row.
6. PWA distinguishes stored, queued, processing, failed-analysis, and completed.
7. Existing successful pipeline remains compatible.
8. No client-side PAT/API token and no secret in GitHub/log output.
9. Related tests and `git diff --check` pass.
10. No nodes policy, B-strict, Reason Evidence, or production skill-estimation change.
