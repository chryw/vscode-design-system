/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build book discovery contract tests. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { basicProjection } from '../adapters/vscode/basic-book.mjs';
import { readRepository } from '../adapters/vscode/repository.mjs';
import { createRepository } from '../model/repository.mjs';
import { legacyRepositoryDirectory, readGeneratedBook, repositoryDirectory, repositoryDirectoryFor } from '../runtime/book.mjs';
import { DocumentLibrary } from '../runtime/documents.mjs';
import { TopicStore } from '../runtime/store.mjs';
import { defaultView } from '../runtime/view-state.mjs';
import { workspaceRoot } from '../runtime/paths.mjs';
import { createExplorer } from '../runtime/server.mjs';
import { vscodeAdapter } from '../adapters/vscode/readers.mjs';
import { createDocumentCheckout } from './document-helpers.mjs';

const movedDocuments = 'content/legacy-document-paths.json';
const colorsSpec = `${repositoryDirectory}/foundations/colors.design.md`;

/** Copies the checkout's guidance without moved-path metadata, so the result does not depend on the checkout under test. */
function canonicalCheckout(t) {
	const fixture = createDocumentCheckout(t);
	rmSync(path.join(fixture.bookRoot, movedDocuments), { force: true });
	for (const directory of ['foundations', 'patterns']) {
		for (const name of readdirSync(path.join(fixture.bookRoot, directory), { recursive: true })) {
			if (!name.endsWith('.design.md')) { continue; }
			const file = path.join(fixture.bookRoot, directory, name);
			writeFileSync(file, readFileSync(file, 'utf8').replace(/^legacyPaths:.*\r?\n(?:[ \t]+-.*\r?\n)*/m, ''));
		}
	}
	return fixture;
}

test('the current catalog is derived from shared and code-local specification front matter', () => {
	const result = readGeneratedBook(workspaceRoot);
	assert.ok(result);
	const shared = result.specs.filter(spec => ['foundation', 'pattern'].includes(spec.kind));
	const components = result.specs.filter(spec => ['primitive', 'composite'].includes(spec.kind));
	assert.ok(shared.length > 0);
	assert.ok(components.length > 0);
	assert.ok(shared.every(spec => spec.path.startsWith(`${repositoryDirectory}/`)));
	assert.ok(components.every(spec => spec.path.startsWith('src/vs/')));
	assert.deepEqual(result.book.topics.filter(topic => topic.group === 'Foundations' || topic.group === 'Patterns').map(topic => topic.id),
		shared.map(spec => spec.id));
	assert.equal(result.book.components.page, 'content/topics/components.json');
	assert.equal(result.book.topics.find(topic => topic.id === 'colors').status, 'stable');
});

test('Colors points to its owning specification and retains the product source link', async () => {
	const store = new TopicStore(workspaceRoot);
	try {
		const result = await store.read('colors', defaultView('colors', store.repository));
		assert.equal(result.data.primarySourceDocument.id, '.github/skills/design-system/foundations/colors.design.md');
		assert.ok(result.sources.includes('src/vs/platform/theme/common/colors/baseColors.ts'));
	} finally {
		store.close();
	}
});

test('generated chapters with live component examples can request the fixture renderer', async t => {
	const adapter = { ...vscodeAdapter, loadFixtureCatalog: async () => ({ sourceTreeId: 'tree', fixtures: [] }) };
	const panel = await createExplorer(workspaceRoot, { adapter, watchCheckout: false, scope: { operation: 'all', active: 'principles' } });
	t.after(() => panel.close());
	const statuses = {};
	for (const topic of ['principles', 'colors', 'spacing', 'motion']) {
		panel.setScope({ operation: 'all', active: topic });
		statuses[topic] = (await fetch(new URL('/api/fixtures', panel.url))).status;
	}
	assert.deepEqual(statuses, { principles: 500, colors: 200, spacing: 200, motion: 200 });
});

test('canonical checkouts load without moved-path metadata and do not resolve moved paths', t => {
	const fixture = canonicalCheckout(t);
	const library = new DocumentLibrary(fixture.root, { bookRoot: fixture.bookRoot });
	try {
		assert.deepEqual({
			documentAliases: readGeneratedBook(fixture.root).book.documentAliases,
			read: library.read(colorsSpec).id,
			diagnostics: library.snapshot().diagnostics,
		}, { documentAliases: {}, read: colorsSpec, diagnostics: [] });
		assert.throws(() => library.read('.github/design-system/colors.design.md'), /not available/);
	} finally { library.close(); }
});

