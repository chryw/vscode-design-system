/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Shared no-build repository projection contract. */
import { createCatalog, validateBook } from './catalog.mjs';
import { createControls } from './components.mjs';

export function createRepository(input) {
	if (input?.format !== 'vscode-design-repository' || input.version !== 1
		|| !Array.isArray(input.toolkit?.specifications) || typeof input.toolkit.file !== 'string'
		|| !Array.isArray(input.bindings?.motion) || !input.bindings.spacing
		|| !Array.isArray(input.tokens?.domains) || !Array.isArray(input.tokens.palettes)
		|| typeof input.references?.components !== 'string' || typeof input.references.foundations !== 'string') {
		throw new Error('Invalid design-system repository projection');
	}
	const { controls, aliases } = createControls(input.curation, input.toolkit.specifications, input.designSpecs ?? []);
	validateBook(input.book);
	if (input.book.components !== undefined) {
		const { components, ...book } = input.book;
		const topics = controls.map(control => ({
			id: `component-${control.id}`, title: control.name, group: 'Components', section: 'components', controlId: control.id,
			aliases: [control.id, ...(control.aliases ?? [])], compare: true, fixture: Boolean(control.groups.length),
			content: control.content, hidden: control.hidden, renderer: 'components', page: components.page,
			kind: control.kind ?? 'component', ...(control.status ? { status: control.status } : {}),
			...(control.replacedBy ? { replacedBy: `component-${control.replacedBy}` } : {}),
			...(control.specPath || control.design ? { design: control.specPath ?? control.design } : {}),
			...(control.kind ? { subgroup: control.kind === 'primitive' ? 'Primitives' : 'Composites' } : {}),
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
