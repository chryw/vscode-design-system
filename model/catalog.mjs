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
const sectionRenderers = {
	typography: ['typography'], foundations: ['layout', 'spacing', 'shape', 'size', 'stroke', 'colors', 'elevation'],
	theming: ['theming'], icons: ['iconography'], motion: ['motion'], tokens: ['tokens'],
	components: ['components'], documents: ['documentation'],
};

export class UnknownTopicError extends Error { }

function validateReferences(book) {
	const references = book.references === undefined ? {} : book.references;
	if (!references || typeof references !== 'object' || Array.isArray(references)) {
		throw new Error('Invalid book references');
	}
	for (const [id, entries] of Object.entries(references)) {
		if (!/^[a-z][a-z0-9-]*$/.test(id) || !book.components && !book.topics.some(topic => topic.id === id)) {
			throw new Error(`Unknown reference topic: ${id}`);
		}
		if (!Array.isArray(entries)) { throw new Error(`Invalid references for topic: ${id}`); }
		const targets = new Set();
		for (const entry of entries) {
			if (!entry || typeof entry !== 'object' || Array.isArray(entry)
				|| Object.keys(entry).some(key => !['title', 'url', 'description'].includes(key))
				|| ['title', 'url', 'description'].some(key => typeof entry[key] !== 'string' || !entry[key].trim())) {
				throw new Error(`Invalid reference for topic: ${id}`);
			}
			let url;
			try { url = new URL(entry.url); }
			catch { throw new Error(`Invalid reference URL for topic: ${id}`); }
			if (url.protocol !== 'https:' || url.username || url.password) {
				throw new Error(`References require HTTPS URLs without credentials: ${id}`);
			}
			if (targets.has(url.href)) { throw new Error(`Duplicate reference URL for topic: ${id}`); }
			targets.add(url.href);
		}
	}
	return references;
}

export function validateBook(book) {
	const components = book?.components;
	if (book?.version !== 1 || book.id !== 'vscode-design-system' || book.title !== 'Visual Studio Code Design System'
		|| !Array.isArray(book.topics) || !book.topics.length || book.topics.length > 200 || book.topics.some(topic => !topic || typeof topic !== 'object' || Array.isArray(topic))
		|| new Set(book.topics.map(topic => topic.id)).size !== book.topics.length
		|| !book.topics.some(topic => topic.id === book.defaultTopic && !topic.hidden)
		|| components !== undefined && (!components || typeof components !== 'object' || Array.isArray(components)
			|| Object.keys(components).some(key => !['after', 'page'].includes(key))
			|| !/^(?:pages|content\/topics)\/[a-z][a-z0-9-]*\.json$/.test(components.page)
			|| !book.topics.some(topic => topic.id === components.after)
			|| book.topics.some(topic => topic.section === 'components'))) {
		throw new Error('Invalid design-system book manifest');
	}
	const references = validateReferences(book);
	return book.topics.map(topic => {
		if (!topic || typeof topic.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(topic.id)
			|| typeof topic.title !== 'string' || !topic.title || typeof topic.section !== 'string'
			|| !['Foundations', 'Patterns', 'Components', 'Guidance'].includes(topic.group) || !Object.hasOwn(renderers, topic.renderer)
			|| !Array.isArray(topic.aliases) || topic.aliases.some(alias => typeof alias !== 'string' || !alias)
			|| new Set(topic.aliases).size !== topic.aliases.length
			|| typeof topic.compare !== 'boolean' || typeof topic.fixture !== 'boolean'
			|| topic.hidden !== undefined && typeof topic.hidden !== 'boolean'
			|| topic.navigation !== undefined && !['topic', 'utility'].includes(topic.navigation)
			|| topic.page !== undefined && !/^(?:pages|content\/topics)\/[a-z][a-z0-9-]*\.json$/.test(topic.page)
			|| topic.kind !== undefined && !['foundation', 'component', 'pattern'].includes(topic.kind)
			|| topic.design !== undefined && (typeof topic.design !== 'string'
				|| !/^(?:\.github\/design-system|src\/vs)\/[\w/.-]+\.design\.md$/.test(topic.design)
				|| topic.design.split('/').includes('..'))
			|| topic.section !== 'components' && topic.section !== topic.id
			|| topic.renderer !== 'guidance' && !sectionRenderers[topic.renderer]?.includes(topic.section)
			|| topic.renderer === 'guidance' && Object.values(sectionRenderers).some(sections => sections.includes(topic.section))
			|| topic.section === 'components' && (topic.id !== `component-${topic.controlId}` || !['ready', 'tbd'].includes(topic.content))) {
			throw new Error(`Invalid book topic: ${topic?.id}`);
		}
		return { ...topic, references: Object.hasOwn(references, topic.id) ? references[topic.id] : [],
			rendererKind: topic.renderer, renderer: renderers[topic.renderer] };
	});
}

export function bookNavigation(catalog) {
	const visible = catalog.filter(item => !item.hidden && (item.id !== 'documentation' || catalog.length === 1));
	return {
		topics: visible.filter(item => item.navigation !== 'utility'),
		utilities: visible.filter(item => item.navigation === 'utility'),
	};
}

export function createCatalog(manifest, componentAliases) {
	const catalog = validateBook(manifest);
	const aliases = new Map(componentAliases);
	for (const topic of catalog.filter(topic => topic.section !== 'components')) {
		for (const alias of topic.aliases) {
			if (alias === 'components' || catalog.some(entry => entry.id === alias && entry.id !== topic.id)
				|| aliases.has(alias) && aliases.get(alias) !== topic.id) {
				throw new Error(`Conflicting topic alias: ${alias}`);
			}
			aliases.set(alias, topic.id);
		}
	}
	const sections = [
		...catalog.filter(item => item.section !== 'components').map(item => ({ id: item.id, title: item.title, searchable: ['tokens', 'iconography'].includes(item.id) })),
		{ id: 'components', title: 'Components' },
	];
	function topicId(view) {
		return getTopic(view.section === 'components' ? `component-${view.controlId || 'button'}` : view.section).id;
	}
	function getTopic(id) {
		const canonical = id === 'components' ? 'component-button' : aliases.get(id) ?? id;
		const entry = catalog.find(item => item.id === canonical);
		if (!entry) { throw new UnknownTopicError(`Unknown topic: ${id}`); }
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
