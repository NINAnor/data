import uiStrings from "./i18n.json";

export type Language = "en" | "no";
export type InterfaceStrings = { [Key in keyof typeof uiStrings.en]: string };

export interface Extent {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface MetadataField {
  label: string;
  value: string;
  is_url?: boolean;
  kind?: string;
}

export interface MetadataSection {
  title: string;
  fields: MetadataField[];
}

export interface DatasetKeywordGroup {
  kind: "keyword" | "theme";
  label: string;
  vocabulary: string;
  values: string[];
}

export interface ContactMethod {
  label: string;
  value: string;
  href: string;
}

export interface ContactAddress {
  label: string;
  value: string;
}

export interface DatasetContact {
  role: string;
  name: string;
  organization: string;
  position: string;
  methods: ContactMethod[];
  address: ContactAddress[];
  hours: string;
  instructions: string;
}

export interface DatasetResource {
  name: string;
  description: string;
  url: string;
  href: string;
  action: string;
  function: string;
  protocol: string;
  relation: string;
  format: string;
  format_version: string;
  channel: string;
}

export interface DatasetSummary {
  identifier: string;
  slug: string;
  title: string;
  modified: string;
  abstract: string;
  preview: string;
  keyword_tags: string[];
  extent: Extent | null;
}

export type DatasetCard = Pick<
  DatasetSummary,
  "identifier" | "slug" | "title" | "preview" | "keyword_tags"
>;

export interface Dataset extends DatasetSummary {
  metadata_sections: MetadataSection[];
  keyword_groups: DatasetKeywordGroup[];
  contacts: DatasetContact[];
  resources: DatasetResource[];
  preview_alt?: string;
  map_label?: string;
}

export interface ParsedMetadata {
  metadata_sections: MetadataSection[];
  keyword_groups: DatasetKeywordGroup[];
  contacts: DatasetContact[];
  resources: DatasetResource[];
  keyword_tags: string[];
  extent: Extent | null;
  preview: string;
}

export interface LocalizedDataset extends Dataset {
  preview_alt: string;
  map_label: string;
}

export interface CatalogueLink {
  rel?: string;
  href?: string;
  type?: string;
  title?: string;
}

export interface RecordTheme {
  concepts?: Array<{ id?: string }>;
  scheme?: string;
}

export interface RecordProperties {
  type?: string;
  title?: string;
  description?: string;
  identifier?: string;
  updated?: string | Date;
  date_modified?: string;
  keywords?: unknown;
  themes?: RecordTheme[];
  [key: string]: unknown;
}

export interface CatalogueRecord {
  id: string;
  type?: string;
  properties: RecordProperties;
  geometry?: unknown;
  links?: CatalogueLink[];
  time?: { date?: string };
}

export interface RecordsDocument {
  features?: unknown;
  numberMatched?: number;
}

export interface DatasetPagePayload {
  datasets: DatasetCard[];
  next_page: number | null;
}

export interface SearchState {
  query: string;
  keywords: string[];
  start: string;
  end: string;
  bbox: [number, number, number, number] | null;
  page: number;
}

export interface SearchFeature {
  type: "Feature";
  properties: { kind: "area" | "corner" };
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "Point"; coordinates: [number, number] };
}

export interface SearchFeatureCollection {
  type: "FeatureCollection";
  features: SearchFeature[];
}

export interface CatalogueInfo {
  url: string;
  collectionId: string;
  title: string;
  description: string;
  endpoints: Array<{ title: string; url: string }>;
  contact: {
    name: string;
    email: string;
    url: string;
    phone: string;
    address: string[];
  };
}

export interface FooterInfo {
  organization: string;
  address: string[];
  phone?: { label: string; href: string };
  email?: { label: string; href: string };
  links: Array<{ label: string; url: string }>;
}

export interface SiteContext {
  site: {
    title: string;
    description: string;
    language: string;
  };
  catalogue: CatalogueInfo;
  footer: FooterInfo;
  ui: InterfaceStrings;
  language: Language;
}
