/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Tests for the no-build document contract. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { readFileSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { documentExcerpt, documentSection, parseDocument, resolveDocumentReference } from '../model/documents.mjs';
import { initialView, readViewURL, validateViewFields, viewProperties, writeViewURL } from '../model/view-state.mjs';
import { DocumentLibrary } from '../runtime/documents.mjs';
import { createExplorer } from '../runtime/server.mjs';
import { readPage } from '../adapters/vscode/groups/authored.mjs';
import { canvasRoot as packageRoot, checkoutRoot as root, createDocumentCheckout as checkout } from './document-helpers.mjs';

test('documents preserve source metadata, scoped headings, fences, and stable duplicate anchors', () => {
	const text = '---\napplyTo: "**/*.css"\n---\n# Guide\n\n<a id="choice"></a>\n## Choosing\n\nFirst.\n\n### Detail\n\nNested.\n\n```md\n## Not a heading\n```\n\n## Choosing\n\nSecond.\n';
	const document = parseDocument(text, { id: 'src/vs/feature/DESIGN.md', origin: 'product' });
	const section = documentSection(document, { anchor: 'choice' });
	assert.deepEqual({
		title: document.title, metadata: document.metadata,
		headings: document.headings.map(({ id, line }) => [id, line]),
		section: { title: section.title, line: section.source.line, nested: section.markdown.includes('### Detail'), second: section.markdown.includes('Second.') },
	}, {
		title: 'Guide', metadata: 'applyTo: "**/*.css"',
		headings: [['guide', 4], ['choosing', 7], ['detail', 11], ['choosing-1', 19]],
		section: { title: 'Choosing', line: 7, nested: true, second: false },
	});
	assert.throws(() => documentSection(document, { heading: 'Choosing' }), /Expected one section/);
	assert.throws(() => documentSection(document, { anchor: 'missing' }), /Expected one section/);
	assert.equal(parseDocument('---\n\nOrdinary Markdown.\n', { id: 'plain.md' }).markdown.includes('Ordinary Markdown'), true);
});

test('discovery and search locate ordinary Markdown by content, path, and metadata without a chapter mapping', t => {
	const fixture = checkout(t);
	const library = new DocumentLibrary(fixture.root, { bookRoot: fixture.bookRoot });
	try {
		fixture.write('src/vs/feature/other.md', '# A reference\n\nRead the feature notes for details.\n');
		const byContent = library.list({ query: 'distinct contract' });
		const byMetadata = library.list({ query: 'special-scope' });
		assert.deepEqual({
			ids: byContent.results.map(item => item.id),
			scope: byMetadata.results.map(item => item.origin),
			metadata: library.read(byMetadata.results[0].id).metadata.includes('applyTo:'),
			complete: byContent.complete,
			titleMatch: library.list({ query: 'feature notes', limit: 1 }).results[0].id,
		}, { ids: ['src/vs/feature/feature-notes.md'], scope: ['instruction'], metadata: true, complete: true, titleMatch: 'src/vs/feature/feature-notes.md' });
		fixture.write('src/vs/new-feature/DESIGN.md', '# New feature\n\nNew guidance.\n');
		assert.equal(library.list({ query: 'New feature' }).total, 1);
		fixture.write('src/vs/new-feature/DESIGN.md', '# New feature\n\nRevised guidance.\n');
		assert.match(library.read('src/vs/new-feature/DESIGN.md').markdown, /Revised guidance/);
		rmSync(path.join(fixture.root, 'src/vs/new-feature/DESIGN.md'));
		assert.equal(library.list({ query: 'New feature' }).total, 0);
		assert.throws(() => library.read('src/vs/new-feature/DESIGN.md'), error => error.code === 'DOCUMENT_NOT_FOUND');
		assert.throws(() => library.list({ scope: 'unconfigured' }), /Unknown documentation scope/);
		assert.throws(() => library.list({ limit: 101 }), /page bounds/);
	} finally { library.close(); }
});

test('discovery watches additions and closes its bounded source watchers when inactive', async t => {
	const fixture = checkout(t);
	const watched = [];
	let notify;
	const changed = new Promise(resolve => { notify = resolve; });
	const library = new DocumentLibrary(fixture.root, {
		bookRoot: fixture.bookRoot, onChange: notify,
		watchFactory: (directory, options, callback) => {
			const watcher = new EventEmitter();
			watcher.closed = false;
			watcher.close = () => { watcher.closed = true; };
			watched.push({ directory, options, callback, watcher });
			return watcher;
		},
	});
	try {
		library.setActive(true);
		library.list();
		fixture.write('src/vs/feature/new-spec.md', '# Newly authored\n\nFind me.\n');
		watched.find(item => item.directory === path.join(fixture.root, 'src/vs')).callback('rename', 'feature/new-spec.md');
		const timeout = setTimeout(() => notify(new Error('Document change was not announced')), 3000);
		try { assert.equal(await changed, undefined); } finally { clearTimeout(timeout); }
		assert.equal(library.list({ query: 'Newly authored' }).total, 1);
		library.setActive(false);
		assert.ok(watched.every(item => item.options.recursive === ['darwin', 'win32'].includes(process.platform) && item.watcher.closed));
		fixture.write('src/vs/feature/new-spec.md', '# Changed while hidden\n');
		library.setActive(true);
		assert.equal(library.list({ query: 'Changed while hidden' }).total, 1);
	} finally { library.close(); }
});

test('document resources cannot escape the checkout or serve unreferenced files', t => {
	const fixture = checkout(t);
	const id = 'src/vs/feature/DESIGN.md';
	fixture.write(id, '# Images\n\n![Diagram](diagram.svg)\n\n[Picture](linked.svg)\n\n[Code](component.ts)\n\n`[Example](literal.ts)`\n');
	fixture.write('src/vs/feature/diagram.svg', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
	fixture.write('src/vs/feature/linked.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
	fixture.write('src/vs/feature/component.ts', 'export const value = true;');
	symlinkSync(path.join(packageRoot, 'README.md'), path.join(fixture.root, 'src/vs/feature/linked.md'));
	const library = new DocumentLibrary(fixture.root, { bookRoot: fixture.bookRoot });
	try {
		assert.deepEqual({
			image: library.resource(id, 'diagram.svg').type,
			linkedImage: library.resource(id, 'linked.svg').type,
			code: library.resource(id, 'component.ts').type,
			symlink: library.list().diagnostics.some(item => item.reason === 'symlink-excluded'),
		}, { image: 'image/svg+xml', linkedImage: 'image/svg+xml', code: 'text/plain; charset=utf-8', symlink: true });
		assert.throws(() => library.resource(id, '../../../package.json'), /not referenced/);
		assert.throws(() => library.resource(id, 'literal.ts'), /not referenced/);
		assert.throws(() => library.read('../outside.md'), /not available/);
		assert.throws(() => resolveDocumentReference(id, '../../../../outside.md'), /leaves the repository/);
		assert.deepEqual(resolveDocumentReference(id, 'javascript:alert(1)'), { kind: 'unsupported' });
		assert.deepEqual(resolveDocumentReference(id, '../other/DESIGN.md#behavior'),
			{ kind: 'document', id: 'src/vs/other/DESIGN.md', anchor: 'behavior' });
	} finally { library.close(); }
});

test('oversized documents are explicit diagnostics, and bounded reads retain provenance', t => {
	const fixture = checkout(t);
	fixture.write('src/vs/feature/large.md', '# Large\n' + 'x'.repeat(256 * 1024));
	const library = new DocumentLibrary(fixture.root, { bookRoot: fixture.bookRoot });
	try {
		const listing = library.list();
		const document = library.read('.github/instructions/example.instructions.md');
		const excerpt = documentExcerpt(document, 100);
		assert.deepEqual({
			complete: listing.complete, reason: listing.diagnostics[0].reason,
			bounded: excerpt.metadata.length + excerpt.markdown.length <= 100,
			revision: excerpt.revision === document.revision,
			source: excerpt.source.file,
			truncated: excerpt.truncated,
		}, {
			complete: false, reason: 'document-too-large', bounded: true, revision: true,
			source: '.github/instructions/example.instructions.md', truncated: true,
		});
	} finally { library.close(); }
});

test('source-section composition reads the canonical document and rejects broken references', () => {
	const file = '.github/instructions/design-tokens.instructions.md';
	const original = readFileSync(path.join(root, file), 'utf8');
	const read = key => key === file ? original.replace('Use the token variable', 'Use the current source-backed variable') : readFileSync(path.join(root, key), 'utf8');
	const page = readPage(read, 'tokens');
	assert.deepEqual({
		source: page.sourceSections[0].source.file,
		anchor: page.sourceSections[0].anchor,
		changed: page.sourceSections[0].markdown.includes('Use the current source-backed variable'),
	}, { source: file, anchor: 'choose-by-role', changed: true });
	assert.throws(() => readPage(key => key === file ? original.replace('## Choose by role', '## Renamed guidance') : read(key), 'tokens'), /Expected one section/);
});

test('view fields round-trip document selection, scope and pagination without exposing private renderer addresses', () => {
	const view = { ...initialView(), section: 'documentation', documentId: 'src/vs/feature/DESIGN.md', documentScope: 'product', documentOffset: 30, query: 'state ownership', anchor: 'behavior', explorerUrl: 'http://localhost:5000/___explorer' };
	const url = writeViewURL(new URL('http://127.0.0.1/'), view);
	const restored = readViewURL(url);
	assert.deepEqual({
		document: restored.documentId, scope: restored.documentScope, offset: restored.documentOffset,
		query: restored.query, anchor: restored.anchor, privateAddress: url.searchParams.has('explorerUrl'),
		schemaType: viewProperties.documentOffset.type,
	}, { document: view.documentId, scope: 'product', offset: 30, query: 'state ownership', anchor: 'behavior', privateAddress: false, schemaType: 'integer' });
	assert.throws(() => readViewURL(new URL('http://127.0.0.1/?documentOffset=invalid')), /Invalid documentOffset/);
	assert.throws(() => validateViewFields({ documentId: {} }), /Invalid documentId/);
});

test('HTTP and topic controls expose the same document identities and reject invalid selection before saving', async t => {
	const fixture = checkout(t);
	const panel = await createExplorer(fixture.root, { bookRoot: fixture.bookRoot });
	try {
		const origin = new URL(panel.url).origin;
		const listing = await (await fetch(`${origin}/api/documents?query=distinct`)).json();
		const id = listing.results[0].id;
		const response = await fetch(`${origin}/api/document?id=${encodeURIComponent(id)}&anchor=behavior`);
		const document = await response.json();
		assert.deepEqual({ status: response.status, id: document.id, text: document.markdown, source: document.source.line },
			{ status: 200, id, text: 'Keep user choices.', source: 5 });
		panel.setView({ section: 'documentation', documentId: id });
		const before = panel.state;
		assert.throws(() => panel.setView({ documentId: 'src/vs/missing.md' }), /not available/);
		assert.deepEqual(panel.state, before);
		const invalid = await fetch(`${origin}/api/documents?limit=invalid`);
		assert.deepEqual({ status: invalid.status, code: (await invalid.json()).error.code }, { status: 400, code: 'DOCUMENT_QUERY_INVALID' });
		const model = await panel.inspectTopic('documentation', true);
		assert.equal(model.data.library.document.id, id);
		for (let index = 0; index < 20; index++) {
			const query = `Feature notes${' '.repeat(index)}`;
			const projection = await panel.store.read('documentation', { ...panel.view, documentId: '', query });
			assert.equal(projection.data.library.listing.query, query);
		}
		assert.equal([...panel.store.groups.values()].filter(group => group.name === 'documents').length, 1);
		panel.setScope({ operation: 'all', active: 'principles' });
		await panel.inspectTopic('documentation', true);
		fixture.write(id, '# Feature notes\n\nUpdated while not subscribed.\n');
		const refreshed = await panel.inspectTopic('documentation', true);
		assert.match(refreshed.data.library.document.markdown, /Updated while not subscribed/);
	} finally { await panel.close(); }
});
