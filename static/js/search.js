const form = document.querySelector("#search-form");
const queryInput = document.querySelector("#query");
const keywordSearch = document.querySelector("#keyword-search");
const keywordOptions = document.querySelector("#keyword-options");
const dateFrom = document.querySelector("#date-from");
const dateTo = document.querySelector("#date-to");
const areaDetails = document.querySelector("#area-filter");
const areaStatus = document.querySelector("#area-status");
const drawAreaButton = document.querySelector("#draw-area");
const clearAreaButton = document.querySelector("#clear-area");
const searchButton = document.querySelector("#search-button");
const clearFiltersButton = document.querySelector("#clear-filters");
const searchStatus = document.querySelector("#search-status");
const retryButton = document.querySelector("#retry-search");
const resultsCount = document.querySelector("#results-count");
const resultsList = document.querySelector("#results-list");
const pagination = document.querySelector("#results-pagination");
const previousButton = document.querySelector("#previous-page");
const nextButton = document.querySelector("#next-page");
const pageStatus = document.querySelector("#page-status");
const detailUrls = JSON.parse(document.querySelector("#dataset-detail-urls").textContent);

const PAGE_SIZE = 10;
const MAPLIBRE_URL = "https://unpkg.com/maplibre-gl@6.16.0/dist/maplibre-gl.mjs";

let worker;
let workerReady = false;
let keywordValues = [];
let activeState = null;
let requestId = 0;
let selectedBounds = null;
let map;
let mapReady;
let maplibrePromise;
let drawMode = false;
let firstCorner = null;
let totalMatches = 0;

function setStatus(message, kind = "info") {
  searchStatus.textContent = message;
  searchStatus.className = "mb-4 rounded-box border p-4 text-sm";
  searchStatus.classList.add("border-base-300", "bg-base-100");
  if (kind === "error") {
    searchStatus.classList.remove("border-base-300", "bg-base-100");
    searchStatus.classList.add("border-error/40", "bg-error/10", "text-error-content");
  }
  searchStatus.dataset.state = kind;
}

function setFailure(stage, message) {
  console.error("CSW search failed", stage, message);
  workerReady = false;
  searchButton.disabled = true;
  retryButton.hidden = false;
  setStatus(
    stage === "init"
      ? "Could not connect to NINA’s catalogue. Check the connection and CORS configuration, then retry."
      : "Search failed. Your filters are unchanged. Check the connection and CORS configuration, then retry.",
    "error"
  );
}

function startWorker() {
  worker?.terminate();
  workerReady = false;
  searchButton.disabled = true;
  retryButton.hidden = true;
  setStatus("Starting the browser search service…");

  worker = new Worker(new URL("./search-worker.js", import.meta.url));
  worker.addEventListener("message", handleWorkerMessage);
  worker.addEventListener("error", (event) => {
    setFailure("init", event.message || "Worker failed to load.");
  });
  worker.postMessage({ type: "init" });
}

function handleWorkerMessage({ data }) {
  if (data.type === "status") {
    setStatus(data.message);
    return;
  }

  if (data.type === "ready") {
    workerReady = true;
    searchButton.disabled = false;
    retryButton.hidden = true;
    keywordValues = data.keywords;

    const state = readUrlState();
    renderKeywordOptions(state.keywords);
    restoreForm(state);

    if (state.submitted) {
      runSearch(state, { updateUrl: false });
    } else {
      setStatus("Search is ready. Set filters and select Search to browse the catalogue.");
    }
    return;
  }

  if (data.type === "results") {
    if (data.requestId !== requestId) return;
    renderResults(data.result);
    return;
  }

  if (data.type === "error") {
    if (data.stage === "search" && data.requestId !== requestId) return;
    setFailure(data.stage, data.message);
  }
}

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  const bboxValues = params.get("bbox")?.split(",").map(Number);
  const bbox = bboxValues?.length === 4 && bboxValues.every(Number.isFinite)
    ? bboxValues
    : null;

  return {
    query: params.get("q") || "",
    keywords: params.getAll("keyword"),
    start: params.get("start") || "",
    end: params.get("end") || "",
    bbox,
    page: Math.max(1, Number.parseInt(params.get("page") || "1", 10) || 1),
    submitted: params.get("submitted") === "1",
  };
}

