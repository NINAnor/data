import { useState } from "react";
import DatasetPreview from "./DatasetPreview";
import type { DatasetCard, DatasetPagePayload, InterfaceStrings } from "../types";

interface Props {
  datasets: DatasetCard[];
  total: number;
  ui: InterfaceStrings;
  searchUrl: string;
  datasetUrlPrefix: string;
  dataUrlPrefix: string;
}

function format(message: string, values: Record<string, string | number>): string {
  return message.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

function isDatasetPagePayload(value: unknown): value is DatasetPagePayload {
  if (value === null || typeof value !== "object" || !("datasets" in value)) return false;
  const payload = value as { datasets: unknown; next_page?: unknown };
  return (
    Array.isArray(payload.datasets) &&
    (payload.next_page === null || typeof payload.next_page === "number")
  );
}

export default function CatalogueGrid({
  datasets,
  total,
  ui,
  searchUrl,
  datasetUrlPrefix,
  dataUrlPrefix,
}: Props) {
  const [items, setItems] = useState<DatasetCard[]>(datasets);
  const [nextPage, setNextPage] = useState<number | null>(datasets.length < total ? 2 : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function loadMore() {
    if (!nextPage || busy) return;
    setBusy(true);
    setError(false);
    try {
      const response = await fetch(`${dataUrlPrefix}${nextPage}.json`);
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      const payload: unknown = await response.json();
      if (!isDatasetPagePayload(payload)) throw new Error("Invalid dataset page");
      setItems((current) => [...current, ...payload.datasets]);
      setNextPage(payload.next_page);
    } catch (loadError) {
      console.error("Could not load more catalogue records", loadError);
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.length ? (
          items.map((dataset) => (
            <article
              className="card border border-base-300 bg-base-100 shadow-sm"
              id={dataset.identifier}
              key={dataset.identifier}
            >
              <DatasetPreview
                preview={dataset.preview}
                alt={format(ui.preview_of, { title: dataset.title })}
              />
              <div className="card-body">
                <h2 className="card-title text-primary">
                  <a href={`${datasetUrlPrefix}${dataset.slug}/`}>{dataset.title}</a>
                </h2>
                {dataset.keyword_tags.length > 0 && (
                  <div className="flex flex-wrap gap-2" aria-label={ui.dataset_tags}>
                    {dataset.keyword_tags.map((tag) => (
                      <a
                        className="badge badge-secondary badge-outline max-w-full h-auto min-h-6 whitespace-normal wrap-anywhere"
                        key={tag}
                        href={`${searchUrl}?keyword=${encodeURIComponent(tag)}`}
                      >
                        {tag}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </article>
          ))
        ) : (
          <p className="col-span-full rounded-box bg-base-100 p-6">{ui.no_records}</p>
        )}
      </div>
      <div className="mt-8 flex flex-col items-center gap-3">
        <p className="text-sm" aria-live="polite">
          {format(ui.showing_datasets, { loaded: items.length, total })}
        </p>
        {error && (
          <output className="block text-sm text-error-content" aria-live="polite">
            {ui.load_error}
          </output>
        )}
        {nextPage && (
          <button
            className="btn btn-secondary"
            type="button"
            onClick={loadMore}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? ui.loading : error ? ui.retry : ui.load_more}
          </button>
        )}
        {nextPage && (
          <noscript>
            <p className="text-sm">{ui.enable_javascript}</p>
          </noscript>
        )}
      </div>
    </section>
  );
}
