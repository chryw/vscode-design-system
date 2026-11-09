/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import { documentSection, isRepositoryPath, parseDocument } from '../../../model/documents.mjs';

export const bookRoot = '.github/design-system/';

export function contentPath(file) {
	if (typeof file !== 'string' || !/^(?:content|pages)\/[a-z0-9/-]+\.(?:json|md)$/.test(file)
		|| file.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
		throw new Error(`Invalid book content path: ${file}`);
	}
	return `${bookRoot}${file}`;
}

export function sourcePath(file) {
	if (!isRepositoryPath(file) || !file.toLowerCase().endsWith('.md') || file.startsWith('.github/extensions/')) {
		throw new Error(`Invalid book source reference: ${file}`);
	}
	return file;
}

export function markdownSection(text, heading, file) {
	if (typeof heading !== 'string' || !heading.trim()) { throw new Error(`Invalid content heading in ${file}`); }
	const result = documentSection(parseDocument(text, { id: file }), { heading }).markdown;
	if (!result) { throw new Error(`Empty content section "${heading}" in ${file}`); }
	return result;
}

export function resolveContent(value, read, depth = 0) {
	if (depth > 20) { throw new Error('Book content nesting exceeds the supported depth'); }
	if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) { return value; }
	if (Array.isArray(value)) { return value.map(item => resolveContent(item, read, depth + 1)); }
	if (!value || typeof value !== 'object') { throw new Error('Invalid book content value'); }
	if (Object.hasOwn(value, '$text')) {
		const reference = value.$text;
		if (Object.keys(value).length !== 1 || !reference || typeof reference !== 'object'
			|| Object.keys(reference).some(key => !['file', 'heading', 'paragraph', 'list'].includes(key))
			|| typeof reference.file !== 'string' || !reference.file.endsWith('.md')
			|| reference.paragraph !== undefined && (!Number.isInteger(reference.paragraph) || reference.paragraph < 0)
			|| reference.list !== undefined && reference.list !== true
			|| reference.list && reference.paragraph !== undefined) {
			throw new Error('Invalid Markdown content reference');
		}
		const file = reference.file.startsWith('content/') ? contentPath(reference.file) : sourcePath(reference.file);
		const text = markdownSection(read(file), reference.heading, file);
		if (reference.list) {
			const rows = text.split('\n').filter(line => line.trim());
			if (!rows.length || rows.some(line => !line.startsWith('- '))) {
				throw new Error(`Content section is not a list: ${file}, ${reference.heading}`);
			}
			return rows.map(line => line.slice(2));
		}
		if (reference.paragraph === undefined) { return text; }
		const paragraph = text.split(/\n\s*\n/)[reference.paragraph];
		if (!paragraph) { throw new Error(`Missing content paragraph: ${file}, ${reference.heading}, ${reference.paragraph}`); }
		return paragraph;
	}
	if (Object.keys(value).some(key => key.startsWith('$') || ['__proto__', 'constructor', 'prototype'].includes(key))) {
		throw new Error('Unsupported book content binding');
	}
	return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolveContent(child, read, depth + 1)]));
}

