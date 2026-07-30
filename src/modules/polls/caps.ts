// Server-enforced caps protecting page weight and D1 batch limits on a
// public-signup surface (Story 1.3 AC #4 assumptions). Kept in their own
// provider-free module so the create form's client script can import the
// caps without dragging the whole domain command into the browser chunk.
export const POLL_CAPS = {
  maxOptions: 30,
  maxQuestionLength: 280,
  maxOptionLength: 100,
  maxDescriptionLength: 5000,
} as const;

// Re-render ceiling for option rows on the create form — far above the
// option cap so legitimate over-cap submissions re-render fully while crafted
// thousand-row bodies stay bounded. Shared by the page and its JS.
export const RENDER_OPTION_CEILING = 100;
