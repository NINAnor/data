#!/usr/bin/env python3

import hashlib
import logging
import pathlib
import re
from datetime import datetime, timezone
from functools import cache
from urllib.parse import urlsplit

import environ
import yaml
from django.http import Http404, JsonResponse
from django.utils.text import slugify
from nanodjango import Django
from owslib.csw import CatalogueServiceWeb
from pygeometa.core import import_metadata

env = environ.Env()
BASE_DIR = pathlib.Path(__file__).parent
environ.Env.read_env(str(BASE_DIR / ".env"))

DEBUG = env.bool("DEBUG", default=False)

logging.basicConfig(level=(logging.DEBUG if DEBUG else logging.INFO))

logger = logging.getLogger(__name__)
app = Django(DEBUG=DEBUG)
CSW_PAGE_SIZE = 100
CATALOGUE_PAGE_SIZE = 12
CSW_TYPE_NAMES = "gmd:MD_Metadata"
CSW_OUTPUT_SCHEMA = "http://www.isotc211.org/2005/gmd"
SITE_CONFIG_PATH = BASE_DIR / "templates" / "site.yml"


def load_site_config(path=SITE_CONFIG_PATH):
    """Load site branding and footer content from the YAML configuration."""
    config = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(config, dict):
        raise ValueError(f"Site config must contain a YAML mapping: {path}")
    for section in ("site", "catalogue", "footer"):
        if not isinstance(config.get(section), dict):
            raise ValueError(f"Site config must define a '{section}' mapping: {path}")
    csw_url = env.str("CSW_URL", default=config["catalogue"].get("csw_url"))
    if not isinstance(csw_url, str) or not csw_url.startswith(("http://", "https://")):
        raise ValueError(f"Site config must define a valid catalogue.csw_url: {path}")
    config["catalogue"]["csw_url"] = csw_url
    return config


@cache
def site_config():
    """Return the cached shared site configuration."""
    return load_site_config()


def shared_template_context():
    """Return site-wide settings shared by every page template."""
    return site_config()


def fetch_all_records(csw, page_size=CSW_PAGE_SIZE):
    """Fetch every CSW record, following the server's result-set pagination."""
    records = {}
    start_position = 1

    while True:
        csw.getrecords2(
            startposition=start_position,
            maxrecords=page_size,
            esn="full",
            typenames=CSW_TYPE_NAMES,
            outputschema=CSW_OUTPUT_SCHEMA,
        )
        records.update(csw.records)

        results = csw.results
        returned = results.get("returned", len(csw.records))
        matched = results.get("matches")
        next_record = results.get("nextrecord")

        if not returned:
            break
        if next_record == 0:
            break
        if next_record is not None:
            if next_record <= start_position:
                break
            start_position = next_record
        else:
            if matched is not None:
                if start_position - 1 + returned >= matched:
                    break
            elif returned < page_size:
                break
            start_position += returned

    return records


def dataset_slug(identifier):
    """Return a stable, URL-safe slug that stays unique across identifiers."""
    label = slugify(identifier)[:80] or "dataset"
    suffix = hashlib.sha256(identifier.encode("utf-8")).hexdigest()[:10]
    return f"{label}-{suffix}"


def modified_datetime(value):
    """Parse a CSW modified timestamp, treating timezone-naive values as UTC."""
    if isinstance(value, datetime):
        modified = value
    elif isinstance(value, str) and value.strip():
        try:
            modified = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None

    if modified.tzinfo is None:
        modified = modified.replace(tzinfo=timezone.utc)
    return modified.astimezone(timezone.utc)


def dataset_sort_key(dataset):
    """Sort newest records first, with stable title/identifier tie-breaks."""
    modified = modified_datetime(dataset.get("modified"))
    return (
        modified is None,
        -modified.timestamp() if modified else 0,
        dataset["title"].casefold(),
        dataset["title"],
        dataset["identifier"].casefold(),
        dataset["identifier"],
    )


