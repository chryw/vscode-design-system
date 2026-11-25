/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
export function basicBook(guidanceRoot = '.github/skills/design-system') {
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
			{ id: 'guidance', title: 'Design guidance', root: guidanceRoot, origin: 'book' },
		],
	};
}

/**
 * Discovery scopes for a checkout whose specifications supply the catalog. The library groups the design-system
 * entry, workflows, and specifications separately from other skills, and skips test and snapshot directories.
 */
export function authoredDocumentSources(guidanceRoot = '.github/skills/design-system') {
	return [
		{ id: 'product', title: 'Product documentation', root: 'src/vs', origin: 'product', excludeDirectories: ['__snapshots__', 'fixtures'] },
		{
			id: 'extensions', title: 'Built-in extension documentation', root: 'extensions', origin: 'product',
			excludeDirectories: ['test', 'tests', 'fixtures', 'test-workspace', 'testWorkspace'],
		},
		{ id: 'instructions', title: 'Repository instructions', root: '.github/instructions', origin: 'instruction' },
		{ id: 'skills', title: 'Authoring workflows', root: '.github/skills', origin: 'skill', excludeDirectories: [guidanceRoot.split('/').at(-1)] },
		{ id: 'design-system-entry', title: 'Design-system skill', root: guidanceRoot, origin: 'skill', fileName: 'SKILL.md' },
		{ id: 'design-system-references', title: 'Design-system authoring workflows', root: `${guidanceRoot}/references`, origin: 'skill' },
		{ id: 'design-foundations', title: 'Design foundations', root: `${guidanceRoot}/foundations`, origin: 'book' },
		{ id: 'design-patterns', title: 'Design patterns', root: `${guidanceRoot}/patterns`, origin: 'book' },
	];
}

export function basicProjection(book = basicBook()) {
	return {
		format: 'vscode-design-repository', version: 1, mode: 'basic', book,
		capabilities: { curatedTopics: false, liveExamples: false, documents: true },
		curation: { version: 1, productControls: [], families: [], additions: [] },
		bindings: { motion: [], spacing: {} }, toolkit: { file: '', specifications: [] },
		tokens: { domains: [], palettes: [] },
		references: { components: '', foundations: '' },
	};
}
