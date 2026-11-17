/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- No-build canvas runtime. */
import { createExplorer } from './server.mjs';
import { canonicalRoot } from './store.mjs';
import { ViewStateStorage } from './state-storage.mjs';
import { bookTitle } from './book.mjs';
import { CheckoutStorage } from './checkout-storage.mjs';

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
		rootFor: instanceId => instances.get(instanceId)?.panel?.root ?? instances.get(instanceId)?.root ?? canonicalRoot(defaultRoot),
		async open(instanceId, input = {}) {
			if (!input || typeof input !== 'object' || Array.isArray(input)
				|| Object.keys(input).some(key => !['root', 'topics', 'active', 'layout'].includes(key))
				|| input.root !== undefined && (typeof input.root !== 'string' || !input.root)) { throw new Error('Invalid design-system input'); }
			let instance = instances.get(instanceId);
			const selection = instance?.selection ?? new CheckoutStorage(defaultRoot, instanceId, { home });
			const root = canonicalRoot(instance ? input.root ?? instance.panel?.root ?? instance.root : selection.read() ?? input.root ?? defaultRoot);
			if (instance?.closing) { await instance.closing; instance = instances.get(instanceId); }
			if (!instance) { instance = { root, selection }; instances.set(instanceId, instance); }
			if (!instance.panel && !instance.starting) {
				instance.starting = createExplorer(root, {
					stateStorageFactory: (checkout, repository) => new ViewStateStorage(checkout, {
						home, view: instanceId, book: repository.projection.mode === 'basic' ? 'vscode-design-system-basic' : 'vscode-design-system',
					}),
					onCheckoutSelected: checkout => selection.write(checkout),
					scope: input.topics === undefined
						? { operation: 'all', ...(input.active === undefined ? {} : { active: input.active }), layout: input.layout ?? 'single' }
						: { topics: input.topics, active: input.active, layout: input.layout ?? 'single' },
				}).then(panel => { instance.panel = panel; }).finally(() => { instance.starting = undefined; });
			}
			await instance.starting;
			if (instance.closing || instances.get(instanceId) !== instance) { throw new Error('Design system closed during startup'); }
			if (input.root !== undefined && instance.panel.root !== root) { instance.panel.selectCheckout({ root }); }
			instance.root = instance.panel.root;
			return { title: bookTitle, url: new URL('/', instance.panel.url).href };
		},
		async stop(instanceId) { await stop(instanceId); return { title: bookTitle, stopped: true, instanceId }; },
		close: instanceId => stop(instanceId, true),
	};
}
