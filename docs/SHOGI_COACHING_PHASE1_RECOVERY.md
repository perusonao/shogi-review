# Phase 1 Recovery Goal

New failures after Phase 1 must be recoverable from durable source storage. Historical failed jobs such as earlier iPhone submissions should be recovered when their stored source still exists, but historical recovery must not block the new durable contract. Any unrecoverable historical source should be explicitly reported rather than reconstructed from guesses.
