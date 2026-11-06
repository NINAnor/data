import { loadDatasets } from "../../../lib/catalogue";

const PAGE_SIZE = 12;

export async function getStaticPaths() {
  const datasets = await loadDatasets();
  const totalPages = Math.ceil(datasets.length / PAGE_SIZE);
  return Array.from({ length: Math.max(2, totalPages) - 1 }, (_, index) => ({
    params: { page: String(index + 2) },
  }));
}

export async function GET({ params }: { params: { page?: string } }): Promise<Response> {
  const datasets = await loadDatasets();
  const page = Number.parseInt(params.page ?? "", 10);
  if (!Number.isSafeInteger(page) || page < 2) {
    return new Response("Not found", { status: 404 });
  }
  const start = (page - 1) * PAGE_SIZE;
  const items = datasets
    .slice(start, start + PAGE_SIZE)
    .map(({ identifier, slug, title, preview, keyword_tags }) => ({
      identifier,
      slug,
      title,
      preview,
      keyword_tags,
    }));
  return new Response(
    JSON.stringify({
      datasets: items,
      next_page: start + items.length < datasets.length ? page + 1 : null,
    }),
    {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    },
  );
}
