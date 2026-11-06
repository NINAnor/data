import process from "node:process";
import { sharedFetch } from "@camptocamp/ogc-client";
import uiStrings from "../i18n.json";
import type { CatalogueInfo, FooterInfo, InterfaceStrings, Language, SiteContext } from "../types";

const DEFAULT_CATALOGUE_URL = "https://csw.nina.no";
const FALLBACK_ADDRESS = ["Postboks 5685 Torgarden", "7485 Trondheim"];
const FALLBACK_PHONE = { label: "(+47) 73 80 14 00", href: "tel:+4773801400" };
const FALLBACK_CONTACT_URL = "https://www.nina.no/kontakt-oss";
const FALLBACK_ORGANIZATION = "Norwegian Institute for Nature Research (NINA)";
const NORWEGIAN_ORGANIZATION = "Norsk institutt for naturforskning (NINA)";

interface ApiLink {
  rel?: string;
  href?: string;
}

interface LandingPageDocument {
  title?: string;
  description?: string;
  links?: ApiLink[];
}

interface CollectionSummary {
  id: string;
  title?: string;
  description?: string;
  itemType?: string;
  type?: string;
}

interface CollectionsDocument {
  collections?: CollectionSummary[];
}

interface OpenApiDocument {
  info?: {
    title?: string;
    description?: string;
    contact?: {
      name?: string;
      email?: string;
      url?: string;
      phone?: string;
      address?: string[];
    };
  };
}

let catalogueInfoPromise: Promise<CatalogueInfo> | undefined;

export function getCatalogueUrl(): string {
  const url = process.env.OGC_API_URL || DEFAULT_CATALOGUE_URL;
  if (!/^https?:\/\//.test(url)) {
    throw new Error("OGC_API_URL must be a valid HTTP(S) OGC API root URL");
  }
  return url.replace(/\/$/, "");
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await sharedFetch(url, "GET", true);
  if (!response.ok)
    throw new Error(`Catalogue metadata request failed (${response.status}): ${url}`);
  return (await response.json()) as T;
}

function linkedUrl(landing: LandingPageDocument, relation: string, fallbackPath: string): string {
  const href = landing.links?.find((link) => link.rel === relation)?.href;
  return href || new URL(fallbackPath, `${getCatalogueUrl()}/`).toString();
}

export async function getCatalogueInfo(): Promise<CatalogueInfo> {
  if (!catalogueInfoPromise) {
    catalogueInfoPromise = (async () => {
      const url = getCatalogueUrl();
      const landing = await fetchJson<LandingPageDocument>(
        new URL("?f=json", `${url}/`).toString(),
      );
      const [collections, openApi] = await Promise.all([
        fetchJson<CollectionsDocument>(linkedUrl(landing, "data", "collections?f=json")),
        fetchJson<OpenApiDocument>(linkedUrl(landing, "service-desc", "openapi?f=json")),
      ]);
      const requestedCollection = process.env.OGC_COLLECTION_ID;
      const collection = requestedCollection
        ? collections.collections?.find((item) => item.id === requestedCollection)
        : (collections.collections?.find(
            (item) => item.itemType === "record" || item.type === "catalog",
          ) ?? collections.collections?.[0]);
      if (!collection) throw new Error("The OGC API does not expose a record collection");
      if (requestedCollection && collection.id !== requestedCollection) {
        throw new Error(`OGC_COLLECTION_ID '${requestedCollection}' is not exposed by the API`);
      }

      const contact = openApi.info?.contact;
      return {
        url,
        collectionId: collection.id,
        title: landing.title || collection.title || openApi.info?.title || "NINA Public Catalog",
        description:
          landing.description || collection.description || openApi.info?.description || "",
        contact: {
          name: contact?.name || FALLBACK_ORGANIZATION,
          email: contact?.email || "firmapost@nina.no",
          url: contact?.url || "https://www.nina.no",
          phone: contact?.phone || "",
          address: contact?.address || [],
        },
      };
    })().catch((error: unknown) => {
      catalogueInfoPromise = undefined;
      throw error;
    });
  }
  return catalogueInfoPromise;
}

export async function getSiteContext(language: Language = "en"): Promise<SiteContext> {
  const catalogue = await getCatalogueInfo();
  const ui: InterfaceStrings = uiStrings[language];
  const site = {
    title: language === "no" ? ui.catalogue_title : catalogue.title,
    description: catalogue.description,
    language: language === "no" ? "nb" : "en",
  };
  const organization =
    language === "en" && catalogue.contact.name === "Norsk institutt for naturforskning"
      ? FALLBACK_ORGANIZATION
      : language === "no" && catalogue.contact.name === "Norsk institutt for naturforskning"
        ? NORWEGIAN_ORGANIZATION
        : catalogue.contact.name;
  const footer: FooterInfo = {
    organization,
    address: catalogue.contact.address.length ? catalogue.contact.address : FALLBACK_ADDRESS,
    phone: catalogue.contact.phone
      ? {
          label: catalogue.contact.phone,
          href: `tel:${catalogue.contact.phone.replace(/[^0-9+]/g, "")}`,
        }
      : FALLBACK_PHONE,
    email: {
      label: catalogue.contact.email,
      href: `mailto:${catalogue.contact.email}`,
    },
    links: [
      { label: language === "no" ? "Kontakt NINA" : "Contact NINA", url: FALLBACK_CONTACT_URL },
      { label: "NINA.no", url: catalogue.contact.url },
    ],
  };

  return { site, catalogue, footer, ui, language };
}

export function assetPath(path: string, base: string = import.meta.env.BASE_URL): string {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}
