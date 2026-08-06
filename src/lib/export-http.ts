export const EXPORT_CACHE_CONTROL = "private, no-store";

export function exportBaseHeaders(): Headers {
  return new Headers({
    "cache-control": EXPORT_CACHE_CONTROL,
    "x-content-type-options": "nosniff",
  });
}

export function safeExportFilename(
  reference: string,
  extension: "csv" | "xlsx",
): string {
  const safe = reference
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  return `oddspark-${safe || "poll"}.${extension}`;
}
