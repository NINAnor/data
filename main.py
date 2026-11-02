#!/usr/bin/env python3

import logging
import pathlib

import environ
from nanodjango import Django
from owslib.csw import CatalogueServiceWeb

env = environ.Env()
BASE_DIR = pathlib.Path(__file__).parent
environ.Env.read_env(str(BASE_DIR / ".env"))

DEBUG = env.bool("DEBUG", default=False)

logging.basicConfig(level=(logging.DEBUG if DEBUG else logging.INFO))

logger = logging.getLogger(__name__)
csw = CatalogueServiceWeb("https://csw.nina.no/csw")
app = Django(DEBUG=DEBUG, STYLE_THEME="tailwind")


@app.route("/", distill_file="index.html")
def catalogue(request):
    """Render the first page of NINA catalogue records."""
    csw.getrecords2(startposition=0, maxrecords=10, esn="full")

    return app.render(
        request,
        "index.html",
        context={
            "site_title": "NINA Public Catalog",
            "title": "NINA Public Catalog",
            "records": csw.records.items(),
        },
    )


def start() -> None:
    """Start the nanodjango development server."""
    logger.debug("Starting NINA Public Catalog")
    app.invoke(default="run")


if __name__ == "__main__":
    start()
