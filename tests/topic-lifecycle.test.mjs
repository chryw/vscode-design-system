/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTopicLoader } from '../view/topic-lifecycle.mjs';

test('reload reads fresh data and commits only the latest read and render', async () => {
	const reads = [];
	const renders = [];
	const commits = [];
	const problems = [];
	const loader = createTopicLoader({
		read: (_input, signal) => new Promise(resolve => reads.push({ resolve, signal })),
		render: (data, signal) => new Promise(resolve => renders.push({ resolve, signal, data })),
		commit: (result, data) => commits.push({ result, data }),
		report: error => problems.push(error.message),
		busy: () => {},
	});
	try {
		const first = loader.refresh();
		reads[0].resolve('first saved source');
		await Promise.resolve();
		const second = loader.refresh();
		reads[1].resolve('second saved source');
		await Promise.resolve();
		renders[1].resolve('current topic');
		await second;
		renders[0].resolve('stale topic');
		await first;
		const third = loader.refresh();
		const fourth = loader.refresh();
		reads[3].resolve('fourth saved source');
		await Promise.resolve();
		renders[2].resolve('newest topic');
		await fourth;
		reads[2].resolve('stale read');
		await third;
		assert.deepEqual({
			commits, problems, rendered: renders.map(item => item.data),
			abortedReads: reads.map(item => item.signal.aborted),
		}, {
			commits: [{ result: 'current topic', data: 'second saved source' }, { result: 'newest topic', data: 'fourth saved source' }],
			problems: [],
			rendered: ['first saved source', 'second saved source', 'fourth saved source'],
			abortedReads: [true, true, true, false],
		});
	} finally {
		loader.dispose();
	}
});

test('reload failures are explicit, recovery works, and disposal prevents late updates', async () => {
	const commits = [];
	const problems = [];
	const busy = [];
	let finish;
	let pendingSignal;
	const loader = createTopicLoader({
		read: (input, signal) => {
			if (input === 'fail') {
				throw new Error('Invalid saved registration');
			}
			if (input === 'pending') {
				pendingSignal = signal;
				return new Promise(resolve => { finish = resolve; });
			}
			return 'restored source';
		},
		render: data => data,
		commit: result => commits.push(result),
		report: error => problems.push(error.message),
		busy: value => busy.push(value),
	});
	await loader.refresh('fail');
	await loader.refresh('recover');
	const pending = loader.refresh('pending');
	loader.dispose();
	finish('late source');
	await pending;
	await loader.refresh('after disposal');
	assert.deepEqual({ commits, problems, busy, aborted: pendingSignal.aborted }, {
		commits: ['restored source'], problems: ['Invalid saved registration'],
		busy: [true, false, true, false, true], aborted: true,
	});
});
