import { XMLParser } from "fast-xml-parser";
import legacyLabels from "../metadata-labels.json" with { type: "json" };
import type {
  ContactAddress,
  ContactMethod,
  Dataset,
  DatasetContact,
  DatasetKeywordGroup,
  DatasetResource,
  Extent,
  InterfaceStrings,
  Language,
  LocalizedDataset,
  MetadataSection,
  ParsedMetadata,
} from "../types";

type XmlObject = Record<string, unknown>;
interface LeafField {
  path: string[];
  value: string;
}

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: false,
  trimValues: true,
  parseTagValue: false,
  htmlEntities: true,
  textNodeName: "#text",
});

const labels: Record<string, string> = {
  fileIdentifier: "Identifier",
  language: "Language",
  characterSet: "Character set",
  hierarchyLevel: "Hierarchy level",
  dateStamp: "Metadata updated",
  metadataStandardName: "Metadata standard",
  metadataStandardVersion: "Metadata standard version",
  dataSetURI: "Dataset URI",
  topologyLevel: "Topology level",
  geometricObjectType: "Geometry type",
  spatialRepresentationType: "Spatial representation type",
  referenceSystemIdentifier: "Reference system",
  maintenanceAndUpdateFrequency: "Maintenance frequency",
  topicCategory: "Topic category",
  accessConstraints: "Access constraints",
  useConstraints: "Use constraints",
  westBoundLongitude: "West longitude",
  eastBoundLongitude: "East longitude",
  southBoundLatitude: "South latitude",
  northBoundLatitude: "North latitude",
  creation: "Creation date",
  publication: "Publication date",
  revision: "Revision date",
  status: "Status",
};

const structuralTags = new Set([
  "MD_Metadata",
  "MD_DataIdentification",
  "MD_VectorSpatialRepresentation",
  "MD_ReferenceSystem",
  "RS_Identifier",
  "CI_Citation",
  "CI_Date",
  "CI_DateTypeCode",
  "LanguageCode",
  "MD_Keywords",
  "MD_CharacterSetCode",
  "MD_MaintenanceFrequencyCode",
  "MD_SpatialRepresentationTypeCode",
  "MD_GeometricObjectTypeCode",
  "MD_ScopeCode",
  "MD_TopologyLevelCode",
  "MD_GeometricObjects",
  "MD_LegalConstraints",
  "MD_MaintenanceInformation",
  "EX_Extent",
  "EX_GeographicBoundingBox",
  "MD_Distribution",
  "MD_DigitalTransferOptions",
  "CI_OnlineResource",
  "CI_ResponsibleParty",
  "CI_Contact",
  "CI_Address",
  "CI_Telephone",
  "MD_ProgressCode",
  "MD_Format",
  "CI_OnLineFunctionCode",
  "CI_RoleCode",
]);

const displayNames: Record<string, string> = {
  ...legacyLabels,
  "Record details": "Postdetaljer",
  "Spatial information": "Romlig informasjon",
  "Dataset information": "Datasettinformasjon",
  "Additional metadata": "Øvrige metadata",
  "Character set": "Tegnsett",
  "Dataset URI": "Datasett-URI",
  "Geometry type": "Geometritype",
  "Reference system": "Referansesystem",
  "Maintenance frequency": "Oppdateringsfrekvens",
  "Metadata standard": "Metadatastandard",
  "Metadata standard version": "Metadatastandardversjon",
  "West longitude": "Vestlig lengdegrad",
  "East longitude": "Østlig lengdegrad",
  "South latitude": "Sørlig breddegrad",
  "North latitude": "Nordlig breddegrad",
  "Creation date": "Opprettelsesdato",
  "Publication date": "Publiseringsdato",
  "Revision date": "Revisjonsdato",
  "Access constraints": "Tilgangsbegrensninger",
  "Use constraints": "Bruksbegrensninger",
  Identifier: "Identifikator",
  Language: "Språk",
  "Hierarchy level": "Hierarkinivå",
  Status: "Status",
  Email: "E-post",
  Phone: "Telefon",
  Fax: "Faks",
  Website: "Nettsted",
  "Street address": "Gateadresse",
  City: "Poststed",
  Region: "Region",
  "Postal code": "Postnummer",
  Country: "Land",
  Download: "Last ned",
  "View information": "Vis informasjon",
  "Access details": "Tilgangsdetaljer",
  "Order resource": "Bestill ressurs",
  "Open service": "Åpne tjeneste",
  "Open resource": "Åpne ressurs",
};

