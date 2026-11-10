import type { AgPageState, AgReportState } from "ag-studio";

// Studio owns the filtering; the host only labels its current scope and resets it.
export function hasAnalyticsFilters(state: AgReportState) {
  const page = state.pages.find((page) => page.id === state.selectedPageId);
  if (!page) return false;
  const selected = Object.values(page.crossFilter?.values ?? {}).some((selections) => selections.some((selection) => {
    if (selection.type === "value") return selection.values.length > 0;
    if (selection.type === "multiValue") return selection.values.some((values) => values.length > 0);
    return selection.from !== undefined || selection.to !== undefined;
  }));
  return selected || [...(page.filter?.page ?? []), ...Object.values(page.filter?.widget ?? {}).flat()].some((filter) => Boolean(filter.model));
}

export function clearAnalyticsFilters(state: AgReportState): AgReportState {
  return { ...state, pages: state.pages.map((page): AgPageState => ({ ...page, filter: undefined, crossFilter: undefined })) };
}
