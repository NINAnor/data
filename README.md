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
Start the app with Pixi so the local stylesheet is generated first:
```bash
pixi run -e dev start
```

For direct uv execution, generate the stylesheet first:
```bash
pixi run -e dev build-css
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
The catalogue page is generated from the live NINA CSW endpoint:

```bash
pixi run -e dev build-static
```

The generated site is written to `output/`; each build recreates that generated directory.

### Pixi (optional)
Pixi is configured alongside the template's uv environment. The Linux Pixi environment uses Python 3.15 and installs Bun from conda-forge. Bun installs DaisyUI and Tailwind CSS from `package.json`.
Edit `assets/css/app.css` to change the DaisyUI `nina` palette, and `templates/base.html` to change the shared page layout.

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
