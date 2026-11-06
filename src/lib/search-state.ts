import type { SearchState } from "../types";

export function parseSearchState(search: string): SearchState {
  const params = new URLSearchParams(search);
  const bboxValues = params.get("bbox")?.split(",").map(Number);
  const bbox: SearchState["bbox"] =
    bboxValues?.length === 4 && bboxValues.every(Number.isFinite)
      ? [bboxValues[0]!, bboxValues[1]!, bboxValues[2]!, bboxValues[3]!]
      : null;
  return {
    query: params.get("q") || "",
    keywords: params.getAll("keyword"),
    start: params.get("start") || "",
    end: params.get("end") || "",
    bbox,
    page: Math.max(1, Number.parseInt(params.get("page") || "1", 10) || 1),
  };
}

export function serializeSearchState(pathname: string, state: SearchState): string {
  const params = new URLSearchParams();
  const hasOtherFilters = Boolean(state.keywords.length || state.start || state.end || state.bbox);
  if (state.query || !hasOtherFilters) params.set("q", state.query);
  state.keywords.forEach((keyword) => params.append("keyword", keyword));
  if (state.start) params.set("start", state.start);
  if (state.end) params.set("end", state.end);
  if (state.bbox) params.set("bbox", state.bbox.map((value) => value.toFixed(6)).join(","));
  if (state.page > 1) params.set("page", String(state.page));
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
