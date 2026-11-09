/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import http from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { readRepository } from '../adapters/vscode/repository.mjs';
import { vscodeAdapter } from '../adapters/vscode/readers.mjs';
import { TopicStore, canonicalRoot, contained } from './store.mjs';
import { packageRoot, viewRoot } from './paths.mjs';
import { bookTitle, contentAssets, readBook } from './book.mjs';
import { defaultView, validateState, validateViewPatch } from './view-state.mjs';
import { StateStorageError } from './state-storage.mjs';
import { DocumentError, documentExcerpt } from '../model/documents.mjs';
import { writeViewURL } from '../model/view-state.mjs';

const assets = new Set([
	'index.html', 'canvas.css', 'shell.css', 'shell.mjs', 'context.mjs', 'book-navigation.mjs', 'book-navigation.css', 'reference.mjs', 'ui.mjs', 'navigation-model.mjs',
	'page-content.mjs', 'motion-reference.mjs', 'topic-lifecycle.mjs', 'token-lookup.mjs', 'controls.mjs', 'component-specs.mjs',
	'typography.mjs', 'foundations.mjs', 'guidance.mjs', 'markdown.mjs', 'layout.mjs', 'icons.mjs',
	'color-reference.mjs', 'theme-gallery.mjs', 'motion.mjs', 'motion-previews.mjs', 'motion-recipes.mjs', 'motion.css', 'components.mjs', 'documents.mjs',
	'topics/catalog.mjs', ...['guidance', 'typography', 'foundations', 'theming', 'icons', 'motion', 'tokens', 'components', 'documents'].map(kind => `topics/${kind}.mjs`),
	],
);
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export async function createExplorer(root, options = {}) {
	const canonical = canonicalRoot(root);
	const roots = { book: options.bookRoot ?? contained(canonical, '.github/design-system'), view: options.viewRoot ?? viewRoot };
	const repository = readRepository(canonical, { bookRoot: roots.book });
	const { catalog, getTopic, topicId, validateScope, visibleTopicIds } = repository;
	const book = readBook(roots.book);
	const content = contentAssets(roots.book);
	const initialScope = validateScope(options.scope ?? { operation: 'all', active: book.defaultTopic, layout: 'single' });
	const saved = options.stateStorage?.read()?.state;
	let initial = validateState(saved ?? { scope: initialScope, views: {} }, repository);
	if (options.stateStorage && !saved) { initial = options.stateStorage.update(current => current ?? initial); }
	let scope = initial.scope;
	const views = new Map(Object.entries(initial.views));
	const clients = new Set();
	const lifetime = new AbortController();
	let closed = false;
	let fixtureCatalog;
	let fixtureDiscovery;
	let fixtureSourceTreeId;
	let staleFixtureSourceTreeId;
	let fixtureController;
	let fixtureGeneration = 0;
	let fixtureHealth;
	let fixtureRequests = 0;
	const invalidateFixtures = () => {
		fixtureGeneration++;
		fixtureCatalog = undefined;
		fixtureHealth = undefined;
	};
	const broadcast = event => {
		for (const client of clients) { client.write(`data: ${JSON.stringify(event)}\n\n`); }
	};
	const adapter = options.adapter ?? vscodeAdapter;
	const store = new TopicStore(canonical, {
		adapter, bookRoot: roots.book, repository,
		onEvent: event => {
			if (event.kind === 'sources' && event.topics.some(id => getTopic(id).fixture)) {
				// Imported product styles and tokens update through HMR without changing the fixture catalog.
				if (event.files?.some(file => file.startsWith('src/') && file.endsWith('.fixture.ts'))) {
					staleFixtureSourceTreeId = fixtureSourceTreeId;
					invalidateFixtures();
				}
			}
			broadcast(event);
		},
		...options.storeOptions,
	});
	const view = id => {
		return { ...defaultView(id, repository), ...views.get(getTopic(id).id) };
	};
	const state = () => ({ scope: { ...scope, topics: [...scope.topics] }, views: Object.fromEntries([...new Set([...scope.topics, ...views.keys()])].map(id => [id, view(id)])) });
	const subscribe = () => {
		const selected = visibleTopicIds(scope);
		if (!selected.some(id => getTopic(id).fixture)) {
			fixtureController?.abort();
			fixtureController = undefined;
			invalidateFixtures();
		}
		store.setSubscribed(selected);
	};
	const setScope = input => {
		if (closed) { throw new Error('Design system stopped'); }
		const next = validateScope(input, scope);
		options.stateStorage?.update(previous => ({ scope: next, views: previous?.views ?? Object.fromEntries(views) }));
		scope = next;
		subscribe();
		broadcast({ kind: 'scope', state: state() });
		return state();
	};
	const setView = (patch, id = scope.active) => {
		if (closed) { throw new Error('Design system stopped'); }
		validateViewPatch(patch);
		id = getTopic(id).id;
		const previous = view(id);
		const nextId = patch.section || patch.controlId ? topicId({ ...previous, ...patch }) : id;
		getTopic(nextId);
		const nextView = { ...view(nextId), ...patch, section: getTopic(nextId).section, controlId: getTopic(nextId).controlId ?? '' };
		if (nextId === 'documentation') {
			if (patch.documentId !== undefined && patch.documentId !== view(nextId).documentId && patch.anchor === undefined) { nextView.anchor = ''; }
			store.documents.project(nextView);
			if (nextView.documentId && nextView.anchor) { store.documents.read(nextView.documentId, { anchor: nextView.anchor }); }
		} else if (['documentId', 'documentScope', 'documentOffset'].some(key => Object.hasOwn(patch, key))) {
			throw new Error('Document options belong to the Documentation topic');
		}
		const nextScope = scope.topics.includes(nextId) ? { ...scope, active: nextId }
			: validateScope({ operation: scope.mode !== 'all' && !getTopic(nextId).compare ? 'replace' : 'add', topics: [nextId], active: nextId, layout: 'single' }, scope);
		options.stateStorage?.update(previous => ({ scope: nextScope, views: {
			...(previous?.views ?? Object.fromEntries(views)), [nextId]: {
				...defaultView(nextId, repository), ...(previous?.views[nextId] ?? views.get(nextId)), ...patch, section: nextView.section, controlId: nextView.controlId, anchor: nextView.anchor,
			},
		} }));
		if (patch.explorerUrl !== undefined && patch.explorerUrl !== view(nextId).explorerUrl) {
			invalidateFixtures();
		}
		views.set(nextId, nextView);
		scope = nextScope;
		subscribe();
		broadcast({ kind: 'view', state: state(), topic: nextId });
		return view(nextId);
	};
	const read = (id, input = {}) => store.read(id, view(id), input);
	const refreshTopics = async ids => {
		if (!Array.isArray(ids) || !ids.length || ids.length > catalog.length || new Set(ids).size !== ids.length) {
			throw new Error('Expected distinct topics to refresh');
		}
		ids = [...new Set(ids.map(id => getTopic(id).id))];
		if (ids.some(id => getTopic(id).fixture)) { invalidateFixtures(); }
		for (const id of ids) { await read(id, { refresh: true }); }
		return { topics: ids, refreshed: true };
	};
	const panel = {
		root: canonical, store, book,
		get url() {
			const active = view(scope.active);
			const url = writeViewURL(new URL(`http://127.0.0.1:${server.address().port}/`), active);
			url.searchParams.set('topics', scope.topics.join(','));
			url.searchParams.set('layout', scope.layout);
			url.searchParams.set('mode', scope.mode);
			return url.href;
		},
		get view() { return view(scope.active); }, get state() { return state(); },
		setScope, setView,
		async inspectTopic(id = scope.active, details = false) {
			id = getTopic(id).id;
			const envelope = await read(id);
			if (details) { return envelope; }
			return { topic: id, checkout: canonical, revision: envelope.revision, version: envelope.version,
				sourceCount: envelope.sources.length, coverage: envelope.coverage.map(item => ({ expected: item.expected, status: item.status })),
				detailPath: `/api/topic?id=${encodeURIComponent(id)}` };
		},
		async refreshTopic(id = scope.active) { id = getTopic(id).id; await refreshTopics([id]); broadcast({ kind: 'sources', topics: [id] }); return { topic: id, refreshed: true }; },
		async close() {
			if (closed) { return; }
			closed = true;
			lifetime.abort();
			fixtureController?.abort();
			store.close();
			for (const client of clients) { client.end(); }
			server.closeIdleConnections();
			await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
		},
	};
	const server = http.createServer(async (request, response) => {
		const send = (status, type, body, headers = {}) => {
			response.writeHead(status, {
				'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
				'Content-Security-Policy': 'default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; connect-src \'self\'; img-src \'self\' data:; frame-src http://localhost:* http://127.0.0.1:*; base-uri \'none\'; form-action \'self\'',
				...headers,
			});
			response.end(body);
		};
		const json = object => send(200, 'application/json; charset=utf-8', JSON.stringify(object));
		try {
			const origin = new URL(panel.url).origin;
			if (request.headers.host !== new URL(origin).host) { send(403, 'text/plain', 'Invalid host'); return; }
			const url = new URL(request.url, origin);
			if (request.method === 'POST') {
				if (request.headers.origin !== origin || request.headers['content-type'] !== 'application/json') {
					send(403, 'text/plain', 'Same-origin JSON required'); return;
				}
				let text = '';
				for await (const chunk of request) {
					text += chunk;
					if (Buffer.byteLength(text) > 8192) { send(413, 'text/plain', 'Request too large'); return; }
				}
				let input;
				try {
					input = JSON.parse(text);
					if (url.pathname === '/api/scope') { json(setScope(input)); return; }
					if (url.pathname === '/api/view') { json(setView(input.patch ?? input, input.topic)); return; }
					if (url.pathname === '/api/refresh') { json(input.topics ? await refreshTopics(input.topics) : await panel.refreshTopic(input.topic)); return; }
				} catch (error) { send(error instanceof StateStorageError ? 503 : 400, 'text/plain', error.message); return; }
				send(404, 'text/plain', 'Unknown action'); return;
			}
			if (request.method !== 'GET') { send(405, 'text/plain', 'Method not allowed'); return; }
			if (url.pathname === '/api/catalog') { json({ version: 1, title: bookTitle, topics: catalog }); return; }
			if (url.pathname === '/api/repository') { json(repository.projection); return; }
			if (url.pathname === '/book.json') { json(readBook(roots.book)); return; }
			if (['/model/documents.mjs', '/model/view-state.mjs', '/model/catalog.mjs', '/model/components.mjs', '/model/repository.mjs'].includes(url.pathname)) {
				send(200, 'text/javascript', readFileSync(contained(packageRoot, url.pathname.slice(1))));
				return;
			}
			if (['/api/documents', '/api/document', '/api/document-resource'].includes(url.pathname)) {
				try {
					const allowed = url.pathname === '/api/documents' ? ['query', 'scope', 'offset', 'limit']
						: url.pathname === '/api/document' ? ['id', 'heading', 'anchor', 'limit'] : ['id', 'target'];
					if ([...url.searchParams.keys()].some(key => !allowed.includes(key) || url.searchParams.getAll(key).length !== 1)) {
						throw new DocumentError('DOCUMENT_QUERY_INVALID', 'Unknown or repeated document query fields');
					}
					if (url.pathname === '/api/documents') {
						json({ ...store.documents.list({
							query: url.searchParams.get('query') ?? '', scope: url.searchParams.get('scope') ?? '',
							offset: Number(url.searchParams.get('offset') ?? 0), limit: Number(url.searchParams.get('limit') ?? 30),
						}), checkout: canonical });
					} else if (url.pathname === '/api/document') {
						const document = store.documents.read(url.searchParams.get('id'), {
							heading: url.searchParams.get('heading') ?? undefined, anchor: url.searchParams.get('anchor') ?? undefined,
						});
						json({ ...documentExcerpt(document, Number(url.searchParams.get('limit') ?? 12000)), checkout: canonical });
					} else {
						const resource = store.documents.resource(url.searchParams.get('id'), url.searchParams.get('target'));
						send(200, resource.type, resource.content, {
							'Content-Security-Policy': 'sandbox; default-src \'none\'; style-src \'unsafe-inline\'; img-src data:',
						});
					}
				} catch (error) {
					const status = error.code === 'DOCUMENT_NOT_FOUND' || error.code === 'ENOENT' ? 404 : error instanceof DocumentError ? 400 : 500;
					send(status, 'application/json; charset=utf-8', JSON.stringify({
						format: 'vscode-design-document-error', version: 1,
						error: { code: error.code ?? 'DOCUMENT_READ_FAILED', message: error.message },
					}));
				}
				return;
			}
			if (url.pathname === '/api/state') { json(state()); return; }
			if (url.pathname === '/api/metrics') { json({ ...store.metrics, groups: [...store.groups.keys()], watchedDirectories: store.watches.size, fixtureRequests }); return; }
			if (url.pathname === '/api/topic') {
				const id = url.searchParams.get('id') ?? scope.active;
				getTopic(id);
				const controller = new AbortController();
				response.on('close', () => controller.abort());
				json(await read(id, { refresh: url.searchParams.get('refresh') === 'true', signal: controller.signal }));
				return;
			}
			if (url.pathname === '/api/fixtures') {
				fixtureRequests++;
				if (!visibleTopicIds(scope).some(id => getTopic(id).fixture)) {
					throw new Error('Select a component or Motion before requesting its renderer');
				}
				if (url.searchParams.get('refresh') === 'true' && !fixtureDiscovery) { invalidateFixtures(); }
				if (fixtureCatalog && url.searchParams.get('check') === 'true') {
					const cached = fixtureCatalog;
					fixtureHealth ??= cached.then(async catalog => {
						try {
							const response = await fetch(catalog.explorerUrl, {
								method: 'HEAD', redirect: 'error',
								signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(3000)]),
							});
							return response.ok;
						} catch (error) {
							if (lifetime.signal.aborted) { throw error; }
							if (error instanceof TypeError || error.name === 'TimeoutError') { return false; }
							throw error;
						}
					});
					const healthy = await fixtureHealth;
					fixtureHealth = undefined;
					if (!healthy && fixtureCatalog === cached) {
						staleFixtureSourceTreeId = undefined;
						invalidateFixtures();
						throw new Error('The local fixture renderer disconnected');
					}
				}
				if (!fixtureCatalog) {
					if (fixtureDiscovery) { json(await fixtureDiscovery); return; }
					fixtureController = new AbortController();
					const signal = AbortSignal.any([lifetime.signal, fixtureController.signal]);
					const generation = fixtureGeneration;
					const requested = adapter.loadFixtureCatalog(canonical, panel.view.explorerUrl, signal, staleFixtureSourceTreeId, repository)
						.then(result => {
							if (signal.aborted) { throw signal.reason; }
							if (generation !== fixtureGeneration) { throw new Error('Component sources changed during discovery; reconnecting is required'); }
							fixtureSourceTreeId = result.sourceTreeId;
							staleFixtureSourceTreeId = undefined;
							return result;
						})
						.catch(error => { if (fixtureCatalog === requested) { fixtureCatalog = undefined; } throw error; })
						.finally(() => { if (fixtureDiscovery === requested) { fixtureDiscovery = undefined; } });
					fixtureDiscovery = requested;
					fixtureCatalog = requested;
				}
				json(await fixtureCatalog); return;
			}
			if (url.pathname === '/api/events') {
				if (request.headers.origin && request.headers.origin !== origin) { send(403, 'text/plain', 'Same-origin events required'); return; }
				response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
				clients.add(response);
				response.write(`: connected\n\ndata: ${JSON.stringify({ kind: 'scope', state: state() })}\n\n`);
				response.on('close', () => clients.delete(response));
				return;
			}
			if (url.pathname === '/source') {
				const file = url.searchParams.get('file');
				if (!store.allowlisted(file)) { send(404, 'text/plain', 'Source not loaded by a topic'); return; }
				const target = store.sourcePath(file);
				const text = readFileSync(target, 'utf8');
				const lines = text.split('\n').map((line, index) => `<span id="L${index + 1}"><a href="#L${index + 1}">${index + 1}</a> ${escape(line)}</span>`).join('\n');
				send(200, 'text/html; charset=utf-8', `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escape(file)}</title><link rel="stylesheet" href="/canvas.css"><body class="design-reference source"><h1>${escape(file)}</h1><pre>${lines}</pre></body></html>`);
				return;
			}
			if (url.pathname === '/codicon.ttf') {
				// This fixed dependency asset can use linked node_modules; user-selected source paths remain contained.
				const file = path.join(canonical, 'node_modules/@vscode/codicons/dist/codicon.ttf');
				send(200, 'font/ttf', readFileSync(file)); return;
			}
			const asset = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
			if (content.has(asset)) {
				const file = contained(roots.book, asset);
				if (statSync(file).size > 1024 * 1024) { throw new Error('Book content is too large'); }
				send(200, asset.endsWith('.json') ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8', readFileSync(file));
				return;
			}
			if (!assets.has(asset)) { send(404, 'text/plain', 'Unknown asset'); return; }
			send(200, asset.endsWith('.css') ? 'text/css' : asset.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript', readFileSync(contained(roots.view, asset)));
		} catch (error) { if (!response.destroyed) { send(500, 'text/plain', error.message); } }
	});
	try {
		await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
		subscribe();
		return panel;
	} catch (error) { store.close(); server.close(); throw error; }
}
