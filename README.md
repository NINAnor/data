# NINA Public Catalog

Static bilingual catalogue site built with Astro and React using TypeScript/TSX. Catalogue data comes exclusively from the NINA OGC API Records endpoint through [`@camptocamp/ogc-client`](https://github.com/camptocamp/ogc-client).

## Requirements

- Node.js 22.12 or newer
- pnpm 12

## Development

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Astro development server runs at `http://localhost:4321/`. Tailwind CSS and DaisyUI are integrated into Astro’s Vite pipeline.

Static files served as-is belong in `public/`; imported files that should be bundled belong under `src/`. Site CSS is in `src/styles/`.

## Build and verification

```bash
pnpm test
pnpm check
pnpm build
pnpm preview
```

The static site is generated in `dist/`. Build fetches Records from the configured OGC API, follows pagination, and requests ISO 19139 XML for full dataset details. The current default endpoint is `https://csw.nina.no` and collection is `metadata:main`.

The site title, description, collection, and available contact details are discovered from the OGC API landing page, collection list, and OpenAPI document. The API does not publish the footer phone or street address, so those retain NINA defaults. Override the API root or collection for a build with:

```bash
OGC_API_URL=https://csw.nina.no OGC_COLLECTION_ID=metadata:main pnpm build
```

The API must allow browser CORS access for the search page. It must expose OGC API Records JSON and ISO 19139 XML for individual items.

## Site behavior

- English at `/` and Norwegian Bokmål at `/no/`, with equivalent-page language links.
- Astro i18n routing keeps English as the unprefixed default and generates localized links with `astro:i18n`.
- Homepage cards are ordered by metadata update date; additional records load in groups of 12.
- Search supports text, all-selected-keyword matching, metadata update date range, and drawn bounding boxes. Search state is shareable through the URL; results use 10-record pages.
- Each dataset has a statically generated English and Norwegian detail page, including ISO metadata, contacts, resources, keywords, and spatial extent.
- GitHub Pages builds set Astro’s `base` path directly, including project-site deployments.

## Git hooks

Husky installs the pre-commit hook during `pnpm install`. The hook formats and lints staged TypeScript/TSX files with Oxfmt and Oxlint, then runs tests and Astro checks.
