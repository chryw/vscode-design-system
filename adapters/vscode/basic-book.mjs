/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
export function basicBook() {
	return {
		version: 1, id: 'vscode-design-system', title: 'Visual Studio Code Design System', defaultTopic: 'documentation',
		topics: [{
			id: 'documentation', title: 'Source library', group: 'Guidance', section: 'documentation',
			renderer: 'documents', aliases: [], compare: false, fixture: false,
		}],
		documentSources: [
			{ id: 'product', title: 'Product documentation', root: 'src/vs', origin: 'product' },
			{ id: 'instructions', title: 'Instructions', root: '.github/instructions', origin: 'instruction' },
			{ id: 'skills', title: 'Skills', root: '.github/skills', origin: 'skill' },
			{ id: 'guidance', title: 'Design guidance', root: '.github/design-system/guidance', origin: 'book' },
		],
	};
}

export function basicProjection(book) {
	return {
		format: 'vscode-design-repository', version: 1, mode: 'basic', book,
		capabilities: { curatedTopics: false, liveExamples: false, documents: true },
		curation: { version: 1, productControls: [], families: [], additions: [] },
		bindings: { motion: [], spacing: {} }, toolkit: { file: '', specifications: [] },
		tokens: { domains: [], palettes: [] }, expectations: { structures: {}, capabilities: {} },
		references: { components: '', foundations: '' },
	};
}
