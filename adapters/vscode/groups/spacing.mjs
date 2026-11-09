/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import { readContent } from './authored.mjs';

export function load({ read, source }) {
	read('src/vs/workbench/test/browser/componentFixtures/baseUI.fixture.ts');
	read('src/vs/base/browser/ui/button/button.ts');
	read('src/vs/base/browser/ui/button/button.css');
	const definition = readContent(read, 'content/foundations/spacing-patterns.json');
	if (!Array.isArray(definition.patterns) || !definition.patterns.length || !Array.isArray(definition.responsive)) {
		throw new Error('Invalid spacing pattern content');
	}
	const rule = ({ file, selector, properties }) => {
		if (typeof file !== 'string' || !/^src\/[\w/.-]+\.css$/.test(file) || file.split('/').includes('..')
			|| typeof selector !== 'string' || !selector || !Array.isArray(properties) || !properties.length
			|| properties.some(property => typeof property !== 'string' || !/^[a-z-]+$/.test(property))) {
			throw new Error('Invalid spacing source binding');
		}
		const text = read(file);
		const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const matches = [...text.matchAll(new RegExp(`^${escaped}\\s*\\{(?<body>[^{}]*)\\}`, 'gm'))];
		if (matches.length !== 1) {
			throw new Error(`Spacing example needs one CSS rule for ${selector} in ${file}; found ${matches.length}`);
		}
		const match = matches[0];
		const declarations = properties.map(property => {
			const values = match.groups.body.replaceAll(/\/\*[\s\S]*?\*\//g, '').split(';')
				.map(declaration => declaration.match(new RegExp(`^\\s*${property}:\\s*(?<value>.+?)\\s*$`))).filter(Boolean);
			if (values.length !== 1) {
				throw new Error(`Spacing example needs one ${property} declaration for ${selector} in ${file}`);
			}
			return { property, value: values[0].groups.value.trim() };
		});
		return { selector, declarations, source: source(file, match.index) };
	};
	return {
		spacing: {
			patterns: definition.patterns.map(pattern => {
				if (!pattern || !['id', 'title', 'guidance', 'context'].every(key => typeof pattern[key] === 'string')
					|| !Array.isArray(pattern.rules) || !pattern.rules.length) {
					throw new Error('Invalid spacing pattern');
				}
				return { ...pattern, rules: pattern.rules.map(rule) };
			}),
			responsive: definition.responsive.map(rule),
		},
	};
}