function asArray(value: unknown): unknown[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (value && typeof value === "object") {
    if ("#text" in value && typeof value["#text"] === "string") {
      return value["#text"].trim();
    }
    for (const child of Object.values(value)) {
      const result = text(child);
      if (result) return result;
    }
  }
  return "";
}

function descendants(value: unknown, name: string, found: unknown[] = []): unknown[] {
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)) {
    if (key === name) found.push(...asArray(child));
    else if (child && typeof child === "object") {
      for (const item of asArray(child)) descendants(item, name, found);
    }
  }
  return found;
}

function firstText(node: unknown, name: string): string {
  return text(descendants(node, name)[0]);
}

function leafFields(value: unknown, path: string[] = [], output: LeafField[] = []): LeafField[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => leafFields(item, [...path, String(index + 1)], output));
    return output;
  }
  if (value == null) return output;
  if (typeof value !== "object") {
    const valueText = String(value).trim();
    if (valueText) output.push({ path, value: valueText });
    return output;
  }

  const entries = Object.entries(value).filter(([key]) => key !== "#text");
  if (!entries.length) {
    const valueText = text(value);
    if (valueText) output.push({ path, value: valueText });
    return output;
  }
  for (const [key, child] of entries) leafFields(child, [...path, key], output);
  return output;
}

function prettifyPath(path: string[]): string {
  const segments = path
    .map((part) => part.replace(/^g(co|md|mx|ml|mlr|mlc|mlpr):/, ""))
    .filter((part) => !structuralTags.has(part))
    .filter((part) => !/^\d+$/.test(part))
    .filter(
      (part) => !/^(CharacterString|Date|Decimal|Boolean|URL|Anchor|Integer|Real)$/.test(part),
    )
    .filter(
      (part) =>
        !/^(metadata|identificationInfo|spatialRepresentationInfo|referenceSystemInfo)$/.test(part),
    );
  const pathLabels = segments.map(
    (part) =>
      labels[part] ||
      part
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[_-]/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase()),
  );
  const uniquePathLabels = pathLabels.filter((label, index) => label !== pathLabels[index - 1]);
  return uniquePathLabels.slice(-3).join(" · ") || "Metadata";
}

function isRedundantField(path: string[]): boolean {
  const joined = path.join(".");
  return (
    /gmd:fileIdentifier|gmd:distributionInfo|gmd:contactInfo|gmd:pointOfContact|gmd:distributorContact|gmd:citedResponsibleParty|gmd:descriptiveKeywords|gmd:keyword|gmd:EX_GeographicBoundingBox/.test(
      joined,
    ) ||
    (joined.includes("gmd:identificationInfo") &&
      /gmd:(title|abstract|extent)(\.|$)/.test(joined)) ||
    /gmd:hierarchyLevel/.test(joined)
  );
}

function makeSections(root: XmlObject): MetadataSection[] {
  const sections: MetadataSection[] = [
    { title: "Record details", fields: [] },
    { title: "Spatial information", fields: [] },
    { title: "Dataset information", fields: [] },
    { title: "Additional metadata", fields: [] },
  ];
  const sectionFor = (path: string[]): MetadataSection => {
    const joined = path.join(".");
    if (/spatialRepresentationInfo|referenceSystemInfo|EX_Geographic|gmd:extent/.test(joined)) {
      return sections[1]!;
    }
    if (/identificationInfo/.test(joined)) return sections[2]!;
    if (/distributionInfo|contactInfo|^gmd:contact/.test(joined)) return sections[3]!;
    return sections[0]!;
  };
  for (const entry of leafFields(root)) {
    if (isRedundantField(entry.path)) continue;
    const section = sectionFor(entry.path);
    const label = prettifyPath(entry.path);
    section.fields.push({
      label,
      value: entry.value,
      is_url: /^https?:\/\//.test(entry.value),
      kind: label === "Status" ? "status" : "value",
    });
  }
  return sections.filter((section) => section.fields.length);
}

