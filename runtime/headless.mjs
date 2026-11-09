/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- No-build canvas runtime. */
import { readFileSync, statSync } from 'node:fs';
import { readRepository } from '../adapters/vscode/repository.mjs';
import { definitionEntries } from '../view/token-lookup.mjs';
import { bookTitle } from './book.mjs';
import { TopicStore, canonicalRoot } from './store.mjs';
import { defaultView } from './view-state.mjs';
import { DocumentLibrary } from './documents.mjs';
import { documentExcerpt } from '../model/documents.mjs';

export function listTopics(root) {
	const { catalog, projection: { book } } = readRepository(root);
	return { title: book.title, version: book.version, defaultTopic: book.defaultTopic,
		topics: catalog.filter(item => !item.hidden).map(({ id, title, group, aliases }) => ({ id, title, group, aliases })) };
}

export async function validateReference(root, topics) {
	const store = new TopicStore(root);
	const { catalog, projection: { book } } = store.repository;
	topics ??= catalog.map(topic => topic.id);
	const sources = new Set();
	const diagnostics = [];
	let indexedDocuments;
	try {
		for (const id of topics) {
			const topic = await store.read(id, defaultView(id, store.repository));
			for (const file of topic.sources) { sources.add(file); }
			for (const diagnostic of topic.data.library?.listing.diagnostics ?? []) { diagnostics.push(diagnostic); }
			for (const document of topic.data.sourceDocuments ?? []) {
				indexedDocuments ??= new Set(store.documents.snapshot().documents.map(item => item.id));
				if (!indexedDocuments.has(document.id) && !diagnostics.some(item => item.file === document.id)) {
					diagnostics.push({ file: document.id, reason: 'chapter-source-not-in-library' });
				}
			}
		}
		return { title: book.title, book: book.id, version: book.version, valid: diagnostics.length === 0, topics: topics.length, sources: sources.size, diagnostics };
	} finally { store.close(); }
}

function topicDefinitions(data) {
	const group = (definitionKind, entries) => entries.map(entry => ({ ...entry, definitionKind }));
	let groups;
	switch (data.view.section) {
		case 'motion':
			groups = [
				group('motion-token', data.motionDocumentation.tokens),
				group('motion-recipe', data.motionDocumentation.recipes),
				group('motion-analysis', data.motionDocumentation.analyses),
				group('motion-preset', data.motionDocumentation.presets.map(preset => ({ ...preset, presetId: preset.id, id: `motion.preset.${preset.id}` }))),
				group('motion-preset-binding', data.motionDocumentation.bindings.map(binding => ({
					id: `motion.presetBinding.${binding.id}`, bindingId: binding.id, presetId: binding.preset, source: binding.source,
					phases: binding.phases.map(phase => ({
						phase: phase.phase, response: phase.response, durationTokens: phase.durationTokens, easingTokens: phase.easingTokens,
					})),
				}))),
				group('motion-response', data.motionDocumentation.responses.map(response => ({
					id: `motion.response.${response.id}`, responseId: response.id, label: response.label, source: response.source,
					frequencyHz: response.frequencyHz, dampingRatio: response.dampingRatio, durationMs: response.durationMs, limits: response.limits,
					metrics: {
						response50Ms: response.metrics.response50Ms, settle2PercentMs: response.metrics.settle2PercentMs,
						endpointResidual: response.metrics.endpointResidual, maxInterpolationError: response.metrics.maxInterpolationError,
					},
				}))),
			];
			break;
		case 'components':
			groups = [group('component-api', data.controls.flatMap(control =>
				(control.docs.api ?? []).map(member => ({ ...member, componentId: control.id }))))];
			break;
		case 'typography':
			groups = [group('type-token', data.typography.tokens), group('font-family', data.typography.families)];
			break;
		case 'tokens':
			groups = [group('design-token', definitionEntries(data))];
			break;
		case 'colors':
			groups = [group('color', data.colors)];
			break;
		case 'theming':
			groups = [group('theme', data.themes), group('color', data.colors)];
			break;
		case 'iconography':
			groups = [group('icon', data.icons)];
			break;
		case 'elevation':
			groups = [group('shadow', data.elevation.cssShadows)];
			break;
		default:
			groups = [group('token', data.sizes)];
	}
	const definitions = [];
	// A long token collection must not starve its related recipes or font families.
	for (let index = 0; groups.some(group => index < group.length); index++) {
		for (const group of groups) {
			if (index < group.length) { definitions.push(group[index]); }
		}
	}
	return definitions;
}