def flatten_metadata(value, path=""):
    """Flatten a pygeometa MCF section into display-ready fields."""
    labels = {
        "hierarchylevel": "Hierarchy level",
        "charset": "Character set",
        "dataseturi": "Dataset URI",
        "datatype": "Data type",
        "geomtype": "Geometry type",
        "denominators": "Scale denominator",
        "resolutions": "Resolution",
        "creation": "Creation date",
        "publication": "Publication date",
        "revision": "Revision date",
        "maintenancefrequency": "Maintenance frequency",
        "topiccategory": "Topic category",
        "accessconstraints": "Access constraints",
        "format_version": "Format version",
    }
    fields = []
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}" if path else str(key)
            fields.extend(flatten_metadata(child, child_path))
    elif isinstance(value, (list, tuple)):
        if all(not isinstance(child, (dict, list, tuple)) for child in value):
            fields.extend(flatten_metadata(", ".join(map(str, value)), path))
        else:
            for index, child in enumerate(value, start=1):
                fields.extend(flatten_metadata(child, f"{path}[{index}]"))
    elif value is not None and value != "":
        text = str(value)
        label = " · ".join(
            labels.get(
                part.split("[")[0],
                part.split("[")[0].replace("_", " ").replace("-", " ").title(),
            )
            + (f" {part.split('[', 1)[1][:-1]}" if "[" in part else "")
            for part in path.split(".")
        )
        fields.append(
            {
                "label": label,
                "value": text,
                "is_url": text.startswith(("https://", "http://")),
                "kind": "status" if path.split(".")[-1] == "status" else "value",
            }
        )
    return fields


def metadata_sections(metadata, extent=None):
    """Build ordered, schema-aware record, spatial, and dataset summaries."""
    record_fields = flatten_metadata(metadata.get("metadata", {}))
    spatial_fields = flatten_metadata(metadata.get("spatial", {}))
    identification = metadata.get("identification", {})
    extent_values = identification.get("extents", {})

    if extent:
        spatial_fields.extend(
            [
                {
                    "label": "Top-left coordinate (longitude, latitude)",
                    "value": f"{extent['west']:g}°, {extent['north']:g}°",
                    "kind": "coordinate",
                },
                {
                    "label": "Bottom-right coordinate (longitude, latitude)",
                    "value": f"{extent['east']:g}°, {extent['south']:g}°",
                    "kind": "coordinate",
                },
            ]
        )

    dataset_values = {
        key: value
        for key, value in identification.items()
        if key not in {"title", "abstract", "keywords", "extents"}
    }
    temporal_extent = (
        extent_values.get("temporal") if isinstance(extent_values, dict) else None
    )
    if temporal_extent:
        dataset_values["temporal_extent"] = temporal_extent

    sections = [
        {"title": "Record details", "fields": record_fields},
        {"title": "Spatial information", "fields": spatial_fields},
        {"title": "Dataset information", "fields": flatten_metadata(dataset_values)},
    ]
    sections = [section for section in sections if section["fields"]]

    additional = {
        key: value
        for key, value in metadata.items()
        if key
        not in {
            "mcf",
            "metadata",
            "spatial",
            "identification",
            "contact",
            "distribution",
        }
    }
    additional_fields = flatten_metadata(additional)
    if additional_fields:
        sections.append({"title": "Additional metadata", "fields": additional_fields})

    return sections


def distribution_cards(distributions):
    """Prepare pygeometa distribution entries as access/download cards."""
    if not isinstance(distributions, dict):
        return []

    action_labels = {
        "download": "Download",
        "information": "View information",
        "offlineAccess": "Access details",
        "order": "Order resource",
        "search": "Open service",
    }
    cards = []

    for details in distributions.values():
        if not isinstance(details, dict):
            continue

        url = primary_text(details.get("url"))
        name = primary_text(details.get("name")) or url or "Dataset resource"
        description = primary_text(details.get("description"))
        function = primary_text(details.get("function"))
        card = {
            "name": name,
            "description": description,
            "url": url,
            "href": url if url.startswith(("http://", "https://")) else "",
            "action": action_labels.get(function, "Open resource"),
            "function": function,
            "protocol": primary_text(details.get("type")),
            "relation": primary_text(details.get("rel")),
            "format": primary_text(details.get("format")),
            "format_version": primary_text(details.get("format_version")),
            "channel": primary_text(details.get("channel")),
        }
        if any(card[key] for key in ("url", "description", "protocol", "format")):
            cards.append(card)

    return cards


