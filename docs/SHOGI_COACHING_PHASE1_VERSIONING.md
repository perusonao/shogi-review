# Phase 1 Identity and Versioning

The logical game/source identity must be stable across retries. Analysis output may later gain explicit versions, but Phase 1 must not solve that future problem by cloning the game. Normalization used for fingerprinting must be deterministic and tested so harmless formatting differences do not accidentally create duplicate logical games where the existing system already normalizes them.