function restoreForm(state) {
  queryInput.value = state.query;
  dateFrom.value = state.start;
  dateTo.value = state.end;
  selectedBounds = state.bbox;

  for (const checkbox of keywordOptions.querySelectorAll('input[name="keyword"]')) {
    checkbox.checked = state.keywords.includes(checkbox.value);
  }

  if (selectedBounds) {
    areaDetails.open = true;
    updateAreaStatus();
    ensureMap().then(syncMapArea).catch((error) => {
      console.error("Could not load area map", error);
      areaStatus.textContent = "The map could not be loaded. Try again later.";
    });
  } else {
    updateAreaStatus();
  }
}

function renderKeywordOptions(selected = []) {
  keywordOptions.replaceChildren();

  if (!keywordValues.length) {
    const message = document.createElement("p");
    message.className = "p-2 text-sm opacity-70";
    message.textContent = "No keyword options are available.";
    keywordOptions.append(message);
    return;
  }

  for (const keyword of keywordValues) {
    const label = document.createElement("label");
    label.className = "keyword-option flex cursor-pointer items-start gap-2 rounded p-2 text-sm hover:bg-base-200";
    label.dataset.keyword = keyword.toLocaleLowerCase();

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "keyword";
    checkbox.value = keyword;
    checkbox.checked = selected.includes(keyword);
    checkbox.className = "checkbox checkbox-sm mt-0.5";

    const text = document.createElement("span");
    text.textContent = keyword;

    label.append(checkbox, text);
    keywordOptions.append(label);
  }

  filterKeywordOptions();
}

function filterKeywordOptions() {
  const filter = keywordSearch.value.trim().toLocaleLowerCase();
  for (const option of keywordOptions.querySelectorAll(".keyword-option")) {
    option.hidden = !option.dataset.keyword.includes(filter);
  }
}

function readFormState(page = 1) {
  return {
    query: queryInput.value.trim(),
    keywords: [...keywordOptions.querySelectorAll('input[name="keyword"]:checked')]
      .map((checkbox) => checkbox.value),
    start: dateFrom.value,
    end: dateTo.value,
    bbox: selectedBounds,
    page,
    submitted: true,
  };
}

function validateState(state) {
  if (state.start && state.end && state.start > state.end) {
    setStatus("The start date must be on or before the end date.", "error");
    dateFrom.focus();
    return false;
  }
  return true;
}

function updateUrl(state, replace = false) {
  const params = new URLSearchParams();
  params.set("submitted", "1");
  if (state.query) params.set("q", state.query);
  for (const keyword of state.keywords) params.append("keyword", keyword);
  if (state.start) params.set("start", state.start);
  if (state.end) params.set("end", state.end);
  if (state.bbox) params.set("bbox", state.bbox.map((value) => value.toFixed(6)).join(","));
  if (state.page > 1) params.set("page", String(state.page));

  const nextUrl = `${window.location.pathname}?${params.toString()}`;
  if (nextUrl === `${window.location.pathname}${window.location.search}`) return;
  if (replace) {
    window.history.replaceState(null, "", nextUrl);
  } else {
    window.history.pushState(null, "", nextUrl);
  }
}

function runSearch(state, { updateUrl: shouldUpdateUrl = true } = {}) {
  if (!workerReady) return;
  if (!validateState(state)) return;

  activeState = { ...state, keywords: [...state.keywords], bbox: state.bbox ? [...state.bbox] : null };
  if (shouldUpdateUrl) updateUrl(activeState);

  requestId += 1;
  searchButton.disabled = false;
  retryButton.hidden = true;
  setStatus("Searching the NINA catalogue…");
  worker.postMessage({ type: "search", requestId, payload: activeState });
}