function parseContacts(root: XmlObject): DatasetContact[] {
  const contactSections = [
    ...descendants(root, "gmd:contact"),
    ...descendants(root, "gmd:pointOfContact"),
    ...descendants(root, "gmd:distributorContact"),
  ];
  const parties = [
    ...new Set(
      contactSections.flatMap((section) => descendants(section, "gmd:CI_ResponsibleParty")),
    ),
  ];
  return parties
    .map((contact) => {
      const name =
        firstText(contact, "gmd:individualName") || firstText(contact, "gmd:organisationName");
      const organization = firstText(contact, "gmd:organisationName");
      const position = firstText(contact, "gmd:positionName");
      const email = firstText(contact, "gmd:electronicMailAddress");
      const phone = firstText(contact, "gmd:voice");
      const fax = firstText(contact, "gmd:facsimile");
      const website = firstText(contact, "gmd:URL");
      const addressFields = [
        ["Street address", firstText(contact, "gmd:deliveryPoint")] as const,
        ["City", firstText(contact, "gmd:city")] as const,
        ["Region", firstText(contact, "gmd:administrativeArea")] as const,
        ["Postal code", firstText(contact, "gmd:postalCode")] as const,
        ["Country", firstText(contact, "gmd:country")] as const,
      ];
      const address: ContactAddress[] = addressFields.flatMap(([label, value]) =>
        value ? [{ label, value }] : [],
      );
      const methods: ContactMethod[] = [
        ...(email ? [{ label: "Email", value: email, href: `mailto:${email}` }] : []),
        ...(phone
          ? [{ label: "Phone", value: phone, href: `tel:${phone.replace(/[^0-9+]/g, "")}` }]
          : []),
        ...(fax ? [{ label: "Fax", value: fax, href: `tel:${fax.replace(/[^0-9+]/g, "")}` }] : []),
        ...(website && /^https?:\/\//.test(website)
          ? [{ label: "Website", value: website, href: website }]
          : []),
      ];
      const role = firstText(contact, "gmd:CI_RoleCode") || "Contact";
      return {
        role: role
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .replace(/\b\w/g, (letter) => letter.toUpperCase()),
        name,
        organization: name && organization !== name ? organization : "",
        position,
        methods,
        address,
        instructions: firstText(contact, "gmd:contactInstructions"),
        hours: firstText(contact, "gmd:hoursOfService"),
      };
    })
    .filter(
      (contact) =>
        contact.name || contact.organization || contact.methods.length || contact.address.length,
    );
}

function parseResources(root: XmlObject): DatasetResource[] {
  const actions: Record<string, string> = {
    download: "Download",
    information: "View information",
    offlineAccess: "Access details",
    order: "Order resource",
    search: "Open service",
  };
  const distributionResources = descendants(root, "gmd:distributionInfo").flatMap((distribution) =>
    descendants(distribution, "gmd:MD_DigitalTransferOptions").flatMap((transferOptions) =>
      descendants(transferOptions, "gmd:CI_OnlineResource"),
    ),
  );
  return distributionResources
    .map((resource) => {
      const url = firstText(resource, "gmd:URL");
      const functionName = firstText(resource, "gmd:CI_OnLineFunctionCode");
      return {
        name: firstText(resource, "gmd:name") || url || "Dataset resource",
        description: firstText(resource, "gmd:description"),
        url,
        href: /^https?:\/\//.test(url) ? url : "",
        action: actions[functionName] || "Open resource",
        function: functionName,
        protocol: firstText(resource, "gmd:protocol"),
        relation: "",
        format: "",
        format_version: "",
        channel: "",
      };
    })
    .filter((resource) => resource.url || resource.description || resource.protocol);
}

function parseKeywords(root: XmlObject): string[] {
  return [...new Set(descendants(root, "gmd:keyword").map(text).filter(Boolean))];
}

