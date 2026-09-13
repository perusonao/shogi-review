# Phase 1 Security Invariants

- No GitHub PAT/API token in public PWA JavaScript.
- No plaintext queue/worker secret in repository, Issue, PR, or logs.
- Keep Windows worker outbound-only; do not open incoming ports for this Phase.
- Retry endpoints must require the existing authenticated model or a comparably safe server-side mechanism.
- User-visible errors may expose safe stage/status, never credentials or sensitive headers.