export async function readReference(root, id, { limit = 12000 } = {}) {
	if (!Number.isInteger(limit) || limit < 100 || limit > 24000) { throw new Error('Read limit must be 100–24000 characters'); }
	const store = new TopicStore(root);
	try {
		id = store.repository.getTopic(id).id;
		const result = await store.read(id, defaultView(id, store.repository));
		let remaining = limit;
		const description = result.data.controls[0]?.docs.summary ?? '';
		const summary = description.slice(0, Math.floor(limit / 4));
		remaining -= summary.length;
		let guidanceBudget = Math.floor(remaining * (id === 'motion' ? 0.5 : 0.75));
		const guidance = [];
		const composed = (result.data.sourceSections ?? []).map(section => ({
			file: section.source.file, text: section.markdown, source: section.source, anchor: section.anchor, title: section.title,
		}));
		const composedFiles = new Set(composed.map(section => section.file));
		const chapterSources = result.sources.filter(file => file.endsWith('.md') && (file.startsWith('.github/design-system/') || file.startsWith('src/')));
		const documents = [
			...composed,
			...chapterSources.filter(file => !composedFiles.has(file)).map(file => ({ file })),
			...(result.data.documents[result.data.view.section] ?? []).filter(document => !chapterSources.includes(document.file) && !composedFiles.has(document.file)),
		];
		for (const document of documents) {
			if (guidanceBudget <= 0) { break; }
			const source = document.text ?? readFileSync(store.sourcePath(document.file), 'utf8');
			const text = source.slice(0, guidanceBudget);
			guidanceBudget -= text.length;
			remaining -= text.length;
			guidance.push({ file: document.file, source: document.source, anchor: document.anchor, title: document.title, text, truncated: text.length !== source.length });
		}
		const candidates = topicDefinitions(result.data);
		const definitions = [];
		for (const candidate of candidates) {
			const text = JSON.stringify(candidate);
			if (text.length > remaining) { continue; }
			definitions.push(candidate);
			remaining -= text.length;
		}
		return { title: bookTitle, topic: id, checkout: store.root, revision: result.revision, sources: result.sources.slice(0, 100),
			sourceCount: result.sources.length, coverage: result.coverage, capability: result.capability, summary, guidance, definitions,
			definitionCount: candidates.length,
			...(result.data.library ? { documents: result.data.library.listing } : {}),
			truncated: summary.length < description.length || guidance.length < documents.length || guidance.some(item => item.truncated)
				|| definitions.length < candidates.length || result.sources.length > 100 };
	} finally { store.close(); }
}

export async function searchReference(root, query, { topics, limit = 20 } = {}) {
	const { catalog, getTopic } = readRepository(root);
	if (typeof query !== 'string' || query.trim().length < 2 || query.length > 200) { throw new Error('Search needs 2–200 characters'); }
	if (!Number.isInteger(limit) || limit < 1 || limit > 50) { throw new Error('Search limit must be 1–50 results'); }
	if (topics !== undefined && (!Array.isArray(topics) || !topics.length || topics.length > catalog.length)) { throw new Error('Select a bounded topic list'); }
	const selected = [...new Set((topics ?? catalog.filter(item => !item.hidden).map(item => item.id)).map(id => getTopic(id).id))];
	const store = new TopicStore(root);
	const results = [];
	const visited = new Set();
	const unavailableSources = [];
	let bytes = 0;
	let truncated = false;
	try {
		outer: for (const id of selected) {
			const envelope = await store.read(id, defaultView(id, store.repository));
			for (const file of envelope.sources) {
				if (visited.has(file)) { continue; }
				visited.add(file);
				const target = store.sourcePath(file);
				let text;
				try {
					const size = statSync(target).size;
					if (bytes + size > 4 * 1024 * 1024) { truncated = true; break outer; }
					text = readFileSync(target, 'utf8');
				} catch (error) {
					if (error.code !== 'ENOENT') { throw error; }
					unavailableSources.push(file);
					continue;
				}
				bytes += Buffer.byteLength(text);
				if (bytes > 4 * 1024 * 1024) { truncated = true; break outer; }
				const lines = text.split('\n');
				for (let index = 0; index < lines.length; index++) {
					const position = lines[index].toLowerCase().indexOf(query.toLowerCase());
					if (position < 0) { continue; }
					results.push({ topic: id, file, line: index + 1, text: lines[index].slice(Math.max(0, position - 80), position + 240) });
					if (results.length === limit) { truncated = true; break outer; }
				}
			}
		}
		return { title: bookTitle, checkout: store.root, query, results, truncated, searchedSources: visited.size,
			unavailableSources, incomplete: unavailableSources.length > 0 };
	} finally { store.close(); }
}

export function listDocuments(root, options = {}) {
	const checkout = canonicalRoot(root);
	const library = new DocumentLibrary(checkout);
	try { return { ...library.list(options), checkout }; }
	finally { library.close(); }
}

export function readDocument(root, id, { heading, anchor, limit = 12000 } = {}) {
	const checkout = canonicalRoot(root);
	const library = new DocumentLibrary(checkout);
	try { return { ...documentExcerpt(library.read(id, { heading, anchor }), limit), checkout }; }
	finally { library.close(); }
}
