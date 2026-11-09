/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
const renderers = Object.freeze({
	guidance: 'topics/guidance.mjs', typography: 'topics/typography.mjs',
	foundations: 'topics/foundations.mjs', theming: 'topics/theming.mjs', icons: 'topics/icons.mjs',
	motion: 'topics/motion.mjs', tokens: 'topics/tokens.mjs', components: 'topics/components.mjs', documents: 'topics/documents.mjs',
});

export function validateBook(book) {
	if (book?.version !== 1 || book.id !== 'vscode-design-system' || book.title !== 'Visual Studio Code Design System'
		|| !Array.isArray(book.topics) || !book.topics.length || book.topics.some(topic => !topic || typeof topic !== 'object' || Array.isArray(topic))
		|| new Set(book.topics.map(topic => topic.id)).size !== book.topics.length
		|| !book.topics.some(topic => topic.id === book.defaultTopic && !topic.hidden)) {
		throw new Error('Invalid design-system book manifest');
	}
	return book.topics.map(topic => {
		if (!topic || typeof topic.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(topic.id)
			|| typeof topic.title !== 'string' || !topic.title || typeof topic.section !== 'string'
			|| !['Foundations', 'Components', 'Guidance'].includes(topic.group) || !Object.hasOwn(renderers, topic.renderer)
			|| !Array.isArray(topic.aliases) || topic.aliases.some(alias => typeof alias !== 'string' || !alias)
			|| new Set(topic.aliases).size !== topic.aliases.length
			|| typeof topic.compare !== 'boolean' || typeof topic.fixture !== 'boolean'
			|| topic.hidden !== undefined && typeof topic.hidden !== 'boolean'
			|| topic.page !== undefined && !/^pages\/[a-z][a-z0-9-]*\.json$/.test(topic.page)
			|| topic.section === 'components' && (topic.id !== `component-${topic.controlId}` || !['ready', 'tbd'].includes(topic.content))) {
			throw new Error(`Invalid book topic: ${topic?.id}`);
		}
		return { ...topic, rendererKind: topic.renderer, renderer: renderers[topic.renderer] };
	});
}

export function createCatalog(manifest, componentAliases) {
	const catalog = validateBook(manifest);
	const sections = [
		...catalog.filter(item => item.section !== 'components').map(item => ({ id: item.id, title: item.title, searchable: ['tokens', 'iconography'].includes(item.id) })),
		{ id: 'components', title: 'Components' },
	];
	function topicId(view) {
		return getTopic(view.section === 'components' ? `component-${view.controlId || 'button'}` : view.section).id;
	}
	function getTopic(id) {
		const canonical = id === 'components' ? 'component-button' : componentAliases.get(id) ?? id;
		const entry = catalog.find(item => item.id === canonical);
		if (!entry) { throw new Error(`Unknown topic: ${id}`); }
		return entry;
	}
	function visibleTopicIds(scope) {
		return scope.mode === 'all' ? [scope.active] : scope.topics;
	}
	function validateScope(input, current = { mode: 'focused', topics: [manifest.defaultTopic], active: manifest.defaultTopic, layout: 'single' }) {
		if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['operation', 'topics', 'active', 'layout'].includes(key))) {
			throw new Error('Expected operation, topics, active and layout');
		}
		const { operation = 'replace', topics = [], active, layout = operation === 'all' ? 'single' : current.layout } = input;
		if (!['replace', 'add', 'all'].includes(operation) || !['single', 'compare'].includes(layout)
			|| !Array.isArray(topics) || topics.length > catalog.length || new Set(topics).size !== topics.length) {
			throw new Error('Invalid scope operation, layout or topic list');
		}
		const canonicalTopics = [...new Set(topics.map(id => getTopic(id).id))];
		if (active !== undefined) { getTopic(active); }
		const selected = operation === 'all' ? catalog.filter(item => !item.hidden).map(item => item.id)
			: operation === 'add' ? [...new Set([...current.topics.map(id => getTopic(id).id), ...canonicalTopics])] : canonicalTopics;
		if (!selected.length) { throw new Error('Select at least one topic'); }
		const nextActive = active !== undefined ? getTopic(active).id : selected.includes(current.active) ? current.active : selected[0];
		if (operation === 'all' && active !== undefined && getTopic(nextActive).hidden && !selected.includes(nextActive)) {
			selected.push(nextActive);
		}
		if (!selected.includes(nextActive) || layout === 'compare' && (selected.length !== 2 || selected.some(id => !getTopic(id).compare))) {
			throw new Error('Active topic must be selected; comparison requires exactly two topics');
		}
		return { mode: operation === 'all' ? 'all' : 'focused', topics: selected, active: nextActive, layout };
	}
	return { catalog, sections, bookTitle: manifest.title, topicId, getTopic, visibleTopicIds, validateScope };
}
