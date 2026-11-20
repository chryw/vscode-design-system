/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- No-build canvas runtime. */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { validateBook as validateCatalogBook } from '../model/catalog.mjs';
import { contained, workspaceRoot } from './paths.mjs';
import { basicBook } from '../adapters/vscode/basic-book.mjs';

export const bookTitle = 'Visual Studio Code Design System';
export const bookId = 'vscode-design-system';
export const repositoryDirectory = '.github/skills/design-system';
export const legacyRepositoryDirectory = '.github/design-system';

export function repositoryDirectoryFor(root = workspaceRoot) {
	const directory = path.join(root, repositoryDirectory);
	return existsSync(path.join(directory, 'foundations')) || existsSync(path.join(directory, 'patterns'))
		? directory : path.join(root, legacyRepositoryDirectory);
}

function checkoutForBookDirectory(root) {
	return path.basename(root) === 'design-system' && path.basename(path.dirname(root)) === 'skills'
		? path.resolve(root, '../../..') : undefined;
}

function readSpecMetadata(root, file, expectedKind) {
	const target = contained(root, file);
	if (statSync(target).size > 1024 * 1024) { throw new Error(`Design specification is too large: ${file}`); }
	const text = readFileSync(target, 'utf8');
	const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
	if (!match || Buffer.byteLength(match[1]) > 64 * 1024) { throw new Error(`${file}: missing or oversized YAML front matter`); }
	const { load } = createRequire(path.join(workspaceRoot, 'package.json'))('js-yaml');
	const metadata = load(match[1]);
	const id = metadata?.id ?? path.posix.basename(file, '.design.md');
	const allowedKinds = expectedKind === 'component' ? ['primitive', 'composite'] : [expectedKind];
	if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
		|| typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)
		|| typeof metadata.title !== 'string' || !metadata.title.trim()
		|| !allowedKinds.includes(metadata.kind)
		|| !['draft', 'stable', 'deprecated'].includes(metadata.status)
		|| metadata.order !== undefined && (!Number.isInteger(metadata.order) || metadata.order < 0)
		|| metadata.hidden !== undefined && typeof metadata.hidden !== 'boolean'
		|| metadata.replacedBy !== undefined && (typeof metadata.replacedBy !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.replacedBy))
		|| metadata.status === 'deprecated' && metadata.replacedBy === undefined
		|| metadata.status !== 'deprecated' && metadata.replacedBy !== undefined
		|| metadata.references !== undefined && !Array.isArray(metadata.references)
		|| ['aliases', 'legacyPaths'].some(key => metadata[key] !== undefined
			&& (!Array.isArray(metadata[key]) || metadata[key].some(value => typeof value !== 'string' || !value.trim())
				|| new Set(metadata[key]).size !== metadata[key].length))) {
		throw new Error(`${file}: invalid design specification metadata`);
	}
	return {
		id, path: file, title: metadata.title.trim(), kind: metadata.kind, status: metadata.status,
		aliases: metadata.aliases ?? [], legacyPaths: metadata.legacyPaths ?? [], replacedBy: metadata.replacedBy,
		order: metadata.order, hidden: metadata.hidden, references: metadata.references ?? [],
	};
}

