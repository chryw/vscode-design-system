# VS Code design-system explorer

A source-backed browser for the work-in-progress VS Code design system. Browse guidance, inspect product tokens, and try live component examples from a selected VS Code checkout.

Both repositories are public. This repository contains the viewer and its tools; the [`chryw/design-system-exploration` branch](https://github.com/microsoft/vscode/tree/chryw/design-system-exploration) contains the draft guidance, book navigation, tokens, styles, and product fixtures. The draft is experimental, not shipped product guidance.

**No viewer build or GitHub CLI is required.** Cloning these public repositories doesn't require GitHub sign-in. The viewer runs directly from JavaScript modules. The selected VS Code checkout needs its own dependencies; live examples also need prepared client output.

## Get started

You can use the explorer in an ordinary browser or as a canvas inside a compatible Copilot session. Neither route requires building or launching Code OSS.

### 1. Get the viewer and the content

Install [Git](https://git-scm.com/downloads), then run these commands from a directory where you keep projects:

```sh
git clone https://github.com/chryw/vscode-design-system.git
git clone --branch chryw/design-system-exploration --single-branch https://github.com/microsoft/vscode.git vscode-design-exploration
```

Keep the directories separate. If you already have the viewer or a prepared VS Code checkout with `.github/design-system/book.json`, reuse it and substitute its path below. Don't switch an existing working checkout to another branch or discard edits just to follow this guide. [compatibility.json](compatibility.json) records a tested product revision if you need a reproducible starting point.

### 2. Prepare the content checkout

Use the Node.js version in the VS Code checkout's `.nvmrc` and the pnpm version in its `package.json` `packageManager` field. If you use nvm, `nvm install` followed by `nvm use` inside that checkout selects its Node.js version. Otherwise use your usual Node.js version manager. See [pnpm installation](https://pnpm.io/installation) if pnpm isn't available.

```sh
cd vscode-design-exploration
pnpm install
node ../vscode-design-system/scripts/book.mjs validate --root .
```

Validation should report `valid: true` and no diagnostics. This checks the selected checkout's content; it doesn't install the canvas.

To use live component examples, also prepare client output:

```sh
pnpm run build-fast --client-only
```

This is a product-source preparation step, not a viewer build or a full application build. The viewer starts this checkout's Component Explorer on demand when a live example comes into view. Skip dependency restoration or client preparation when that checkout is already prepared and unchanged. Don't copy or symlink `node_modules` from another checkout.

If dependency restoration fails, follow the selected checkout's [contribution guidance](https://github.com/microsoft/vscode/wiki/How-to-Contribute) and any organization-specific setup instructions. Don't disable install scripts or change registry credentials to work around an error. Public source access doesn't guarantee access to every development dependency.

### 3. Open in a browser

From the VS Code checkout used in step 2:

```sh
node ../vscode-design-system/scripts/book.mjs serve --root .
```

Open the `url` printed in the terminal. Keep that terminal running while you browse; press **Ctrl+C** to stop the server. It serves only on this machine's loopback interface.

You should see the book's navigation and articles. Open **Motion** and scroll to a live example to check that Component Explorer is ready. Article browsing doesn't require an agent or canvas support.

### Or: install as a Copilot canvas

This route requires a VS Code or Agents window session backed by Copilot SDK with canvas extension support. It isn't a Marketplace extension or VSIX, and not every chat provider can open it. There is no Extensions-view Install button.

From the VS Code checkout used in step 2:

```sh
node ../vscode-design-system/scripts/install.mjs --workspace .
```

Open **that VS Code checkout** as the session workspace, then ask its Copilot chat:

> Reload extensions, discover the `vscode-design-system` canvas, and open it for this checkout. List its topics to verify the installation.

The installer copies viewer assets into `.github/extensions/vscode-design-system/`, records an installation fingerprint, and adds a local Git exclusion. It doesn't change tracked product files. Install only trusted viewer code: SDK extensions run local Node.js processes.

New sessions discover workspace extensions at startup; an existing session needs its extension providers reloaded. Reloading restarts all extension providers for that session. Keep only one active registration for `vscode-design-system`; don't also install a user-scope or plugin copy.

**Using an isolated Agents worktree?** Prepare and install into that worktree, not only its parent checkout. Discovery follows the session workspace. The canvas's `root` input selects a content checkout; it doesn't install an extension there.

## Let an agent handle setup

You can also give an agent this request:

> Install and open https://github.com/chryw/vscode-design-system. Read its README.md and AGENTS.md, prepare a suitable VS Code exploration checkout, and verify an article and a live example. Preserve my existing work. If this chat cannot open canvases, use the browser route instead.

[AGENTS.md](AGENTS.md) gives agents a bounded setup and verification workflow. It points back to the same human-readable steps rather than maintaining a second installation guide. An agent reading only a repository URL must fetch these files explicitly; cloning this repository doesn't automatically load its instructions into an unrelated chat. A URL by itself also doesn't specify permission to install or start processes, so include the requested action.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| Missing book or source files | Select the exploration checkout, not the viewer clone or an unrelated VS Code branch. Check for `.github/design-system/book.json`. |
| Missing TypeScript, MCP, or other modules | Restore dependencies in the selected VS Code checkout, not in this viewer repository. |
| Articles load but examples don't | Prepare client output in that checkout, then scroll the example into view. Inspect the reported preview error before starting another server. |
| Canvas not discovered | Confirm the chat supports SDK canvases, install into its actual workspace/worktree, and reload providers. Otherwise use the browser route. |
| Installer refuses replacement | It protects tracked, unmanaged, or locally edited installations. Preserve edits before updating; don't bypass the checks. |

## Update and uninstall

From the directory containing the viewer clone, pull updates:

```sh
git -C vscode-design-system pull --ff-only
```

For canvas installations, run the installer again from that clone with `--workspace /absolute/path/to/vscode-checkout --update`, then reload extension providers. For browser use, stop and restart the serving command. Update the product checkout separately; viewer updates never fetch or modify product sources.

To uninstall a canvas, remove only the installed `.github/extensions/vscode-design-system/` directory, then reload providers. The installer leaves its local exclusion rule in Git's `info/exclude`; remove that exact rule if desired. Private view state remains under `extension-data/vscode-design-system/` in `COPILOT_HOME`, or `~/.copilot` when unset, and is isolated by checkout, book, and panel. The browser route doesn't install an extension.

## Develop and collaborate

This repository owns the viewer layout, adapters, controllers, local runtime, and tests. It contains no book manifest, chapter content, guidance, token definitions, or product fixtures. Make viewer changes here and guidance/product changes in the selected VS Code checkout. The viewer must never substitute bundled content when checkout sources are missing.

Saved guidance and product-source edits use topic refresh. Book catalog or fixture-binding changes require a provider reload, or a server restart for the browser route. After viewer changes, update the managed installation and reload; never edit the generated installed copy.

From the viewer source clone:

```sh
node --check extension.mjs
node scripts/test.mjs --root /absolute/path/to/vscode-checkout
node scripts/book.mjs read --root /absolute/path/to/vscode-checkout --topic motion --limit 12000
node scripts/book.mjs documents --root /absolute/path/to/vscode-checkout --query "motion"
```

The test runner executes against the explicit checkout while loading tests and viewer code from this clone. Browser checks use that checkout's Playwright dependency. SDK adapter tests don't replace a real host installation check.

For a portable snapshot, `node scripts/export.mjs /absolute/path/to/book.html --root /absolute/path/to/vscode-checkout` uses the selected checkout's prepared Rspack and Playwright tooling. [Private review publishing](docs/private-review.md) is a separate, optional deployment workflow; it isn't needed to install or browse the explorer and does require GitHub CLI.

See [architecture](docs/architecture.md) and the [document protocol](docs/documents.md). Authoring conventions live in the selected checkout's `.github/design-system/authoring.md`, not in this viewer.
