const PYODIDE_VERSION = "0.29.5";
const PAGE_SIZE = 10;
const CSW_URL = "https://csw.nina.no/csw";
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let pyodide;
let initialization;

const PYTHON_SEARCH = String.raw`
import json

from owslib.csw import CatalogueServiceWeb
from owslib.fes import (
    And,
    BBox,
    PropertyIsGreaterThanOrEqualTo,
    PropertyIsLessThanOrEqualTo,
    PropertyIsLike,
    SortBy,
    SortProperty,
)

PAGE_SIZE = 10
CSW_URL = "https://csw.nina.no/csw"
client = None


def initialize_catalogue_json():
    global client
    client = CatalogueServiceWeb(CSW_URL, version="2.0.2", timeout=30)
    client.getdomain("dc:subject", dtype="property")

    keywords = set()
    for domain_value in client.results.get("values", []):
        # PyCSW returns one comma-separated subject string per record.
        keywords.update(
            keyword.strip()
            for keyword in str(domain_value).split(",")
            if keyword.strip()
        )

    return json.dumps(sorted(keywords, key=str.casefold), ensure_ascii=False)


def _escape_like_literal(value):
    return str(value).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def search_json(payload_json):
    payload = json.loads(payload_json)
    constraints = []

    query = str(payload.get("query", "")).strip()
    if query:
        constraints.append(
            PropertyIsLike(
                "apiso:AnyText",
                f"%{_escape_like_literal(query)}%",
                escapeChar="\\",
                singleChar="_",
                wildCard="%",
                matchCase=False,
            )
        )

    for keyword in payload.get("keywords", []):
        constraints.append(
            PropertyIsLike(
                "dc:subject",
                f"%{_escape_like_literal(keyword)}%",
                escapeChar="\\",
                singleChar="_",
                wildCard="%",
                matchCase=False,
            )
        )

    start_date = payload.get("start")
    if start_date:
        constraints.append(
            PropertyIsGreaterThanOrEqualTo(
                "apiso:Modified", f"{start_date}T00:00:00Z"
            )
        )

    end_date = payload.get("end")
    if end_date:
        constraints.append(
            PropertyIsLessThanOrEqualTo(
                "apiso:Modified", f"{end_date}T23:59:59Z"
            )
        )

    bbox = payload.get("bbox")
    if bbox:
        west, south, east, north = (float(value) for value in bbox)
        if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
            raise ValueError("The selected map area is not a valid rectangle.")
        constraints.append(
            BBox(
                [west, south, east, north],
                crs="urn:ogc:def:crs:OGC:1.3:CRS84",
            )
        )

    if len(constraints) > 1:
        constraints = [And(constraints)]

    page = max(1, int(payload.get("page", 1)))
    client.getrecords2(
        constraints=constraints,
        sortby=SortBy([SortProperty("apiso:Modified", order="DESC")]),
        typenames="csw:Record",
        esn="summary",
        startposition=(page - 1) * PAGE_SIZE + 1,
        maxrecords=PAGE_SIZE,
    )

    records = []
    for record in client.records.values():
        subjects = record.subjects or []
        if isinstance(subjects, str):
            subjects = [subjects]
        records.append(
            {
                "identifier": record.identifier or "",
                "title": record.title or record.identifier or "Untitled dataset",
                "abstract": record.abstract or "",
                "keywords": list(dict.fromkeys(str(value) for value in subjects if value)),
                "modified": record.modified or "",
            }
        )

    return json.dumps(
        {
            "page": page,
            "pageSize": PAGE_SIZE,
            "matches": client.results.get("matches", 0),
            "records": records,
        },
        ensure_ascii=False,
    )
`;

async function initialize() {
  if (initialization) return initialization;

  initialization = (async () => {
    self.postMessage({ type: "status", message: "Loading browser Python runtime…" });
    importScripts(`${PYODIDE_BASE}pyodide.js`);
    pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });

    self.postMessage({ type: "status", message: "Installing OWSLib…" });
    await pyodide.loadPackage("micropip");
    await pyodide.runPythonAsync(`
import micropip
await micropip.install("OWSLib==0.36.0")
`);
    await pyodide.runPythonAsync(PYTHON_SEARCH);

    self.postMessage({ type: "status", message: "Connecting to NINA catalogue…" });
    const keywordsJson = await pyodide.runPythonAsync("initialize_catalogue_json()");
    const keywords = JSON.parse(String(keywordsJson));
    self.postMessage({ type: "ready", keywords });
  })();

  try {
    await initialization;
  } catch (error) {
    initialization = undefined;
    throw error;
  }
}

self.addEventListener("message", async ({ data }) => {
  if (data?.type === "init") {
    try {
      await initialize();
    } catch (error) {
      self.postMessage({
        type: "error",
        stage: "init",
        message: String(error?.message || error),
      });
    }
    return;
  }

  if (data?.type === "search") {
    try {
      if (!pyodide) throw new Error("Search service is not ready.");
      pyodide.globals.set("_search_payload_json", JSON.stringify(data.payload));
      const result = await pyodide.runPythonAsync("search_json(_search_payload_json)");
      self.postMessage({
        type: "results",
        requestId: data.requestId,
        result: JSON.parse(String(result)),
      });
    } catch (error) {
      self.postMessage({
        type: "error",
        stage: "search",
        requestId: data.requestId,
        message: String(error?.message || error),
      });
    }
  }
});
