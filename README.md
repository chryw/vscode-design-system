# VS Code design-system explorer

A private, installable Copilot canvas for browsing a selected VS Code checkout's design-system book. This repository owns the viewer, source adapters, controllers, local runtime, and tests. It contains no product checkout, chapter content, proposed design guidance, token definitions, or product fixtures.

The working draft lives on the public [`chryw/design-system-exploration` branch](https://github.com/microsoft/vscode/tree/chryw/design-system-exploration). Public branch content is experimental, not shipped product guidance. This repository's privacy controls access to the viewer, not to that public content.

## Requirements

- Node.js matching the selected VS Code checkout's `.nvmrc`.
- A VS Code or Agents window session backed by Copilot SDK with canvas extension support. This isn't a Marketplace extension or VSIX and doesn't work in every chat provider.
- Read access to this private repository and GitHub authentication for cloning it.
- A checkout containing `.github/design-system/book.json` and its bound sources.

The viewer uses JavaScript modules directly: **no viewer build, package installation, or independent Copilot SDK dependency is needed**. Source parsing uses the selected checkout's TypeScript dependency. Live product examples additionally use that checkout's Component Explorer and MCP dependencies. Restore the checkout's own dependencies through its documented pnpm setup; don't share `node_modules` between worktrees. Missing dependencies produce an explicit error.

## Install in a workspace

Clone the repositories into separate directories:

```sh
gh repo clone chryw/vscode-design-system
gh repo clone microsoft/vscode vscode-design-exploration -- --branch chryw/design-system-exploration --single-branch
node vscode-design-system/scripts/install.mjs --workspace /absolute/path/to/vscode-design-exploration
```

The installer copies only executable viewer assets and supporting tools into the selected checkout's `.github/extensions/vscode-design-system/`. It validates the book, records an installation fingerprint, and adds a local Git exclusion without changing tracked files. It refuses to overwrite a tracked extension, an unmanaged installation, or locally edited installed files. Install only trusted viewer code: SDK extensions run local Node.js processes.

Open that checkout in VS Code or select it as the Agents window session workspace. Start a compatible Copilot session and ask:

> Reload extensions, discover the `vscode-design-system` canvas, and open it with `root` set to this checkout's absolute path. Use a stable instance ID. List its topics to verify the installation.

New sessions discover workspace extensions at startup; an existing session needs its extension providers reloaded. A reload restarts all extension providers for that session. There must be only one active registration for `vscode-design-system`; don't also install a user-scope or plugin copy.

If the Agents window creates an isolated worktree, install into **that worktree**, not only its parent checkout. Discovery follows the session's workspace. Canvas input `root` chooses the data checkout; it doesn't install the extension there.

The canvas reads guidance and product definitions from the selected checkout and refreshes saved edits. Live examples start the checkout's Component Explorer on demand. No product application build is required just to browse the book. Catalog/fixture-binding changes require a provider reload; ordinary guidance and product-source edits use topic refresh.

## Update and uninstall

Update the viewer source clone, then explicitly replace an unchanged managed installation:

```sh
git -C vscode-design-system pull --ff-only
node vscode-design-system/scripts/install.mjs --workspace /absolute/path/to/vscode-design-exploration --update
```

Reload extension providers afterward. Update the product checkout separately; viewer updates never fetch or modify product sources. Use the version and product revision recorded in `compatibility.json` for a reproducible starting point.

To uninstall, remove only the installed `.github/extensions/vscode-design-system/` directory, then reload providers. The installer leaves its local exclusion rule in Git's `info/exclude`; remove that exact rule if desired. Private view state remains under `extension-data/vscode-design-system/` in `COPILOT_HOME`, or `~/.copilot` when unset, and is isolated by checkout, book, and panel.

## Develop and validate

Edit the viewer in this repository and guidance/product examples in the selected VS Code checkout. Reinstall with `--update` and reload after viewer changes. Never edit the generated installed copy.

```sh
node --check extension.mjs
node scripts/test.mjs --root /absolute/path/to/vscode-design-exploration
node scripts/book.mjs validate --root /absolute/path/to/vscode-design-exploration
node scripts/book.mjs read --root /absolute/path/to/vscode-design-exploration --topic motion --limit 12000
node scripts/book.mjs documents --root /absolute/path/to/vscode-design-exploration --query "motion"
```

The test runner executes against the explicit checkout while loading tests and viewer code from this clone. Browser checks use that checkout's Playwright dependency; run them from its working directory with absolute test paths. SDK adapter tests don't replace a real host installation check.

For browser-only inspection, `node scripts/book.mjs serve --root /absolute/path/to/checkout` starts a loopback server and reports its URL. For a portable review snapshot, `node scripts/export.mjs /absolute/path/to/book.html --root /absolute/path/to/checkout` uses the selected checkout's prepared Rspack and Playwright tooling.

## Ownership and collaboration

- Viewer layout, diagrams, source readers, serving, and canvas actions belong here.
- Book navigation, composition data, guidance, tokens, styles, and real component fixtures belong to the VS Code branch.
- The viewer must never substitute bundled guidance or product values when selected-checkout sources are missing.
- Propose viewer changes through this private repository's PRs; propose guidance and product changes on the public exploration branch.

See [architecture](docs/architecture.md) and the [document protocol](docs/documents.md). Authoring conventions live in the selected checkout's `.github/design-system/authoring.md`, not in this viewer.
