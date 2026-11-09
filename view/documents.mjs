/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- No-build document views. */
import { DocumentError, resolveDocumentReference } from '../model/documents.mjs';
import { markdown } from './markdown.mjs';
import { node } from './ui.mjs';

export function documentURL(id = '', { anchor = '', query = '', documentScope = '', documentOffset = 0 } = {}) {
	const parameters = new URLSearchParams({ section: 'documentation', mode: 'all' });
	if (id) { parameters.set('documentId', id); }
	if (query) { parameters.set('query', query); }
	if (documentScope) { parameters.set('documentScope', documentScope); }
	if (documentOffset) { parameters.set('documentOffset', String(documentOffset)); }
	return `/?${parameters}${id && anchor ? `#${encodeURIComponent(anchor)}` : ''}`;
}

export function documentMarkup(document, options = {}) {
	return markdown(document.markdown, options.level ?? 2, {
		anchors: true, paragraphs: true, headings: document.headings, prefix: options.prefix, skipTitle: options.skipTitle,
		resolveReference: (target, image) => {
			let reference;
			try { reference = resolveDocumentReference(document.id, target); }
			catch (error) {
				if (!(error instanceof DocumentError || error instanceof URIError || error instanceof TypeError)) { throw error; }
				return { problem: error.message };
			}
			if (reference.kind === 'unsupported') { return { problem: 'Unsupported document link protocol' }; }
			if (reference.kind === 'external') { return { href: reference.href, external: true }; }
			if (image) {
				return options.resolveResource?.(document.id, target, true)
					?? { href: `/api/document-resource?id=${encodeURIComponent(document.id)}&target=${encodeURIComponent(target)}`, image: true };
			}
			if (reference.kind === 'document') { return { href: documentURL(reference.id, { ...options.view, anchor: reference.anchor }) }; }
			return options.resolveResource?.(document.id, target, false)
				?? { href: `/api/document-resource?id=${encodeURIComponent(document.id)}&target=${encodeURIComponent(target)}`, external: true };
		},
	});
}

export function renderSourceSections(target, sections = [], resolveResource) {
	const linkedDocuments = new Set();
	for (const document of sections) {
		const section = node('section', undefined, 'article-section source-guidance');
		section.id = document.sectionId;
		section.append(node('h2', document.title), documentMarkup(document, { level: 3, prefix: `${document.sectionId}-`, resolveResource }));
		if (!linkedDocuments.has(document.id)) {
			const source = node('a', 'Read full specification', 'source-action');
			source.href = documentURL(document.id, { anchor: document.anchor });
			section.append(source);
			linkedDocuments.add(document.id);
		}
		if (document.before) {
			const next = target.querySelector(`#${CSS.escape(document.before)}`);
			if (!next) { throw new Error(`Missing guidance placement target: ${document.before}`); }
			next.before(section);
		} else {
			target.append(section);
		}
	}
}

export function renderDocumentation(target, system, host = {}) {
	const { listing, document } = system.library;
	const view = system.view;
	const page = node('div', undefined, 'documentation');
	if (document) {
		const back = node('a', 'Back to documentation');
		back.href = documentURL('', view);
		const metadata = node('p', `${listing.scopes.find(scope => scope.id === document.scope)?.title ?? document.origin} · ${document.id}`, 'meta document-path');
		page.append(back, metadata);
		if (document.metadata) {
			const details = node('details');
			details.append(node('summary', 'Document metadata'), node('pre', document.metadata));
			page.append(details);
		}
		page.append(documentMarkup(document, { skipTitle: true, prefix: 'document-', view, resolveResource: host.documentResource }));
		target.append(page);
		return 1;
	}
	const form = node('form', undefined, 'document-search');
	form.method = 'get';
	form.action = '/';
	const mode = new URL(location.href).searchParams.get('mode') === 'focused' ? 'focused' : 'all';
	for (const [name, value] of [['section', 'documentation'], ['mode', mode]]) {
		const field = node('input');
		field.type = 'hidden'; field.name = name; field.value = value; form.append(field);
	}
	const label = node('label', 'Search documentation');
	const search = node('input');
	search.type = 'search'; search.name = 'query'; search.maxLength = 200; search.value = listing.query;
	label.append(search);
	const filterLabel = node('label', 'Source');
	const filter = node('select');
	filter.name = 'documentScope';
	for (const scope of [{ id: '', title: 'All sources' }, ...listing.scopes]) {
		const option = node('option', scope.title);
		option.value = scope.id; option.selected = scope.id === listing.scope; filter.append(option);
	}
	filterLabel.append(filter);
	const submit = node('button', 'Search');
	submit.type = 'submit';
	form.append(label, filterLabel, submit);
	page.append(form, node('p', `${listing.total} matching documents · ${listing.indexed} indexed`, 'meta'));
	if (!listing.complete) {
		const problems = node('details', undefined, 'document-diagnostics');
		problems.append(node('summary', 'Some sources could not be indexed'));
		const list = node('ul');
		for (const diagnostic of listing.diagnostics) { list.append(node('li', `${diagnostic.file}: ${diagnostic.reason}`)); }
		problems.append(list); page.append(problems);
	}
	const results = node('ul', undefined, 'document-results');
	for (const result of listing.results) {
		const item = node('li');
		const link = node('a', result.title);
		link.href = documentURL(result.id, view);
		item.append(link, node('p', result.id, 'meta document-path'));
		if (result.excerpt) { item.append(node('p', result.excerpt)); }
		results.append(item);
	}
	page.append(results);
	if (!listing.results.length) {
		page.append(node('p', listing.total ? 'This result page is no longer available.' : 'No documents match this search. Try another term or source.'));
		if (listing.total) {
			const first = node('a', 'Return to the first page');
			first.href = documentURL('', { ...view, documentOffset: 0 });
			page.append(first);
		}
	}
	const pagination = node('nav', undefined, 'tools');
	pagination.setAttribute('aria-label', 'Documentation pages');
	for (const [title, offset] of [['Previous results', listing.offset ? Math.max(0, listing.offset - listing.limit) : undefined], ['Next results', listing.nextOffset]]) {
		if (offset === undefined) { continue; }
		const link = node('a', title);
		link.href = documentURL('', { ...view, documentOffset: offset });
		pagination.append(link);
	}
	page.append(pagination);
	target.append(page);
	return listing.total;
}
