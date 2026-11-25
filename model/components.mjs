/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
export function componentMetadata(value = {}) {
	const fields = ['implementation', 'relatedSources', 'api', 'fixtures', 'designReference'];
	const strings = key => value[key] === undefined || Array.isArray(value[key])
		&& value[key].every(item => typeof item === 'string' && item.trim())
		&& new Set(value[key]).size === value[key].length;
	const source = file => typeof file === 'string' && /^src\/[\w/.-]+\.ts$/.test(file) && !file.split('/').includes('..');
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.keys(value).some(key => !fields.includes(key))
		|| !['relatedSources', 'api', 'fixtures'].every(strings)
		|| value.implementation !== undefined && !source(value.implementation)
		|| value.relatedSources?.some(file => !source(file))
		|| value.api?.some(member => !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?$/.test(member))
		|| value.api?.length && !value.implementation
		|| value.designReference !== undefined && (typeof value.designReference !== 'string'
			|| !/^https:\/\/www\.figma\.com\/(?:design|file)\/[A-Za-z0-9]+\/[^#\s]*$/.test(value.designReference))) {
		throw new Error('Invalid component specification bindings');
	}
	return value;
}

/** Returns the book topic that presents a specification; component topics are prefixed, shared guidance keeps its id. */
export function specTopicId(id, specifications) {
	const kind = specifications.find(specification => specification.id === id)?.kind;
	return kind === 'foundation' || kind === 'pattern' ? id : `component-${id}`;
}

export function createSpecControls(specifications) {
	const specs = specifications.filter(spec => ['component', 'primitive', 'composite'].includes(spec.kind));
	const controls = specs.map(spec => {
		const binding = componentMetadata(spec.component);
		return {
			id: spec.id, name: spec.title, kind: 'component', isDraft: spec.isDraft ?? spec.status === 'draft',
			primitive: true,
			hidden: spec.hidden === true || Boolean(spec.replacedBy),
			replacedBy: spec.replacedBy, aliases: spec.aliases, content: 'ready',
			design: spec.path, specPath: spec.path, reason: '',
			owner: binding.implementation, relatedOwners: binding.relatedSources ?? [],
			api: binding.api ?? [], groups: binding.fixtures ?? [], designReference: binding.designReference,
		};
	}).sort((a, b) => a.name.localeCompare(b.name, 'en'));
	const aliases = new Map();
	for (const spec of specs) {
		const target = spec.replacedBy ? specTopicId(spec.replacedBy, specifications) : `component-${spec.id}`;
		aliases.set(`component-${spec.id}`, target);
		for (const alias of spec.aliases) { aliases.set(`component-${alias}`, target); }
	}
	return { controls, aliases };
}

export function createControls(input, specifications, designSpecs = []) {
	const object = value => value && typeof value === 'object' && !Array.isArray(value);
	const words = value => Array.isArray(value) && value.every(item => typeof item === 'string' && item);
	const source = value => typeof value === 'string' && /^src\/[\w/.-]+\.(?:ts|css)$/.test(value) && !value.split('/').includes('..');
	const design = control => control.design === undefined && control.api === undefined
		|| typeof control.design === 'string' && /^src\/[\w/.-]+\.design\.md$/.test(control.design)
			&& /\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.design\.md$/.test(control.design)
			&& !control.design.split('/').includes('..') && words(control.api) && control.api.length > 0
			&& new Set(control.api).size === control.api.length
			&& control.api.every(member => /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?$/.test(member));
	const definition = control => object(control) && typeof control.id === 'string' && typeof control.name === 'string'
		&& words(control.groups) && (control.aliases === undefined || words(control.aliases))
		&& (control.relatedOwners === undefined || words(control.relatedOwners))
		&& design(control)
		&& [control.owner, control.evidence, control.file, ...(control.relatedOwners ?? [])].every(file => file === undefined || source(file));
	if (input?.version !== 1 || !Array.isArray(input.productControls) || !Array.isArray(input.families)
		|| !Array.isArray(input.additions) || !Array.isArray(specifications) || !Array.isArray(designSpecs)
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
	const authoredSpecs = new Map(designSpecs.filter(specification => ['component', 'primitive', 'composite'].includes(specification.kind))
		.map(specification => [specification.id, specification]));
	const specFor = control => authoredSpecs.get(control.id)
		?? [...authoredSpecs.values()].find(specification => control.aliases?.includes(specification.id) || specification.aliases.includes(control.id));
	const canonical = [
		...input.families.map(([id, options]) => {
			const control = historical.get(id);
			if (!control) { throw new Error(`Unknown component family: ${id}`); }
			return { ...control, ...options };
		}),
		...input.additions,
	].map(control => ({
		primitive: true, hidden: false, content: control.groups.length ? 'ready' : 'tbd', ...control,
		...(specFor(control) ? {
			kind: 'component', isDraft: specFor(control).isDraft ?? specFor(control).status === 'draft', specPath: specFor(control).path,
			replacedBy: specFor(control).replacedBy, hidden: control.hidden || Boolean(specFor(control).replacedBy),
		} : {}),
		nodeId: control.nodeId ?? specifications.find(specification => specification.id === control.id)?.nodeId
			?? specifications.find(specification => control.aliases?.includes(specification.id))?.nodeId,
		specifications: specifications.filter(specification => specification.id === control.id || control.aliases?.includes(specification.id)),
	}));
	const aliases = new Map([
		...canonical.flatMap(control => (control.aliases ?? []).map(alias => [`component-${alias}`, `component-${control.id}`])),
		...['status-icon', 'file-icon', 'suggest-icon'].map(id => [`component-${id}`, 'iconography']),
	]);
	for (const specification of authoredSpecs.values()) {
		const target = specification.replacedBy ? specTopicId(specification.replacedBy, designSpecs) : `component-${specification.id}`;
		aliases.set(`component-${specification.id}`, target);
		for (const alias of specification.aliases) { aliases.set(`component-${alias}`, target); }
	}
	const canonicalIds = new Set(canonical.map(control => control.id));
	const result = [
		...canonical,
		...[...historical.values()].filter(control => !canonicalIds.has(control.id)).map(control => ({
			...control, primitive: false, hidden: true, archived: !aliases.has(`component-${control.id}`),
			...(specFor(control) ? {
				kind: 'component', isDraft: specFor(control).isDraft ?? specFor(control).status === 'draft', specPath: specFor(control).path,
				replacedBy: specFor(control).replacedBy,
			} : {}),
			content: control.groups.length ? 'ready' : 'tbd',
			nodeId: control.nodeId ?? specifications.find(specification => specification.id === control.id)?.nodeId,
			reason: input.archiveReason,
		})),
	].sort((a, b) => a.name.localeCompare(b.name, 'en'));
	if (new Set(result.map(control => control.id)).size !== result.length || result.some(control =>
		typeof control.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(control.id) || typeof control.name !== 'string'
		|| !Array.isArray(control.groups) || control.groups.some(group => typeof group !== 'string')
		|| control.aliases && (!Array.isArray(control.aliases) || control.aliases.some(alias => typeof alias !== 'string'))
		|| control.kind !== undefined && !['component', 'primitive', 'composite'].includes(control.kind)
		|| control.isDraft !== undefined && typeof control.isDraft !== 'boolean'
		|| control.status !== undefined && !['draft', 'stable', 'deprecated'].includes(control.status)
		|| !['ready', 'tbd'].includes(control.content) || typeof control.reason !== 'string'
		|| !definition(control))) {
		throw new Error('Invalid component definition');
	}
	return { controls: result, aliases };
}

/** Secondary fixture groups are labelled from their registered group name, e.g. `ButtonBar` becomes `Button bar`. */
function fixtureGroupLabel(segment) {
	const words = segment.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
	return words.charAt(0).toUpperCase() + words.slice(1);
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
						: control.groupLabels?.[fixture.groupPath.join('/')] ? `${control.groupLabels[fixture.groupPath.join('/')]} · `
							: control.groups.indexOf(fixture.groupPath.join('/')) > 0 ? `${fixtureGroupLabel(fixture.groupPath.at(-1))} · ` : ''}${fixture.fixtureName}`,
					group: fixture.groupPath.join('/'),
					variant: fixture.fixtureName,
					background: fixture.background,
				};
			}),
	}));
}