test('removing the redundant expectations inventory preserves catalog and view defaults', t => {
	const fixture = canonicalCheckout(t);
	const inventory = path.join(fixture.bookRoot, 'content/foundations/reference-expectations.json');
	const expectations = { structures: { motion: ['Obsolete heading'] }, capabilities: { motion: ['Obsolete capability'] } };
	writeFileSync(inventory, JSON.stringify(expectations));
	const older = readRepository(fixture.root);
	rmSync(inventory);
	const current = readRepository(fixture.root);
	const snapshot = createRepository({ ...current.projection, expectations });
	const observe = repository => ({
		catalog: repository.catalog,
		controls: repository.controls,
		views: repository.catalog.filter(topic => !topic.hidden).map(topic => defaultView(topic.id, repository)),
	});
	assert.deepEqual([observe(current), observe(snapshot)], [observe(older), observe(older)]);
});

test('older checkouts that declare moved paths keep chapter and document links on canonical guidance', t => {
	const fixture = canonicalCheckout(t);
	const inputBoxSpec = 'src/vs/base/browser/ui/inputbox/input-box.design.md';
	const movedChapters = [
		['colors', colorsSpec, ['.github/design-system/colors.design.md', 'src/vs/platform/theme/common/colors/COLORS.md']],
		['typography', `${repositoryDirectory}/foundations/typography.design.md`, ['src/vs/platform/theme/common/sizes/typography.md', 'src/vs/platform/theme/common/sizes/typography.design.md']],
		['modal', `${repositoryDirectory}/patterns/modal.design.md`, ['.github/design-system/guidance/modal.design.md']],
	];
	const movedInputBox = ['src/vs/base/browser/ui/inputbox/input-design.md', 'src/vs/base/browser/ui/inputbox/input.design.md'];
	const movedEntry = '.github/design-system/README.md';
	const entry = `${repositoryDirectory}/SKILL.md`;
	const declareMovedPaths = (file, paths) => {
		const spec = path.join(fixture.root, file);
		writeFileSync(spec, readFileSync(spec, 'utf8').replace(/\r?\n---\r?\n/, `\nlegacyPaths:\n${paths.map(item => `  - "${item}"`).join('\n')}\n---\n`));
	};
	fixture.write(inputBoxSpec, readFileSync(path.join(workspaceRoot, inputBoxSpec), 'utf8'));
	for (const [, file, paths] of movedChapters) { declareMovedPaths(file, paths); }
	declareMovedPaths(inputBoxSpec, movedInputBox);
	writeFileSync(path.join(fixture.bookRoot, movedDocuments), JSON.stringify({ [movedEntry]: entry }));
	const repository = readRepository(fixture.root);
	const library = new DocumentLibrary(fixture.root, { bookRoot: fixture.bookRoot });
	try {
		const movedDocumentPairs = [
			...movedChapters.flatMap(([, file, paths]) => paths.map(item => [item, file])),
			...movedInputBox.map(item => [item, inputBoxSpec]),
			[movedEntry, entry],
		];
		assert.deepEqual({
			topics: movedChapters.flatMap(([, , paths]) => paths.map(item => repository.getTopic(item).id)),
			documents: movedDocumentPairs.map(([item]) => library.read(item).id),
			componentSources: movedInputBox.map(item => [library.read(item).source.file, library.read(item).title]),
			diagnostics: library.snapshot().diagnostics,
		}, {
			topics: movedChapters.flatMap(([id, , paths]) => paths.map(() => id)),
			documents: movedDocumentPairs.map(([, file]) => file),
			componentSources: movedInputBox.map(() => [inputBoxSpec, 'InputBox']),
			diagnostics: [],
		});
	} finally { library.close(); }
	writeFileSync(path.join(fixture.bookRoot, movedDocuments), '{');
	assert.throws(() => readGeneratedBook(fixture.root), SyntaxError);
});

test('legacy checkouts remain selectable and generated content paths resolve inside their legacy root', t => {
	const root = mkdtempSync(path.join(os.tmpdir(), 'design-book-legacy-root-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(path.join(root, 'src/vs/base/common'), { recursive: true });
	writeFileSync(path.join(root, 'src/vs/base/common/lifecycle.ts'), '');
	const legacyRoot = path.join(root, legacyRepositoryDirectory);
	mkdirSync(legacyRoot, { recursive: true });
	assert.equal(repositoryDirectoryFor(root), legacyRoot);
	mkdirSync(path.join(root, repositoryDirectory, 'foundations'), { recursive: true });
	assert.equal(repositoryDirectoryFor(root), path.join(root, repositoryDirectory));

	const store = new TopicStore(root, { bookRoot: legacyRoot, repository: basicProjection() });
	try {
		assert.equal(store.sourcePath(`${repositoryDirectory}/content/topics/colors.json`),
			path.join(legacyRoot, 'content/topics/colors.json'));
	} finally {
		store.close();
	}
});
