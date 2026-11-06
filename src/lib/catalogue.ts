import { createHash } from "node:crypto";
import { OgcApiEndpoint, sharedFetch } from "@camptocamp/ogc-client";
import { getCatalogueInfo, getCatalogueUrl } from "./site";
import { parseIsoMetadata } from "./metadata";
import type {
  CatalogueRecord,
  Dataset,
  DatasetKeywordGroup,
  DatasetSummary,
  Extent,
  RecordProperties,
  RecordTheme,
  RecordsDocument,
} from "../types";

const PAGE_SIZE = 10000;
const endpointCache = new Map<string, OgcApiEndpoint>();
const detailsCache = new Map<string, Promise<Dataset>>();
let cataloguePromise: Promise<CatalogueRecord[]> | undefined;

function endpointFor(url = getCatalogueUrl()): OgcApiEndpoint {
  if (!endpointCache.has(url)) endpointCache.set(url, new OgcApiEndpoint(url));
  return endpointCache.get(url)!;
}

async function fetchJson(url: string): Promise<RecordsDocument> {
  const response = await sharedFetch(url, "GET", true);
  if (!response.ok) throw new Error(`Catalogue request failed (${response.status}): ${url}`);
  return (await response.json()) as RecordsDocument;
}

function isRecordProperties(value: unknown): value is RecordProperties {
  return value !== null && typeof value === "object";
}

function isCatalogueRecord(value: unknown): value is CatalogueRecord {
  if (value === null || typeof value !== "object") return false;
  return (
    "id" in value &&
    typeof value.id === "string" &&
    "properties" in value &&
    isRecordProperties(value.properties)
  );
}

function normalizedDate(record: CatalogueRecord): string {
  const updated = record.properties.updated;
  if (typeof updated === "string") return updated;
  if (updated instanceof Date) return updated.toISOString();
  return record.properties.date_modified || record.time?.date || "";
}

function slugify(value: string): string {
  const label =
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "dataset";
  const suffix = createHash("sha256").update(value, "utf8").digest("hex").slice(0, 10);
  return `${label}-${suffix}`;
}

function isRecordTheme(value: unknown): value is RecordTheme {
  return value !== null && typeof value === "object";
}

function keywordsOf(properties: RecordProperties): string[] {
  const keywords = Array.isArray(properties.keywords)
    ? properties.keywords.filter((value): value is string => typeof value === "string")
    : [];
  const themes = Array.isArray(properties.themes)
    ? properties.themes
        .filter(isRecordTheme)
        .flatMap((theme) => theme.concepts || [])
        .map((concept) => concept.id)
        .filter((value): value is string => typeof value === "string")
    : [];
  return [...new Set([...keywords, ...themes].filter((value) => value.trim()))];
}

function keywordGroupsOf(properties: RecordProperties): DatasetKeywordGroup[] {
  const themes = (properties.themes || []).flatMap((theme) => {
    const values = [
      ...new Set(
        (theme.concepts || [])
          .map((concept) => concept.id)
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0),
      ),
    ];
    if (!values.length) return [];
    const vocabulary = theme.scheme || "";
    const vocabularyName = vocabulary
      .split("/")
      .at(-1)
      ?.replace(/\.xml$/i, "")
      .replace(/_\d{4}-\d{2}-\d{2}$/, "")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
    return [{ kind: "theme" as const, label: vocabularyName || "Theme", vocabulary, values }];
  });
  const themeTerms = new Set(themes.flatMap((theme) => theme.values));
  const rawKeywords = Array.isArray(properties.keywords)
    ? properties.keywords.filter((value): value is string => typeof value === "string")
    : [];
  const keywords = [...new Set(rawKeywords.filter((keyword) => !themeTerms.has(keyword)))];
  return [
    ...themes,
    ...(keywords.length
      ? [{ kind: "keyword" as const, label: "", vocabulary: "", values: keywords }]
      : []),
  ];
}

