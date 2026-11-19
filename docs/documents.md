# Authored-document contract

The book has two complementary entry points: curated design chapters and the **Source library**. Both read the same source files. A document does not need a custom renderer or a chapter entry to be discoverable.

## Find and read

Open **Source library** beneath the topic groups. It is a book-level tool for finding original guidance, specifications, instructions, and references, not another design subject. Search matches document titles, repository-relative paths, Markdown, and frontmatter. Exact title and path matches rank ahead of incidental mentions. Filter by source and page through bounded results.

The checkout registers the library with `navigation: "utility"`; omitting this field or using `"topic"` keeps ordinary grouped navigation. Utility placement does not hide content from exports or machine listings. The internal `documentation` ID, section, document APIs, and existing URLs remain unchanged.

Selecting a result reads the actual Markdown, including code blocks, tables, links, and local images. Frontmatter remains available under **Document metadata** so instruction applicability is not lost. Relative Markdown links open the corresponding document; linked code opens as source text. Unsupported or unavailable references are reported rather than executed or silently replaced.

Source readers use the same opening hierarchy as curated chapters: document navigation and provenance, one page title, section navigation, introductory prose, then the body. Descriptions follow the page navigation; the wide layout keeps section navigation in its right rail. A leading, prose-only **Introduction** section supplies that introduction without repeating its heading; its original anchor and aliases remain usable. Substantive headings, nested introductory sections, lists, tables, and code retain their source structure. This is a presentation rule, not a rewrite of the document or the agent-facing source.

The document ID is its repository-relative path. When renaming a specification, the selected checkout can retain a direct old-path → canonical-path mapping in `topics.json`'s optional `documentAliases`. Reads, saved document selections, and portable snapshots resolve that mapping to the same canonical document; searches do not list duplicate copies. Aliases cannot chain or shadow an existing document, and missing targets are explicit diagnostics. An unknown bookmark still reports that the document is unavailable and offers a route back to the library. IDs are interpreted within the canvas's canonical checkout, never as arbitrary absolute paths.

## Discovery scopes

`documentSources` in the selected checkout's [topics.json](https://github.com/microsoft/vscode/blob/chryw/design-system-exploration/.github/design-system/topics.json) defines the source locations. The defaults include product documentation, built-in extension documentation, repository instructions, authoring workflows and their references, and repository-owned design-system guidance. Viewer implementation docs are not part of the design-guidance corpus.

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

After changing discovery-scope configuration or the curated topic catalog, use **Change checkout**, reselect the current checkout, and choose **Browse checkout**. Agents can call `select_checkout` with the current root. Adding a document within an existing scope does not require this catalog refresh.

## Route a new chapter

A chapter's `topics.json` entry selects a trusted renderer kind, not a module path from the checkout. For a non-component chapter, `id` and `section` must match its page definition's ID. Use stable IDs and retain former topic names in `aliases` when renaming a route. Aliases cannot shadow another topic, conflict with an existing alias, or take the reserved `components` route. Document-path renames use the separate `documentAliases` map described above.

Use `renderer: "guidance"` for a new authored chapter. Both composed `sections` and source-bound `guidance` render without adding the topic to a fixed viewer assessment table; a new authored chapter is not thereby assessed as adopted in the product. Specialized renderer kinds support their corresponding product sections only. A new interactive visualization or source-reader capability requires a viewer-code change and, for installed plugins, an updated release.

Catalog validation rejects ambiguous routes and incompatible renderer/section combinations before replacing a live book. Missing source files or headings remain explicit topic errors that can recover after the source is repaired and refreshed. Links to topics absent from the selected catalog are labeled unavailable instead of preventing the surrounding article from rendering.

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

The shared article frame renders these sections inline without appending **Read full specification** links that reopen the same guidance in the Source library. Purposeful authored cross-references and external references remain usable, with **Back** and **Forward** restoring earlier pages and reading positions. **Topic files** in the page header lists the guidance files used by the projection and its distinct implementation entry point as direct file links. Topics and source documents need not map one-to-one. The full dependency inventory and document search remain available to machine readers; the Source library is no longer a curated-book navigation destination. Definitions, values, and actual component previews remain separate projections of product code.

Missing or ambiguous sections fail validation explicitly. Do not repair them by copying the old prose into the renderer. Update the binding when a deliberate source reorganization changes its anchor.

## Curate further reading

The selected checkout registers external references once in `topics.json`'s optional `references` map. Keys are exact topic IDs, including generated `component-<controlId>` IDs:

```json
{
	"references": {
		"typography": [
			{
				"title": "WCAG: Text spacing",
				"url": "https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html",
				"description": "Check the user text-spacing overrides a layout must accommodate."
			}
		]
	}
}
```

Declaration order is display order in **Further reading**, shared by live and portable views. Every entry requires a title, an HTTPS URL without credentials, and a short description of its specific value beyond the chapter. Unknown topic IDs, duplicate URLs within a topic, malformed entries, and unsupported URLs fail catalog validation. Omitted topics have no reading list. The metadata-only topic listing exposes the same references to agents.

Prefer a few authoritative, directly relevant references: a standard, a deeper technical explanation, or a useful comparison that helps make the topic's decision. Do not add a generic homepage or fill a quota. Nothing harvests references from Markdown links, page dependencies, instructions, or skills. Keep purposeful cross-topic links inline in their owning guidance. Page `sources` and `guidance` remain composition inputs, not bibliography registration.

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
