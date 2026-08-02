// BARS · PIE view swap (Story 1.10, UX-DR5) — the toggle's own sanctioned
// hand-written script, separate from the poller. BARS is the default on
// every load and the choice is per-viewer and never persisted: no storage,
// no cookie, no server field, no added request. PIE hides the bar group
// visually (the poller keeps patching the hidden DOM); re-entering BARS
// snaps at current values with no replay — a synchronous tally-local event
// asks the poller to cancel its private tweens before BARS is revealed.
//
// The pie is drawn geometry built with DOM APIs only (template-string
// markup construction fails the build) and is static by contract: every
// render is a plain rebuild at current values — no transition on slices,
// no count-up in the legend, no animated sweep on entry, including on live
// updates. Its one data source is the bars' server-rendered data attributes:
// unrounded data-pie-share for geometry, rounded percent/count for display.
// The poller keeps all three current, and a MutationObserver re-renders while
// PIE is active.

import { barAccessibleName } from "../components/results-bar";
import {
  RESULTS_CHART_FORM_CHANGE_EVENT,
  type ResultsChartForm,
} from "./chart-form-contract";
import { pieSlicePathD, pieSlices } from "./chart-pie-core";
import {
  clearResultsSparks,
  prepareResultsSparks,
} from "./results-spark";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const PIE_VIEWBOX_SIZE = 200;
const PIE_CENTER = PIE_VIEWBOX_SIZE / 2;
const PIE_RADIUS = 92;

type PieEntry = {
  id: string;
  label: string;
  percent: number;
  pieShare: number;
  count: number;
  leading: boolean;
};

// The own-vote spark (Story 1.10, AC #6) — the one sanctioned exception to
// never-animate-on-initial-paint, and the entire celebration budget.
// data-your-option marks the voter's own bar(s) only on the counted
// confirmation render, so its presence IS the confirmation: the spark fires
// once per page load, simultaneously on every selected bar (a cascade is
// banned choreography), and is omitted entirely under reduced motion — the
// confirmation text is the state change and nothing is lost. It lives here
// because this script loads on every visible Tally, open or closed — a Poll
// that closed between vote and render still confirms with a spark, and
// multi-select confirmations render no toggle to hang the hook on. A double
// rAF lands behind the cold-load enhancer's own double rAF, so the spark
// starts on the frame the Tally is revealed, never before.
const sparkOwnBallot = (root: HTMLElement): void => {
  const yourBars = Array.from(
    root.querySelectorAll<HTMLElement>(
      "[data-tally-final] [data-your-option]",
    ),
  );
  if (yourBars.length === 0) {
    return;
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  const fills = yourBars.flatMap((bar) => {
    const fill = bar.querySelector<HTMLElement>(".results-bar-fill");
    return fill ? [fill] : [];
  });
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const startSparks = prepareResultsSparks(fills);
      // One flush, then every bar's spark starts on the same frame.
      void root.offsetWidth;
      startSparks();
    });
  });
};

