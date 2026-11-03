import json
import re
import unittest
from pathlib import Path

from owslib.fes import And

WORKER_SOURCE = Path(__file__).parents[1] / "static/js/search-worker.js"
PYTHON_SEARCH = re.search(
    r"const PYTHON_SEARCH = String\.raw`([\s\S]*?)`;\n",
    WORKER_SOURCE.read_text(),
).group(1)


class FakeClient:
    def __init__(self):
        self.results = {"matches": 0}
        self.records = {}
        self.request = None

    def getrecords2(self, **kwargs):
        self.request = kwargs


class SearchWorkerTests(unittest.TestCase):
    def setUp(self):
        self.namespace = {}
        exec(  # noqa: S102 - Executes local worker source.
            PYTHON_SEARCH,
            self.namespace,
        )
        self.client = FakeClient()
        self.namespace["client"] = self.client

    def test_active_filters_are_combined_with_and(self):
        payload = {
            "query": "lynx",
            "keywords": ["wolverine", "large carnivores"],
            "start": "2026-01-01",
            "end": "2026-12-31",
            "bbox": [5, 58, 31, 71],
            "page": 2,
        }

        result = json.loads(self.namespace["search_json"](json.dumps(payload)))

        constraint = self.client.request["constraints"][0]
        self.assertIsInstance(constraint, And)
        self.assertEqual(len(constraint.operations), 6)
        self.assertEqual(self.client.request["startposition"], 11)
        self.assertEqual(self.client.request["maxrecords"], 10)
        self.assertEqual(result["matches"], 0)
        self.assertEqual(result["records"], [])

    def test_invalid_rectangle_is_rejected_before_request(self):
        with self.assertRaisesRegex(ValueError, "valid rectangle"):
            self.namespace["search_json"](
                json.dumps({"bbox": [10, 70, 5, 60], "page": 1})
            )

        self.assertIsNone(self.client.request)

    def test_subject_domain_is_split_into_unique_keywords(self):
        class DomainClient:
            results = {
                "values": [
                    "Occurrence,lynx, wolverine,Occurrence",
                    "birds, lynx",
                ]
            }

            def getdomain(self, property_name, dtype):
                self.property_name = property_name
                self.dtype = dtype

        self.namespace["CatalogueServiceWeb"] = lambda *args, **kwargs: DomainClient()
        keywords = json.loads(self.namespace["initialize_catalogue_json"]())

        self.assertEqual(keywords, ["birds", "lynx", "Occurrence", "wolverine"])


if __name__ == "__main__":
    unittest.main()
