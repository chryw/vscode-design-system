# VS Code design-system explorer

Browse design guidance, inspect tokens, and try live VS Code components. The viewer lives here; the content lives on the [`chryw/design-system-exploration` branch](https://github.com/microsoft/vscode/tree/chryw/design-system-exploration).

## Get started

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

## Open inside VS Code

To use the book as a canvas in a Copilot session with canvas support, run this from `vscode-design-exploration`, the VS Code checkout containing the content branch:

```sh
node ../vscode-design-system/scripts/install.mjs --workspace .
```

This installs the canvas into that checkout's `.github/extensions/vscode-design-system/` directory, which is locally ignored by Git. Keep the viewer clone separate.

Open that checkout in VS Code or the Agents window, then ask Copilot:

> Reload extensions and open the `vscode-design-system` canvas for this checkout.

## Let an agent handle setup

Paste this into your agent chat:

> Install and open https://github.com/chryw/vscode-design-system.

[AGENTS.md](AGENTS.md) provides the agent setup workflow.

## Working on the design system

Make viewer changes here and guidance, token, style, or fixture changes in the VS Code checkout.

See the [setup reference](docs/setup.md) for updates, troubleshooting, and development commands.
