const PYODIDE_VERSION = "0.29.5";
const OWSLIB_VERSION = "0.36.0";
const PAGE_SIZE = 10;
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const PACKAGE_CACHE_ROOT = "/nina-datasets-search-packages";
const PACKAGE_CACHE_PATH = `${PACKAGE_CACHE_ROOT}/pyodide-${PYODIDE_VERSION}-owslib-${OWSLIB_VERSION}`;
const PACKAGE_CACHE_MANIFEST = `pyodide-${PYODIDE_VERSION};OWSLib==${OWSLIB_VERSION}`;

let pyodide;
let initialization;
let searchQueue = Promise.resolve();
let latestRequestId;
let packageCacheMounted = false;

const PYTHON_PACKAGE_SETUP = String.raw`
import importlib
import shutil
import sys
import sysconfig
from pathlib import Path

cache_path = Path(_package_cache_path) if _package_cache_path else None
cache_manifest = _package_cache_manifest
marker = cache_path / ".manifest" if cache_path else None
cache_hit = False


def clear_cache_directory(path):
    try:
        if not path.exists():
            return True
        for child in path.iterdir():
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()
    except Exception:
        return False
    return True


if cache_path and marker and marker.is_file():
    try:
        cache_hit = marker.read_text(encoding="utf-8") == cache_manifest
        if cache_hit:
            sys.path.insert(0, str(cache_path))
            from owslib.csw import CatalogueServiceWeb  # noqa: F401
            from owslib.fes import And, BBox  # noqa: F401
    except Exception:
        cache_hit = False
        if str(cache_path) in sys.path:
            sys.path.remove(str(cache_path))
        clear_cache_directory(cache_path)

if not cache_hit:
    import micropip

    await micropip.install(f"OWSLib=={_owslib_version}")
    from owslib.csw import CatalogueServiceWeb  # noqa: F401
    from owslib.fes import And, BBox  # noqa: F401

    if cache_path and clear_cache_directory(cache_path):
        try:
            cache_path.mkdir(parents=True, exist_ok=True)
            site_packages = Path(sysconfig.get_paths()["purelib"])
            for package in site_packages.iterdir():
                target = cache_path / package.name
                if package.is_dir():
                    shutil.copytree(package, target, dirs_exist_ok=True)
                elif package.is_file():
                    shutil.copy2(package, target)
            marker.write_text(cache_manifest, encoding="utf-8")
            sys.path.insert(0, str(cache_path))
            importlib.invalidate_caches()
        except Exception:
            clear_cache_directory(cache_path)

cache_hit
`;

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
client = None


def initialize_catalogue_json(csw_url):
    global client
    client = CatalogueServiceWeb(csw_url, version="2.0.2", timeout=30)
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

async function initialize(cswUrl) {
  if (initialization) return initialization;

  initialization = (async () => {
    self.postMessage({ type: "status", message: "Loading browser Python runtime…" });
    importScripts(`${PYODIDE_BASE}pyodide.js`);
    pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });

    self.postMessage({ type: "status", message: "Checking the browser package cache…" });
    await pyodide.loadPackage("micropip");
    const packageCacheAvailable = await mountPackageCache();
    pyodide.globals.set(
      "_package_cache_path",
      packageCacheAvailable ? PACKAGE_CACHE_PATH : "",
    );
    pyodide.globals.set("_package_cache_manifest", PACKAGE_CACHE_MANIFEST);
    pyodide.globals.set("_owslib_version", OWSLIB_VERSION);

    const hasCachedPackage = packageCacheAvailable && packageCacheManifestMatches();
    self.postMessage({
      type: "status",
      message: hasCachedPackage ? "Loading cached OWSLib…" : "Installing OWSLib…",
    });
    const cacheHit = await pyodide.runPythonAsync(PYTHON_PACKAGE_SETUP);
    if (packageCacheAvailable && !cacheHit) {
      try {
        await syncPackageCache(false);
      } catch (error) {
        console.warn("Could not persist the browser package cache", error);
      }
    }
    await pyodide.runPythonAsync(PYTHON_SEARCH);

    self.postMessage({ type: "status", message: "Connecting to catalogue…" });
    pyodide.globals.set("_csw_url", cswUrl);
    const keywordsJson = await pyodide.runPythonAsync("initialize_catalogue_json(_csw_url)");
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

async function mountPackageCache() {
  try {
    const fileSystem = pyodide.FS;
    if (!fileSystem.filesystems?.IDBFS) return false;
    if (!packageCacheMounted) {
      fileSystem.mkdirTree(PACKAGE_CACHE_ROOT);
      fileSystem.mount(fileSystem.filesystems.IDBFS, {}, PACKAGE_CACHE_ROOT);
      packageCacheMounted = true;
    }
    await syncPackageCache(true);
    return true;
  } catch (error) {
    console.warn("IndexedDB package cache unavailable; using network packages", error);
    return false;
  }
}

function syncPackageCache(populate) {
  return new Promise((resolve, reject) => {
    pyodide.FS.syncfs(populate, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function packageCacheManifestMatches() {
  try {
    return (
      pyodide.FS.readFile(`${PACKAGE_CACHE_PATH}/.manifest`, { encoding: "utf8" }) ===
      PACKAGE_CACHE_MANIFEST
    );
  } catch {
    return false;
  }
}

function enqueueSearch(data) {
  latestRequestId = data.requestId;
  searchQueue = searchQueue.then(async () => {
    if (data.requestId !== latestRequestId) return;

    try {
      if (!pyodide) throw new Error("Search service is not ready.");
      pyodide.globals.set("_search_payload_json", JSON.stringify(data.payload));
      const result = await pyodide.runPythonAsync("search_json(_search_payload_json)");
      if (data.requestId !== latestRequestId) return;
      self.postMessage({
        type: "results",
        requestId: data.requestId,
        result: JSON.parse(String(result)),
      });
    } catch (error) {
      if (data.requestId !== latestRequestId) return;
      self.postMessage({
        type: "error",
        stage: "search",
        requestId: data.requestId,
        message: String(error?.message || error),
      });
    }
  });
}

self.addEventListener("message", async ({ data }) => {
  if (data?.type === "init") {
    try {
      await initialize(data.cswUrl);
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
    enqueueSearch(data);
    return;
  }

  if (data?.type === "cancel") {
    latestRequestId = undefined;
  }
});