const enhanceChartFormToggle = (root: HTMLElement): void => {
  const toggle = root.querySelector<HTMLElement>("[data-chart-form-toggle]");
  if (!toggle) {
    // Multi-select Polls are bars-only and render no toggle, and hidden
    // surfaces render no Tally at all — nothing to enhance.
    return;
  }
  const bars = root.querySelector<HTMLElement>("[data-tally-final]");
  const pie = root.querySelector<HTMLElement>("[data-chart-form-pie]");
  const barsButton = toggle.querySelector<HTMLButtonElement>(
    '[data-chart-form="bars"]',
  );
  const pieButton = toggle.querySelector<HTMLButtonElement>(
    '[data-chart-form="pie"]',
  );
  if (!bars || !pie || !barsButton || !pieButton) {
    return;
  }

  let pieActive = false;
  root.dataset.chartFormState = "bars";

  // The decorative SVG may rebuild, but the accessible legend and each
  // option-keyed row persist for the lifetime of the view. A live refresh
  // therefore updates the reader's current nodes rather than replacing its
  // virtual-cursor anchors.
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute(
    "viewBox",
    `0 0 ${PIE_VIEWBOX_SIZE} ${PIE_VIEWBOX_SIZE}`,
  );
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "chart-form-pie-svg");
  svg.setAttribute("hidden", "");
  const legend = document.createElement("ol");
  legend.setAttribute("class", "chart-form-pie-legend");
  pie.appendChild(svg);
  pie.appendChild(legend);
  const legendRows = new Map<
    string,
    {
      row: HTMLLIElement;
      label: HTMLSpanElement;
      pct: HTMLSpanElement;
      count: HTMLSpanElement;
    }
  >();

  const readPieEntries = (): PieEntry[] =>
    Array.from(bars.querySelectorAll<HTMLElement>("[data-option-id]")).map(
      (bar) => ({
        id: bar.dataset.optionId ?? "",
        label: bar.querySelector(".results-bar-label")?.textContent ?? "",
        percent: Number(bar.dataset.percent ?? "0"),
        pieShare: Number(bar.dataset.pieShare ?? "0"),
        count: Number(bar.dataset.count ?? "0"),
        leading: bar.classList.contains("is-leader"),
      }),
    );

  // Slices rebuild plainly at current server-owned shares; the accessible
  // legend is reconciled in place below.
  const renderPie = (): void => {
    const entries = readPieEntries();
    const slices = pieSlices(entries.map((entry) => entry.pieShare));
    svg.replaceChildren();
    if (slices.length === 0) {
      svg.setAttribute("hidden", "");
    } else {
      svg.removeAttribute("hidden");
    }

    // An empty Poll (zero votes) renders no ring — the tally's empty-state
    // line and the zero-valued legend rows carry the state.
    if (slices.length > 0) {
      let nonLeaderIndex = 0;
      for (const slice of slices) {
        const entry = entries[slice.optionIndex];
        if (!entry) {
          continue;
        }
        const d = pieSlicePathD(
          PIE_CENTER,
          PIE_CENTER,
          PIE_RADIUS,
          slice.startAngleDeg,
          slice.endAngleDeg,
        );
        // A full-circle slice can't be one arc (its endpoints coincide).
        const shape = d === null
          ? document.createElementNS(SVG_NAMESPACE, "circle")
          : document.createElementNS(SVG_NAMESPACE, "path");
        if (d === null) {
          shape.setAttribute("cx", String(PIE_CENTER));
          shape.setAttribute("cy", String(PIE_CENTER));
          shape.setAttribute("r", String(PIE_RADIUS));
        } else {
          shape.setAttribute("d", d);
        }
        // Hue never carries leadership (composited washes measure 1.12:1)
        // — the legend's ◆ is the signal. Non-leader slices alternate so
        // adjacent slices separate.
        let fillClass = "chart-form-pie-slice-entropy";
        if (entry.leading) {
          fillClass = "chart-form-pie-slice-leader";
        } else {
          fillClass = nonLeaderIndex % 2 === 0
            ? "chart-form-pie-slice-entropy"
            : "chart-form-pie-slice-panel";
          nonLeaderIndex += 1;
        }
        shape.setAttribute("class", `chart-form-pie-slice ${fillClass}`);
        svg.appendChild(shape);
      }
    }

    // The legend carries the accessible content — one row per option in
    // creator order, named with the bar accessible-name pattern. On a tie
    // no bar is is-leader, so no gold and no ◆ render anywhere.
    const currentIds = new Set(entries.map((entry) => entry.id));
    for (const [id, hooks] of legendRows) {
      if (!currentIds.has(id)) {
        hooks.row.remove();
        legendRows.delete(id);
      }
    }
    for (const entry of entries) {
      let hooks = legendRows.get(entry.id);
      if (!hooks) {
        const row = document.createElement("li");
        row.setAttribute("class", "chart-form-pie-legend-row");
        row.dataset.optionId = entry.id;
        const label = document.createElement("span");
        label.setAttribute("class", "chart-form-pie-legend-label");
        label.setAttribute("aria-hidden", "true");
        // Never a percentage without its raw count (DESIGN.md binds the pie
        // legend too) — the bar-value typography, at final values.
        const value = document.createElement("span");
        value.setAttribute("class", "chart-form-pie-legend-value");
        value.setAttribute("aria-hidden", "true");
        const pct = document.createElement("span");
        pct.setAttribute("class", "chart-form-pie-legend-pct");
        const count = document.createElement("span");
        count.setAttribute("class", "chart-form-pie-legend-count");
        value.appendChild(pct);
        value.appendChild(count);
        row.appendChild(label);
        row.appendChild(value);
        legend.appendChild(row);
        hooks = { row, label, pct, count };
        legendRows.set(entry.id, hooks);
      }
      const { row, label, pct, count } = hooks;
      row.setAttribute(
        "aria-label",
        barAccessibleName(
          entry.label,
          entry.percent,
          entry.count,
          entry.leading,
        ),
      );
      const existingMark = row.querySelector<HTMLElement>(
        ".chart-form-pie-legend-mark",
      );
      if (entry.leading && !existingMark) {
        const mark = document.createElement("span");
        mark.setAttribute("class", "chart-form-pie-legend-mark");
        mark.setAttribute("aria-hidden", "true");
        mark.textContent = "◆";
        row.insertBefore(mark, label);
      } else if (!entry.leading && existingMark) {
        existingMark.remove();
      }
      if (label.textContent !== entry.label) {
        label.textContent = entry.label;
      }
      const percentText = `${entry.percent}%`;
      if (pct.textContent !== percentText) {
        pct.textContent = percentText;
      }
      const countText = ` · ${entry.count}`;
      if (count.textContent !== countText) {
        count.textContent = countText;
      }
    }
  };

  const render = (): void => {
    if (pieActive) {
      renderPie();
    }
    bars.hidden = pieActive;
    pie.hidden = !pieActive;
    barsButton.classList.toggle("is-current", !pieActive);
    pieButton.classList.toggle("is-current", pieActive);
    barsButton.setAttribute("aria-pressed", String(!pieActive));
    pieButton.setAttribute("aria-pressed", String(pieActive));
  };

  const selectForm = (form: ResultsChartForm): void => {
    const nextPieActive = form === "pie";
    if (pieActive === nextPieActive) {
      return;
    }
    pieActive = nextPieActive;
    root.dataset.chartFormState = form;
    // The poller owns tween/transition cancellation when present. Clearing
    // the shared one-shot class here also covers closed Tally surfaces that
    // intentionally have no poller.
    clearResultsSparks(root);
    root.dispatchEvent(
      new CustomEvent(RESULTS_CHART_FORM_CHANGE_EVENT, {
        detail: { form },
      }),
    );
    // Dispatch is synchronous and precedes BARS reveal, so the poller has
    // snapped every numeric slot before readers can see the form again.
    render();
  };

  barsButton.addEventListener("click", () => selectForm("bars"));
  pieButton.addEventListener("click", () => selectForm("pie"));

  // Live updates while PIE is active land as plain re-renders at the new
  // values: the poller keeps patching the hidden bars, and their data
  // attributes (plus the is-leader class, which carries tie withdrawals)
  // are the one uniform source. The class filter also catches leader
  // changes; no characterData — the count-up tween writes text every frame.
  const observer = new MutationObserver(() => {
    if (pieActive) {
      renderPie();
    }
  });
  observer.observe(bars, {
    attributes: true,
    attributeFilter: [
      "data-percent",
      "data-count",
      "data-pie-share",
      "class",
    ],
    subtree: true,
  });

  // The server renders the control hidden (the no-JS floor never sees a
  // dead control); running JS is what reveals it. SSR defaults — bars
  // shown, pie hidden, BARS current — already match the initial state.
  toggle.hidden = false;
};

for (const root of document.querySelectorAll<HTMLElement>(
  "[data-results-tally]",
)) {
  sparkOwnBallot(root);
  enhanceChartFormToggle(root);
}