function compareSpecs(a, b) {
	const order = { foundation: 0, pattern: 1, primitive: 2, composite: 3 };
	return order[a.kind] - order[b.kind] || (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
		|| a.title.localeCompare(b.title) || a.path.localeCompare(b.path);
}

export function discoverDesignSpecs(root) {
	const specs = [];
	for (const [directory, kind] of [
		[`${repositoryDirectory}/foundations`, 'foundation'],
		[`${repositoryDirectory}/patterns`, 'pattern'],
		['src/vs', 'component'],
	]) {
		const visit = relative => {
			for (const entry of readdirSync(contained(root, relative), { withFileTypes: true })
				.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
				const file = `${relative}/${entry.name}`;
				if (entry.isSymbolicLink()) { continue; }
				if (entry.isDirectory()) { visit(file); }
				else if (entry.isFile() && entry.name.endsWith('.design.md')) {
					specs.push(readSpecMetadata(root, file, kind));
				}
			}
		};
		visit(directory);
	}
	const ids = new Map(specs.map(spec => [spec.id, spec]));
	if (ids.size !== specs.length) { throw new Error('Duplicate design specification id'); }
	const aliases = new Map();
	const orders = new Map();
	for (const spec of specs) {
		if (spec.order !== undefined) {
			const key = `${spec.kind}:${spec.order}`;
			if (orders.has(key)) { throw new Error(`Duplicate design specification order ${key}`); }
			orders.set(key, spec.path);
		}
		for (const alias of [...spec.aliases, ...spec.legacyPaths]) {
			if (ids.has(alias) || aliases.has(alias)) { throw new Error(`Duplicate design specification alias '${alias}'`); }
			aliases.set(alias, spec.id);
		}
	}
	for (const spec of specs) {
		if (spec.replacedBy && (!ids.has(spec.replacedBy) || ids.get(spec.replacedBy).status === 'deprecated')) {
			throw new Error(`${spec.path}: replacement '${spec.replacedBy}' must identify a nondeprecated specification`);
		}
	}
	return specs.sort(compareSpecs);
}

function rendererFor(spec) {
	if (spec.kind === 'primitive' || spec.kind === 'composite') { return 'components'; }
	return {
		typography: 'typography', layout: 'foundations', spacing: 'foundations',
		shape: 'foundations', size: 'foundations', stroke: 'foundations', colors: 'foundations',
		elevation: 'foundations', theming: 'theming', iconography: 'icons', motion: 'motion', tokens: 'tokens',
	}[spec.id] ?? 'guidance';
}

/** Shared chapters whose viewer renderers embed live component examples and therefore need the fixture service. */
const liveExampleChapters = new Set(['colors', 'spacing', 'motion']);

export function readGeneratedBook(root) {
	const read = file => {
		const target = contained(root, file);
		if (statSync(target).size > 1024 * 1024) { throw new Error(`Repository metadata is too large: ${file}`); }
		return readFileSync(target, 'utf8');
	};
	const json = file => JSON.parse(read(`${repositoryDirectory}/${file}`));
	const specs = discoverDesignSpecs(root);
	if (!specs.length) { return undefined; }
	const byId = new Map(specs.map(spec => [spec.id, spec]));
	const shared = specs.filter(spec => spec.kind === 'foundation' || spec.kind === 'pattern');
	const topics = shared.map(spec => ({
		id: spec.id, title: spec.title, group: spec.kind === 'foundation' ? 'Foundations' : 'Patterns',
		section: spec.id, renderer: rendererFor(spec), aliases: [...spec.aliases, ...spec.legacyPaths],
		compare: spec.status !== 'deprecated', fixture: liveExampleChapters.has(spec.id),
		hidden: spec.status === 'deprecated' || spec.hidden === true, kind: spec.kind,
		status: spec.status, ...(spec.replacedBy ? { replacedBy: spec.replacedBy } : {}),
		page: `content/topics/${spec.id}.json`, references: spec.references,
	}));
	const components = json('content/topics/components.json');
	const documentation = json('content/topics/documentation.json');
	const documentSources = json('content/document-sources.json');
	const documentAliases = json('content/legacy-document-paths.json');
	if (!documentAliases || typeof documentAliases !== 'object' || Array.isArray(documentAliases)) {
		throw new Error('Invalid document aliases; use direct repository Markdown paths');
	}
	for (const spec of specs) {
		const replacement = spec.status === 'deprecated' ? byId.get(spec.replacedBy) : spec;
		for (const legacyPath of spec.legacyPaths) {
			if (legacyPath.endsWith('.md')) { documentAliases[legacyPath] = replacement.path; }
		}
	}
	topics.push({
		id: documentation.id, title: documentation.title ?? 'Source library', group: 'Guidance',
		section: documentation.id, renderer: documentation.renderer, aliases: documentation.aliases ?? [],
		compare: documentation.compare ?? false, fixture: false, navigation: 'utility',
		page: 'content/topics/documentation.json',
	});
	const visible = topics.filter(topic => !topic.hidden);
	const lastPattern = visible.filter(topic => topic.group === 'Patterns').at(-1) ?? visible.at(-1);
	return {
		book: validateBook({
			version: 1, id: bookId, title: bookTitle,
			defaultTopic: shared.find(spec => spec.kind === 'foundation' && spec.status !== 'deprecated')?.id ?? documentation.id,
			topics, components: { after: lastPattern?.id ?? documentation.id, page: 'content/topics/components.json' },
			documentSources, documentAliases,
			references: Object.fromEntries(shared.filter(spec => spec.references.length).map(spec => [spec.id, spec.references])),
		}),
		specs,
	};
}

export function validateBook(book) {
	if (!book || book.version !== 1 || book.id !== bookId || book.title !== bookTitle
		|| !Array.isArray(book.topics) || !book.topics.length || book.topics.length > 200) {
		throw new Error('Invalid Visual Studio Code Design System manifest or unsupported version');
	}
	for (const topic of validateCatalogBook(book)) {
		if (topic.id.length > 100 || topic.title.length > 200 || topic.aliases.length > 100
			|| topic.aliases.some(alias => alias.length > 200)
			|| new Set(topic.aliases).size !== topic.aliases.length
			|| !/^[a-z][a-z0-9-]*$/.test(topic.section)) {
			throw new Error(`Invalid book topic: ${topic.id}`);
		}
	}
	return book;
}

export function readBookSource(read) {
	for (const file of ['topics.json', 'book.json']) {
		let text;
		try { text = read(file); }
		catch (error) {
			if (error.code === 'ENOENT') { continue; }
			throw error;
		}
		try { return { file, book: validateBook(JSON.parse(text)) }; }
		catch (error) { throw new Error(`Couldn't read ${file}: ${error.message}`); }
	}
}

export function readBook(root = repositoryDirectoryFor(workspaceRoot)) {
	return readBookSource(file => {
		const target = contained(root, file);
		if (statSync(target).size > 1024 * 1024) { throw new Error('Topic map is too large'); }
		return readFileSync(target, 'utf8');
	})?.book ?? (checkoutForBookDirectory(root) ? readGeneratedBook(checkoutForBookDirectory(root))?.book : undefined)
		?? basicBook(checkoutForBookDirectory(root) ? repositoryDirectory : legacyRepositoryDirectory);
}

export function contentAssets(root = repositoryDirectoryFor(workspaceRoot)) {
	const files = new Set();
	const collect = relative => {
		let entries;
		try { entries = readdirSync(contained(root, relative), { withFileTypes: true }); }
		catch (error) { if (error.code === 'ENOENT') { return; } throw error; }
		for (const entry of entries) {
			const file = `${relative}/${entry.name}`;
			if (entry.isDirectory()) { collect(file); }
			else if (entry.isFile() && /\.(?:json|md)$/.test(entry.name)) {
				contained(root, file);
				files.add(file);
				if (files.size > 1000) { throw new Error('Too many book content files'); }
			}
		}
	};
	collect('content');
	collect('pages');
	return files;
}
