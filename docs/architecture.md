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
- **Checkout:** The current layout discovers foundations and patterns under `.github/skills/design-system` and component specifications beside their implementation. Older checkouts with `.github/design-system/topics.json` remain supported. A checkout without either layout shows the Source library; invalid metadata or bindings report an error rather than borrowing another checkout's content. YAML and TypeScript parsing and the viewer's Codicon font use the session workspace's tooling; selected source files are data, not dependency code. Cached remote checkouts install nothing and leave unrelated LFS assets as pointers. Live examples require the selected local checkout's own dependencies and build output.
- **Topics:** The catalog is built from validated front matter without reading every chapter. Each specification's front matter selects its renderer and examples, and its headings form the chapter; there is no separate inventory of expected headings or capabilities. The runtime reads the selected topic on demand and returns guidance, definitions, and examples in `data.resources`. Metadata selects a known renderer, not executable code from the checkout. See the [document reference](documents.md) for Markdown discovery and composition.
- **Motion:** Selected `motion-` heading anchors own the rich chapter's hierarchy, titles, and order. Front matter binds visual examples to those headings, not another section tree. Guidance-only Motion uses the ordinary Markdown renderer and needs no experimental runtime definitions. Older checkouts may still provide their page descriptor.
- **Components:** Code-local specifications with `kind: "component"` define the component collection, including composed controls. Authored topics appear directly under Components, without an additional Primitives subgroup. Fixture bindings supply optional examples; discovery does not inspect fixture labels. The reader normalizes historical `primitive` and `composite` kinds for older checkouts; legacy curated books retain their grouping.
- **Drafts and redirects:** Current specifications use optional boolean `isDraft`; `true` marks visible, provisional guidance, while `false` or omission leaves it unmarked. `replacedBy` retires a specification and redirects to its replacement. The reader accepts historical `status` metadata at the compatibility boundary and exposes the current boolean contract to consumers.
- **Saved views:** Each panel saves its scope and per-topic views together with the catalog they were saved against. When the selected checkout no longer has a saved topic, the panel restores the remaining scope and views and reports that topic as unavailable. Records saved before catalogs were recorded treat any well-formed topic the current book can't resolve the same way. Corrupt or unsupported state is reported and never overwritten.
- **Lifetime:** A canvas instance owns its server, caches, and watches. Refresh rereads the selected checkout; a failed checkout switch leaves the current book available. Closing the instance releases its resources without stopping the shared Component Explorer service.
- **Source access:** The live server listens on loopback. Source paths are repository-relative and stay within the selected checkout. Markdown is rendered as content. Live previews use the checkout's existing Component Explorer fixtures.

For changes, see [development commands](setup.md#development) and [canvas UI conventions](../.github/instructions/canvas-ui.instructions.md). To share a frozen book, see [snapshot releases](snapshot-releases.md).
