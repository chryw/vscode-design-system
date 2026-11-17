# Setup reference

Start with the [README](../README.md) to open the book in a browser or install it as a Copilot canvas.

## Requirements

- Git.
- The Node.js version in the selected VS Code checkout's `.nvmrc`, installed directly or through your preferred version manager.
- The pnpm version in that checkout's `package.json` `packageManager` field. See [pnpm installation](https://pnpm.io/installation) if needed.
- For the canvas route, a VS Code or Agents window session backed by Copilot SDK with canvas extension support.

The viewer runs directly from JavaScript modules. Dependencies and client output belong to the selected VS Code checkout. The viewer starts that checkout's Component Explorer when a live example comes into view.

For dependency setup problems, see VS Code's [contribution guidance](https://github.com/microsoft/vscode/wiki/How-to-Contribute) and any organization-specific setup instructions.

## Use an existing checkout

Choose any local VS Code checkout. The [exploration branch](https://github.com/microsoft/vscode/tree/chryw/design-system-exploration), containing `.github/design-system/book.json`, enables the curated book. Without that manifest, the viewer exposes a source library of product Markdown, repository instructions, skills, and any local design guidance. It does not substitute content from another checkout. Malformed manifests and unreadable sources remain explicit errors. Keep the viewer source clone separate when using the browser/development route. [compatibility.json](../compatibility.json) records a tested curated product revision.

From the viewer clone, pass the checkout explicitly:

```sh
node scripts/book.mjs serve --root /absolute/path/to/vscode-checkout
```

Reuse that checkout's existing dependencies and client output when they are already prepared. Basic source browsing needs no product build or dependency installation. Some curated source readers need dependencies; live examples also need `pnpm run build-fast --client-only`.

## Native plugin

The repository's `.plugin/plugin.json` declares the independent viewer, and `.plugin/marketplace.json` supplies its marketplace entry. The plugin extension imports the shared viewer implementation; it packages no product guidance or book data. Install through the client's native manager as described in the README. For CLI source development, `copilot --plugin-dir /absolute/path/to/vscode-design-system` loads the source package without installing a copy.

Use **Change checkout** in the canvas header, or the `select_checkout` canvas action with an absolute `root`, to browse another clone or worktree in the same panel and on the same server. Selection is saved privately per originating workspace and panel, with topic views separately keyed by checkout and book mode. Reopening after a provider restart restores that selection. Another checkout is never modified as a side effect of browsing.

The canvas checks the local Git branch and commit periodically. An external branch change recreates its source readers and watches, rereads the checkout-owned catalog, and refreshes the same panel. A topic absent from the new branch returns to that branch's default topic. Source-library mode explicitly explains why curated topics and live examples are unavailable. Invalid checkout selection preserves the current book and reports the error.

Native plugin auto-updates depend on the client's version, marketplace configuration, permissions, and automatic-update policy. Updates are not instant; activation may require a provider reload. Keep the existing panel and its checkout selection rather than opening a replacement.

### Move from a workspace installation to the plugin

1. Preserve any edits in the old managed `.github/extensions/vscode-design-system/` installation. The existing installer refuses to overwrite locally changed files.
2. Disable the workspace provider through the client's extension manager before enabling the plugin provider. Keep exactly one active registration for `vscode-design-system`.
3. Install the plugin through the native manager, reload providers at a safe boundary, and reopen the same canvas in its owning chat.
4. Verify the selected checkout, topic, and saved view. Remove the obsolete managed copy only after verifying the plugin. Do not remove independent or unrecognized extensions.

## Canvas workspaces

Install into the chat's actual VS Code workspace or isolated worktree:

```sh
node scripts/install.mjs --workspace /absolute/path/to/vscode-checkout
```

On Windows, use your checkout path, for example `--workspace "C:/src/vscode-design-exploration"`.

The installer copies assets into `.github/extensions/vscode-design-system/` and adds a local Git exclusion. New sessions discover workspace extensions at startup; existing sessions need their extension providers reloaded. Keep only one active registration for `vscode-design-system`.

For an isolated Agents worktree, prepare and install into that worktree. Discovery follows the session workspace. The canvas's `root` input selects the content checkout; installation determines where the extension is discovered.

## Keep one current book

Use one design-system canvas per product worktree across all chats and sessions, including newly opened sessions. Reuse the existing canvas in its owning chat. Instance IDs are chat-scoped: opening `design-book` in another chat still creates another canvas. Do not invent numbered, topic-specific, or validation-specific instances.

Before opening a canvas, locate the worktree's existing canvas owner through its shared coordination record or known session. Where the worktree uses the private coordination index, resolve it with `git rev-parse --git-path copilot-workflow.json` and read its owner/checkpoint. If no canvas exists, open `vscode-design-system` once with instance ID `design-book` and the selected worktree's `root`. Record that owning chat, root, and instance in the existing worktree coordination record so later sessions can return to it.

The canvas owner refreshes the same instance with the combined saved worktree, including uncommitted changes, rather than a contributor's isolated snapshot. Use topic refresh for guidance and product-source edits. External Git branch or commit changes refresh the catalog automatically; saved topics absent from that catalog are dropped with an explanation. Uncommitted book catalog or fixture-binding changes still require a provider reload. Viewer changes arrive through native plugin updates, or an updated managed installation for the legacy route, followed by a provider reload when required. Serialize these operations with active contributors, validate a coherent candidate, and preserve the current topic and view. Do not install partially written changes or postpone every refresh indefinitely behind new work.

Retire obsolete instances with the host's **Close Canvas** action. Closing an editor tab or stopping a viewer server alone does not remove a canvas from the picker. Preserve the canonical instance and unrelated canvases.

Before reporting the book as current, verify that the picker contains only one design-system canvas, its content root is the intended worktree, and it reflects the latest coordinated product and viewer changes. If a refresh is pending or cleanup is blocked, report that limitation rather than opening a replacement.

## Check the content

From the viewer clone:

```sh
node scripts/book.mjs validate --root /absolute/path/to/vscode-checkout
```

For a compatible curated checkout, validation should report `valid: true` and no diagnostics. In basic mode, a missing curated-guidance diagnostic is expected; open a source-library document to verify browsing. Live examples apply only to compatible curated checkouts.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| Source library instead of curated topics | This checkout has no design-book manifest. Browse its documents or select the exploration worktree for the full book. |
| Unsupported or malformed book, or missing source files | Inspect the reported source error; select a compatible checkout if needed. Other checkouts' content is never substituted. |
| Missing TypeScript, MCP, or other modules | Run `pnpm install` in the selected VS Code checkout. |
| Articles load but examples don't | Prepare client output in that checkout, then scroll the example into view. Inspect any preview error before starting another server. |
| Canvas not discovered | Check canvas support, install into the chat's workspace/worktree, and reload providers. The browser route is also available. |
| Installer refuses replacement | It protects tracked, unmanaged, or locally edited installations. Preserve edits before updating. |

## Update and uninstall

For native plugin installations, use the native manager. For example:

```sh
copilot plugin update vscode-design-system@vscode-design-system
```

Where enabled, the client's marketplace auto-updater handles this. Update the product checkout separately through your normal Git workflow; the plugin never pulls or switches it.

For legacy workspace-copy installations only, run these commands from the viewer clone:

```sh
git pull --ff-only
node scripts/install.mjs --workspace /absolute/path/to/vscode-checkout --update
```

For a canvas, have the existing canvas owner reload extension providers afterward and reopen the same instance in its owning chat. Follow [Keep one current book](#keep-one-current-book) rather than creating a replacement panel. For browser use, pull the viewer updates and restart the serving command. Update the product checkout separately.

To uninstall a canvas, remove the installed `.github/extensions/vscode-design-system/` directory, then reload providers. Its local exclusion rule remains in Git's `info/exclude`; remove that exact rule if desired. View state remains under `extension-data/vscode-design-system/` in `COPILOT_HOME`, or `~/.copilot` when unset, keyed by checkout, book, and panel.

## Development

Edit the viewer source clone, then update its native plugin or legacy managed installation and reload. Saved guidance and product-source edits use topic refresh. External branch changes refresh automatically; uncommitted book catalog or fixture-binding changes require a provider reload, or a server restart for the browser route.

From the viewer clone:

```sh
node --check extension.mjs
node scripts/test.mjs --root /absolute/path/to/vscode-checkout
node scripts/book.mjs read --root /absolute/path/to/vscode-checkout --topic motion --limit 12000
node scripts/book.mjs documents --root /absolute/path/to/vscode-checkout --query "motion"
```

The test runner executes against the explicit checkout while loading tests and viewer code from this clone. Browser checks use that checkout's Playwright dependency.

For a portable snapshot, `node scripts/export.mjs /absolute/path/to/book.html --root /absolute/path/to/vscode-checkout` uses the selected checkout's prepared Rspack and Playwright tooling. See [private review publishing](private-review.md) for access-controlled deployment.

See [architecture](architecture.md) and the [document protocol](documents.md). Book authoring conventions live in the selected checkout's `.github/design-system/authoring.md`.