function sortRecords(records: CatalogueRecord[]): CatalogueRecord[] {
  return records.sort((a, b) => {
    const dateA = Date.parse(normalizedDate(a));
    const dateB = Date.parse(normalizedDate(b));
    const validA = Number.isFinite(dateA);
    const validB = Number.isFinite(dateB);
    if (validA !== validB) return validA ? -1 : 1;
    if (validA && dateA !== dateB) return dateB - dateA;
    const titleA = a.properties.title || a.id;
    const titleB = b.properties.title || b.id;
    return titleA.localeCompare(titleB) || a.id.localeCompare(b.id);
  });
}

export async function loadRecords(): Promise<CatalogueRecord[]> {
  if (cataloguePromise) return cataloguePromise;
  cataloguePromise = (async () => {
    const endpoint = endpointFor();
    const collectionId = (await getCatalogueInfo()).collectionId;
    const records: CatalogueRecord[] = [];
    let offset = 0;
    while (true) {
      const url = await endpoint.getCollectionItemsUrl(collectionId, {
        asJson: true,
        limit: PAGE_SIZE,
        offset,
        sortBy: ["-updated"],
      });
      const page = await fetchJson(url);
      const features = Array.isArray(page.features) ? page.features.filter(isCatalogueRecord) : [];
      records.push(...features.filter((record) => record.properties.type === "dataset"));
      offset += features.length;
      if (
        !features.length ||
        features.length < PAGE_SIZE ||
        (page.numberMatched != null && offset >= page.numberMatched)
      ) {
        break;
      }
    }
    return sortRecords(records);
  })().catch((error: unknown) => {
    cataloguePromise = undefined;
    throw error;
  });
  return cataloguePromise;
}

export function summarizeRecord(record: CatalogueRecord): DatasetSummary {
  const identifier = record.id || record.properties.identifier || "";
  return {
    identifier,
    slug: slugify(identifier),
    title: record.properties.title || identifier || "Untitled dataset",
    modified: normalizedDate(record),
    abstract: record.properties.description || "",
    preview: "",
    keyword_tags: keywordsOf(record.properties),
    extent: extentFromGeometry(record.geometry),
  };
}

export async function loadDatasets(): Promise<Dataset[]> {
  return Promise.all((await loadRecords()).map((record) => loadDatasetDetails(record)));
}

export async function loadKeywords(): Promise<string[]> {
  return [
    ...new Set((await loadRecords()).flatMap((record) => keywordsOf(record.properties))),
  ].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export async function loadDatasetDetails(
  record: CatalogueRecord,
  summary: DatasetSummary = summarizeRecord(record),
): Promise<Dataset> {
  if (!detailsCache.has(summary.identifier)) {
    detailsCache.set(
      summary.identifier,
      (async () => {
        const link = record.links?.find((item) => item.rel === "self")?.href;
        if (!link) throw new Error(`Record ${summary.identifier} does not expose a self link`);
        const url = new URL(link);
        url.searchParams.set("f", "xml");
        const response = await sharedFetch(url.toString(), "GET", false, "application/xml");
        if (!response.ok)
          throw new Error(`ISO metadata request failed (${response.status}): ${url}`);
        const metadata = parseIsoMetadata(await response.text());
        return {
          ...summary,
          ...metadata,
          extent: metadata.extent || summary.extent,
          keyword_tags: metadata.keyword_tags.length ? metadata.keyword_tags : summary.keyword_tags,
          keyword_groups: metadata.keyword_groups.length
            ? metadata.keyword_groups
            : keywordGroupsOf(record.properties),
        };
      })(),
    );
  }
  return detailsCache.get(summary.identifier)!;
}

function collectPoints(value: unknown, points: Array<[number, number]>): void {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
    points.push([value[0], value[1]]);
    return;
  }
  value.forEach((child) => collectPoints(child, points));
}

export function extentFromGeometry(geometry: unknown): Extent | null {
  if (geometry === null || typeof geometry !== "object" || !("coordinates" in geometry)) {
    return null;
  }
  const points: Array<[number, number]> = [];
  collectPoints(geometry.coordinates, points);
  if (!points.length) return null;
  const longitudes = points.map(([longitude]) => longitude);
  const latitudes = points.map(([, latitude]) => latitude);
  const extent = {
    west: Math.min(...longitudes),
    south: Math.min(...latitudes),
    east: Math.max(...longitudes),
    north: Math.max(...latitudes),
  };
  if (extent.west >= extent.east || extent.south >= extent.north) return null;
  return extent;
}
