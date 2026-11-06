import { loadDatasetDetails, loadRecords, summarizeRecord } from "./catalogue";

export async function getDatasetStaticPaths() {
  const records = await loadRecords();
  return Promise.all(
    records.map(async (record) => {
      const summary = summarizeRecord(record);
      return {
        params: { slug: summary.slug },
        props: { dataset: await loadDatasetDetails(record, summary) },
      };
    }),
  );
}
