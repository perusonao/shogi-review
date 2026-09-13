# Phase 1 Implementation Notes

Concrete schema/API choices are intentionally not prescribed here. The implementer must audit current main and prefer minimal additive changes. Preserve existing authentication and outbound-only worker architecture. If the current queue already durably stores full KIF, reuse it and strengthen lifecycle/retry/UI semantics rather than creating redundant storage.
