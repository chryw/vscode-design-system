# VS Code design-system explorer

Browse design guidance from your current VS Code checkout, or choose another local clone or worktree. The viewer is an independent Copilot plugin. The [`chryw/design-system-exploration` branch](https://github.com/microsoft/vscode/tree/chryw/design-system-exploration) provides the full curated book, token references, and live examples; other branches provide a source library without requiring exploration metadata.

## Install the canvas plugin

In a Copilot client with plugin and canvas support, register this marketplace and install the plugin once:

```sh
copilot plugin marketplace add chryw/vscode-design-system
copilot plugin install vscode-design-system@vscode-design-system
```

The native manager owns viewer updates and honors its automatic-update settings. No viewer clone or per-worktree reinstall is needed. Plugin releases never pull, switch, or modify your product checkout.

Open your VS Code checkout in a supported Copilot session and ask:

> Open the design-system canvas for this checkout, reusing its existing panel if one exists.

Use **Change checkout** to select another local worktree or enter a clone's path. The same panel follows saved changes and external branch changes. To browse a different branch without disrupting your current work, select a worktree already on that branch. The canvas does not switch branches or create worktrees.

If you previously used the workspace installer, follow the [migration steps](docs/setup.md#move-from-a-workspace-installation-to-the-plugin) to avoid duplicate providers.

## Browser and source development

You'll need Git, Node.js, and pnpm. See [setup details](docs/setup.md#requirements) for versions.

**1. Get the viewer and the content**

```sh
git clone https://github.com/chryw/vscode-design-system.git
git clone --branch chryw/design-system-exploration --single-branch https://github.com/microsoft/vscode.git vscode-design-exploration
```

**2. Prepare and open the book**

```sh
cd vscode-design-exploration
pnpm install
pnpm run build-fast --client-only
node ../vscode-design-system/scripts/book.mjs serve --root .
```

Open the URL printed in your terminal. Keep the terminal running while you browse; press **Ctrl+C** to stop.

Already have a prepared VS Code checkout? [Use it instead](docs/setup.md#use-an-existing-checkout).

## Legacy workspace installation

For development or clients without native plugin installation, run this from the selected VS Code checkout:

```sh
node ../vscode-design-system/scripts/install.mjs --workspace .
```

This installs the canvas into that checkout's `.github/extensions/vscode-design-system/` directory, which is locally ignored by Git. Keep the viewer clone separate.

Open that checkout in VS Code or the Agents window, then ask Copilot:

> Reuse this worktree's existing `vscode-design-system` canvas in its owning chat and refresh it. If none exists, open it once with instance ID `design-book` for this checkout.

Keep [one current book](docs/setup.md#keep-one-current-book) across chats and sessions; changing topics or updating the viewer should not create more canvases.

## Let an agent handle setup

Paste this into your agent chat:

> Install and open https://github.com/chryw/vscode-design-system.

[AGENTS.md](AGENTS.md) provides the agent setup workflow.

## Working on the design system

Make viewer changes here and guidance, token, style, or fixture changes in the VS Code checkout.

See the [setup reference](docs/setup.md) for updates, troubleshooting, and development commands.

## Share a browser-only snapshot

Use [snapshot releases](docs/snapshot-releases.md) to export a selected checkout, validate its rendered chapters, and publish an offline download plus a versioned GitHub Pages link. Readers need only a browser. Building locally does not publish anything; public publication is explicit.
