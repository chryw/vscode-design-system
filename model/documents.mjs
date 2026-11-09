/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Shared no-build document contracts. */

export const documentFormat = 'vscode-design-document';
export const documentIndexFormat = 'vscode-design-document-index';

export class DocumentError extends Error {
	constructor(code, message) { super(message); this.code = code; }
}

export function isRepositoryPath(value) {
	return typeof value === 'string' && value.length > 0 && !/^(?:\/|[a-z]:)/i.test(value)
		&& !value.includes('\\') && ![...value].some(character => character.charCodeAt(0) < 32)
		&& value.split('/').every(part => part && part !== '.' && part !== '..');
}

export function headingId(title) {
	return title.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
}

export function plainText(text) {
	return text.replace(/!?\[([^\]]*)\]\([^)]+\)/g, '$1').replace(/[*_`]/g, '').trim();
}

export function parseDocument(text, { id, origin = 'book' } = {}) {
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	let start = 0;
	if (lines[0] === '---') {
		const end = lines.indexOf('---', 1);
		const metadata = /^[\w-]+\s*:/.test(lines[1] ?? '');
		if (end < 0 && metadata) { throw new DocumentError('DOCUMENT_PARSE_FAILED', `Unclosed document metadata: ${id}`); }
		if (end >= 0 && metadata) { start = end + 1; }
	}
	const markdown = lines.slice(start).join('\n');
	const headings = [];
	const references = [];
	const counts = new Map();
	let fence;
	let offset = 0;
	let aliases = [];
	for (const [index, line] of lines.slice(start).entries()) {
		const delimiter = line.match(/^\s*(?<marker>`{3,}|~{3,})/);
		if (delimiter) {
			const marker = delimiter.groups.marker;
			if (!fence) { fence = marker; }
			else if (marker[0] === fence[0] && marker.length >= fence.length) { fence = undefined; }
		} else if (!fence) {
			const anchor = line.match(/^\s*<a\s+id=["'](?<id>[\w:-]+)["']\s*>\s*(?:<\/a>)?\s*$/);
			if (anchor) { aliases.push(anchor.groups.id); }
			const underline = line.trim() && lines[start + index + 1]?.match(/^\s*(?<rule>={3,}|-{3,})\s*$/);
			const match = line.match(/^(?<marks>#{1,6})\s+(?<title>.+?)\s*#*\s*$/)
				?? (underline ? { groups: { marks: underline.groups.rule[0] === '=' ? '#' : '##', title: line.trim() } } : undefined);
			if (match) {
				const title = plainText(match.groups.title);
				const base = headingId(title) || 'section';
				const count = counts.get(base) ?? 0;
				counts.set(base, count + 1);
				headings.push({
					id: count ? `${base}-${count}` : base, title, rawTitle: match.groups.title, aliases,
					level: match.groups.marks.length, line: start + index + 1, offset,
					bodyOffset: offset + line.length + 1 + (underline ? lines[start + index + 1].length + 1 : 0), underline: Boolean(underline),
				});
				aliases = [];
			}
			for (const reference of line.matchAll(/`[^`]*`|(?<image>!)?\[(?<label>[^\]]*)\]\((?<target><[^>]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\)/g)) {
				if (!reference.groups.target) { continue; }
				references.push({ target: reference.groups.target.replace(/^<|>$/g, ''), image: Boolean(reference.groups.image) });
			}
			if (headings.length > 1000 || references.length > 1000) { throw new DocumentError('DOCUMENT_LIMIT', `Too many headings or references in ${id}`); }
		}
		offset += line.length + 1;
	}
	const title = headings.find(heading => heading.level === 1)?.title
		?? id?.split('/').slice(-2).join(' / ') ?? 'Document';
	return { format: documentFormat, version: 1, id, title, origin, metadata: start ? lines.slice(1, start - 1).join('\n') : '',
		markdown, headings, references, source: { file: id, line: start + 1 } };
}

export function documentSection(document, { heading, anchor } = {}) {
	if (heading === undefined && anchor === undefined) { return document; }
	if (typeof (heading ?? anchor) !== 'string' || !(heading ?? anchor).trim() || heading !== undefined && anchor !== undefined) {
		throw new DocumentError('DOCUMENT_SECTION_INVALID', 'Select one document heading or anchor');
	}
	const matches = document.headings.filter(item => heading !== undefined
		? item.title === heading || item.rawTitle === heading : item.id === anchor || item.aliases.includes(anchor));
	if (matches.length !== 1) { throw new DocumentError('DOCUMENT_SECTION_INVALID', `Expected one section "${heading ?? anchor}" in ${document.id}; found ${matches.length}`); }
	const selected = matches[0];
	const end = document.headings.find(item => item.offset > selected.offset && item.level <= selected.level)?.offset ?? document.markdown.length;
	return {
		...document,
		title: selected.title,
		markdown: document.markdown.slice(selected.bodyOffset, end).trim(),
		headings: document.headings.filter(item => item.offset > selected.offset && item.offset < end),
		source: { file: document.id, line: selected.line },
		anchor: selected.id,
	};
}

export function resolveDocumentReference(id, target) {
	if (typeof target !== 'string' || !target || target.length > 4096 || /[\u0000-\u001f]/.test(target)) {
		throw new DocumentError('DOCUMENT_REFERENCE_INVALID', 'Invalid document reference');
	}
	if (/^(?:https?:)?\/\//i.test(target)) {
		const url = new URL(target.startsWith('//') ? `https:${target}` : target);
		if (url.username || url.password) { throw new DocumentError('DOCUMENT_REFERENCE_INVALID', 'Document links cannot contain credentials'); }
		return { kind: 'external', href: url.href };
	}
	if (/^[a-z][a-z0-9+.-]*:/i.test(target)) { return { kind: 'unsupported' }; }
	const [rawPath, ...fragment] = target.split('#');
	const anchor = fragment.length ? decodeURIComponent(fragment.join('#')) : '';
	if (!rawPath) { return { kind: 'document', id, anchor }; }
	const relative = decodeURIComponent(rawPath.split('?')[0]).replaceAll('\\', '/');
	const parts = relative.startsWith('/') ? [] : id.split('/').slice(0, -1);
	for (const part of relative.split('/')) {
		if (!part || part === '.') { continue; }
		if (part === '..') {
			if (!parts.length) { throw new DocumentError('DOCUMENT_REFERENCE_INVALID', 'Document reference leaves the repository'); }
			parts.pop();
		} else { parts.push(part); }
	}
	const file = parts.join('/');
	if (!isRepositoryPath(file)) { throw new DocumentError('DOCUMENT_REFERENCE_INVALID', 'Document reference must identify a repository file'); }
	return { kind: file.toLowerCase().endsWith('.md') ? 'document' : 'source', id: file, anchor };
}

export function queryDocuments(index, options = {}) {
	if (!options || typeof options !== 'object' || Array.isArray(options)
		|| Object.keys(options).some(key => !['query', 'scope', 'offset', 'limit'].includes(key))) {
		throw new DocumentError('DOCUMENT_QUERY_INVALID', 'Unknown document query fields');
	}
	const { query = '', scope = '', offset = 0, limit = 30 } = options;
	if (typeof query !== 'string' || query.length > 200 || typeof scope !== 'string'
		|| !Number.isSafeInteger(offset) || offset < 0 || offset > 1000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
		throw new DocumentError('DOCUMENT_QUERY_INVALID', 'Invalid document query or page bounds');
	}
	if (scope && !index.scopes.some(item => item.id === scope)) { throw new DocumentError('DOCUMENT_QUERY_INVALID', `Unknown documentation scope: ${scope}`); }
	const words = [...new Set(query.toLowerCase().trim().split(/\s+/).filter(Boolean))];
	const matches = index.documents.filter(document => (!scope || document.scope === scope)
		&& words.every(word => `${document.title}\n${document.id}\n${document.metadata}\n${document.markdown}`.toLowerCase().includes(word)));
	const phrase = query.trim().toLowerCase();
	const rank = document => {
		if (!phrase) { return 0; }
		const title = document.title.toLowerCase();
		const id = document.id.toLowerCase();
		return id === phrase || title === phrase ? 0 : title.includes(phrase) ? 1
			: words.every(word => title.includes(word)) ? 2 : id.includes(phrase) ? 3 : 4;
	};
	matches.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title, 'en') || a.id.localeCompare(b.id, 'en'));
	const results = matches.slice(offset, offset + limit).map(document => {
		const lines = document.markdown.split('\n');
		const matching = words.length ? lines.find(line => !/^(?:#|<|```|~~~)/.test(line.trim()) && words.some(word => line.toLowerCase().includes(word))) : undefined;
		const description = matching ?? lines.find(line => line.trim() && !/^(?:#|<|```|~~~)/.test(line.trim())) ?? '';
		return {
			id: document.id, title: document.title, origin: document.origin, scope: document.scope,
			revision: document.revision, source: document.source, excerpt: plainText(description).slice(0, 240),
		};
	});
	return {
		format: documentIndexFormat, version: 1, revision: index.revision, scopes: index.scopes,
		query, scope, offset, limit, total: matches.length, indexed: index.documents.length,
		nextOffset: offset + results.length < matches.length ? offset + results.length : undefined,
		results, diagnostics: index.diagnostics, complete: index.diagnostics.length === 0,
	};
}

export function documentView(index, view) {
	const listing = queryDocuments(index, { query: view.query ?? '', scope: view.documentScope ?? '', offset: view.documentOffset ?? 0 });
	const document = view.documentId ? index.documents.find(item => item.id === view.documentId) : undefined;
	if (view.documentId && !document) { throw new DocumentError('DOCUMENT_NOT_FOUND', `Document is not available in the configured library: ${view.documentId}`); }
	return { listing, document };
}

export function documentExcerpt(document, limit = 12000) {
	if (!Number.isSafeInteger(limit) || limit < 100 || limit > 24000) {
		throw new DocumentError('DOCUMENT_QUERY_INVALID', 'Document read limit must be 100–24000 characters');
	}
	const metadata = document.metadata.slice(0, Math.floor(limit / 4));
	const markdown = document.markdown.slice(0, limit - metadata.length);
	return {
		format: documentFormat, version: 1, id: document.id, title: document.title, origin: document.origin, scope: document.scope,
		revision: document.revision, source: document.source, anchor: document.anchor,
		metadata, markdown,
		headings: document.headings.slice(0, 200).map(({ id, title, level, line }) => ({ id, title, level, line })),
		headingCount: document.headings.length, truncated: metadata.length < document.metadata.length || markdown.length < document.markdown.length || document.headings.length > 200,
	};
}
