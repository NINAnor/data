import assert from "node:assert/strict";
import test from "node:test";
import { appendSearchQuery, buildSearchQuery } from "../src/lib/search-query";
import { parseSearchState, serializeSearchState } from "../src/lib/search-state";

test("combines selected keywords and modified-date bounds with CQL2 AND", () => {
  const query = buildSearchQuery({
    query: " lynx ",
    keywords: ["wolverine", "large carnivores"],
    start: "2026-01-01",
    end: "2026-12-31",
    bbox: null,
    page: 1,
  });
  const params = new URLSearchParams(query);
  assert.equal(params.get("filter-lang"), "cql2-text");
  assert.equal(
    params.get("filter"),
    "keywords LIKE '%wolverine%' AND keywords LIKE '%large carnivores%' AND date_modified >= '2026-01-01' AND date_modified <= '2026-12-31'",
  );
  assert.equal(params.get("q"), "lynx");
});

test("escapes CQL string literals before URL encoding", () => {
  const params = new URLSearchParams(
    buildSearchQuery({
      query: "",
      keywords: ["O'Brien"],
      start: "",
      end: "",
      bbox: null,
      page: 1,
    }),
  );
  assert.equal(params.get("filter"), "keywords LIKE '%O''Brien%'");
});

test("search URLs encode their state without a submitted sentinel", () => {
  const searchUrl = serializeSearchState("/no/search/", {
    query: "lynx",
    keywords: ["wolverine"],
    start: "2026-01-01",
    end: "2026-12-31",
    bbox: null,
    page: 2,
  });
  const params = new URLSearchParams(searchUrl.split("?")[1]);

  assert.equal(params.has("submitted"), false);
  assert.equal(params.get("q"), "lynx");
  assert.equal(params.get("keyword"), "wolverine");
  assert.equal(params.get("page"), "2");
  assert.deepEqual(parseSearchState(`?${params}`), {
    query: "lynx",
    keywords: ["wolverine"],
    start: "2026-01-01",
    end: "2026-12-31",
    bbox: null,
    page: 2,
  });
  const emptySearch = serializeSearchState("/search/", {
    query: "",
    keywords: [],
    start: "",
    end: "",
    bbox: null,
    page: 1,
  });
  assert.equal(emptySearch, "/search/?q=");
  assert.deepEqual(parseSearchState(""), {
    query: "",
    keywords: [],
    start: "",
    end: "",
    bbox: null,
    page: 1,
  });
});

test("CQL stays decoded when attached to the OGC items URL", () => {
  const cql = "date_modified >= '2026-11-09' AND date_modified <= '2026-11-30'";
  const query = buildSearchQuery({
    query: "",
    keywords: [],
    start: "2026-11-09",
    end: "2026-11-30",
    bbox: null,
    page: 1,
  });
  const requestUrl = appendSearchQuery(
    "https://csw.nina.no/collections/metadata:main/items",
    query,
  );

  assert.equal(new URL(requestUrl).searchParams.get("filter"), cql);
});
