/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

export function validateControlDocumentation(input, id) {
	if (input?.version !== 1 || input.id !== id || typeof input.className !== 'string'
		|| typeof input.summary !== 'string' || typeof input.preview !== 'string'
		|| ![input.usage, input.accessibility].every(items => Array.isArray(items) && items.length && items.every(item => typeof item === 'string'))
		|| !Array.isArray(input.api) || !input.api.length || input.api.some(member =>
			!Array.isArray(member) || member.length < 4 || member.length > 5 || member.some(value => typeof value !== 'string' || !value))
		|| input.apiStart !== undefined && typeof input.apiStart !== 'string') {
		throw new Error(`Invalid component documentation: ${id}`);
	}
	const { version, id: identity, ...documentation } = input;
	return documentation;
}

export function describeControl(control, input) {
	if (control.content === 'tbd') {
		return { ...control, docs: { summary: control.reason } };
	}
	const documentation = validateControlDocumentation(input, control.id);
	return { ...control, docs: documentation };
}

export function documentControl(control, read, input) {
	const { docs: documentation } = describeControl(control, input);
	for (const file of control.relatedOwners ?? []) { read(file); }
	if (control.content === 'tbd') {
		if (control.owner) { read(control.owner); }
		if (control.evidence) { read(control.evidence); }
		return { ...control, docs: documentation };
	}
	const lines = read(control.owner).split('\n');
	const start = documentation.apiStart ? lines.findIndex(line => line.includes(documentation.apiStart)) : 0;
	if (start < 0) {
		throw new Error(`Component documentation source changed: ${control.name}`);
	}
	return {
		...control,
		docs: {
			...documentation,
			api: documentation.api.map(([name, type, description, anchor, file = control.owner]) => {
				if (![control.owner, ...(control.relatedOwners ?? [])].includes(file)) {
					throw new Error(`Component API source is not an owner: ${control.name}, ${file}`);
				}
				const sourceLines = file === control.owner ? lines : read(file).split('\n');
				const index = sourceLines.findIndex((line, index) => index >= (file === control.owner ? start : 0) && line.includes(anchor));
				if (index < 0) {
					throw new Error(`Component documentation source changed: ${control.name}, ${name}`);
				}
				return { name, type, description, source: { file, line: index + 1 } };
			}),
		},
	};
}
