import { useEffect, useRef, useState } from "react";
import { OgcApiEndpoint, sharedFetch } from "@camptocamp/ogc-client";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { appendSearchQuery, buildSearchQuery } from "../lib/search-query";
import { parseSearchState, serializeSearchState } from "../lib/search-state";
import { apiErrorMessage, isCrossOriginError } from "../lib/search-errors";
import DatasetPreview from "./DatasetPreview";
import type {
  CatalogueRecord,
  InterfaceStrings,
  RecordsDocument,
  SearchFeature,
  SearchFeatureCollection,
  SearchState,
} from "../types";

const PAGE_SIZE = 10;
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

interface Props {
  catalogueUrl: string;
  collectionId: string;
  keywords: string[];
  detailUrls: Record<string, string>;
  previewUrls: Record<string, string>;
  ui: InterfaceStrings;
}

type Corner = [number, number];
type Failure = "" | "init" | "search" | "validation";
type AreaError = boolean | "map";
type HistoryUpdate = "push" | "replace" | "none";

function format(message: string, values: Record<string, string | number> = {}): string {
  return message.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

function readUrlState(): SearchState {
  return parseSearchState(window.location.search);
}

function searchStateKey(state: SearchState): string {
  return JSON.stringify([state.query, state.keywords, state.start, state.end, state.bbox]);
}

function featureCollection(
  bounds: SearchState["bbox"],
  corner: Corner | null,
): SearchFeatureCollection {
  const features: SearchFeature[] = [];
  if (bounds) {
    const [west, south, east, north] = bounds;
    features.push({
      type: "Feature",
      properties: { kind: "area" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [west, south],
            [east, south],
            [east, north],
            [west, north],
            [west, south],
          ],
        ],
      },
    });
  } else if (corner) {
    features.push({
      type: "Feature",
      properties: { kind: "corner" },
      geometry: { type: "Point", coordinates: corner },
    });
  }
  return { type: "FeatureCollection", features };
}

function recordKeywords(record: CatalogueRecord): string[] {
  const values = record.properties?.keywords;
  return Array.isArray(values)
    ? [...new Set(values.filter((value): value is string => typeof value === "string" && !!value))]
    : [];
}

function isCatalogueRecord(value: unknown): value is CatalogueRecord {
  return (
    value !== null &&
    typeof value === "object" &&
    "id" in value &&
    typeof value.id === "string" &&
    "properties" in value &&
    value.properties !== null &&
    typeof value.properties === "object"
  );
}

