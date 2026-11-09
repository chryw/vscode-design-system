# Authored-document contract

The book has two complementary entry points: curated design chapters and the **Documentation** library. Both read the same source files. A document does not need a custom renderer or a chapter entry to be discoverable.

## Find and read

Open **Guidance → Documentation**. Search matches document titles, repository-relative paths, Markdown, and frontmatter. Exact title and path matches rank ahead of incidental mentions. Filter by source and page through bounded results.

Selecting a result reads the actual Markdown, including code blocks, tables, links, and local images. Frontmatter remains available under **Document metadata** so instruction applicability is not lost. Relative Markdown links open the corresponding document; linked code opens as source text. Unsupported or unavailable references are reported rather than executed or silently replaced.

The document ID is its repository-relative path. Renaming a file changes that ID; an old bookmark reports that the document is unavailable and offers a route back to the library. IDs are interpreted within the canvas's canonical checkout, never as arbitrary absolute paths.

## Discovery scopes

`documentSources` in the selected checkout's [book.json](https://github.com/microsoft/vscode/blob/chryw/design-system-exploration/.github/design-system/book.json) defines the source locations. The defaults include product documentation, built-in extension documentation, repository instructions, authoring workflows and their references, and repository-owned design-system guidance. Viewer implementation docs are not part of the design-guidance corpus.

Each scope has:

```json
{
	"id": "product",
	"title": "Product documentation",
	"root": "src/vs",
	"origin": "product",
	"excludeDirectories": ["__snapshots__", "fixtures"]
}
```

`fileName` optionally restricts discovery to one filename. `excludeDirectories` excludes directory names within that scope. Hidden children, dependency/build/vendor directories, and symlinks are not followed. Explicitly configured hidden roots, such as repository instructions, remain supported.

Origins describe where content comes from, not whether it is approved. A discovered implementation note, workflow, or draft does not become a universal design rule. The current task and the document's applicability still determine how an agent should use it.

New and changed Markdown is discovered automatically while the library is active. The runtime watches only the configured sources, uses filtered directory watches where native recursive watching would include dependencies, and closes those watches when the library is inactive. Reopening or searching an inactive library rereads its sources.

Use the book's **Refresh** action after changing discovery-scope configuration. Changes to the curated topic catalog still require an extension reload. Adding a document within an existing scope does not.

## Compose guidance into a chapter

Use `guidance` in a page definition to display source text after the chapter's primary reading flow and examples:

```json
{
	"guidance": [
		{
			"id": "tokens-usage",
			"title": "Using tokens",
			"file": ".github/instructions/design-tokens.instructions.md",
			"anchor": "choose-by-role"
		}
	]
}
```

Select either an `anchor` or an exact `heading`; omit both to use the document body. `title` is an optional presentation label, not a second copy of the guidance. `id` is a stable, unique article-section ID. The source must be readable within the selected checkout and covered by a discovery scope. Chapter bindings reject extension-owned documents. Add a directory to `documentSources` when introducing a new source location; do not register each file separately.

The shared article frame renders these sections with a **Read full specification** link. Its **Source documents** menu exposes the documents used by the chapter. Definitions, values, and actual component previews remain separate projections of product code.

Missing or ambiguous sections fail validation explicitly. Do not repair them by copying the old prose into the renderer. Update the binding when a deliberate source reorganization changes its anchor.

## One model for people and agents

[The document model](../model/documents.mjs) owns heading identities, section selection, reference resolution, search ranking, and bounded excerpts. The live book, HTTP endpoints, canvas actions, CLI, and portable snapshot reuse it.

| Interface | List or search | Read | Navigate |
| --- | --- | --- | --- |
| Canvas actions | `list_documents` | `read_document` | `open_document` |
| CLI | `documents` | `read-document` | Open the canvas |
| HTTP | `GET /api/documents` | `GET /api/document` | Book URLs |

```sh
node /path/to/vscode-design-system/scripts/book.mjs documents --query "Sessions list" --scope product
node /path/to/vscode-design-system/scripts/book.mjs read-document --document src/vs/sessions/SESSIONS_LIST.md --anchor placement-precedence
```

List responses use `format: "vscode-design-document-index"` and `version: 1`. They include source scopes, revision, result IDs, excerpts, total matches, pagination, and explicit diagnostics. Reads use `format: "vscode-design-document"` and `version: 1`, with identity, origin, source location, revision, metadata, Markdown, headings, and truncation status.

Read limits budget metadata and Markdown together; heading metadata is separately bounded. Missing documents, invalid selectors, and invalid queries have explicit error codes. HTTP failures use `format: "vscode-design-document-error"` with a code and message. Genuine permission and I/O failures remain errors.

[The view/control model](../model/view-state.mjs) owns field schemas, defaults, validation, and URL serialization. The SDK action schema, live runtime, and portable viewer use that contract rather than maintaining independent lists of fields. Document selection, source filter, query, pagination, and anchors participate in the existing per-instance saved state.

## Safety and completeness

Discovery is bounded by document size, corpus size, entry count, nesting, and watcher limits. Oversized, malformed, missing, or unfollowed document symlinks remain explicit diagnostics; configured exclusions are intentional scope boundaries. Validation reports an incomplete library or a chapter source missing from the library instead of claiming complete coverage.

Markdown is content, not executable instructions or HTML. The reader does not evaluate scripts, start fixtures, or grant permission to run commands found in a document. Local resources must be referenced by a discovered document, remain within the checkout, and use supported bounded image or source-text formats. Resource responses are sandboxed.

Portable exports freeze the discovered document corpus and embed available local images. Missing images retain explicit explanations. Linked code follows the snapshot's commit-source convention; it is not silently fetched or executed. No content is uploaded by discovery or export.

## Validate contributions

Run the relevant existing document tests or the book's `validate` command. Checks cover the contract rather than a frozen list of document titles: new files, edits, removal, source-section bindings, links, resources, negative inputs, discovery limits, navigation, and state restoration.

Keep semantic guidance in its owning document and executable values in product code. New authored content normally needs a Markdown edit, not application code.
