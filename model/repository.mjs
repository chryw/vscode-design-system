/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Shared no-build repository projection contract. */
import { createCatalog, validateBook } from './catalog.mjs';
import { createControls, createSpecControls, specTopicId } from './components.mjs';

export function createRepository(input) {
	if (input?.format !== 'vscode-design-repository' || input.version !== 1
		|| !Array.isArray(input.toolkit?.specifications) || typeof input.toolkit.file !== 'string'
		|| !Array.isArray(input.bindings?.motion) || !input.bindings.spacing
		|| !Array.isArray(input.tokens?.domains) || !Array.isArray(input.tokens.palettes)
		|| typeof input.references?.foundations !== 'string'
		|| (input.mode !== 'authored' || input.references.components !== undefined) && typeof input.references.components !== 'string') {
		throw new Error('Invalid design-system repository projection');
	}
	const { controls, aliases } = input.mode === 'authored'
		? createSpecControls(input.designSpecs ?? [])
		: createControls(input.curation, input.toolkit.specifications, input.designSpecs ?? []);
	validateBook(input.book);
	if (input.book.components !== undefined) {
		const { components, ...book } = input.book;
		if (input.mode !== 'authored' && !components.page) {
			throw new Error('Missing component page for a curated repository');
		}
		const topics = controls.map(control => ({
			id: `component-${control.id}`, title: control.name, group: 'Components', section: 'components', controlId: control.id,
			aliases: [control.id, ...(control.aliases ?? [])], compare: true, fixture: Boolean(control.groups.length),
			content: control.content, hidden: control.hidden, renderer: 'components',
			page: input.mode === 'authored' ? control.specPath : components.page,
			kind: 'component', isDraft: control.isDraft ?? control.status === 'draft',
			...(control.replacedBy ? { replacedBy: specTopicId(control.replacedBy, input.designSpecs ?? []) } : {}),
			...(control.specPath || control.design ? { design: control.specPath ?? control.design } : {}),
			...(input.mode !== 'authored' && control.primitive ? { subgroup: 'Primitives' } : {}),
		}));
		input = { ...input, book: { ...book, topics: book.topics.flatMap(topic => topic.id === components.after ? [topic, ...topics] : [topic]) } };
	}
	const isVisibleComponent = topic => topic.group === 'Components' && !topic.hidden && topic.navigation !== 'utility';
	const orderedComponents = input.book.topics.filter(isVisibleComponent).sort((a, b) => a.title.localeCompare(b.title, 'en'));
	let componentIndex = 0;
	input = { ...input, book: { ...input.book, topics: input.book.topics.map(topic => isVisibleComponent(topic) ? orderedComponents[componentIndex++] : topic) } };
	return {
		...createCatalog(input.book, aliases), projection: input, controls, componentAliases: aliases,
		motionControls: input.bindings.motion, spacingControl: input.bindings.spacing,
		toolkitFile: input.toolkit.file, toolkitSpecifications: input.toolkit.specifications,
		tokenDomains: input.tokens.domains, corePaletteThemes: input.tokens.palettes,
		primitiveReference: input.references.components, foundationReference: input.references.foundations,
		controlGaps: controls.filter(control => !control.hidden && control.content === 'tbd')
			.map(control => ({ name: control.name, note: input.curation.missingReference, owner: control.owner })),
	};
}