export default function SearchApp({
  catalogueUrl,
  collectionId,
  keywords,
  detailUrls,
  previewUrls,
  ui,
}: Props) {
  const [query, setQuery] = useState<string>("");
  const [keywordFilter, setKeywordFilter] = useState<string>("");
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [start, setStart] = useState<string>("");
  const [end, setEnd] = useState<string>("");
  const [bbox, setBbox] = useState<SearchState["bbox"]>(null);
  const [areaOpen, setAreaOpen] = useState<boolean>(false);
  const [drawMode, setDrawMode] = useState<boolean>(false);
  const [firstCorner, setFirstCorner] = useState<Corner | null>(null);
  const [ready, setReady] = useState<boolean>(false);
  const [status, setStatus] = useState<string>(ui.loading_search);
  const [failure, setFailure] = useState<Failure>("");
  const [results, setResults] = useState<CatalogueRecord[]>([]);
  const [matches, setMatches] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [requestPending, setRequestPending] = useState<boolean>(false);
  const [areaError, setAreaError] = useState<AreaError>(false);
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const sourceReady = useRef(false);
  const stateRef = useRef({ bbox, drawMode, firstCorner });
  const requestId = useRef(0);
  const endpointRef = useRef<OgcApiEndpoint | null>(null);
  const appliedSearchKey = useRef<string | null>(null);

  stateRef.current = { bbox, drawMode, firstCorner };

  useEffect(() => {
    endpointRef.current = new OgcApiEndpoint(catalogueUrl);
    let active = true;
    endpointRef.current.recordCollections
      .then((collections) => {
        if (!active) return;
        if (!collections.includes(collectionId))
          throw new Error(`Missing Records collection ${collectionId}`);
        setReady(true);
        setFailure("");
        setStatus("");
        const restored = readUrlState();
        setQuery(restored.query);
        setSelectedKeywords(restored.keywords);
        setStart(restored.start);
        setEnd(restored.end);
        setBbox(restored.bbox);
        setPage(restored.page);
        setSubmitted(true);
        if (restored.bbox) setAreaOpen(true);
        runSearch(restored, "none");
      })
      .catch((error) => {
        console.error("OGC API Records connection failed", error);
        if (!active) return;
        setReady(false);
        setFailure("init");
        setStatus(isCrossOriginError(error) ? ui.cors_error : ui.connect_error);
      });
    return () => {
      active = false;
      requestId.current += 1;
    };
    // URL state is restored once, after the Records API is available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogueUrl, collectionId]);

  useEffect(() => {
    if (!areaOpen || !mapContainer.current || mapRef.current) return;
    setAreaError(false);
    let active = true;
    let map: MapLibreMap | undefined;
    import("../lib/maplibre")
      .then(({ Map: MapLibreMap, NavigationControl }) => {
        if (!active || !mapContainer.current) return;
        const createdMap = new MapLibreMap({
          container: mapContainer.current,
          style: MAP_STYLE,
          center: [15, 64],
          zoom: 3,
        });
        map = createdMap;
        mapRef.current = createdMap;
        createdMap.addControl(new NavigationControl(), "top-right");
        createdMap.once("load", () => {
          createdMap.addSource("search-area", {
            type: "geojson",
            data: featureCollection(stateRef.current.bbox, stateRef.current.firstCorner),
          });
          createdMap.addLayer({
            id: "search-area-fill",
            type: "fill",
            source: "search-area",
            filter: ["==", ["geometry-type"], "Polygon"],
            paint: { "fill-color": "#2d6a4f", "fill-opacity": 0.18 },
          });
          createdMap.addLayer({
            id: "search-area-outline",
            type: "line",
            source: "search-area",
            filter: ["==", ["geometry-type"], "Polygon"],
            paint: { "line-color": "#2d6a4f", "line-width": 2 },
          });
          createdMap.addLayer({
            id: "search-area-corner",
            type: "circle",
            source: "search-area",
            filter: ["==", ["geometry-type"], "Point"],
            paint: { "circle-color": "#004f71", "circle-radius": 6 },
          });
          sourceReady.current = true;
          createdMap.getCanvas().style.cursor = stateRef.current.drawMode ? "crosshair" : "";
          if (stateRef.current.bbox) {
            const [west, south, east, north] = stateRef.current.bbox;
            createdMap.fitBounds(
              [
                [west, south],
                [east, north],
              ],
              { padding: 48, maxZoom: 9 },
            );
          }
          createdMap.on("click", (event) => {
            const current = stateRef.current;
            if (!current.drawMode) return;
            const corner: Corner = [event.lngLat.lng, event.lngLat.lat];
            if (!current.firstCorner) {
              setFirstCorner(corner);
              return;
            }
            const west = Math.min(current.firstCorner[0], corner[0]);
            const east = Math.max(current.firstCorner[0], corner[0]);
            const south = Math.min(current.firstCorner[1], corner[1]);
            const north = Math.max(current.firstCorner[1], corner[1]);
            setFirstCorner(null);
            if (west === east || south === north) {
              setAreaError(true);
              return;
            }
            setDrawMode(false);
            setBbox([west, south, east, north]);
            setPage(1);
            setSubmitted(true);
            createdMap.getCanvas().style.cursor = "";
          });
        });
        createdMap.on("error", (event) => {
          if (event.error) {
            console.error("Search map failed", event.error);
            setAreaError("map");
          }
        });
      })
      .catch((error) => {
        console.error("Could not load area map", error);
        setAreaError("map");
      });
    return () => {
      active = false;
      map?.remove();
      if (mapRef.current === map) mapRef.current = null;
      sourceReady.current = false;
    };
  }, [areaOpen]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !sourceReady.current) return;
    (map.getSource("search-area") as GeoJSONSource | undefined)?.setData(
      featureCollection(bbox, firstCorner),
    );
    if (bbox) {
      const [west, south, east, north] = bbox;
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: 48, maxZoom: 9 },
      );
    }
    map.getCanvas().style.cursor = drawMode ? "crosshair" : "";
  }, [bbox, firstCorner, drawMode]);

  function applyUrl(state: SearchState, replace = false): void {
    const next = serializeSearchState(window.location.pathname, state);
    if (replace) window.history.replaceState(null, "", next);
    else window.history.pushState(null, "", next);
  }

  async function runSearch(state: SearchState, history: HistoryUpdate = "push"): Promise<void> {
    if (!endpointRef.current) return;
    if (state.start && state.end && state.start > state.end) {
      setStatus(ui.date_order_error);
      setFailure("validation");
      return;
    }
    const id = ++requestId.current;
    const request = { ...state, keywords: [...state.keywords], page: Math.max(1, state.page || 1) };
    appliedSearchKey.current = searchStateKey(request);
    setPage(request.page);
    setSubmitted(true);
    setFailure("");
    setRequestPending(true);
    setStatus(ui.searching);
    if (history !== "none") applyUrl(request, history === "replace");
    try {
      const itemsUrl = await endpointRef.current.getCollectionItemsUrl(collectionId, {
        asJson: true,
        limit: PAGE_SIZE,
        offset: (request.page - 1) * PAGE_SIZE,
        sortBy: ["-updated"],
        extent: request.bbox || undefined,
      });
      const url = appendSearchQuery(itemsUrl, buildSearchQuery(request));
      const response = await sharedFetch(url, "GET", true);
      if (!response.ok) {
        const message = apiErrorMessage(
          await response.text(),
          response.status,
          response.statusText,
        );
        if (id !== requestId.current) return;
        setFailure("search");
        setStatus(format(ui.catalogue_rejected, { message }));
        return;
      }
      const document = (await response.json()) as RecordsDocument;
      if (id !== requestId.current) return;
      const records = Array.isArray(document.features)
        ? document.features.filter(isCatalogueRecord)
        : [];
      const total = Number(document.numberMatched ?? records.length);
      setResults(records);
      setMatches(Number.isFinite(total) ? total : records.length);
      if (total && request.page > Math.ceil(total / PAGE_SIZE)) {
        const correctedPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
        const corrected = { ...request, page: correctedPage };
        runSearch(corrected, "replace");
        return;
      }
      setStatus("");
    } catch (error) {
      if (id !== requestId.current) return;
      console.error("OGC API Records search failed", error);
      setFailure("search");
      setStatus(isCrossOriginError(error) ? ui.cors_error : ui.search_error);
    } finally {
      if (id === requestId.current) setRequestPending(false);
    }
  }

  const runSearchRef = useRef(runSearch);
  runSearchRef.current = runSearch;

  useEffect(() => {
    if (!ready || !submitted) return;
    const state: SearchState = {
      query: query.trim(),
      keywords: selectedKeywords,
      start,
      end,
      bbox,
      page: 1,
    };
    const key = searchStateKey(state);
    if (key === appliedSearchKey.current) return;
    const timeout = window.setTimeout(() => {
      void runSearchRef.current(state, "replace");
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [query, selectedKeywords, start, end, bbox, ready, submitted]);

  function currentState(nextPage = 1): SearchState {
    return { query: query.trim(), keywords: selectedKeywords, start, end, bbox, page: nextPage };
  }

  function toggleKeyword(keyword: string): void {
    setSubmitted(true);
    setPage(1);
    setSelectedKeywords((current) =>
      current.includes(keyword)
        ? current.filter((value) => value !== keyword)
        : [...current, keyword],
    );
  }

  function clearArea(autoApply = true): void {
    setBbox(null);
    setFirstCorner(null);
    setDrawMode(false);
    setAreaError(false);
    if (autoApply) {
      setSubmitted(true);
      setPage(1);
    }
    if (mapRef.current) mapRef.current.getCanvas().style.cursor = "";
  }

  function clearFilters(): void {
    requestId.current += 1;
    setQuery("");
    setKeywordFilter("");
    setSelectedKeywords([]);
    setStart("");
    setEnd("");
    clearArea(false);
    setResults([]);
    setMatches(0);
    setPage(1);
    setSubmitted(false);
    setFailure("");
    setRequestPending(false);
    appliedSearchKey.current = null;
    window.history.pushState(null, "", window.location.pathname);
    setStatus("");
  }

  function retry(): void {
    setFailure("");
    setStatus(ui.loading_search);
    endpointRef.current = new OgcApiEndpoint(catalogueUrl);
    endpointRef.current.recordCollections
      .then((collections) => {
        if (!collections.includes(collectionId))
          throw new Error(`Missing Records collection ${collectionId}`);
        setReady(true);
        setStatus("");
        const restored = readUrlState();
        setQuery(restored.query);
        setSelectedKeywords(restored.keywords);
        setStart(restored.start);
        setEnd(restored.end);
        setBbox(restored.bbox);
        setPage(restored.page);
        setSubmitted(true);
        if (restored.bbox) setAreaOpen(true);
        runSearch(restored, "none");
      })
      .catch((error) => {
        console.error("Could not reconnect to OGC API Records", error);
        setFailure("init");
        setStatus(isCrossOriginError(error) ? ui.cors_error : ui.connect_error);
      });
  }

  useEffect(() => {
    const handlePopState = () => {
      const restored = readUrlState();
      setQuery(restored.query);
      setSelectedKeywords(restored.keywords);
      setStart(restored.start);
      setEnd(restored.end);
      setBbox(restored.bbox);
      setPage(restored.page);
      setSubmitted(true);
      setResults([]);
      setMatches(0);
      if (restored.bbox) setAreaOpen(true);
      runSearch(restored, "none");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
    // Keep browser history state in sync with the current form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const totalPages = Math.ceil(matches / PAGE_SIZE);
  const areaStatus = bbox
    ? format(ui.selected_rectangle, {
        west: bbox[0].toFixed(2),
        south: bbox[1].toFixed(2),
        east: bbox[2].toFixed(2),
        north: bbox[3].toFixed(2),
      })
    : drawMode
      ? firstCorner
        ? ui.first_corner
        : ui.choose_corners
      : ui.no_area;

  return (
    <>
      <noscript>
        <p className="mb-6 rounded-box border border-warning/40 bg-warning/10 p-4 text-sm">
          {ui.search_noscript}
        </p>
      </noscript>
      <div className="grid gap-8 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="search-sidebar lg:sticky lg:top-6">
          <form
            className="card border border-base-300 bg-base-100 shadow-sm"
            onSubmit={(event) => {
              event.preventDefault();
              setSubmitted(true);
              setPage(1);
              void runSearch(currentState(1), "replace");
            }}
          >
            <div className="card-body gap-5">
              <div>
                <label className="label" htmlFor="query">
                  <span className="label-text font-semibold">{ui.search_text}</span>
                </label>
                <input
                  id="query"
                  type="search"
                  className="input input-bordered w-full"
                  placeholder={ui.query_placeholder}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setSubmitted(true);
                    setPage(1);
                  }}
                />
              </div>
              <fieldset>
                <legend className="label">
                  <span className="label-text font-semibold">{ui.keywords}</span>
                </legend>
                <label className="label" htmlFor="keyword-search">
                  <span className="label-text text-sm">{ui.find_keyword}</span>
                </label>
                <input
                  id="keyword-search"
                  type="search"
                  className="input input-bordered input-sm w-full"
                  placeholder={ui.filter_keywords}
                  autoComplete="off"
                  value={keywordFilter}
                  onChange={(event) => setKeywordFilter(event.target.value)}
                />
                <div
                  className="keyword-options mt-3 rounded-box border border-base-300 p-2"
                  aria-label={ui.keywords}
                >
                  {keywords.length ? (
                    keywords
                      .filter((keyword) =>
                        keyword
                          .toLocaleLowerCase()
                          .includes(keywordFilter.trim().toLocaleLowerCase()),
                      )
                      .map((keyword) => (
                        <label
                          className="keyword-option flex cursor-pointer items-start gap-2 rounded p-2 text-sm hover:bg-base-200"
                          key={keyword}
                        >
                          <input
                            type="checkbox"
                            className="checkbox checkbox-sm mt-0.5"
                            checked={selectedKeywords.includes(keyword)}
                            onChange={() => toggleKeyword(keyword)}
                          />
                          <span className="min-w-0 wrap-anywhere">{keyword}</span>
                        </label>
                      ))
                  ) : (
                    <p className="p-2 text-sm opacity-70">{ui.no_keyword_options}</p>
                  )}
                </div>
                <p className="mt-2 text-xs opacity-70">{ui.all_keywords}</p>
              </fieldset>
              <fieldset>
                <legend className="label">
                  <span className="label-text font-semibold">{ui.metadata_updated}</span>
                </legend>
                <div className="grid grid-cols-2 gap-3">
                  <label>
                    <span className="label-text text-sm">{ui.from}</span>
                    <input
                      type="date"
                      className="input input-bordered input-sm mt-1 w-full"
                      value={start}
                      onChange={(event) => {
                        setStart(event.target.value);
                        setSubmitted(true);
                        setPage(1);
                      }}
                    />
                  </label>
                  <label>
                    <span className="label-text text-sm">{ui.to}</span>
                    <input
                      type="date"
                      className="input input-bordered input-sm mt-1 w-full"
                      value={end}
                      onChange={(event) => {
                        setEnd(event.target.value);
                        setSubmitted(true);
                        setPage(1);
                      }}
                    />
                  </label>
                </div>
              </fieldset>
              <details
                className="rounded-box border border-base-300 p-3"
                open={areaOpen}
                onToggle={(event) => setAreaOpen(event.currentTarget.open)}
              >
                <summary className="cursor-pointer font-semibold">{ui.area}</summary>
                <p className="mt-3 text-sm opacity-75">{ui.draw_instructions}</p>
                <div
                  ref={mapContainer}
                  className="search-map mt-3 overflow-hidden rounded-box border border-base-300"
                  aria-label={ui.map_for_search}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={() => {
                      setAreaOpen(true);
                      setDrawMode(true);
                      setFirstCorner(null);
                      setBbox(null);
                      setSubmitted(false);
                      setAreaError(false);
                    }}
                  >
                    {" "}
                    {ui.draw_rectangle}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    disabled={!bbox && !drawMode}
                    onClick={() => clearArea()}
                  >
                    {ui.clear_area}
                  </button>
                </div>
                <p className="mt-2 text-sm opacity-75" aria-live="polite">
                  {areaError === "map"
                    ? ui.map_error
                    : areaError
                      ? ui.distinct_corners
                      : areaStatus}
                </p>
              </details>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className="sr-only" aria-label={ui.search}>
                  {ui.search}
                </button>
                <button type="button" className="btn btn-outline" onClick={clearFilters}>
                  {ui.clear}
                </button>
              </div>
            </div>
          </form>
        </aside>
        <section aria-label={ui.search_page_title}>
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-primary sm:text-4xl">
              {ui.search_page_title}
            </h1>
            {submitted && (
              <p className="text-sm font-medium">
                {matches === 1 ? ui.found_dataset : format(ui.found_datasets, { count: matches })}
              </p>
            )}
          </div>
          {status && (
            <output
              className={`mb-4 block rounded-box border p-4 text-sm ${failure ? "border-error/40 bg-error/10 text-error-content" : "border-base-300 bg-base-100"}`}
              aria-live="polite"
            >
              {status}
            </output>
          )}
          {(failure === "init" || failure === "search") && (
            <button type="button" className="btn btn-outline mb-4" onClick={retry}>
              {ui.retry_connection}
            </button>
          )}
          <div className="grid gap-4">
            {results.map((record) => {
              const props = record.properties || {};
              const title = props.title || record.id || "Untitled dataset";
              const href = detailUrls[record.id];
              const modifiedValue = props.updated || props.date_modified || record.time?.date;
              const modified =
                modifiedValue instanceof Date ? modifiedValue.toISOString() : modifiedValue;
              return (
                <article
                  className="card border border-base-300 bg-base-100 shadow-sm"
                  key={record.id}
                >
                  <DatasetPreview
                    preview={previewUrls[record.id] || ""}
                    alt={format(ui.preview_of, { title })}
                  />
                  <div className="card-body gap-3">
                    <h3 className="card-title text-primary">
                      {href ? <a href={href}>{title}</a> : title}
                    </h3>
                    {props.description && (
                      <p className="line-clamp-4 text-sm">{props.description}</p>
                    )}
                    {!!recordKeywords(record).length && (
                      <div className="flex flex-wrap gap-2">
                        {recordKeywords(record).map((keyword) => (
                          <span
                            className="badge badge-primary badge-outline max-w-full h-auto min-h-6 whitespace-normal wrap-anywhere"
                            key={keyword}
                          >
                            {keyword}
                          </span>
                        ))}
                      </div>
                    )}
                    {modified && (
                      <p className="text-xs opacity-70">
                        {format(ui.updated_date, { date: modified })}
                      </p>
                    )}
                  </div>
                </article>
              );
            })}
            {submitted && matches === 0 && (
              <p className="rounded-box border border-base-300 bg-base-100 p-6 text-sm">
                {ui.no_match}
              </p>
            )}
          </div>
          {submitted && matches > PAGE_SIZE && (
            <nav className="mt-6 flex items-center justify-between gap-4" aria-label={ui.results}>
              <button
                type="button"
                className="btn btn-outline"
                disabled={page <= 1 || requestPending}
                onClick={() => runSearch(currentState(page - 1))}
              >
                {ui.previous}
              </button>
              <p className="text-sm" aria-live="polite">
                {format(ui.page_of, { page, total: totalPages })}
              </p>
              <button
                type="button"
                className="btn btn-outline"
                disabled={page >= totalPages || requestPending}
                onClick={() => runSearch(currentState(page + 1))}
              >
                {ui.next}
              </button>
            </nav>
          )}
        </section>
      </div>
    </>
  );
}
