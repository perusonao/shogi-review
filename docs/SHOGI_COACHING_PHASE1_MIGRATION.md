# Phase 1 Migration Rule

Prefer additive/backward-compatible D1/schema changes. Existing completed games and current queue records must remain readable. Do not bulk-rewrite historical analysis JSON or re-run engine analysis. If historical failed-job recovery requires a separate migration, report it as a follow-up instead of silently expanding scope.
