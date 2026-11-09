/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Shared no-build view/control contract. */

const fields = {
	section: { schema: { type: 'string', maxLength: 100 }, initial: '' },
	controlId: { schema: { type: 'string', maxLength: 100 }, initial: '' },
	theme: { schema: { type: 'string', maxLength: 200 }, initial: 'Dark 2026' },
	compareTheme: { schema: { type: 'string', maxLength: 200 }, initial: 'Light 2026' },
	query: { schema: { type: 'string', maxLength: 200 }, initial: '' },
	fixtureId: { schema: { type: 'string', maxLength: 1024 }, initial: '' },
	anchor: { schema: { type: 'string', maxLength: 200 }, initial: '' },
	explorerUrl: { schema: { type: 'string', maxLength: 2048 }, initial: '', private: true },
	expandedNodes: { schema: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 100 }, initial: [], private: true },
	documentId: { schema: { type: 'string', maxLength: 2048 }, initial: '' },
	documentScope: { schema: { type: 'string', maxLength: 100 }, initial: '' },
	documentOffset: { schema: { type: 'integer', minimum: 0, maximum: 1000 }, initial: 0 },
};

export const viewProperties = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.schema]));

export function initialView() {
	return Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, Array.isArray(field.initial) ? [...field.initial] : field.initial]));
}

export function validateViewFields(patch) {
	if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !Object.hasOwn(fields, key))) {
		throw new Error('Invalid view fields');
	}
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) { continue; }
		const schema = fields[key].schema;
		const valid = schema.type === 'string' ? typeof value === 'string' && value.length <= schema.maxLength
			: schema.type === 'integer' ? Number.isSafeInteger(value) && value >= schema.minimum && value <= schema.maximum
				: Array.isArray(value) && value.length <= schema.maxItems && value.every(item => typeof item === 'string' && item.length <= schema.items.maxLength);
		if (!valid) { throw new Error(`Invalid ${key}`); }
	}
	return patch;
}

export function readViewURL(url) {
	const result = {};
	for (const [key, field] of Object.entries(fields)) {
		if (field.private || key === 'anchor' || !url.searchParams.has(key)) { continue; }
		if (url.searchParams.getAll(key).length !== 1) { throw new Error(`Repeated view field: ${key}`); }
		const value = url.searchParams.get(key);
		result[key] = field.schema.type === 'integer' ? Number(value) : value;
	}
	result.anchor = decodeURIComponent(url.hash.slice(1));
	return validateViewFields(result);
}

export function writeViewURL(url, view, { topic = true } = {}) {
	validateViewFields(view);
	for (const [key, field] of Object.entries(fields)) {
		if (field.private || key === 'anchor' || !topic && ['section', 'controlId'].includes(key)) { continue; }
		if (view[key]) { url.searchParams.set(key, String(view[key])); }
		else { url.searchParams.delete(key); }
	}
	url.hash = view.anchor ?? '';
	return url;
}