function renderResults(result) {
  const matches = Number(result.matches) || 0;
  totalMatches = matches;
  const totalPages = Math.ceil(matches / PAGE_SIZE);
  const currentPage = Number(result.page) || 1;

  if (totalPages && currentPage > totalPages && activeState) {
    const state = { ...activeState, page: totalPages };
    updateUrl(state, true);
    restoreForm(state);
    runSearch(state, { updateUrl: false });
    return;
  }
  if (!totalPages && currentPage > 1 && activeState) {
    activeState = { ...activeState, page: 1 };
    updateUrl(activeState, true);
  }

  resultsCount.hidden = false;
  resultsCount.textContent = `${matches} dataset${matches === 1 ? "" : "s"} found`;
  resultsList.replaceChildren();

  for (const record of result.records) {
    resultsList.append(renderRecord(record));
  }

  if (!matches) {
    const empty = document.createElement("p");
    empty.className = "rounded-box border border-base-300 bg-base-100 p-6 text-sm";
    empty.textContent = "No datasets match these filters. Try changing or clearing a filter.";
    resultsList.append(empty);
  }

  pagination.hidden = matches <= PAGE_SIZE;
  previousButton.disabled = currentPage <= 1;
  nextButton.disabled = currentPage >= totalPages;
  pageStatus.textContent = totalPages ? `Page ${currentPage} of ${totalPages}` : "No pages";
  setStatus("Search complete.");
}

function renderRecord(record) {
  const article = document.createElement("article");
  article.className = "card border border-base-300 bg-base-100 shadow-sm";
  const body = document.createElement("div");
  body.className = "card-body gap-3";

  const heading = document.createElement("h3");
  heading.className = "card-title text-primary";
  const detailUrl = detailUrls[record.identifier];
  if (detailUrl) {
    const link = document.createElement("a");
    link.href = detailUrl;
    link.textContent = record.title;
    heading.append(link);
  } else {
    heading.textContent = record.title;
  }
  body.append(heading);

  if (record.abstract) {
    const abstract = document.createElement("p");
    abstract.className = "line-clamp-4 text-sm";
    abstract.textContent = record.abstract;
    body.append(abstract);
  }

  if (record.keywords.length) {
    const keywords = document.createElement("div");
    keywords.className = "flex flex-wrap gap-2";
    for (const keyword of record.keywords) {
      const badge = document.createElement("span");
      badge.className = "badge badge-primary badge-outline";
      badge.textContent = keyword;
      keywords.append(badge);
    }
    body.append(keywords);
  }

  if (record.modified) {
    const modified = document.createElement("p");
    modified.className = "text-xs opacity-70";
    modified.textContent = `Metadata updated: ${record.modified}`;
    body.append(modified);
  }

  article.append(body);
  return article;
}

function formatBounds(bounds) {
  const [west, south, east, north] = bounds;
  return `Rectangle selected (${west.toFixed(2)}, ${south.toFixed(2)} to ${east.toFixed(2)}, ${north.toFixed(2)}).`;
}

function updateAreaStatus() {
  clearAreaButton.disabled = !selectedBounds && !drawMode;
  areaStatus.textContent = selectedBounds
    ? formatBounds(selectedBounds)
    : drawMode
      ? firstCorner
        ? "First corner selected. Choose the opposite corner."
        : "Choose the first corner, then the opposite corner."
      : "No area selected.";
}

function featureCollection(bounds = selectedBounds, draftCorner = firstCorner) {
  const features = [];
  if (bounds) {
    const [west, south, east, north] = bounds;
    features.push({
      type: "Feature",
      properties: { kind: "area" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ]],
      },
    });
  }
  if (!bounds && draftCorner) {
    features.push({
      type: "Feature",
      properties: { kind: "corner" },
      geometry: { type: "Point", coordinates: draftCorner },
    });
  }
  return { type: "FeatureCollection", features };
}

function syncMapArea() {
  if (!map || !map.getSource("search-area")) return;
  map.getSource("search-area").setData(featureCollection());
  if (selectedBounds) {
    const [west, south, east, north] = selectedBounds;
    map.fitBounds([[west, south], [east, north]], { padding: 48, maxZoom: 9 });
  }
}

