# Phase 1 Retry Semantics

Retry means: create/requeue a new analysis attempt that references the already-saved source identity. It must not require a second client KIF paste and must not create a second logical game. A completed source should be safely deduplicated rather than analyzed into duplicate production artifacts unless an explicit future reanalysis feature requests a new analysis version.
