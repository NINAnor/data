const catalogue = document.querySelector("#dataset-catalogue");
const datasetList = document.querySelector("#dataset-list");
const datasetCount = document.querySelector("#dataset-count");
const loadStatus = document.querySelector("#dataset-load-status");
const loadMoreButton = document.querySelector("#load-more-datasets");
const cardTemplate = document.querySelector("#dataset-card-template");
const ui = JSON.parse(document.querySelector("#ui-strings").textContent);

function format(message, values = {}) {
  return message.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
}

const total = Number.parseInt(catalogue.dataset.total, 10);
let loaded = Number.parseInt(catalogue.dataset.loaded, 10);
let nextPage = Number.parseInt(catalogue.dataset.nextPage, 10) || null;

function createDatasetCard(dataset) {
  const card = cardTemplate.content.firstElementChild.cloneNode(true);
  card.id = dataset.identifier;

  const titleLink = card.querySelector("[data-dataset-title]");
  titleLink.textContent = dataset.title;
  titleLink.href = new URL(`datasets/${dataset.slug}/`, document.baseURI).href;

  if (dataset.preview) {
    const preview = document.createElement("img");
    preview.className = "absolute inset-0 h-full max-h-24 w-full object-cover";
    preview.src = dataset.preview;
    preview.alt = format(ui.preview_of, { title: dataset.title });
    preview.loading = "lazy";
    preview.decoding = "async";
    preview.dataset.datasetPreview = "";
    card.querySelector("[data-preview-frame]").append(preview);
  }

  const tags = card.querySelector("[data-dataset-tags]");
  tags.replaceChildren();
  for (const tag of dataset.keyword_tags) {
    const link = document.createElement("a");
    link.className = "badge badge-secondary badge-outline max-w-full h-auto min-h-6 whitespace-normal wrap-anywhere";
    link.textContent = tag;
    const searchUrl = new URL("search/", document.baseURI);
    searchUrl.searchParams.set("submitted", "1");
    searchUrl.searchParams.set("keyword", tag);
    link.href = searchUrl.href;
    tags.append(link);
  }
  tags.hidden = dataset.keyword_tags.length === 0;

  return card;
}

loadMoreButton.addEventListener("click", async () => {
  if (loadMoreButton.disabled || !nextPage) return;

  const requestedPage = nextPage;
  loadMoreButton.disabled = true;
  loadMoreButton.setAttribute("aria-busy", "true");
  loadMoreButton.textContent = ui.loading;
  loadStatus.hidden = true;

  try {
    const url = new URL(`data/datasets/${requestedPage}.json`, document.baseURI);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Request failed with status ${response.status}`);

    const payload = await response.json();
    if (!Array.isArray(payload.datasets)) throw new Error("Invalid dataset response");
    if (
      payload.next_page !== null &&
      (!Number.isSafeInteger(payload.next_page) || payload.next_page <= requestedPage)
    ) {
      throw new Error("Invalid next-page response");
    }

    const cards = document.createDocumentFragment();
    for (const dataset of payload.datasets) cards.append(createDatasetCard(dataset));
    datasetList.append(cards);

    loaded += payload.datasets.length;
    datasetCount.textContent = format(ui.showing_datasets, { loaded, total });
    nextPage = payload.next_page;
    loadMoreButton.hidden = !nextPage;
    loadMoreButton.textContent = ui.load_more;
  } catch (error) {
    console.error("Could not load more datasets", error);
    loadStatus.textContent = ui.load_error;
    loadStatus.hidden = false;
    loadMoreButton.textContent = ui.retry;
  } finally {
    loadMoreButton.disabled = false;
    loadMoreButton.removeAttribute("aria-busy");
  }
});
