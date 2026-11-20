# Source documents

The book reads Markdown from the selected VS Code checkout. Curated chapters link to their owning files under **Contributor resources**. The **Source library** is the browsing view for checkouts without a curated book. Agents can search and read documents with or without that view.

## Read and search

| Interface | List or search | Read |
| --- | --- | --- |
| Canvas actions | `list_documents` | `read_document`; use `open_document` to show it in the canvas |
| CLI | `documents --query <text>` | `read-document --document <path>` |
| HTTP | `GET /api/documents` | `GET /api/document` |

Run CLI commands through [`scripts/book.mjs`](../scripts/book.mjs). Pass `--root` when running outside the VS Code checkout. Reads accept a heading or anchor and return bounded Markdown with source information.

## Authoring

- **Discovery:** The current book defines `documentSources` in `.github/skills/design-system/content/document-sources.json`, with scopes such as `id`, `title`, `root`, `origin`, and optional `fileName` or `excludeDirectories`. Add normal Markdown files inside those scopes. Discovery skips dependency and build trees and does not follow symlinks.
- **Identity:** A document ID is its repository-relative path. The current book maps renamed documents in `.github/skills/design-system/content/legacy-document-paths.json`; map the old path directly to the new one. Aliases cannot chain or shadow a real document.
- **Composition:** For a prose chapter, use `renderer: "guidance"` and the worktree's page bindings to select source sections. A `guidance` entry identifies the section with `id` and `file`, plus an optional `title` and either `heading` or `anchor`. Use the source section rather than copying its text into the viewer.
- **Further reading:** Add ordered `references` to the owning foundation or pattern specification's front matter. Each entry has a title, an HTTPS URL, and a description of why it is useful. Older checkouts may still define these bindings in `topics.json`.

Use **Refresh** after changing discovery or page-binding files. [Validate the checkout](setup.md#development) to catch missing or ambiguous sources.
