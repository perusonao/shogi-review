# Phase 1 Observability

Worker/server logs should identify safe source/job IDs and failure stage without logging full credentials. The PWA needs only safe user-facing status. Detailed stderr may remain local/server-side. The design should make it possible to answer: was the KIF saved, where did analysis fail, and can this exact source be retried?
