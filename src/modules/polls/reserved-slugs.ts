// One reserved-slug registry imported by BOTH routing and slug validation
// (AD-13). Story 1.4's custom-link validation must import this same set.

// First path segments owned by the application itself.
const RESERVED_APPLICATION_SLUGS = [
  "/",
  "creator",
  "discover",
  "media",
  "sign-in",
  "assets",
  "api",
  "_astro",
  "favicon.ico",
  "favicon.svg",
  "fonts",
  "robots.txt",
  "sitemap.xml",
] as const;

// Per-poll sub-paths (`/{link}/results`, `/{link}/manifest`). The
// `[reference].astro` route matches single segments only, so these are
// reserved as first segments too — a reference may not claim them.
const RESERVED_POLL_SUBPATHS = ["results", "manifest"] as const;

export const RESERVED_SLUGS = [
  ...RESERVED_APPLICATION_SLUGS,
  ...RESERVED_POLL_SUBPATHS,
] as const;

const RESERVED = new Set<string>(RESERVED_SLUGS);

export function isReservedSlug(slug: string): boolean {
  return slug.length === 0 || RESERVED.has(slug.toLowerCase());
}
