/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Shared no-build reference projections. */

export function findTokens(tokens, input) {
	const query = input.trim().replace(/^var\(\s*/, '').replace(/\s*\)$/, '').toLowerCase();
	return tokens.filter(token => [token.id, token.css, token.value, token.alias, token.purpose, token.description, token.scope, token.source?.file].some(value => value?.toLowerCase().includes(query)))
		.sort((a, b) => Number(b.id.toLowerCase() === query || b.css?.toLowerCase() === query)
			- Number(a.id.toLowerCase() === query || a.css?.toLowerCase() === query) || a.id.localeCompare(b.id));
}

export function definitionEntries(system, query = '') {
	const sizes = system.sizes.flatMap(token => {
		const group = token.id.startsWith('spacing.') ? 'spacing' : /^(?:fontSize\.|fontWeight\.|bodyFontSize|agents\.font)/.test(token.id) ? 'typography'
			: token.id.startsWith('cornerRadius.') ? 'shape' : token.id.startsWith('codiconFontSize') ? 'iconography'
				: token.id === 'strokeThickness' ? 'stroke' : undefined;
		return group ? [{ ...token, group, purpose: token.description, alias: token.deprecated ? token.replacement : undefined }] : [];
	});
	const entries = [
		...sizes,
		...(system.designTokens ?? []),
		...(system.elevation?.cssShadows ?? []).map(shadow => ({
			id: shadow.css, ...shadow, group: 'elevation', purpose: system.tokenGuidance?.find(domain => domain.id === 'elevation')?.description ?? shadow.css,
		})),
	];
	const order = new Map(entries.map((entry, index) => [entry, index]));
	return findTokens(entries, query)
		.sort((a, b) => Number(Boolean(a.deprecated)) - Number(Boolean(b.deprecated)) || order.get(a) - order.get(b));
}
