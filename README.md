# VS Code design-system explorer

Browse design guidance from your current VS Code checkout, or choose another local clone or worktree. The viewer is an independent Copilot plugin. The [`chryw/design-system-exploration` branch](https://github.com/microsoft/vscode/tree/chryw/design-system-exploration) provides the full curated book, token references, and live examples; other branches provide a source library without requiring exploration metadata.

The viewer and the content update separately: plugin updates change the browsing UI; your selected checkout supplies the guidance, tokens, styles, and examples. This is a local viewer, not a hosted website.

## Quick setup with an agent

Open a chat in the VS Code checkout you want to browse and paste:

> Set up or update https://github.com/chryw/vscode-design-system for this checkout, following its README and AGENTS.md. Use the native plugin manager where supported and open the canvas in this session, reusing its existing panel here; otherwise use the documented browser route. Do not pull or switch my product branch. For native canvas setup, verify the loaded provider comes from the installed plugin. Confirm the selected checkout and open a source document before finishing.

For a different content checkout, add its absolute path to the prompt. [AGENTS.md](AGENTS.md) provides the setup and verification workflow.

## Install the canvas plugin

Use a Copilot client with plugin and canvas extension support. The commands below use the Copilot CLI; run them in the environment used by your Copilot session. If your client does not support canvases, use the [browser route](#browser-and-source-development).

**1. Install once**

Previously used the workspace installer? First follow the [migration steps](docs/setup.md#move-from-a-workspace-installation-to-the-plugin): preserve local edits and disable the old workspace provider before enabling the plugin. Keep only one active provider.

```sh
copilot plugin marketplace add chryw/vscode-design-system
copilot plugin install vscode-design-system@vscode-design-system
```

No viewer clone or per-worktree reinstall is needed.

**2. Open the canvas**

Open your VS Code checkout in a supported Copilot session, then ask:

> Open the design-system canvas for this checkout in this session using the installed plugin. Reuse `design-book` in this chat; if none exists here, open `vscode-design-system` with that instance ID and this checkout's absolute path as `root`.

The plugin is installed once, but panels belong to their chat. Another session in the same worktree can open its own panel without reinstalling the plugin or returning to an older chat. Reuse the same panel for topics and refreshes within each chat.

If the plugin is installed but not discovered in an existing chat, ask Copilot to reload extension providers and inspect the loaded source. Native installation should load `plugin:vscode-design-system:vscode-design-system`, not `project:vscode-design-system`. Installation and activation are separate: an existing chat may retain its previous discovery state after a reload. If so, use the client's supported customization refresh or a new supported session and verify again before retiring the old installation.

If opening reports that `design-book` is already owned by a different canvas, that chat still has a legacy-provider binding. Use the host's **Close Canvas** action on its old panel before reopening from the plugin. This does not block opening in another session; see [session and migration guidance](docs/setup.md#keep-one-current-book).

## Browse content from a checkout

- **Current checkout:** the canvas starts from the session's workspace. A previously selected checkout is restored when you reopen the same panel; open the chevron beside **Refresh** to confirm its name and full path.
- **Another checkout:** open the chevron beside **Refresh**, select a local worktree, or choose **Other checkout…** and enter an absolute clone/worktree path. Select **Browse checkout** to switch content in the same panel. Checkout details stay in this picker rather than occupying a separate site-header row.
- **Another branch:** select a worktree already on that branch. The canvas never pulls, switches branches, or creates worktrees. If you change branches externally, it reloads the checkout's catalog.
- **Saved edits:** the viewer reads local saved files, including uncommitted changes. Source watches update supported content; the main **Refresh** button rereads saved content, the topic catalog, and live examples from the selected checkout while preserving the current view. It does not open the checkout picker, update the viewer, or fetch Git changes.
- **Reading:** one compact global bar contains the site name, **Back**/**Forward**, and **Refresh**. Wide windows show a topic sidebar; smaller windows use the left menu button to open the same navigation on the left. The article title and section links form a separate local header; the overview scrolls with the content. On the smallest panes, the brand shortens and Refresh uses its labeled icon.
- **Contributor resources:** at the end of a topic, expand this optional section when changing its guidance or implementation. Links have readable names with repository paths underneath and open files in a separate tab. A topic can use several files, and one file can serve several topics. This is separate from selecting a checkout.

A checkout with `.github/design-system/topics.json` provides curated topics; the exploration branch contains the full book. A checkout without it provides **Source library** for local product Markdown, instructions, skills, and available design guidance. It does not borrow missing content from another branch. Malformed or incompatible sources report errors.

Basic source browsing needs no product build or dependency installation. Some curated readers need checkout dependencies; live examples also need prepared client output. Follow the selected checkout's setup instructions, restoring dependencies only if needed, then run `pnpm run build-fast --client-only` there for live examples. See [requirements](docs/setup.md#requirements) for Node.js and pnpm versions.

## Get updates

**Native plugin:** the native manager handles automatic updates where enabled by your client and policy. To request an update manually:

```sh
copilot plugin update vscode-design-system@vscode-design-system
```

If the running canvas still shows the old viewer, ask Copilot to reload extension providers and verify the loaded plugin source before reopening the same panel, preserving its checkout and view. A successful update command alone does not establish that an existing chat has activated it.

**Browser/source checkout:** run `git pull --ff-only` in the viewer clone, then restart its serving command.

**Legacy workspace copy:** pull the viewer clone, run the [workspace update command](#legacy-workspace-installation), then reload providers and reopen the same panel.

**Design-system content:** update the selected product checkout separately through your normal Git workflow, or select a different prepared worktree. A plugin update does not fetch newer product content.

## Browser and source development

Use this route if your client cannot render canvases, or when developing the viewer. You'll need Git and the Node.js version required by the selected checkout.

```sh
git clone https://github.com/chryw/vscode-design-system.git
cd vscode-design-system
node scripts/book.mjs serve --root /absolute/path/to/vscode-checkout
```

Keep the viewer clone separate from the product checkout. Open the URL printed in the terminal; keep the server running while you browse and press **Ctrl+C** to stop. The same **Checkout** control works in the browser. Preparing live examples is optional; see [browsing requirements](#browse-content-from-a-checkout).

## Legacy workspace installation

For development or clients that support workspace canvases but not native plugins, run from a separate viewer clone:

```sh
node scripts/install.mjs --workspace /absolute/path/to/vscode-checkout
```

This copies the viewer into that checkout's locally ignored `.github/extensions/vscode-design-system/` directory. Open that checkout in your Copilot session, reload providers if needed, and use the [canvas-opening prompt](#install-the-canvas-plugin).

To update an existing managed workspace copy, run from the viewer clone:

```sh
git pull --ff-only
node scripts/install.mjs --workspace /absolute/path/to/vscode-checkout --update
```

Reload extension providers and reopen the same panel afterward. The installer refuses to overwrite locally changed or unmanaged installations; preserve those edits before retrying. Keep [one current book](docs/setup.md#keep-one-current-book) rather than creating replacement panels.

## Working on the design system

Make viewer changes here and guidance, token, style, or fixture changes in the VS Code checkout.

See the [setup reference](docs/setup.md) for updates, troubleshooting, and development commands.

## Share a browser-only snapshot

Use [snapshot releases](docs/snapshot-releases.md) to export a selected checkout, validate its rendered chapters, and publish an offline download plus a versioned GitHub Pages link. Readers need only a browser. Building locally does not publish anything; public publication is explicit.
