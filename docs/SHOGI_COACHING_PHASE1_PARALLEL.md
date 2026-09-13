# Phase 1 Parallel Work

Issue #5 Phase 2 Windows-worker recovery may proceed in parallel because it validates downstream processing. Phase 1 owns durable capture/retry semantics. If both touch the same queue/worker files, whichever PR lands second must rebase and rerun full relevant tests. Do not combine them merely for convenience.
