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

- **Discovery:** For the current layout, the viewer defines the scopes: product documentation under `src/vs` and `extensions`, repository instructions, other skills, and the design-system skill entry, authoring references, foundations, and patterns. Add normal Markdown files inside those scopes; there is no checkout registry to update. Older checkouts may define `documentSources` in JSON, and the viewer honors them. Discovery skips dependency and build trees and does not follow symlinks.
- **Identity:** A document ID is its repository-relative path. When a document moves, update its inbound links; the current book declares no path aliases. Older checkouts may still map old paths with specification `legacyPaths` or `content/legacy-document-paths.json`, and the viewer honors those mappings when present. Aliases cannot chain or shadow a real document.
- **Composition:** A foundation or pattern chapter renders its own specification, and its headings form the outline. Front matter `presentation` adds a known renderer for implemented definitions; without it, the chapter is prose guidance. Older checkouts compose prose chapters from JSON page bindings, where a `guidance` entry identifies the section with `id` and `file`, plus an optional `title` and either `heading` or `anchor`.
- **Further reading:** Add ordered `references` to the owning foundation or pattern specification's front matter. Each entry has a title, an HTTPS URL, and a description of why it is useful. Older checkouts may still define these bindings in `topics.json`.

Use **Refresh** after changing specifications or adding documents. [Validate the checkout](setup.md#development) to catch missing or ambiguous sources.
