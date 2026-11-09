/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas tests execute directly in Node. */
import assert from 'node:assert/strict';
import { workspaceRoot } from '../runtime/paths.mjs';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { TopicStore } from '../runtime/store.mjs';
import { createReferenceModel } from '../adapters/vscode/reference-model.mjs';
import { load as readPhilosophy } from '../adapters/vscode/groups/philosophy.mjs';

const root = workspaceRoot;

test('source coverage does not promote absent geometry or a missing specification to defined guidance', async () => {
	const store = new TopicStore(root);
	try {
		const result = [];
		for (const [topic, expected] of [
			['size', 'Product control geometry'], ['stroke', 'Boundary and scrollbar recipes'],
			['layout', 'Named composition recipes'], ['elevation', 'Shadow-tier usage guidance'],
		]) {
			const data = (await store.read(topic, { theme: 'Dark 2026' })).data;
			const entry = data.reference.topics[topic].find(entry => entry.expected === expected);
			result.push([topic, entry.status, entry.scope.every(file => data.sourceFiles.includes(file))]);
		}
		assert.deepEqual(result, [
			['size', 'not-assessed', true], ['stroke', 'not-assessed', true],
			['layout', 'not-defined-in-covered-sources', true], ['elevation', 'not-defined-in-covered-sources', true],
		]);
	} finally { store.close(); }
});

test('defined coverage and authored annotations require actual covered inputs', async () => {
	const store = new TopicStore(root);
	try {
		const data = (await store.read('shape', { theme: 'Dark 2026' })).data;
		assert.throws(() => createReferenceModel({ ...data, sourceFiles: [] }, ['shape']), /needs the covered source/);
		assert.throws(() => createReferenceModel({ ...data, referenceNotes: {} }, ['shape']), /Missing source coverage note/);
		const notes = structuredClone(data.referenceNotes);
		notes.shape['Radius scale']['source-defined'] = 'Changed coverage annotation.';
		assert.equal(createReferenceModel({ ...data, referenceNotes: notes }, ['shape']).topics.shape[0].summary, 'Changed coverage annotation.');
	} finally { store.close(); }
});

test('the philosophy cards project the canonical values rather than a second authored definition', () => {
	const read = file => readFileSync(`${root}/${file}`, 'utf8');
	const original = readPhilosophy({ read });
	const result = readPhilosophy({
		read: file => read(file).replace(/\| \*\*Calm\*\* \| [^|]+ \|/, '| **Calm** | Changed canonical meaning. |'),
	});
	assert.deepEqual(result.philosophyValues, original.philosophyValues.map(value =>
		value.title === 'Calm' ? { ...value, text: 'Changed canonical meaning.' } : value));
	assert.throws(() => readPhilosophy({ read: file => read(file).replace('| **Calm** |', '| **Renamed** |') }), /values changed/);
});