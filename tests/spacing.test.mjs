/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import assert from 'node:assert/strict';
import { workspaceRoot } from '../runtime/paths.mjs';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { load } from '../adapters/vscode/groups/spacing.mjs';
import { TopicStore } from '../runtime/store.mjs';

const root = workspaceRoot;
const read = file => readFileSync(`${root}/${file}`, 'utf8');

test('spacing patterns retain exact declarations, source locations, and lazy dependency coverage', async () => {
	const store = new TopicStore(root);
	try {
		const result = await store.read('spacing', { theme: 'Dark 2026' });
		const { patterns, responsive } = result.data.spacing;
		assert.deepEqual(patterns.map(({ id, rules }) => ({ id, values: rules.flatMap(rule => rule.declarations.map(item => item.value)) })), [
			{ id: 'association', values: ['var(--vscode-spacing-size40)'] },
			{ id: 'field', values: ['var(--vscode-spacing-size60)'] },
			{ id: 'siblings', values: ['var(--vscode-spacing-size80) var(--vscode-spacing-size160)'] },
			{ id: 'inset', values: ['var(--vscode-spacing-size100) var(--vscode-spacing-size120)', 'var(--vscode-spacing-size160)'] },
			{ id: 'sections', values: ['var(--vscode-spacing-size240)', '0 0 var(--vscode-spacing-size20)'] },
		]);
		for (const rule of [...patterns.flatMap(pattern => pattern.rules), ...responsive]) {
			assert.equal(read(rule.source.file).split('\n')[rule.source.line - 1], `${rule.selector} {`);
			assert.ok(result.sources.includes(rule.source.file));
			assert.equal(store.metrics.reads[rule.source.file], 1);
		}
		assert.deepEqual(Object.keys(store.metrics.parses).sort(), ['guidance', 'sizes', 'sourceDocuments', 'spacing']);
		assert.equal(store.documentLibrary, undefined);
		assert.equal(result.coverage.find(item => item.expected === 'Product spacing patterns').status, 'implementation-only');
		assert.equal(result.coverage.find(item => item.expected === 'Named semantic spacing roles').status, 'not-defined-in-covered-sources');
		assert.ok(Buffer.byteLength(JSON.stringify(result)) < 100000);
	} finally { store.close(); }
});

test('spacing examples reread values and explicitly reject missing or ambiguous CSS evidence', () => {
	const context = transform => ({
		read: file => file.endsWith('.css') ? transform(read(file)) : read(file),
		source: file => ({ file, line: 1 }),
	});
	const changed = load(context(text => text.replace('gap: var(--vscode-spacing-size40);', 'gap: var(--vscode-spacing-size60);')));
	assert.equal(changed.spacing.patterns[0].rules[0].declarations[0].value, 'var(--vscode-spacing-size60)');
	for (const [transform, expected] of [
		[text => text.replace('.automation-owner-label {', '.renamed-owner-label {'), /needs one CSS rule/],
		[text => text.replace('gap: var(--vscode-spacing-size40);', ''), /needs one gap declaration/],
		[text => `${text}\n.automation-owner-label { gap: 4px; }`, /found 2/],
		[text => text.replace('gap: var(--vscode-spacing-size40);', 'gap: 4px; gap: 6px;'), /needs one gap declaration/],
	]) {
		assert.throws(() => load(context(transform)), expected);
	}
});
