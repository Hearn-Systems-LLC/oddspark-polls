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
