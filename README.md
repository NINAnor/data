# datasets

## Setup
Install `uv`: https://docs.astral.sh/uv/getting-started/installation/

```bash
git init
uv sync --dev
git add .
git commit -m "Initial commit"
uv run prek install # optional
```


### Run
Start the app with Pixi so CSS is generated and static files are collected first:
```bash
pixi run -e dev start
```

For direct uv execution, generate the stylesheet first:
```bash
pixi run -e dev build-css
uv run python main.py manage collectstatic --noinput
uv run main.py
```

Run the installed command after building CSS:
```bash
uvx --from . datasets
```

### Development
Start the app with Pixi so it builds the stylesheet first:

```bash
pixi run -e dev start
```

To rebuild CSS while editing, run `pixi run -e dev watch-css` in a second terminal.

### Build the static site
The catalogue index and one metadata page per dataset are generated from the configured CSW endpoint (`catalogue.csw_url` in `templates/site.yml`). The build requests ISO 19139 metadata and parses it with pygeometa; CSW results are paginated. The homepage renders its first 12 datasets in HTML and loads later groups of 12 from generated JSON files when requested. The card grid uses four columns on extra-large screens. Cards are ordered by modification date, newest first; records without a valid date appear last.

```bash
pixi run -e dev build-static
```

The generated site is written to `output/`; each build recreates that generated directory.

For a local experiment against the larger integration catalogue, override the endpoint for that build only:

```bash
CSW_URL=https://pycsw-int.nina.no/csw pixi run -e dev build-static
```

The GitHub Pages workflow does not set `CSW_URL`, so production continues to use the endpoint in `templates/site.yml`.

The build also creates `/search/`. Its browser-side search uses Pyodide 0.29.5 and OWSLib 0.36.0 to query the configured endpoint directly with CSW 2.0.2 Filter Encoding. The browser loads Pyodide and OWSLib from their public package/CDN sources at runtime.

The configured CSW endpoint must allow CORS from the deployed site origin for GET and POST requests, including OPTIONS preflight and the XML POST content type. Without that endpoint configuration, search displays a connection error and offers retry; the static catalogue pages remain available.

### Pixi (optional)
Pixi is configured alongside the template's uv environment. The Linux Pixi environment uses Python 3.15 and installs Bun from conda-forge. Bun installs DaisyUI and Tailwind CSS from `package.json`.
Edit `assets/css/app.css` to change the DaisyUI `nina` palette, `templates/base.html` to change the shared page layout, and `templates/site.yml` to configure the site metadata, CSW endpoint, and footer contact information.

```bash
pixi install -e dev
pixi run -e dev start
pixi run bun --version
pixi run python --version
pixi run -e dev check
```

### Update from template
To update your project with the latest changes from the template, run:
```bash
uvx --with copier-template-extensions copier update --trust
```

You can keep your previous answers by using:
```bash
uvx --with copier-template-extensions copier update --trust --defaults
```

### (Optional) prek
prek is a fast, Rust-based tool for managing git hooks (100% compatible with pre-commit). It helps ensure code quality by running checks every time you make a commit.

First, install prek:
```bash
uv tool install prek
```

If you have installed the git hooks with `pre-commit` (template version 0.2.6 and older), remove them before installing the ones provided by prek:

```
pre-commit uninstall
```

Then install git hooks:
```bash
prek install
```

To run prek on all files:
```bash
prek run --all-files
```

### How to install a package
Run `uv add <package-name>` to install a package. For example:
```bash
uv add requests
```

#### Visual studio code
If you are using visual studio code install the recommended extensions

### Tools installed
- uv
- Pixi (optional)
- Bun (via Pixi)
- DaisyUI and Tailwind CSS (via Bun)
- prek (optional)

#### What is an environment variable? and why should I use them?
Environment variables are variables that are not populated in your code but rather in the environment
that you are running your code. This is extremely useful mainly for two reasons:
- security, you can share your code without sharing your passwords/credentials
- portability, you can avoid using hard-coded values like file-system paths or folder names

you can place your environment variables in a file called `.env`, the `main.py` will read from it. Remember to:
- NEVER commit your `.env`
- Keep a `.env.example` file updated with the variables that the software expects
