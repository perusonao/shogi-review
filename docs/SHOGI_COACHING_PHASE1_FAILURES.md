# Phase 1 Failure Contract

Storage failure: submission is not accepted; user must be told the KIF was not saved.

Any failure after durable storage: submission remains recoverable. UI must say the KIF is saved and analysis failed/waits. Retry operates on the saved source identity.

Never collapse storage failure and analysis failure into the same generic message.
