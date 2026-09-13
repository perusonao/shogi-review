# Phase 1 Architecture Decision

Decision: durable source storage is upstream of analysis and is the system of record for a submitted game until GitHub artifacts are successfully produced. Analysis is a repeatable derived process, not the act that creates the only copy of the game.

This principle remains valid whether the analyzer is Windows-based today or cloud-based later.
