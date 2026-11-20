/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build book discovery contract tests. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { basicProjection } from '../adapters/vscode/basic-book.mjs';
import { legacyRepositoryDirectory, readGeneratedBook, repositoryDirectory, repositoryDirectoryFor } from '../runtime/book.mjs';
import { TopicStore } from '../runtime/store.mjs';
import { defaultView } from '../runtime/view-state.mjs';
import { workspaceRoot } from '../runtime/paths.mjs';
import { createExplorer } from '../runtime/server.mjs';
import { vscodeAdapter } from '../adapters/vscode/readers.mjs';

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
