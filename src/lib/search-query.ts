import type { SearchState } from "../types";

export function escapeCqlString(value: string): string {
  return value.replace(/'/g, "''");
}

export function buildSearchQuery(state: SearchState): URLSearchParams {
  const filters = state.keywords.map((keyword) => `keywords LIKE '%${escapeCqlString(keyword)}%'`);
  if (state.start) filters.push(`date_modified >= '${escapeCqlString(state.start)}'`);
  if (state.end) filters.push(`date_modified <= '${escapeCqlString(state.end)}'`);
  const parameters = new URLSearchParams();
  if (filters.length) {
    parameters.set("filter", filters.join(" AND "));
    parameters.set("filter-lang", "cql2-text");
  }
  if (state.query.trim()) parameters.set("q", state.query.trim());
  return parameters;
}

export function appendSearchQuery(itemsUrl: string, query: URLSearchParams): string {
  const url = new URL(itemsUrl);
  for (const [key, value] of query) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}
