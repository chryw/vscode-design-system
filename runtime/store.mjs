/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import { readFileSync, statSync, existsSync, watch } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { vscodeAdapter, canonicalRoot } from '../adapters/vscode/readers.mjs';
import { contained } from './paths.mjs';
import { DocumentLibrary } from './documents.mjs';
import { readRepository, repositoryDirectory } from '../adapters/vscode/repository.mjs';

export { canonicalRoot, contained };
const signature = target => {
	try { const stat = statSync(target); return `${stat.mtimeMs}:${stat.size}:${stat.ino}`; }
	catch (error) { if (error.code === 'ENOENT') { return 'missing'; } throw error; }
};
class SourceRevisionError extends Error { }

export class TopicStore {
	constructor(root, { onEvent = () => {}, watchFactory = watch, adapter = vscodeAdapter, bookRoot = contained(root, repositoryDirectory), repository = readRepository(root, { bookRoot }) } = {}) {
		Object.defineProperty(this, 'root', { value: adapter.canonicalRoot(root), enumerable: true });
		this.adapter = adapter;
		this.bookRoot = bookRoot;
		this.repository = repository;
		this.onEvent = onEvent;
		this.watchFactory = watchFactory;
		this.groups = new Map();
		this.topics = new Map();
		this.watches = new Map();
		this.subscribed = new Set();
		this.closed = false;
		this.metrics = { reads: {}, parses: {}, bytes: 0 };
		this.identity = undefined;
		this.identityAt = 0;
	}
	sourcePath(file) {
		return this.adapter.sourcePath?.(this.root, file, this.bookRoot) ?? contained(this.root, file);
	}
	get documents() {
		if (!this.documentLibrary) {
			this.documentLibrary = new DocumentLibrary(this.root, {
				bookRoot: this.bookRoot, watchFactory: this.watchFactory,
				onChange: () => {
					for (const group of this.groups.values()) {
						if (group.name === 'documents') { this.invalidate(group); }
					}
					this.onEvent({ kind: 'sources', topics: ['documentation'], files: [] });
				},
				onError: error => this.onEvent({ kind: 'error', message: error.message }),
			});
			this.documentLibrary.setActive(this.subscribed.has('documentation'));
		}
		return this.documentLibrary;
	}
	key(name, args = []) {
		return `${name}:${createHash('sha256').update(JSON.stringify(args)).digest('hex').slice(0, 16)}`;
	}
	async group(name, args, load) {
		const key = this.key(name, args);
		let entry = this.groups.get(key);
		if (!entry) {
			entry = { key, name, revision: 0, files: new Set(), signatures: new Map() };
			this.groups.set(key, entry);
		}
		if ([...entry.signatures].some(([file, value]) => signature(this.sourcePath(file)) !== value)) {
			this.invalidate(entry);
		}
		if (!entry.promise) {
			const revision = entry.revision;
			entry.files = new Set();
			entry.signatures = new Map();
			const texts = new Map();
			const read = file => {
				entry.files.add(file);
				if (texts.has(file)) { return texts.get(file); }
				const target = this.sourcePath(file);
				entry.signatures.set(file, signature(target));
				const text = readFileSync(target, 'utf8');
				this.metrics.reads[file] = (this.metrics.reads[file] ?? 0) + 1;
				this.metrics.bytes += Buffer.byteLength(text);
				entry.signatures.set(file, signature(target));
				texts.set(file, text);
				return text;
			};
			this.metrics.parses[name] = (this.metrics.parses[name] ?? 0) + 1;
			entry.promise = Promise.resolve().then(() => load({
				root: this.root, read, documents: () => this.documents,
				repository: this.repository,
				source: (file, offset = 0) => ({ file, line: read(file).slice(0, offset).split('\n').length }),
			})).then(value => {
				if (entry.revision !== revision || this.closed) { throw new SourceRevisionError('Source revision changed while reading; retry topic'); }
				return { key, revision, value, files: [...entry.files] };
			}).catch(error => {
				if (entry.revision === revision) { entry.promise = undefined; }
				throw error;
			});
		}
		return entry.promise;
	}
	declare(id, key) {
		const topic = this.topics.get(id);
		topic.declared ??= new Set();
		topic.declared.add(key);
	}
	invalidate(entry, notify = false) {
		entry.revision++;
		entry.promise = undefined;
		for (const [id, topic] of this.topics) {
			if (topic.declared?.has(entry.key) || topic.dependencies?.some(item => item.key === entry.key)) {
				topic.envelope = undefined;
				if (notify) { this.pending?.add(id); }
			}
		}
	}
	setSubscribed(ids) {
		const watchedDocuments = this.subscribed.has('documentation');
		this.subscribed = new Set(ids);
		this.documentLibrary?.setActive(this.subscribed.has('documentation'));
		if (watchedDocuments !== this.subscribed.has('documentation')) {
			for (const group of this.groups.values()) {
				if (group.name === 'documents') { this.invalidate(group); }
			}
		}
		this.track();
	}
	track() {
		if (this.closed) { return; }
		const files = new Set();
		for (const id of this.subscribed) {
			for (const key of this.topics.get(id)?.declared ?? []) {
				for (const file of this.groups.get(key)?.files ?? []) { files.add(file); }
			}
		}
		const directories = new Map();
		for (const file of files) {
			let directory = path.dirname(this.sourcePath(file));
			while (!existsSync(directory)) { directory = path.dirname(directory); }
			directories.set(directory, false);
		}
		if ([...this.subscribed].some(id => ['colors', 'theming'].includes(id))) {
			directories.set(path.join(this.root, 'extensions'), true);
		}
		for (const [directory, watcher] of this.watches) {
			if (!directories.has(directory)) { watcher.close(); this.watches.delete(directory); }
		}
		for (const [directory, recursive] of directories) {
			if (this.watches.has(directory)) { continue; }
			const watcher = this.watchFactory(directory, { recursive }, (_event, file) => {
				if (this.closed) { return; }
				const relative = path.relative(this.root, file ? path.join(directory, file) : directory).split(path.sep).join('/');
				const changedPath = file ? path.join(directory, String(file)) : directory;
				const affected = file => {
					const target = this.sourcePath(file);
					return target === changedPath || target.startsWith(`${changedPath}${path.sep}`);
				};
				const changed = new Set();
				this.pending ??= new Set();
				for (const group of this.groups.values()) {
					let changedFiles;
					try {
						changedFiles = [...group.files].filter(file => affected(file)
							&& signature(this.sourcePath(file)) !== group.signatures.get(file));
					} catch (error) {
						this.onEvent({ kind: 'error', message: `Couldn't inspect saved sources: ${error.message}` });
						return;
					}
					const discovery = group.name === 'themes' && /^extensions\/theme-[^/]+\/.*(?:json|jsonc)$/.test(relative);
					if (changedFiles.length || discovery) {
						for (const file of changedFiles) { changed.add(file); }
						if (discovery) { changed.add(relative); }
						this.invalidate(group, true);
					}
				}
				if (!changed.size) { return; }
				this.changedFiles ??= new Set();
				for (const file of changed) { this.changedFiles.add(file); }
				clearTimeout(this.timer);
				this.timer = setTimeout(() => {
					const topics = [...this.pending].filter(id => this.subscribed.has(id));
					this.pending.clear();
					const files = [...this.changedFiles];
					this.changedFiles.clear();
					this.onEvent({ kind: 'sources', topics, files, debouncedAt: Date.now() });
				}, 100);
			});
			watcher.on('error', error => this.onEvent({ kind: 'error', message: `Source watcher failed: ${error.message}` }));
			this.watches.set(directory, watcher);
		}
	}
	async read(id, settings, options = {}) {
		id = this.repository.getTopic(id).id;
		try {
			return await this.readCurrent(id, settings, options);
		} catch (error) {
			if (!(error instanceof SourceRevisionError) || this.closed || options.signal?.aborted) { throw error; }
			return this.readCurrent(id, settings, { ...options, refresh: false });
		}
	}
	async readCurrent(id, settings, { refresh = false, signal } = {}) {
		if (this.closed) { throw new Error('Explorer stopped'); }
		if (signal?.aborted) { throw new Error('Topic request cancelled'); }
		let topic = this.topics.get(id);
		if (!topic) { topic = {}; this.topics.set(id, topic); }
		if (id === 'documentation' && !this.subscribed.has(id)) {
			this.documents.invalidate();
			for (const group of this.groups.values()) {
				if (group.name === 'documents') { this.invalidate(group); }
			}
		}
		for (const dependency of topic.dependencies ?? []) {
			const group = this.groups.get(dependency.key);
			if (group && [...group.signatures].some(([file, value]) => signature(this.sourcePath(file)) !== value)) {
				this.invalidate(group);
			}
		}
		if (refresh) {
			if (id === 'documentation') { this.documents.snapshot({ refresh: true }); }
			for (const dependency of topic.dependencies ?? []) { this.invalidate(this.groups.get(dependency.key)); }
			topic.envelope = undefined;
		}
		const settingsKey = JSON.stringify(settings);
		if (!topic.envelope || topic.settingsKey !== settingsKey) {
			let result;
			try { result = await this.adapter.readTopic(this, id, settings); }
			catch (error) { this.track(); throw error; }
			if (this.closed || signal?.aborted) { throw new Error('Topic request cancelled'); }
			if (result.dependencies.some(item => this.groups.get(item.key).revision !== item.revision)) { throw new SourceRevisionError('Stale source revision; retry topic'); }
			if (!this.identity || Date.now() - this.identityAt > 2000) {
				this.identity = this.adapter.readProvenance(this.root);
				this.identityAt = Date.now();
			}
			topic.settingsKey = settingsKey;
			topic.dependencies = result.dependencies;
			topic.envelope = {
				format: 'vscode-design-topic', version: 1, topic: id, checkout: this.root,
				readerVersion: 1, templateVersion: 1,
				revision: result.dependencies.map(item => `${item.key}:${item.revision}`).join('|'),
				provenance: this.identity, sources: result.data.sourceFiles,
				coverage: result.data.reference.topics[result.data.view.section] ?? [],
				capability: { fixture: this.repository.getTopic(id).fixture, readiness: this.repository.getTopic(id).content === 'tbd' ? 'content-tbd' : 'source-ready' },
				data: { ...result.data, provenance: this.identity },
			};
			this.track();
		}
		return topic.envelope;
	}
	allowlisted(file) {
		return [...this.topics.values()].some(topic => topic.envelope?.sources.includes(file));
	}
	close() {
		if (this.closed) { return; }
		this.closed = true;
		clearTimeout(this.timer);
		this.documentLibrary?.close();
		for (const watcher of this.watches.values()) { watcher.close(); }
		this.watches.clear();
		this.groups.clear();
		this.topics.clear();
	}
}