async function ensureMap() {
  if (mapReady) return mapReady;
  mapReady = (async () => {
    maplibrePromise ||= import(MAPLIBRE_URL);
    const maplibregl = await maplibrePromise;
    map = new maplibregl.Map({
      container: "search-map",
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [15, 64],
      zoom: 3,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    await new Promise((resolve) => map.once("load", resolve));
    map.addSource("search-area", { type: "geojson", data: featureCollection() });
    map.addLayer({
      id: "search-area-fill",
      type: "fill",
      source: "search-area",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": "#2d6a4f", "fill-opacity": 0.18 },
    });
    map.addLayer({
      id: "search-area-outline",
      type: "line",
      source: "search-area",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "line-color": "#2d6a4f", "line-width": 2 },
    });
    map.addLayer({
      id: "search-area-corner",
      type: "circle",
      source: "search-area",
      filter: ["==", ["geometry-type"], "Point"],
      paint: { "circle-color": "#004f71", "circle-radius": 6 },
    });

    map.on("click", (event) => {
      if (!drawMode) return;
      const corner = [event.lngLat.lng, event.lngLat.lat];
      if (!firstCorner) {
        firstCorner = corner;
        syncMapArea();
        updateAreaStatus();
        return;
      }

      const west = Math.min(firstCorner[0], corner[0]);
      const east = Math.max(firstCorner[0], corner[0]);
      const south = Math.min(firstCorner[1], corner[1]);
      const north = Math.max(firstCorner[1], corner[1]);
      firstCorner = null;
      if (west === east || south === north) {
        drawMode = true;
        areaStatus.textContent = "Choose two distinct corners to make a rectangle.";
        return;
      }
      drawMode = false;
      map.getCanvas().style.cursor = "";
      selectedBounds = [west, south, east, north];
      syncMapArea();
      updateAreaStatus();
    });

    syncMapArea();
    return map;
  })().catch((error) => {
    mapReady = undefined;
    throw error;
  });
  return mapReady;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch(readFormState(1));
});

keywordSearch.addEventListener("input", filterKeywordOptions);

drawAreaButton.addEventListener("click", async () => {
  areaDetails.open = true;
  try {
    await ensureMap();
    drawMode = true;
    firstCorner = null;
    selectedBounds = null;
    map.getCanvas().style.cursor = "crosshair";
    syncMapArea();
    updateAreaStatus();
  } catch (error) {
    console.error("Could not load area map", error);
    areaStatus.textContent = "The map could not be loaded. Try again later.";
  }
});

clearAreaButton.addEventListener("click", () => {
  selectedBounds = null;
  firstCorner = null;
  drawMode = false;
  if (map) map.getCanvas().style.cursor = "";
  syncMapArea();
  updateAreaStatus();
});

areaDetails.addEventListener("toggle", () => {
  if (!areaDetails.open) return;
  ensureMap()
    .then(() => {
      map.resize();
      syncMapArea();
    })
    .catch((error) => {
      console.error("Could not load area map", error);
      areaStatus.textContent = "The map could not be loaded. Try again later.";
    });
});

clearFiltersButton.addEventListener("click", () => {
  form.reset();
  selectedBounds = null;
  firstCorner = null;
  drawMode = false;
  activeState = null;
  if (map) {
    map.getCanvas().style.cursor = "";
    syncMapArea();
  }
  updateAreaStatus();
  resultsCount.hidden = true;
  resultsList.replaceChildren();
  pagination.hidden = true;
  window.history.pushState(null, "", window.location.pathname);
  setStatus(workerReady ? "Search is ready. Set filters and select Search to browse the catalogue." : "Search service is unavailable. Retry the connection.");
});

retryButton.addEventListener("click", startWorker);

previousButton.addEventListener("click", () => {
  if (activeState && activeState.page > 1) {
    const state = { ...activeState, page: activeState.page - 1 };
    restoreForm(state);
    runSearch(state);
  }
});

nextButton.addEventListener("click", () => {
  if (activeState && activeState.page * PAGE_SIZE < totalMatches) {
    const state = { ...activeState, page: activeState.page + 1 };
    restoreForm(state);
    runSearch(state);
  }
});

window.addEventListener("popstate", () => {
  const state = readUrlState();
  renderKeywordOptions(state.keywords);
  restoreForm(state);
  if (state.submitted) {
    runSearch(state, { updateUrl: false });
  } else {
    activeState = null;
    resultsCount.hidden = true;
    resultsList.replaceChildren();
    pagination.hidden = true;
    if (workerReady) setStatus("Search is ready. Set filters and select Search to browse the catalogue.");
  }
});

const initialState = readUrlState();
queryInput.value = initialState.query;
dateFrom.value = initialState.start;
dateTo.value = initialState.end;
selectedBounds = initialState.bbox;
if (selectedBounds) areaDetails.open = true;
startWorker();