def contact_cards(contacts):
    """Prepare pygeometa contact properties for dedicated contact cards."""
    if not isinstance(contacts, dict):
        return []

    contact_methods = (
        ("email", "Email"),
        ("phone", "Phone"),
        ("fax", "Fax"),
        ("url", "Website"),
    )
    address_properties = (
        ("address", "Street address"),
        ("city", "City"),
        ("administrativearea", "Region"),
        ("postalcode", "Postal code"),
        ("country", "Country"),
    )
    cards = []

    for role, details in contacts.items():
        if not isinstance(details, dict):
            continue

        methods = []
        for key, label in contact_methods:
            value = primary_text(details.get(key))
            if not value:
                continue
            href = ""
            if key == "email":
                href = f"mailto:{value}"
            elif key in {"phone", "fax"}:
                telephone = re.sub(r"[^0-9+]", "", value)
                href = f"tel:{telephone}" if telephone else ""
            elif value.startswith(("http://", "https://")):
                href = value
            methods.append({"label": label, "value": value, "href": href})

        address = [
            {"label": label, "value": primary_text(details.get(key))}
            for key, label in address_properties
            if primary_text(details.get(key))
        ]
        name = primary_text(details.get("individualname") or details.get("name"))
        organization = primary_text(details.get("organization"))
        position = primary_text(details.get("positionname"))
        hours = primary_text(details.get("hoursofservice"))
        instructions = primary_text(details.get("contactinstructions"))

        if not any(
            (name, organization, position, methods, address, hours, instructions)
        ):
            continue

        role_label = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", str(role))
        role_label = role_label.replace("_", " ").title()
        cards.append(
            {
                "role": role_label,
                "name": name or organization or role_label,
                "organization": organization if name else "",
                "position": position,
                "methods": methods,
                "address": address,
                "hours": hours,
                "instructions": instructions,
            }
        )

    return cards


def keyword_tags(identification):
    """Return unique keyword values, without their vocabulary metadata."""
    keywords = identification.get("keywords") or {}
    groups = keywords.values() if isinstance(keywords, dict) else keywords
    tags = []

    for group in groups:
        if not isinstance(group, dict):
            continue
        values = group.get("keywords") or []
        if isinstance(values, str):
            values = [values]
        tags.extend(tag for value in values if (tag := primary_text(value)))

    return list(dict.fromkeys(tags))


def primary_text(value):
    """Choose a readable string from pygeometa's scalar or multilingual values."""
    if isinstance(value, dict):
        return next(
            (text for item in value.values() if (text := primary_text(item))), ""
        )
    if isinstance(value, (list, tuple)):
        return next((text for item in value if (text := primary_text(item))), "")
    return "" if value is None else str(value)


def dataset_preview(identification):
    """Return a valid HTTP(S) ISO browse graphic URL, if one is available."""
    preview = primary_text(identification.get("browsegraphic"))
    try:
        parsed = urlsplit(preview)
    except ValueError:
        return ""
    return preview if parsed.scheme in {"http", "https"} and parsed.netloc else ""


def spatial_extent(identification):
    """Return the first valid WGS84 bounding box from pygeometa metadata."""
    extents = identification.get("extents", {}).get("spatial", [])
    if isinstance(extents, dict):
        extents = [extents]

    for extent in extents:
        bbox = extent.get("bbox") if isinstance(extent, dict) else None
        if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
            continue
        try:
            west, south, east, north = (float(value) for value in bbox)
        except (TypeError, ValueError):
            continue
        if -180 <= west < east <= 180 and -90 <= south < north <= 90:
            return {
                "west": west,
                "south": south,
                "east": east,
                "north": north,
            }
    return None


