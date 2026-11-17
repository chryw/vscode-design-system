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

Choose a VS Code checkout on the [exploration branch](https://github.com/microsoft/vscode/tree/chryw/design-system-exploration) containing `.github/design-system/book.json`. Keep the viewer source clone in a separate directory. [compatibility.json](../compatibility.json) records a tested product revision.

From the viewer clone, pass the checkout explicitly:

```sh
node scripts/book.mjs serve --root /absolute/path/to/vscode-checkout
```

Reuse that checkout's existing dependencies and client output when they are already prepared. Articles need dependencies; live examples also need `pnpm run build-fast --client-only`.

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

The canvas owner refreshes the same instance with the combined saved worktree, including uncommitted changes, rather than a contributor's isolated snapshot. Use topic refresh for guidance and product-source edits. Book catalog or fixture-binding changes require a provider reload; viewer changes require updating the managed installation and reloading providers. Serialize these operations with active contributors, validate a coherent candidate, and preserve the current topic and view. Do not install partially written changes or postpone every refresh indefinitely behind new work.

Retire obsolete instances with the host's **Close Canvas** action. Closing an editor tab or stopping a viewer server alone does not remove a canvas from the picker. Preserve the canonical instance and unrelated canvases.

Before reporting the book as current, verify that the picker contains only one design-system canvas, its content root is the intended worktree, and it reflects the latest coordinated product and viewer changes. If a refresh is pending or cleanup is blocked, report that limitation rather than opening a replacement.

## Check the content

From the viewer clone:

```sh
node scripts/book.mjs validate --root /absolute/path/to/vscode-checkout
```

Validation should report `valid: true` and no diagnostics. Open an article and scroll a live example into view to check rendering.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| Missing book or source files | Select a checkout containing `.github/design-system/book.json`. |
| Missing TypeScript, MCP, or other modules | Run `pnpm install` in the selected VS Code checkout. |
| Articles load but examples don't | Prepare client output in that checkout, then scroll the example into view. Inspect any preview error before starting another server. |
| Canvas not discovered | Check canvas support, install into the chat's workspace/worktree, and reload providers. The browser route is also available. |
| Installer refuses replacement | It protects tracked, unmanaged, or locally edited installations. Preserve edits before updating. |

## Update and uninstall

For installed canvases, run these commands from the viewer clone:

```sh
git pull --ff-only
node scripts/install.mjs --workspace /absolute/path/to/vscode-checkout --update
```

For a canvas, have the existing canvas owner reload extension providers afterward and reopen the same instance in its owning chat. Follow [Keep one current book](#keep-one-current-book) rather than creating a replacement panel. For browser use, pull the viewer updates and restart the serving command. Update the product checkout separately.

To uninstall a canvas, remove the installed `.github/extensions/vscode-design-system/` directory, then reload providers. Its local exclusion rule remains in Git's `info/exclude`; remove that exact rule if desired. View state remains under `extension-data/vscode-design-system/` in `COPILOT_HOME`, or `~/.copilot` when unset, keyed by checkout, book, and panel.

## Development

Edit the viewer source clone, then update the managed installation and reload. Saved guidance and product-source edits use topic refresh. Book catalog or fixture-binding changes require a provider reload, or a server restart for the browser route.

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
