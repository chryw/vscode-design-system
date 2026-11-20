/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- No-build canvas runtime. */
import { createHash } from 'node:crypto';
import { createExplorer } from './server.mjs';
import { canonicalRoot } from './store.mjs';
import { ViewStateStorage } from './state-storage.mjs';
import { bookTitle } from './book.mjs';
import { CheckoutStorage } from './checkout-storage.mjs';
import { checkoutForWorkspace } from '../adapters/vscode/readers.mjs';
import { ContentVersions, contentVersionSelection } from '../adapters/vscode/content-versions.mjs';

export function createBookRuntime(workspace, { home, remote } = {}) {
	const defaultRoot = checkoutForWorkspace(workspace);
	let sessionRoot;
	try { sessionRoot = canonicalRoot(defaultRoot); }
	catch (error) { if (error.message !== 'Select a VS Code checkout') { throw error; } }
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
			instance.controller?.abort();
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
				|| Object.keys(input).some(key => !['root', 'version', 'topics', 'active', 'layout'].includes(key))
				|| input.root !== undefined && (typeof input.root !== 'string' || !input.root)
				|| input.root !== undefined && input.version !== undefined) { throw new Error('Invalid design-system input'); }
			if (input.version !== undefined) { contentVersionSelection(input.version); }
			if (input.root !== undefined) { canonicalRoot(input.root); }
			let instance = instances.get(instanceId);
			if (instance?.closing) { await instance.closing; instance = instances.get(instanceId); }
			const existing = Boolean(instance);
			if (!instance) {
				const selection = new CheckoutStorage(defaultRoot, instanceId, { home });
				const saved = selection.readSelection();
				const origin = sessionRoot ?? (input.root ? canonicalRoot(input.root)
					: saved?.sessionRoot ? canonicalRoot(saved.sessionRoot)
					: saved && (!saved.selection || saved.selection.kind === 'session') ? canonicalRoot(saved.root) : undefined);
				instance = { selection, versions: new ContentVersions(origin, { home, remote }) };
				instances.set(instanceId, instance);
			}
			if (!instance.panel && !instance.starting) {
				instance.controller = new AbortController();
				instance.starting = (async () => {
					const saved = instance.selection.readSelection();
					const version = input.version ?? saved?.selection;
					const localRoot = saved?.root ?? input.root ?? instance.versions.sessionRoot;
					const contentVersion = version || !localRoot
						? await instance.versions.resolve(version ?? { kind: 'latest' }, { signal: instance.controller.signal })
						: instance.versions.local(canonicalRoot(localRoot));
					instance.root = contentVersion.root;
					const panel = await createExplorer(contentVersion.root, {
						contentVersions: instance.versions, contentVersion,
						stateStorageFactory: (checkout, repository, selected) => {
							const remoteVersion = ['latest', 'shared'].includes(selected.selection.kind);
							const view = remoteVersion
								? `${instanceId}:${createHash('sha256').update(JSON.stringify([selected.remote, selected.ref])).digest('hex')}` : instanceId;
							return new ViewStateStorage(remoteVersion ? defaultRoot : checkout, {
								home, repository, view, book: repository.projection.mode === 'basic' ? 'vscode-design-system-basic' : 'vscode-design-system',
							});
						},
						onCheckoutSelected: (checkout, selected) => instance.selection.write(checkout,
							selected.kind === 'local' ? undefined : selected, instance.versions.sessionRoot),
						scope: input.topics === undefined
							? { operation: 'all', ...(input.active === undefined ? {} : { active: input.active }), layout: input.layout ?? 'single' }
							: { topics: input.topics, active: input.active, layout: input.layout ?? 'single' },
					});
					if (saved || input.root !== undefined || input.version !== undefined || contentVersion.selection.kind !== 'session') {
						try {
							instance.selection.write(panel.root, contentVersion.selection.kind === 'local' ? undefined : contentVersion.selection,
								instance.versions.sessionRoot);
						} catch (error) { await panel.close(); throw error; }
					}
					instance.panel = panel;
				})().finally(() => { instance.starting = undefined; });
			}
			await instance.starting;
			if (instance.closing || instances.get(instanceId) !== instance) { throw new Error('Design system closed during startup'); }
			if (existing && input.root !== undefined && instance.panel.root !== canonicalRoot(input.root)) { instance.panel.selectCheckout({ root: input.root }); }
			if (existing && input.version !== undefined) { await instance.panel.selectContentVersion(input.version); }
			instance.root = instance.panel.root;
			return { title: bookTitle, url: new URL('/', instance.panel.url).href };
		},
		async stop(instanceId) { await stop(instanceId); return { title: bookTitle, stopped: true, instanceId }; },
		close: instanceId => stop(instanceId, true),
	};
}