@cache
def catalogue_datasets():
    """Load and cache all dataset records from the configured CSW catalogue."""
    csw = CatalogueServiceWeb(site_config()["catalogue"]["csw_url"])
    records = fetch_all_records(csw)
    datasets = []

    for identifier, record in records.items():
        xml = getattr(record, "xml", None)
        if not xml:
            continue
        xml = xml.decode("utf-8") if isinstance(xml, bytes) else str(xml)
        metadata = import_metadata("iso19139", xml)
        if not metadata:
            logger.warning("pygeometa could not import CSW record %s", identifier)
            continue

        hierarchy = metadata.get("metadata", {}).get("hierarchylevel")
        if hierarchy and hierarchy != "dataset":
            continue

        identifier = (
            metadata.get("metadata", {}).get("identifier")
            or getattr(record, "identifier", None)
            or identifier
        )
        identification = metadata.get("identification", {})
        title = primary_text(identification.get("title")) or identifier
        extent = spatial_extent(identification)
        datasets.append(
            {
                "identifier": identifier,
                "slug": dataset_slug(identifier),
                "title": title,
                "modified": getattr(record, "datestamp", None),
                "abstract": primary_text(identification.get("abstract")),
                "preview": dataset_preview(identification),
                "keyword_tags": keyword_tags(identification),
                "contacts": contact_cards(metadata.get("contact", {})),
                "resources": distribution_cards(metadata.get("distribution", {})),
                "extent": extent,
                "metadata_sections": metadata_sections(metadata, extent),
            }
        )

    return sorted(datasets, key=dataset_sort_key)


def dataset_chunk_pages():
    """Return static JSON page parameters, keeping page 2 valid for empty catalogues."""
    total_pages = (
        len(catalogue_datasets()) + CATALOGUE_PAGE_SIZE - 1
    ) // CATALOGUE_PAGE_SIZE
    return [{"page": page} for page in range(2, max(2, total_pages) + 1)]


def dataset_page_payload(page):
    """Build the compact, public card data for one lazily loaded catalogue page."""
    datasets = catalogue_datasets()
    start = (page - 1) * CATALOGUE_PAGE_SIZE
    items = datasets[start : start + CATALOGUE_PAGE_SIZE]
    next_page = page + 1 if start + len(items) < len(datasets) else None
    return {
        "datasets": [
            {
                key: dataset[key]
                for key in ("identifier", "slug", "title", "preview", "keyword_tags")
            }
            for dataset in items
        ],
        "next_page": next_page,
    }


def dataset_pages():
    """Return URL parameters used by django-distill for dataset detail pages."""
    return [{"slug": dataset["slug"]} for dataset in catalogue_datasets()]


@app.route("/", distill_file="index.html")
def catalogue(request):
    """Render the catalogue index with links to every dataset page."""
    config = shared_template_context()
    datasets = catalogue_datasets()
    return app.render(
        request,
        "index.html",
        context={
            **config,
            "title": config["site"]["title"],
            "datasets": datasets[:CATALOGUE_PAGE_SIZE],
            "dataset_total": len(datasets),
            "dataset_initial_count": min(len(datasets), CATALOGUE_PAGE_SIZE),
            "dataset_next_page": 2 if len(datasets) > CATALOGUE_PAGE_SIZE else "",
            "empty_dataset": {
                "identifier": "",
                "slug": "",
                "title": "",
                "preview": "",
                "keyword_tags": [],
            },
        },
    )


@app.route("/data/datasets/<int:page>.json", distill_func=dataset_chunk_pages)
def dataset_chunk(request, page):
    """Return one static JSON page of catalogue cards."""
    return JsonResponse(dataset_page_payload(page))


@app.route("/search/", distill_file="search/index.html")
def dataset_search(request):
    """Render the static shell for browser-side CSW dataset search."""
    config = shared_template_context()
    datasets = catalogue_datasets()
    return app.render(
        request,
        "search.html",
        context={
            **config,
            "title": "Search datasets",
            "detail_urls": {
                dataset["identifier"]: f"/datasets/{dataset['slug']}/"
                for dataset in datasets
            },
        },
    )


@app.route("/datasets/<slug:slug>/", distill_func=dataset_pages)
def dataset_detail(request, slug):
    """Render one dataset's ISO metadata."""
    dataset = next(
        (item for item in catalogue_datasets() if item["slug"] == slug),
        None,
    )
    if dataset is None:
        raise Http404("Dataset not found")

    config = shared_template_context()
    return app.render(
        request,
        "dataset.html",
        context={
            **config,
            "title": dataset["title"],
            "dataset": dataset,
        },
    )


def start() -> None:
    """Start the nanodjango development server."""
    logger.debug("Starting NINA Public Catalog")
    app.invoke(default="run")


if __name__ == "__main__":
    start()