function parseKeywordGroups(root: XmlObject): DatasetKeywordGroup[] {
  const grouped = new Map<string, DatasetKeywordGroup>();
  for (const keywordGroup of descendants(root, "gmd:MD_Keywords")) {
    const values = [...new Set(descendants(keywordGroup, "gmd:keyword").map(text).filter(Boolean))];
    if (!values.length) continue;

    const type = firstText(keywordGroup, "gmd:MD_KeywordTypeCode");
    const vocabulary = firstText(keywordGroup, "gmd:thesaurusName");
    const vocabularyLabel = vocabulary
      .replace(/:\s*https?:\/\/\S+.*$/, "")
      .replace(/^n\/a$/i, "")
      .trim();
    const isTheme = Boolean(type || vocabularyLabel);
    const label = type ? type.replace(/\b\w/g, (letter) => letter.toUpperCase()) : vocabularyLabel;
    const kind = isTheme ? "theme" : "keyword";
    const key = `${kind}\u0000${label}\u0000${vocabularyLabel}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.values = [...new Set([...existing.values, ...values])];
    } else {
      grouped.set(key, {
        kind,
        label,
        vocabulary: vocabularyLabel,
        values,
      });
    }
  }
  return [...grouped.values()];
}

function parseExtent(root: XmlObject): Extent | null {
  const bounds = descendants(root, "gmd:EX_GeographicBoundingBox")[0];
  if (!bounds) return null;
  const extent = {
    west: Number(firstText(bounds, "gmd:westBoundLongitude")),
    south: Number(firstText(bounds, "gmd:southBoundLatitude")),
    east: Number(firstText(bounds, "gmd:eastBoundLongitude")),
    north: Number(firstText(bounds, "gmd:northBoundLatitude")),
  };
  return Number.isFinite(extent.west) &&
    Number.isFinite(extent.south) &&
    Number.isFinite(extent.east) &&
    Number.isFinite(extent.north) &&
    extent.west < extent.east &&
    extent.south < extent.north
    ? extent
    : null;
}

export function parseIsoMetadata(xml: string): ParsedMetadata {
  const root = parser.parse(xml) as XmlObject;
  const metadataRoot = (root["gmd:MD_Metadata"] as XmlObject | undefined) || root;
  const extent = parseExtent(metadataRoot);
  const sections = makeSections(metadataRoot);
  if (extent) {
    let spatial = sections.find((section) => section.title === "Spatial information");
    if (!spatial) {
      spatial = { title: "Spatial information", fields: [] };
      sections.push(spatial);
    }
    spatial.fields.push(
      {
        label: "Top-left coordinate (longitude, latitude)",
        value: `${extent.west}°, ${extent.north}°`,
        kind: "coordinate",
      },
      {
        label: "Bottom-right coordinate (longitude, latitude)",
        value: `${extent.east}°, ${extent.south}°`,
        kind: "coordinate",
      },
    );
  }
  const browseGraphic = descendants(metadataRoot, "gmd:MD_BrowseGraphic")[0];
  const preview = browseGraphic ? firstText(browseGraphic, "gmd:fileName") : "";
  return {
    metadata_sections: sections,
    keyword_groups: parseKeywordGroups(metadataRoot),
    contacts: parseContacts(metadataRoot),
    resources: parseResources(metadataRoot),
    keyword_tags: parseKeywords(metadataRoot),
    extent,
    preview: /^https?:\/\//.test(preview) ? preview : "",
  };
}

export function localizeDataset(
  dataset: Dataset,
  language: Language,
  ui: Pick<InterfaceStrings, "preview_of" | "map_extent">,
): LocalizedDataset {
  const copy: LocalizedDataset = {
    ...structuredClone(dataset),
    preview_alt: ui.preview_of.replace("{title}", dataset.title),
    map_label: ui.map_extent.replace("{title}", dataset.title),
  };
  if (language === "no") {
    for (const section of copy.metadata_sections) {
      section.title = displayNames[section.title] || section.title;
      for (const field of section.fields) {
        field.label = field.label
          .split(" · ")
          .map((part) => displayNames[part] || part)
          .join(" · ");
      }
    }
    for (const contact of copy.contacts) {
      contact.methods.forEach((method) => {
        method.label = displayNames[method.label] || method.label;
      });
      contact.address.forEach((item) => {
        item.label = displayNames[item.label] || item.label;
      });
    }
    for (const resource of copy.resources) {
      resource.action = displayNames[resource.action] || resource.action;
    }
  }
  return copy;
}
