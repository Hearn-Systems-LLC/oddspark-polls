// Server-rendered UTC floor for deadline timestamps: meaningful without
// JavaScript; the shared deadline-time enhancement rewrites it viewer-local
// when JS runs. Extracted from [reference].astro for the Results route.
export const formatUtc = (timestampMs: number): string =>
  new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(timestampMs);

export function formatMeetingSlotLocal(
  startsAtMs: number,
  endsAtMs: number,
  timeZone: string,
): string {
  const dateTime = new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone,
  });
  const endTime = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone,
  });
  return `${dateTime.format(startsAtMs)}–${endTime.format(endsAtMs)}`;
}

export function meetingSlotDayKey(timestampMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone,
  }).format(timestampMs);
}
