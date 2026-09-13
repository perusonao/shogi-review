# Phase 1 Data Contract

The implementation may choose the concrete storage schema after auditing current Cloudflare D1/queue code, but must preserve these logical concepts:

- source identity: deterministic fingerprint of normalized original KIF
- original KIF: durable canonical source text
- source saved timestamp
- analysis state: queued / processing / failed / completed
- safe failure metadata sufficient for retry/diagnosis
- analysis/result linkage to the same source identity
- retry attempt metadata without cloning the source

Do not duplicate the source merely because analysis is retried. Concrete migration must be backward-compatible and tested.
