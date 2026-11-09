/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import { createExplorer } from '../runtime/server.mjs';

/** Reuse an explicitly selected canvas for sequential browser validation, restoring its scope afterward. */
export async function createBrowserHost(root, options) {
	const url = process.env.EXPLORER_TEST_URL;
	if (!url) { return createExplorer(root, options); }
	const request = async (path, input) => {
		const response = await fetch(new URL(path, url), input ? {
			method: 'POST', headers: { origin: new URL(url).origin, 'content-type': 'application/json' },
			body: JSON.stringify(input),
		} : undefined);
		if (!response.ok) { throw new Error(`Canvas test request failed: ${response.status} ${path}`); }
		return response.json();
	};
	const previous = await request('/api/state');
	const state = await request('/api/scope', options?.scope ?? { operation: 'all' });
	await request('/api/view', { topic: state.scope.active, patch: { query: '', anchor: '', expandedNodes: [] } });
	return {
		url, state,
		close: async () => {
			for (const [topic, patch] of Object.entries(previous.views)) { await request('/api/view', { topic, patch }); }
			await request('/api/scope', previous.scope.mode === 'all'
				? { operation: 'all', active: previous.scope.active, layout: previous.scope.layout }
				: { operation: 'replace', topics: previous.scope.topics, active: previous.scope.active, layout: previous.scope.layout });
		},
	};
}
