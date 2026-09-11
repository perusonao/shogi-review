export const STATUS_TRANSITIONS = Object.freeze({
  queued: new Set(["processing"]),
  processing: new Set(["completed", "failed"]),
  completed: new Set(),
  failed: new Set(["queued"]),
});

export function canTransition(from, to) {
  return Boolean(STATUS_TRANSITIONS[from]?.has(to));
}
