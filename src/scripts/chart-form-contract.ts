// Synchronous, tally-local handshake between the isolated chart-form and
// live-results enhancers. The dataset is state truth; the event only tells
// the poller to snap its private animation state before a view swap.

export const RESULTS_CHART_FORM_CHANGE_EVENT =
  "oddspark:chart-form-change";

export type ResultsChartForm = "bars" | "pie";
