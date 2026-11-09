/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- No-build canvas runtime. */
import { readRepository } from '../adapters/vscode/repository.mjs';
import { initialView, validateViewFields } from '../model/view-state.mjs';

export function validateViewPatch(patch) {
	validateViewFields(patch);
	if (patch.explorerUrl) {
		const url = new URL(patch.explorerUrl);
		if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.username || url.password
			|| url.pathname !== '/___explorer' || url.search || url.hash) { throw new Error('Invalid Component Explorer URL'); }
	}
	return patch;
}

export function defaultView(id, repository = readRepository()) {
	const entry = repository.getTopic(id);
	return { ...initialView(), section: entry.section, controlId: entry.controlId ?? '' };
}

export function validateState(value, repository = readRepository()) {
	const { getTopic, validateScope } = repository;
	if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['scope', 'views'].includes(key))
		|| !value.scope || !['all', 'focused'].includes(value.scope.mode)
		|| Object.keys(value.scope).some(key => !['mode', 'topics', 'active', 'layout'].includes(key))
		|| !Array.isArray(value.scope.topics) || typeof value.scope.active !== 'string'
		|| !['single', 'compare'].includes(value.scope.layout)
		|| !value.views || typeof value.views !== 'object' || Array.isArray(value.views)) {
		throw new Error('Invalid saved book view state');
	}
	const scope = validateScope({
		operation: value.scope.mode === 'all' ? 'all' : 'replace',
		topics: value.scope.topics, active: value.scope.active, layout: value.scope.layout,
	});
	const views = {};
	for (const [id, patch] of Object.entries(value.views)) {
		if (getTopic(id).id !== id) { throw new Error('Saved views must use canonical topic IDs'); }
		validateViewPatch(patch);
		const defaults = defaultView(id, repository);
		if (['section', 'controlId'].some(key => patch[key] !== undefined && patch[key] !== defaults[key])) {
			throw new Error(`Saved view does not belong to ${id}`);
		}
		views[id] = { ...defaults, ...patch };
	}
	return { scope, views };
}
