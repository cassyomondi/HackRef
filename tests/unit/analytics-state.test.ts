import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgReportState } from "ag-studio";
import { clearAnalyticsFilters, hasAnalyticsFilters } from "../../src/lib/evaluation/analytics-state";

const base: AgReportState = { selectedPageId: "Progress", pages: [{ id: "Progress" }, { id: "Scores" }] };

test("analytics scope follows native selections, ranges and page/widget filters on the selected report", () => {
  assert.equal(hasAnalyticsFilters(base), false);
  for (const selection of [
    { type: "value" as const, field: { id: "project" }, values: ["A"], group: 0 },
    { type: "range" as const, field: { id: "score" }, from: 0, group: 0 },
    { type: "multiValue" as const, values: [[{ field: { id: "project" }, value: "A" }]], group: 0 },
  ]) {
    const state: AgReportState = { ...base, pages: [{ id: "Progress", crossFilter: { values: { records: [selection] } } }, base.pages[1]] };
    assert.equal(hasAnalyticsFilters(state), true);
    assert.equal(hasAnalyticsFilters({ ...state, selectedPageId: "Scores" }), false);
  }
  assert.equal(hasAnalyticsFilters({ ...base, pages: [{ id: "Progress", crossFilter: { values: { records: [{ type: "value", field: { id: "project" }, values: [], group: 0 }] } } }] }), false);
  const filter = { field: { id: "project" }, model: { operator: "isIn" as const, value: ["A"] } };
  assert.equal(hasAnalyticsFilters({ ...base, pages: [{ id: "Progress", filter: { page: [filter] } }] }), true);
  assert.equal(hasAnalyticsFilters({ ...base, pages: [{ id: "Progress", filter: { widget: { records: [filter] } } }] }), true);
});

test("clearing filters is immutable and clears every page without changing widgets, layout or selected page", () => {
  const state: AgReportState = { ...base, pages: base.pages.map((page) => ({ ...page,
    widgets: { count: { type: "value", dataMapping: { value: [{ id: "count", aggregation: "sum" }] } } },
    widgetLayout: { count: { xTrack: 0, yTrack: 0, xSpan: 6, ySpan: 5 } },
    crossFilter: { values: { records: [{ type: "value", field: { id: "project" }, values: ["A"], group: 0 }] } },
    filter: { page: [{ field: { id: "score" }, model: { operator: "greaterThan", value: 0 } }] },
  })) };
  const before = structuredClone(state);
  const cleared = clearAnalyticsFilters(state);
  assert.deepEqual(state, before);
  assert.equal(cleared.selectedPageId, state.selectedPageId);
  for (const page of cleared.pages) {
    assert.equal(hasAnalyticsFilters({ ...cleared, selectedPageId: page.id }), false);
    assert.equal(page.widgets, state.pages.find((p) => p.id === page.id)!.widgets);
    assert.equal(page.widgetLayout, state.pages.find((p) => p.id === page.id)!.widgetLayout);
  }
});
