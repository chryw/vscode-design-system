/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- No-build canvas runtime. */
import { createExplorer } from './server.mjs';
import { canonicalRoot } from './store.mjs';
import { ViewStateStorage } from './state-storage.mjs';
import { bookTitle } from './book.mjs';

export function createBookRuntime(defaultRoot, { home } = {}) {
	const instances = new Map();
	const required = id => {
		const instance = instances.get(id);
		if (!instance?.panel || instance.closing) { throw new Error('Open this design-system instance first'); }
		return instance.panel;
	};
	const stop = async (instanceId, forget = false) => {
		const instance = instances.get(instanceId);
		if (!instance) { return; }
		instance.forget ||= forget;
		if (!instance.closing) {
			instance.closing = (async () => {
				try { await instance.starting; }
				catch { /* A failed open has no server to close. */ }
				await instance.panel?.close();
				instance.panel = undefined;
			})().finally(() => {
				instance.closing = undefined;
				if (instance.forget && instances.get(instanceId) === instance) { instances.delete(instanceId); }
			});
		}
		await instance.closing;
	};
	return {
		required,
		rootFor: instanceId => instances.get(instanceId)?.root ?? canonicalRoot(defaultRoot),
		async open(instanceId, input = {}) {
			if (!input || typeof input !== 'object' || Array.isArray(input)
				|| Object.keys(input).some(key => !['root', 'topics', 'active', 'layout'].includes(key))
				|| input.root !== undefined && (typeof input.root !== 'string' || !input.root)) { throw new Error('Invalid design-system input'); }
			let instance = instances.get(instanceId);
			const root = canonicalRoot(input.root ?? instance?.root ?? defaultRoot);
			if (instance && instance.root !== root) { throw new Error('Instance checkout cannot change; open a different instance'); }
			if (instance?.closing) { await instance.closing; instance = instances.get(instanceId); }
			if (!instance) { instance = { root }; instances.set(instanceId, instance); }
			if (!instance.panel && !instance.starting) {
				instance.starting = createExplorer(root, {
					stateStorage: new ViewStateStorage(root, { home, view: instanceId }),
					scope: input.topics === undefined
						? { operation: 'all', active: input.active ?? 'principles', layout: input.layout ?? 'single' }
						: { topics: input.topics, active: input.active, layout: input.layout ?? 'single' },
				}).then(panel => { instance.panel = panel; }).finally(() => { instance.starting = undefined; });
			}
			await instance.starting;
			if (instance.closing || instances.get(instanceId) !== instance) { throw new Error('Design system closed during startup'); }
			return { title: bookTitle, url: new URL('/', instance.panel.url).href };
		},
		async stop(instanceId) { await stop(instanceId); return { title: bookTitle, stopped: true, instanceId }; },
		close: instanceId => stop(instanceId, true),
	};
}
