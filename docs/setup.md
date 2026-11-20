# Setup reference

Follow the [quick start](../README.md#quick-start) to install and open the canvas.

## Prepare the exploration checkout

Use your existing VS Code worktree if it has the exploration content. If you need a separate checkout:

```sh
git clone --depth 1 --branch chryw/design-system-exploration \
  https://github.com/microsoft/vscode.git vscode-design-exploration
```

Open a Copilot session in that checkout. The current book is discovered from foundation, pattern, and code-local specification front matter under `.github/skills/design-system` and `src/vs`. Older checkouts with `.github/design-system/topics.json` remain supported; a checkout without either layout shows the Source library.

## Component APIs and live examples

You can open the canvas and read foundations without installing VS Code dependencies. For component APIs, run `pnpm install` in the VS Code checkout. For live examples, also run `pnpm run build-fast --client-only`. Use the Node.js version in that checkout's `.nvmrc` and the pnpm version pinned in `package.json`.

## Local browser

From a clone of this viewer, run with Node.js 22 or later:

```sh
node scripts/book.mjs serve --root /path/to/vscode-checkout
```

Open the printed URL. Press **Ctrl+C** to stop the server.

## Update and troubleshoot

Use the chevron beside **Refresh** to choose a **Content version**:

- **Latest (main)** fetches current `main` from the session checkout's `origin` remote.
- **Shared branch…** accepts a branch name on that remote or a GitHub branch URL, including a branch in a fork. No local branch or checkout is needed.
- **This session** reads the worktree the canvas opened from, including saved uncommitted edits.

New session canvases default to **This session**; readers outside a VS Code worktree default to **Latest (main)** from `microsoft/vscode`. Reopening retains the selected version. **Refresh** refetches a remote version or rereads session files. Remote content lives in a private Git cache: switching never changes the session's branch, index, or worktree. Fetch failures leave the current content available and report the error; they do not silently show an older copy.

To update the published plugin, run `copilot plugin update vscode-design-system@vscode-design-system`. If a session doesn't see the update, refresh its customizations or open a new session. The loaded provider should be `plugin:vscode-design-system:vscode-design-system`.

### Move from a workspace installation to the plugin

If you still have a legacy workspace installation, preserve local edits and disable `project:vscode-design-system` before enabling the plugin. If the legacy provider owns the panel in your chat, use **Close Canvas** before reopening it with the plugin.

## Development

Use the [local browser](#local-browser) or `copilot --plugin-dir /path/to/vscode-design-system` in a separate development session. Restart the preview or reload the provider after viewer code changes.

From the viewer clone, check the selected checkout's content or run viewer tests:

```sh
node scripts/book.mjs validate --root /path/to/vscode-checkout
node scripts/test.mjs --root /path/to/vscode-checkout
```
