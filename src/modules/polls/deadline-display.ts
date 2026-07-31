const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const COUNTDOWN_WINDOW_MS = 24 * HOUR_MS;

export function countdownLabel(
  deadlineMs: number,
  nowMs: number,
): string | null {
  const remainingMs = deadlineMs - nowMs;
  if (remainingMs <= 0 || remainingMs >= COUNTDOWN_WINDOW_MS) {
    return null;
  }
  if (remainingMs >= HOUR_MS) {
    return `CLOSES IN ${Math.max(1, Math.floor(remainingMs / HOUR_MS))}H`;
  }
  return `CLOSES IN ${Math.max(1, Math.floor(remainingMs / MINUTE_MS))}M`;
}
