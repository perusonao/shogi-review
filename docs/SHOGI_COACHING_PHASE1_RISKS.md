# Phase 1 Risks

- D1 may already hold KIF but lifecycle semantics may be insufficient; avoid redundant copies without audit.
- Issue #5 may modify overlapping worker/import files; coordinate/rebase.
- Retry can create duplicate Git artifacts or calibration rows if identity is not end-to-end.
- UI may falsely say saved when only queued in volatile/client state; acknowledgement must follow durable server persistence.
- Historical failed records may have incomplete metadata; never invent missing KIF.
