/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- No-build authored-document discovery. */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, statSync, watch } from 'node:fs';
import path from 'node:path';
import { contained } from './paths.mjs';
import { readBook } from './book.mjs';
import { DocumentError, documentSection, documentView, isRepositoryPath, parseDocument, queryDocuments, resolveDocumentReference } from '../model/documents.mjs';

const bookPrefix = '.github/design-system/';
const ignoredDirectories = new Set(['.git', 'node_modules', '.build', 'out', 'dist', 'vendor']);
const maximumDocumentBytes = 256 * 1024;
const maximumCorpusBytes = 16 * 1024 * 1024;
const maximumDocuments = 1000;
const imageTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const sourceExtensions = new Set(['.md', '.ts', '.js', '.mjs', '.cjs', '.css', '.json', '.jsonc', '.yml', '.yaml']);
const digest = text => createHash('sha256').update(text).digest('hex');

export class DocumentLibrary {
	constructor(root, { bookRoot = contained(root, '.github/design-system'), onChange = () => {}, onError = () => {}, watchFactory = watch } = {}) {
		this.root = root;
		this.bookRoot = bookRoot;
		this.onChange = onChange;
		this.onError = onError;
		this.watchFactory = watchFactory;
		this.watchers = new Map();
		this.directories = new Map();
		this.recursive = ['darwin', 'win32'].includes(process.platform);
		this.closed = false;
		this.active = false;
		this.index = undefined;
		this.readScopes();
	}
	readScopes() {
		const scopes = readBook(this.bookRoot).documentSources;
		if (!Array.isArray(scopes) || !scopes.length || scopes.length > 12
			|| new Set(scopes.map(scope => scope?.id)).size !== scopes.length) { throw new Error('Invalid authored-document discovery scopes'); }
		for (const scope of scopes) {
			if (!scope || typeof scope.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(scope.id)
				|| Object.keys(scope).some(key => !['id', 'title', 'root', 'origin', 'fileName', 'excludeDirectories'].includes(key))
				|| typeof scope.title !== 'string' || !scope.title || scope.title.length > 200 || !isRepositoryPath(scope.root) || scope.root.length > 2048
				|| scope.root.split('/').some(part => ignoredDirectories.has(part))
				|| !['product', 'instruction', 'skill', 'book'].includes(scope.origin)
				|| scope.fileName !== undefined && (typeof scope.fileName !== 'string' || !/^[\w.-]+\.md$/i.test(scope.fileName))
				|| scope.excludeDirectories !== undefined && (!Array.isArray(scope.excludeDirectories) || scope.excludeDirectories.length > 20
					|| scope.excludeDirectories.some(name => typeof name !== 'string' || !/^[\w.-]+$/.test(name)))) {
				throw new Error(`Invalid documentation scope: ${scope?.id}`);
			}
			this.sourcePath(scope.root);
		}
		const changed = JSON.stringify(this.scopes) !== JSON.stringify(scopes);
		this.scopes = scopes;
		if (changed && this.active) { this.setActive(false); this.setActive(true); }
	}
	sourcePath(file) {
		return file.startsWith(bookPrefix) ? contained(this.bookRoot, file.slice(bookPrefix.length)) : contained(this.root, file);
	}
	invalidate(notify = false) {
		this.index = undefined;
		if (notify && !this.closed) {
			clearTimeout(this.timer);
			this.timer = setTimeout(() => { if (!this.closed) { this.onChange(); } }, 100);
		}
	}
	setActive(active) {
		if (this.closed || this.active === active) { return; }
		this.active = active;
		for (const watcher of this.watchers.values()) { watcher.close(); }
		this.watchers.clear();
		this.invalidate();
		if (!active) { clearTimeout(this.timer); this.directories.clear(); return; }
		try {
			this.snapshot();
		} catch (error) {
			for (const watcher of this.watchers.values()) { watcher.close(); }
			this.watchers.clear();
			this.active = false;
			throw error;
		}
	}
	updateWatchers() {
		const directories = this.recursive ? new Map() : this.directories;
		if (this.recursive) {
			for (const scope of this.scopes) {
				let directory = this.sourcePath(scope.root);
				while (!existsSync(directory)) { directory = path.dirname(directory); }
				const scopes = directories.get(directory) ?? [];
				scopes.push(scope); directories.set(directory, scopes);
			}
		}
		if (directories.size > 8192) { throw new Error('Documentation discovery exceeds its watch-directory limit; narrow documentSources'); }
		for (const [directory, watcher] of this.watchers) {
			if (!directories.has(directory)) { watcher.close(); this.watchers.delete(directory); }
		}
		for (const [directory, scopes] of directories) {
			if (this.watchers.has(directory)) { continue; }
			const watcher = this.watchFactory(directory, { recursive: this.recursive }, (event, file) => {
				if (this.closed || !this.active) { return; }
				const relative = file ? String(file) : '';
				const segments = relative.split(/[\\/]/);
				if (segments.some(segment => ignoredDirectories.has(segment))
					|| scopes.every(scope => segments.some(segment => scope.excludeDirectories?.includes(segment)))) { return; }
				if (!file || relative.toLowerCase().endsWith('.md')) { this.invalidate(true); return; }
				if (event !== 'rename') { return; }
				const target = path.join(directory, relative);
				try {
					if (this.directories.has(target) || !path.extname(relative) || statSync(target).isDirectory()) { this.invalidate(true); }
				} catch (error) {
					if (error.code !== 'ENOENT') { this.onError(new Error(`Couldn't inspect documentation change: ${error.message}`)); }
				}
			});
			watcher.on('error', error => this.onError(new Error(`Documentation watcher failed: ${error.message}`)));
			this.watchers.set(directory, watcher);
		}
	}
	snapshot({ refresh = false } = {}) {
		if (this.closed) { throw new Error('Documentation library stopped'); }
		if (refresh) { this.invalidate(); this.readScopes(); }
		if (this.index) { return this.index; }
		const documents = [];
		const diagnostics = [];
		const seen = new Set();
		const directories = new Map();
		let bytes = 0;
		let entries = 0;
		const visit = (relative, scope, depth = 0) => {
			if (depth > 24) { throw new Error(`Documentation discovery exceeds its depth limit: ${relative}`); }
			let children;
			try { children = readdirSync(this.sourcePath(relative), { withFileTypes: true }); }
			catch (error) {
				if (error.code !== 'ENOENT') { throw error; }
				diagnostics.push({ file: relative, reason: 'missing-directory' });
				let parent = this.sourcePath(relative);
				while (!existsSync(parent)) { parent = path.dirname(parent); }
				directories.set(parent, [...(directories.get(parent) ?? []), scope]);
				return;
			}
			const directory = this.sourcePath(relative);
			directories.set(directory, [...(directories.get(directory) ?? []), scope]);
			for (const child of children.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
				if (++entries > 100000) { throw new Error('Documentation discovery exceeds its directory-entry limit'); }
				if (child.name.startsWith('.') || ignoredDirectories.has(child.name) || scope.excludeDirectories?.includes(child.name)) { continue; }
				const file = `${relative}/${child.name}`;
				if (child.isSymbolicLink()) {
					if (!path.extname(child.name) || child.name.toLowerCase().endsWith('.md')) { diagnostics.push({ file, reason: 'symlink-excluded' }); }
					continue;
				}
				if (child.isDirectory()) { visit(file, scope, depth + 1); continue; }
				if (!child.isFile() || !child.name.toLowerCase().endsWith('.md') || scope.fileName && child.name !== scope.fileName || seen.has(file)) { continue; }
				seen.add(file);
				const target = this.sourcePath(file);
				try {
					const size = statSync(target).size;
					if (size > maximumDocumentBytes) { diagnostics.push({ file, reason: 'document-too-large' }); continue; }
					const text = readFileSync(target, 'utf8');
					bytes += Buffer.byteLength(text);
					if (Buffer.byteLength(text) > maximumDocumentBytes) { diagnostics.push({ file, reason: 'document-too-large' }); continue; }
					if (documents.length >= maximumDocuments || bytes > maximumCorpusBytes) { throw new Error('Documentation corpus exceeds its configured safety limit'); }
					documents.push({ ...parseDocument(text, { id: file, origin: scope.origin }), scope: scope.id, revision: digest(text) });
				} catch (error) {
					if (error.code === 'ENOENT') { diagnostics.push({ file, reason: 'missing-document' }); }
					else if (error instanceof DocumentError) { diagnostics.push({ file, reason: error.code, message: error.message }); }
					else { throw error; }
				}
			}
		};
		for (const scope of this.scopes) { visit(scope.root, scope); }
		documents.sort((a, b) => a.title.localeCompare(b.title, 'en') || a.id.localeCompare(b.id, 'en'));
		this.index = {
			version: 1, revision: digest(JSON.stringify({ documents: documents.map(({ id, revision }) => [id, revision]), scopes: this.scopes, diagnostics })),
			scopes: this.scopes.map(({ id, title, origin, root, fileName, excludeDirectories }) => ({ id, title, origin, root, fileName, excludeDirectories })), documents, diagnostics,
		};
		this.directories = directories;
		if (this.active) {
			try { this.updateWatchers(); }
			catch (error) { this.index = undefined; throw error; }
		}
		return this.index;
	}
	list(options) { return queryDocuments(this.snapshot({ refresh: !this.active }), options); }
	project(view, options = {}) { return documentView(this.snapshot({ refresh: !this.active, ...options }), view); }
	read(id, options = {}) {
		if (typeof id !== 'string' || !id || id.length > 2048) { throw new DocumentError('DOCUMENT_QUERY_INVALID', 'Expected a discovered repository-relative document ID'); }
		const document = this.snapshot({ refresh: !this.active }).documents.find(document => document.id === id);
		if (!document) { throw new DocumentError('DOCUMENT_NOT_FOUND', `Document is not available in the configured library: ${id}`); }
		return documentSection(document, options);
	}
	resource(id, target) {
		return this.documentResource(this.read(id), target);
	}
	documentResource(document, target) {
		const id = document.id;
		const reference = document.references.find(reference => reference.target === target);
		if (!reference) { throw new DocumentError('DOCUMENT_REFERENCE_INVALID', 'Resource is not referenced by this document'); }
		const resolved = resolveDocumentReference(id, target);
		if (!['document', 'source'].includes(resolved.kind)) { throw new DocumentError('DOCUMENT_REFERENCE_INVALID', 'Only repository resources can be served'); }
		const extension = path.posix.extname(resolved.id).toLowerCase();
		const image = Object.hasOwn(imageTypes, extension);
		if (reference.image && !image || !image && !sourceExtensions.has(extension)) {
			throw new DocumentError('DOCUMENT_REFERENCE_INVALID', 'Unsupported document resource type');
		}
		const file = this.sourcePath(resolved.id);
		const stat = lstatSync(file);
		if (!stat.isFile() || stat.size > 2 * 1024 * 1024) { throw new DocumentError('DOCUMENT_REFERENCE_INVALID', 'Document resource must be a bounded regular file'); }
		const content = readFileSync(file);
		if (content.length > 2 * 1024 * 1024) { throw new DocumentError('DOCUMENT_REFERENCE_INVALID', 'Document resource is too large'); }
		if (image) {
			return { file: resolved.id, type: imageTypes[extension], content, image: true };
		}
		return { file: resolved.id, type: 'text/plain; charset=utf-8', content, image: false };
	}
	close() {
		this.closed = true;
		clearTimeout(this.timer);
		for (const watcher of this.watchers.values()) { watcher.close(); }
		this.watchers.clear();
		this.directories.clear();
		this.index = undefined;
	}
}
