/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
export function createControls(input, specifications) {
	const object = value => value && typeof value === 'object' && !Array.isArray(value);
	const words = value => Array.isArray(value) && value.every(item => typeof item === 'string' && item);
	const source = value => typeof value === 'string' && /^src\/[\w/.-]+\.(?:ts|css)$/.test(value) && !value.split('/').includes('..');
	const definition = control => object(control) && typeof control.id === 'string' && typeof control.name === 'string'
		&& words(control.groups) && (control.aliases === undefined || words(control.aliases))
		&& (control.relatedOwners === undefined || words(control.relatedOwners))
		&& [control.owner, control.evidence, control.file, ...(control.relatedOwners ?? [])].every(file => file === undefined || source(file));
	if (input?.version !== 1 || !Array.isArray(input.productControls) || !Array.isArray(input.families)
		|| !Array.isArray(input.additions) || !Array.isArray(specifications)
		|| input.productControls.some(control => !definition(control)) || input.additions.some(control => !definition(control))
		|| input.families.some(family => !Array.isArray(family) || family.length !== 2 || typeof family[0] !== 'string' || !object(family[1])
			|| family[1].aliases !== undefined && !words(family[1].aliases)
			|| family[1].groups !== undefined && !words(family[1].groups)
			|| family[1].relatedOwners !== undefined && !words(family[1].relatedOwners))
		|| specifications.some(specification => !object(specification) || typeof specification.id !== 'string'
			|| typeof specification.name !== 'string' || !/^\d+:\d+$/.test(specification.nodeId))
		|| new Set(input.productControls.map(control => control.id)).size !== input.productControls.length
		|| new Set(specifications.map(specification => specification.id)).size !== specifications.length) {
		throw new Error('Invalid component curation');
	}
	const historical = new Map([
		...input.productControls.map(({ family, ...control }) => [control.id, control]),
		...specifications.filter(specification => !input.productControls.some(control => control.id === specification.id))
			.map(specification => [specification.id, { ...specification, groups: [] }]),
	]);
	const canonical = [
		...input.families.map(([id, options]) => {
			const control = historical.get(id);
			if (!control) { throw new Error(`Unknown component family: ${id}`); }
			return { ...control, ...options };
		}),
		...input.additions,
	].map(control => ({
		primitive: true, hidden: false, content: control.groups.length ? 'ready' : 'tbd', ...control,
		nodeId: control.nodeId ?? specifications.find(specification => specification.id === control.id)?.nodeId
			?? specifications.find(specification => control.aliases?.includes(specification.id))?.nodeId,
		specifications: specifications.filter(specification => specification.id === control.id || control.aliases?.includes(specification.id)),
	}));
	const aliases = new Map([
		...canonical.flatMap(control => (control.aliases ?? []).map(alias => [`component-${alias}`, `component-${control.id}`])),
		...['status-icon', 'file-icon', 'suggest-icon'].map(id => [`component-${id}`, 'iconography']),
	]);
	const canonicalIds = new Set(canonical.map(control => control.id));
	const result = [
		...canonical,
		...[...historical.values()].filter(control => !canonicalIds.has(control.id)).map(control => ({
			...control, primitive: false, hidden: true, archived: !aliases.has(`component-${control.id}`),
			content: control.groups.length ? 'ready' : 'tbd',
			nodeId: control.nodeId ?? specifications.find(specification => specification.id === control.id)?.nodeId,
			reason: input.archiveReason,
		})),
	].sort((a, b) => a.name.localeCompare(b.name, 'en'));
	if (new Set(result.map(control => control.id)).size !== result.length || result.some(control =>
		typeof control.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(control.id) || typeof control.name !== 'string'
		|| !Array.isArray(control.groups) || control.groups.some(group => typeof group !== 'string')
		|| control.aliases && (!Array.isArray(control.aliases) || control.aliases.some(alias => typeof alias !== 'string'))
		|| !['ready', 'tbd'].includes(control.content) || typeof control.reason !== 'string'
		|| !definition(control))) {
		throw new Error('Invalid component definition');
	}
	return { controls: result, aliases };
}

export function curateFixtures(fixtures, inventory) {
	if (!Array.isArray(fixtures)) {
		throw new Error('Component Explorer returned an invalid fixture catalog');
	}
	return inventory.map(control => ({
		...control,
		variants: fixtures.filter(fixture => Array.isArray(fixture.groupPath) && control.groups.includes(fixture.groupPath.join('/'))
			&& (!control.previewTheme || fixture.fixtureName === control.previewTheme))
			.sort((a, b) => control.groups.indexOf(a.groupPath.join('/')) - control.groups.indexOf(b.groupPath.join('/'))).map(fixture => {
				if (typeof fixture.fixtureId !== 'string' || fixture.fixtureId.length > 1024 || typeof fixture.fixtureName !== 'string') {
					throw new Error('Component Explorer returned an invalid fixture identifier');
				}
				return {
					id: fixture.fixtureId,
					name: control.previewTheme ? control.groupLabels[fixture.groupPath.join('/')] : `${fixture.groupPath.at(-1) === 'KeyboardFocusedToggle' ? 'Keyboard focus · '
						: control.groupLabels?.[fixture.groupPath.join('/')] ? `${control.groupLabels[fixture.groupPath.join('/')]} · ` : ''}${fixture.fixtureName}`,
					group: fixture.groupPath.join('/'),
					variant: fixture.fixtureName,
					background: fixture.background,
				};
			}),
	}));
}
