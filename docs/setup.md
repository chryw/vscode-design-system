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

Choose any local VS Code checkout. The [exploration branch](https://github.com/microsoft/vscode/tree/chryw/design-system-exploration), containing `.github/design-system/topics.json`, enables the curated book. Without that manifest, the viewer exposes a source library of product Markdown, repository instructions, skills, and any local design guidance. It does not substitute content from another checkout. Malformed manifests and unreadable sources remain explicit errors. Keep the viewer source clone separate when using the browser/development route. [compatibility.json](../compatibility.json) records a tested curated product revision.

From the viewer clone, pass the checkout explicitly:

```sh
node scripts/book.mjs serve --root /absolute/path/to/vscode-checkout
```

The topic map is `.github/design-system/topics.json`. Shared foundation and pattern specifications live directly in that directory; component specifications stay beside their implementation. Topic source compositions live in `content/topics/`, while the plugin owns layout and navigation. Readers accept legacy `book.json` and `pages/` bindings only when the new map is absent. A malformed, unsupported, or unreadable `topics.json` is an error, never a reason to fall back to stale data. `/book.json` remains an HTTP compatibility alias for `/topics.json`.

Reuse that checkout's existing dependencies and client output when they are already prepared. Basic source browsing needs no product build or dependency installation. Some curated source readers need dependencies; live examples also need `pnpm run build-fast --client-only`.

## Native plugin

The repository's `.plugin/plugin.json` declares the independent viewer, and `.plugin/marketplace.json` supplies its marketplace entry. The plugin extension imports the shared viewer implementation; it packages no product guidance or book data. Install through the client's native manager as described in the README. For CLI source development, `copilot --plugin-dir /absolute/path/to/vscode-design-system` loads the source package without installing a copy.

Use the chevron beside **Refresh** in the canvas header, or the `select_checkout` canvas action with an absolute `root`, to browse another clone or worktree in the same panel and on the same server. Refresh is the split button's main action; only the chevron opens its anchored checkout popup. The picker shows branch/worktree names and the selected checkout's full path separately. Choose a worktree and select **Browse checkout** to apply it. Escape dismisses the popup and restores focus to the chevron; outside clicks dismiss it too. Arrow Down from either half opens the picker, and Left/Right moves between the halves. Selection is saved privately per originating workspace and panel, with topic views separately keyed by checkout and book mode. Reopening after a provider restart restores that selection. Another checkout is never modified as a side effect of browsing.

The canvas checks the local Git branch and commit periodically. An external branch change recreates its source readers and watches, rereads the checkout-owned catalog, and refreshes the same panel. A topic absent from the new branch returns to that branch's default topic. Source-library mode explicitly explains why curated topics and live examples are unavailable. Invalid checkout selection preserves the current book and reports the error.

After adding, removing, or moving topics, changing document discovery scopes, or editing fixture bindings without a Git branch change, choose **Refresh**. This rereads saved content, the catalog, and bindings on the same server, retaining available topics, focused/comparison scope, themes, anchors, document selections, and local example controls. Removed topics are reconciled to the available catalog; an invalid candidate leaves the current book open with an error. Agents can use `select_checkout` with the current absolute `root` for the same operation. Refresh does not fetch Git changes or load updated viewer modules.

**Back** and **Forward** work inside the canvas without browser chrome, including links between chapters and authored documents. They restore reading position and do not leave the book. Same-page section links do not add redundant page visits. **Topic files** in the page header lists that topic's guidance documents and its implementation entry point as direct file links, rather than routing through the old raw-document library. There may be multiple guidance files per topic and multiple topics per file. The Source library is no longer a curated-book navigation destination; document search and old document URLs remain available to headless tools and checkouts without a curated book.

Native plugin auto-updates depend on the client's version, marketplace configuration, permissions, and automatic-update policy. Updates are not instant; activation may require a provider reload. Keep the existing panel and its checkout selection rather than opening a replacement.

### Move from a workspace installation to the plugin

1. Preserve any edits in the old managed `.github/extensions/vscode-design-system/` installation. The existing installer refuses to overwrite locally changed files.
2. Disable the workspace provider through the client's extension manager before enabling the plugin provider. With the Copilot CLI, run `copilot config extensions.disabledExtensions project:vscode-design-system`. This is a user-level preference for legacy project providers with this name across your checkouts; repository-local settings do not support it. It does not disable the installed plugin or delete the workspace copy.
3. Install the plugin through the native manager and reload providers at a safe boundary. Open `design-book` from the plugin in the current chat. If this chat already has that ID bound to the workspace provider, use the host's **Close Canvas** action before reopening it. Closing an editor tab or stopping its server is not enough. Another session without the legacy binding can open the plugin immediately; migration in an older chat is not a worktree-wide prerequisite.
4. Inspect the loaded extension source: require `plugin:vscode-design-system:vscode-design-system`, not `project:vscode-design-system`. An installed/enabled entry alone is not activation evidence. If an existing chat retains old discovery after provider reload, use the client's supported customization refresh or a new supported session and recheck. Verify the selected checkout, topic, and saved view before retiring the old provider. Remove or archive the obsolete managed copy outside extension discovery only after verifying the plugin. Keep private saved view state and do not remove independent or unrecognized extensions.

## Canvas workspaces

Install into the chat's actual VS Code workspace or isolated worktree:

```sh
node scripts/install.mjs --workspace /absolute/path/to/vscode-checkout
```

On Windows, use your checkout path, for example `--workspace "C:/src/vscode-design-exploration"`.

The installer copies assets into `.github/extensions/vscode-design-system/` and adds a local Git exclusion. New sessions discover workspace extensions at startup; existing sessions need their extension providers reloaded. Keep only one active registration for `vscode-design-system`.

For an isolated Agents worktree, prepare and install into that worktree. Discovery follows the session workspace. The canvas's `root` input selects the content checkout; installation determines where the extension is discovered.

## Keep one current book

Keep one active design-system provider: prefer the installed plugin, without a duplicate workspace copy. Within each chat, reuse one panel with instance ID `design-book` for topics, refreshes, and checkout selection. Do not invent numbered, topic-specific, or validation-specific instances.

Panels are chat-scoped, not worktree-global. A session in the same worktree can open the plugin with `design-book` and that checkout's `root` even when another chat has its own panel. It does not need a per-worktree installation or permission from a historical canvas owner. A legacy-provider ID conflict in one chat does not imply the plugin is broken in other sessions.

Where a worktree has a coordination record, use it for the intended content root, shared edits, and any active reload operation, not as a requirement to route every open through another chat. Record a useful working panel reference when that record's ownership permits it. The selected checkout, book, and panel ID identify private saved view state; check the header and restored view after opening.

Refresh the current chat's instance with the combined saved worktree, including uncommitted changes, rather than a contributor's isolated snapshot. Use **Refresh** for guidance, product sources, catalog, and fixture bindings. External Git branch or commit changes refresh the catalog automatically; saved topics absent from that catalog are dropped with an explanation. Viewer changes arrive through native plugin updates, or an updated managed installation for the legacy route, followed by a provider reload when required. Serialize shared edits and reloads with active contributors, validate a coherent candidate, and preserve the current topic and view. Do not install partially written changes or postpone every refresh indefinitely behind new work.

Retire obsolete instances with the host's **Close Canvas** action. Closing an editor tab or stopping a viewer server alone does not remove a canvas from the picker. Do not edit host storage or create a suffixed instance to bypass an old provider binding. Preserve unrelated canvases.

Before reporting the book as current, verify the current chat's panel uses the plugin, its content root is the intended worktree, and it reflects the latest coordinated product and viewer changes. Invoke a source action and reopen the same instance to check saved state. Report a chat-local migration blocker separately from the availability of the plugin in other sessions.

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
| Canvas not discovered | Check canvas support and the running extension's source path. Prefer the native plugin; a workspace installation is needed only for the legacy route. If an existing session retains an old or removed plugin root, use a full customization refresh, then reload/reopen the same panel. |
| Instance ID already owned by a different canvas | The current chat retains a legacy-provider binding. Use its host's **Close Canvas** action before reopening from the plugin, or open the plugin in another session. Do not reinstall the plugin or treat the old chat's conflict as worktree-wide. |
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

For a canvas, reload extension providers afterward and reopen the same instance in the current chat. Follow [Keep one current book](#keep-one-current-book) rather than creating a replacement panel for each update. For browser use, pull the viewer updates and restart the serving command. Update the product checkout separately.

To uninstall a canvas, remove the installed `.github/extensions/vscode-design-system/` directory, then reload providers. Its local exclusion rule remains in Git's `info/exclude`; remove that exact rule if desired. View state remains under `extension-data/vscode-design-system/` in `COPILOT_HOME`, or `~/.copilot` when unset, keyed by checkout, book, and panel.

## Development

The installed plugin and local source viewer read saved, uncommitted content from the selected checkout, but execute their own viewer code. **Refresh** rereads content, the catalog, and bindings. It does not update viewer code or add a renderer capability.

For unpublished viewer changes in regular canvas sessions, the native CLI manager supports a live local marketplace:

```sh
copilot plugin marketplace add /absolute/path/to/vscode-design-system
copilot plugin install vscode-design-system@vscode-design-system
```

The local marketplace uses the same identity as the released marketplace. If that name is already registered, inspect its installed plugins and use the native manager to remove that registration before adding the local source; removal can uninstall its plugins. This changes this machine's plugin source, not a single worktree or the published release. Preserve private canvas state and other marketplaces. Verify the resulting installation reports `source: live` and the intended source clone, then verify the running extension loads that clone's `extensions/vscode-design-system/extension.mjs`. Version metadata alone does not distinguish live source from a released copy.

Existing sessions can retain their previous plugin roots even after a plugin update or ordinary extension-provider reload. Use the client's full customization refresh in each affected session, then recheck its running extension path before reopening the same canvas. The public Copilot SDK operation is `session.rpc.customizations.reload()`; it can restart the extension that requested it, so a caller disconnect alone does not establish failure or success. Verify discovery and a source action afterward. Do not patch installed caches or host session storage, and do not create a replacement canvas to work around stale membership.

Once the live source is discovered, use the appropriate refresh:

| Changed source | Refresh |
| --- | --- |
| Guidance or product source | **Refresh**. |
| Added, removed, or moved topics; catalog or binding changes | **Refresh**. |
| Viewer modules or client assets | Reload extension providers and reopen the same canvas. Content refresh does not reload running viewer modules. |
| Installed plugin source or membership | Full customization refresh in affected existing sessions; verify the loaded source path. |

Alternatively, run `copilot --plugin-dir /absolute/path/to/vscode-design-system` in a separate development CLI session, or use the browser `serve` command above. Restart that owned runtime after editing viewer modules. Do not register a second workspace copy. A marketplace viewer-code fix reaches teammates only after a release and native plugin update; refreshing content cannot retrofit an older viewer.

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