export function readContent(read, file) {
	const value = JSON.parse(read(contentPath(file)));
	if (value?.version !== 1 || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Invalid book content version: ${file}`);
	}
	return resolveContent(value, read);
}

function validateChapter(authored, topic) {
	const text = value => typeof value === 'string' && value.trim().length > 0;
	const rows = (value, columns) => Array.isArray(value) && value.length > 0
		&& value.every(row => Array.isArray(row) && row.length === columns && row.every(text));
	const requiredSections = {
		principles: ['practice'], typography: ['composition', 'emphasis', 'styles', 'metrics', 'families'],
		spacing: ['grouping', 'ownership', 'patterns', 'product', 'responsive', 'ramp'],
		shape: ['roles', 'scale'], size: ['glyphs', 'reference'], stroke: ['usage', 'reference'],
		layout: ['hierarchy', 'responsive'], elevation: ['tiers', 'shadows', 'guidance', 'role'],
		theming: ['guidance', 'comparison'], colors: ['usage', 'surfaces', 'accent', 'feedback', 'states', 'palette'],
	};
	if (authored.id !== topic || authored.status !== 'book-authored' || !text(authored.intro) || !authored.sections || Array.isArray(authored.sections)
		|| typeof authored.sections !== 'object' || (requiredSections[topic] ?? []).some(id => !authored.sections[id])
		|| Object.values(authored.sections).some(section => !section || !text(section.title) || !text(section.description)
			|| !Array.isArray(section.paragraphs) || !section.paragraphs.every(text))
		|| topic === 'typography' && (!text(authored.sampleText) || !text(authored.baseline) || !rows(authored.composition, 2))
		|| topic === 'spacing' && (!rows(authored.relationships, 2) || !rows(authored.ownership, 2) || !text(authored.preview?.control) || !text(authored.preview?.summary))
		|| topic === 'shape' && (!Array.isArray(authored.contexts) || !authored.contexts.length || authored.contexts.some(context =>
			!context || !['control', 'contained', 'overlay'].includes(context.kind) || !text(context.label) || !text(context.token)))
		|| topic === 'elevation' && !rows(authored.roles, 3)
		|| topic === 'theming' && !text(authored.specimen)
		|| topic === 'colors' && (!rows(authored.roles, 2) || !rows(authored.statusRoles, 2)
			|| !['surfaces', 'accent', 'feedback', 'states'].every(id => rows([authored.previews?.[id]], 2)))
		|| ['accessibility', 'content'].includes(topic) && (!Array.isArray(authored.headingOrder) || !authored.headingOrder.length || !authored.headingOrder.every(text))) {
		throw new Error(`Invalid authored chapter: ${topic}`);
	}
}

export function readPage(read, topic) {
	const manifest = JSON.parse(read(`${bookRoot}book.json`));
	if (manifest?.version !== 1 || !Array.isArray(manifest.topics) || manifest.topics.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
		throw new Error('Invalid book manifest');
	}
	const topics = manifest.topics.filter(item => item.section === topic);
	const bindings = new Set(topics.map(item => item.page));
	if (!topics.length || bindings.size !== 1) { throw new Error(`Missing or conflicting page binding: ${topic}`); }
	const [binding] = bindings;
	const page = JSON.parse(read(contentPath(binding)));
	if (page?.version !== 1 || page.id !== topic || typeof page.renderer !== 'string'
		|| topics.some(topic => topic.renderer !== page.renderer)
		|| !Array.isArray(page.sources) || page.sources.some(item => !item || typeof item.file !== 'string'
			|| item.heading !== undefined && typeof item.heading !== 'string'
			|| Object.keys(item).some(key => !['file', 'heading'].includes(key)))
		|| !Array.isArray(page.sections) || page.sections.some(item => !item || typeof item.id !== 'string'
			|| !/^[a-z][a-z0-9-]*$/.test(item.id) || typeof item.title !== 'string' || !item.title)
		|| new Set(page.sections.map(item => item.id)).size !== page.sections.length
		|| typeof page.content !== 'string' || !page.content.startsWith('content/') || !page.content.endsWith('.json')) {
		throw new Error(`Invalid book page: ${topic}`);
	}
	for (const reference of page.sources) {
		const file = sourcePath(reference.file);
		const text = read(file);
		if (reference.heading !== undefined) { markdownSection(text, reference.heading, file); }
	}
	const authored = readContent(read, page.content);
	validateChapter(authored, topic);
	const sourceBindings = page.guidance ?? [];
	if (!Array.isArray(sourceBindings) || sourceBindings.length > 20 || new Set(sourceBindings.map(binding => binding?.id)).size !== sourceBindings.length) {
		throw new Error(`Invalid source-section bindings: ${topic}`);
	}
	const sourceSections = sourceBindings.map(binding => {
		if (!binding || typeof binding.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(binding.id)
			|| typeof binding.file !== 'string' || binding.title !== undefined && typeof binding.title !== 'string'
			|| binding.before !== undefined && (typeof binding.before !== 'string' || !/^[a-z][a-z0-9-]*$/.test(binding.before))
			|| Object.keys(binding).some(key => !['id', 'file', 'heading', 'anchor', 'title', 'before'].includes(key))) {
			throw new Error(`Invalid source-section binding in ${topic}`);
		}
		const file = binding.file.startsWith('content/') ? contentPath(binding.file) : sourcePath(binding.file);
		const document = documentSection(parseDocument(read(file), { id: file }), binding);
		return { ...document, sectionId: binding.id, title: binding.title ?? document.title, before: binding.before };
	});
	return { page, authored, sourceSections };
}
