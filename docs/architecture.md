# Architecture

The [README diagram](../README.md#how-it-works) shows the data flow. The VS Code checkout owns the design guidance, specification metadata, content bindings, and examples. The viewer discovers the current catalog from front matter and presents those saved sources in the canvas, browser, snapshots, and headless tools.

## Code map

| Area | Responsibility |
| --- | --- |
| [`.plugin/`](../.plugin/) and [`extension.mjs`](../extension.mjs) | Package the plugin and register the canvas and its actions. |
| [`adapters/vscode/`](../adapters/vscode/) | Read the selected checkout's catalog, Markdown, product definitions, and fixture metadata. |
| [`model/`](../model/) | Validate the catalog and define the data and view state shared by consumers. |
| [`runtime/`](../runtime/) | Serve the live book, expose headless reads, and manage checkout selection, source watches, and state. |
| [`view/`](../view/) | Render the live and portable books. Renderers consume prepared data rather than reading the checkout. |
| [`scripts/`](../scripts/) | Run the CLI, build snapshots, publish releases, and run tests. |

## Runtime contracts

- **Content version:** A new canvas defaults to the session's enclosing VS Code checkout, including saved uncommitted edits. Discovery stops at a Git repository boundary. Outside a VS Code worktree, the default is latest remote `main`. The picker offers Latest (main), a shared branch name or GitHub branch URL, and This session; it does not enumerate local worktrees. Remote refs are fetched into a private bare repository and materialized as commit-addressed detached checkouts, never by changing the session's branch or index. Refresh refetches remote refs. Reopening restores the selected source while preserving the original session worktree. The legacy `select_checkout` action remains available for an explicit local override.
- **Checkout:** The current layout discovers foundations and patterns under `.github/skills/design-system` and component specifications beside their implementation. Older checkouts with `.github/design-system/topics.json` remain supported. A checkout without either layout shows the Source library; invalid metadata or bindings report an error rather than borrowing another checkout's content. Cached remote checkouts do not borrow or install another worktree's dependencies; component APIs and live examples retain their own prerequisite checks.
- **Topics:** The catalog is built from validated front matter without reading every chapter. Chapter bindings select Markdown sections and examples; there is no separate inventory of expected headings or capabilities. The runtime reads the selected topic on demand and returns guidance, definitions, and examples in `data.resources`. Metadata selects a known renderer, not executable code from the checkout. See the [document reference](documents.md) for Markdown discovery and bindings.
- **Lifetime:** A canvas instance owns its server, caches, and watches. Refresh rereads the selected checkout; a failed checkout switch leaves the current book available. Closing the instance releases its resources without stopping the shared Component Explorer service.
- **Source access:** The live server listens on loopback. Source paths are repository-relative and stay within the selected checkout. Markdown is rendered as content. Live previews use the checkout's existing Component Explorer fixtures.

For changes, see [development commands](setup.md#development) and [canvas UI conventions](../.github/instructions/canvas-ui.instructions.md). To share a frozen book, see [snapshot releases](snapshot-releases.md).
