/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- No-build canvas runtime. */
import { readFileSync, statSync } from 'node:fs';
import { readRepository } from '../adapters/vscode/repository.mjs';
import { bookTitle } from './book.mjs';
import { TopicStore, canonicalRoot } from './store.mjs';
import { defaultView } from './view-state.mjs';
import { DocumentLibrary } from './documents.mjs';
import { documentExcerpt, withoutPresentationData } from '../model/documents.mjs';

export function listTopics(root) {
	const { catalog, projection: { book } } = readRepository(root);
	return { title: book.title, version: book.version, defaultTopic: book.defaultTopic,
		topics: catalog.filter(item => !item.hidden).map(({ id, title, group, subgroup, kind, isDraft, design, aliases, references, navigation = 'topic' }) => ({
			id, title, group, ...(subgroup ? { subgroup } : {}), ...(kind ? { kind } : {}),
			isDraft, ...(design ? { design } : {}), aliases, references, navigation,
		})) };
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
		const documents = result.data.resources.guidance;
		for (const document of documents) {
			if (guidanceBudget <= 0) { break; }
			const source = withoutPresentationData(document.text ?? readFileSync(store.sourcePath(document.file), 'utf8'));
			const text = source.slice(0, guidanceBudget);
			guidanceBudget -= text.length;
			remaining -= text.length;
			guidance.push({ file: document.file, source: document.source, anchor: document.anchor, title: document.title, text, truncated: text.length !== source.length });
		}
		const candidates = result.data.resources.definitions;
		const definitions = [];
		for (const candidate of candidates) {
			const text = JSON.stringify(candidate);
			if (text.length > remaining) { continue; }
			definitions.push(candidate);
			remaining -= text.length;
		}
		const examples = [];
		for (const candidate of result.data.resources.examples) {
			const length = JSON.stringify(candidate).length;
			if (length > remaining) { continue; }
			examples.push(candidate);
			remaining -= length;
		}
		return { title: bookTitle, topic: id, checkout: store.root, revision: result.revision, sources: result.sources.slice(0, 100),
			sourceCount: result.sources.length, coverage: result.coverage, capability: result.capability, summary, guidance, definitions,
			definitionCount: candidates.length, examples, exampleCount: result.data.resources.examples.length,
			...(result.data.library ? { documents: result.data.library.listing } : {}),
			truncated: summary.length < description.length || guidance.length < documents.length || guidance.some(item => item.truncated)
				|| definitions.length < candidates.length || examples.length < result.data.resources.examples.length || result.sources.length > 100 };
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
