# Phase 1 Test Matrix

- New valid KIF: durable store then queued.
- Duplicate same KIF: same source/fingerprint, no duplicate.
- Worker unavailable: original remains stored; analysis status can fail/wait.
- Engine failure: original remains stored and retryable.
- Publish failure: original remains stored and retryable.
- Retry after failure: reaches completed without duplicate artifacts.
- Existing completed game resubmit: no duplicate.
- PWA 390px: stored/queued/processing/failed/completed status understandable.
- Authentication/logging: no secret/token exposure.
- Existing Node/Python/Cloudflare tests, relevant regressions, `git diff --check`.
