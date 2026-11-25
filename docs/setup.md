# Setup reference

Follow the [quick start](../README.md#quick-start) to install and open the canvas.

## Prepare the docs-only checkout

From a prepared VS Code session, select **Shared branch…** in the canvas and enter `https://github.com/microsoft/vscode/tree/chryw/design-system-docs-pr`. No local branch switch or installation in the downloaded source checkout is needed.

For local authoring or live examples, reuse an existing checkout of that branch. If you need a separate checkout:

```sh
git clone --depth 1 --branch chryw/design-system-docs-pr \
  https://github.com/microsoft/vscode.git vscode-design-system-docs
```

Open a Copilot session in that checkout. The current book is discovered from foundation, pattern, and code-local specification front matter under `.github/skills/design-system` and `src/vs`. Older checkouts with `.github/design-system/topics.json` remain supported; a checkout without either layout shows the Source library.

Each component chapter reads its owning code-local specification. The Source library indexes existing repository documents independently of authored chapters.

The docs-only source is [microsoft/vscode#350445](https://github.com/microsoft/vscode/pull/350445); the tested revision is recorded in [`compatibility.json`](../compatibility.json). It does not include experimental product token, style, or motion changes. Motion remains browsable as guidance; source-defined interactive motion presentations remain supported in checkouts that provide them.

## Component APIs and live examples

The source readers use the session workspace's `js-yaml` and TypeScript tooling to parse saved files without executing the selected source checkout. If the session's VS Code checkout is not prepared, run its normal `pnpm install`. Use that checkout's `.nvmrc` and the pnpm version pinned in `package.json`.

Remote content versions need no dependency installation or build. For live examples, select a prepared local docs checkout, run its `pnpm install` and `pnpm run build-fast --client-only`, and reuse its Component Explorer. Live examples never borrow another branch's dependencies or build output. Missing prerequisites are reported rather than replaced with examples from a different branch.

Remote versions show a source-only notice in place of live previews; guidance and source-derived APIs remain available. A specification without a fixture binding states that no live example is defined.

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
