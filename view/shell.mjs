/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import { mountReference } from './reference.mjs';
import { node, request } from './ui.mjs';
import { bookTitle, topicId, visibleTopicIds } from './topics/catalog.mjs';
import { createBookNavigation } from './book-navigation.mjs';
import { readViewURL, writeViewURL } from '../model/view-state.mjs';
import { documentURL } from './documents.mjs';
import { setRepository } from './context.mjs';

const lifetime = new AbortController();
const panes = new Map();
const target = document.querySelector('#reference');
const navigation = document.querySelector('#book-navigation');
const refresh = document.querySelector('#refresh');
const contents = createBookNavigation(navigation, id => {
	void navigate(id).then(() => focusArticle(id)).catch(error => {
		problem(error);
		target.focus();
	});
}, document.querySelector('#book-pagination'));
let catalog;
let state;
let events;
let pendingNavigations = 0;
let refreshing = false;
let reconnecting = false;
const connectionStatus = node('p', undefined, 'meta');
connectionStatus.setAttribute('role', 'status');
connectionStatus.hidden = true;
target.before(connectionStatus);
const post = (route, input) => request(route, {
	method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: lifetime.signal,
});
const problem = error => {
	let message = document.querySelector('#shell-problem');
	if (!message) { message = node('p'); message.id = 'shell-problem'; message.setAttribute('role', 'alert'); target.before(message); }
	message.textContent = `Couldn't update the design system: ${error.message}`;
	if (new URL(location.href).searchParams.get('section') === 'documentation') {
		const back = node('a', 'Browse documentation');
		back.href = documentURL();
		message.append(' ', back);
	}
};
const urlFor = id => {
	const entry = catalog.find(item => item.id === id);
	const view = state.views[id] ?? {};
	const url = writeViewURL(new URL('/', location.href), { ...view, section: entry.section, controlId: entry.controlId ?? '' });
	url.searchParams.set('topics', state.scope.topics.join(','));
	url.searchParams.set('layout', state.scope.layout);
	url.searchParams.set('mode', state.scope.mode);
	return url;
};
function focusArticle(id) {
	const element = panes.get(id)?.element;
	if (!element || element.hidden || state.scope.active !== id) { return; }
	const heading = element.querySelector('h1');
	const destination = heading?.textContent ? heading : element;
	destination.tabIndex = -1;
	destination.focus({ preventScroll: true });
	destination.scrollIntoView({ block: 'start' });
}
function syncArticleLinks(element) {
	for (const link of element.querySelectorAll('a[href]')) {
		if (link.getAttribute('href').startsWith('#')) { continue; }
		const url = new URL(link.href);
		if (url.origin !== location.origin || url.pathname !== '/' || !url.searchParams.has('section')) { continue; }
		const id = topicId(Object.fromEntries(url.searchParams));
		url.searchParams.set('mode', state.scope.mode);
		url.searchParams.set('topics', state.scope.mode === 'all' ? state.scope.topics.join(',') : id);
		url.searchParams.set('layout', 'single');
		link.href = url.href;
	}
}
async function navigate(id) {
	const layout = state.scope.layout === 'compare' && !state.scope.topics.includes(id) ? 'single' : state.scope.layout;
	await changeScope({ operation: state.scope.mode === 'all' ? 'all' : 'add', topics: [id], active: id, layout });
}
async function changeScope(input) {
	pendingNavigations++;
	try {
		const next = await post('/api/scope', input);
		reconcile(next);
		history.pushState(null, '', urlFor(next.scope.active));
	} finally { pendingNavigations--; }
}
function reconcile(next) {
	state = next;
	refresh.disabled = refreshing;
	const all = state.scope.mode === 'all';
	document.body.classList.toggle('book-layout', all);
	const restoreFocus = navigation.contains(document.activeElement);
	contents.update(all ? catalog.filter(item => !item.hidden).map(item => ({ id: item.id, title: item.title, group: item.group, subgroup: item.subgroup, aliases: item.aliases, href: urlFor(item.id).href })) : [], state.scope.active);
	document.querySelector('.skip').hidden = !all;
	const visible = visibleTopicIds(state.scope);
	if (!panes.size) { target.replaceChildren(); }
	for (const [id, pane] of panes) {
		if (!state.scope.topics.includes(id) && !all) { pane.reference.dispose(); pane.element.remove(); panes.delete(id); continue; }
		pane.wasHidden = pane.element.hidden;
		pane.element.hidden = !visible.includes(id);
	}
	target.classList.toggle('comparison-layout', state.scope.layout === 'compare');
	for (const id of visible) {
		const view = state.views[id];
		const signature = JSON.stringify(view);
		let pane = panes.get(id);
		if (pane && pane.signature !== signature) {
			pane.reference.dispose(); pane.element.remove(); panes.delete(id); pane = undefined;
		}
		if (!pane) {
			const element = node('article', undefined, 'design-reference topic-pane');
			element.dataset.topic = id;
			element.setAttribute('aria-label', catalog.find(item => item.id === id).title);
			target.append(element);
			pane = { element, signature };
			panes.set(id, pane);
			pane.reference = mountReference(element, view, {
				read: async (signal, refresh) => {
					const envelope = await request(`/api/topic?id=${encodeURIComponent(id)}${refresh ? '&refresh=true' : ''}`, { signal });
					element.dataset.revision = envelope.revision;
					return envelope.data;
				},
				onView: patch => {
					pane.signature = JSON.stringify({ ...state.views[id], ...patch });
					state.views[id] = { ...state.views[id], ...patch };
					// View settings require remount; unrelated panes retain identity.
					if (Object.keys(patch).some(key => key !== 'fixtureId' && key !== 'anchor')) { pane.signature = ''; }
					void post('/api/view', { topic: id, patch }).then(async () => reconcile(await request('/api/state'))).catch(problem);
				},
				onQuery: query => {
					state.views[id] = { ...state.views[id], query };
					pane.signature = JSON.stringify(state.views[id]);
					history.replaceState(null, '', urlFor(state.scope.active));
					void post('/api/view', { topic: id, patch: { query } }).catch(problem);
				},
				onSnapshot: system => {
					syncArticleLinks(element);
					document.title = `${system.library?.document?.title ?? catalog.find(item => item.id === state.scope.active).title} — ${bookTitle}`;
					const { kind, branch, worktree, modified } = system.provenance;
					document.querySelector('#checkout').textContent = `${kind} · ${worktree} · ${branch} · ${modified ? 'Modified' : 'Clean'}`;
				},
			});
		} else if (pane.wasHidden) {
			// A hidden selected topic may have released its source watches.
			void pane.reference.refresh();
		}
		pane.element.hidden = false;
		syncArticleLinks(pane.element);
	}
	if (visible.length > 1) {
		visible.forEach((id, index) => {
			const element = panes.get(id).element;
			if (target.children[index] !== element) { target.insertBefore(element, target.children[index] ?? null); }
		});
	}
	if (restoreFocus && !all) { focusArticle(state.scope.active); }
}
const refreshVisible = () => Promise.all([...panes.values()].filter(pane => !pane.element.hidden).map(pane => pane.reference.refresh()));
refresh.addEventListener('click', async () => {
	if (refreshing) { return; }
	refreshing = true;
	refresh.disabled = true;
	refresh.textContent = 'Refreshing…';
	document.querySelector('#shell-problem')?.remove();
	try {
		const topics = [...panes.entries()].filter(([, pane]) => !pane.element.hidden).map(([id]) => id);
		await post('/api/refresh', { topics });
		await refreshVisible();
	} catch (error) {
		problem(error);
	} finally {
		refreshing = false;
		refresh.disabled = false;
		refresh.textContent = 'Refresh';
	}
}, { signal: lifetime.signal });
async function applyURL() {
	const url = new URL(location.href);
	const current = await request('/api/state', { signal: lifetime.signal });
	state = current;
	if (url.searchParams.has('section')) {
		const patch = readViewURL(url);
		if (patch.section === 'components') { patch.controlId ??= ''; }
		if (patch.section === 'documentation') {
			patch.documentId ??= ''; patch.documentScope ??= ''; patch.documentOffset = Number(patch.documentOffset ?? 0);
		}
		patch.query ??= '';
		if (patch.anchor === 'reference') { patch.anchor = ''; }
		await post('/api/view', patch);
		const active = topicId(patch);
		const ids = [...new Set((url.searchParams.get('topics')?.split(',') ?? [active]).map(id => id === 'components' ? 'component-button' : id))];
		if (!ids.includes(active)) { ids.push(active); }
		const next = await post('/api/scope', { operation: url.searchParams.get('mode') === 'all' || patch.section === 'components' && !patch.controlId ? 'all' : 'replace', topics: ids, active, layout: url.searchParams.get('layout') ?? 'single' });
		reconcile(next);
	} else { reconcile(current); }
	history.replaceState(null, '', urlFor(state.scope.active));
}
async function start() {
	setRepository(await request('/api/repository', { signal: lifetime.signal }));
	catalog = (await request('/api/catalog', { signal: lifetime.signal })).topics;
	await applyURL();
	events = new EventSource('/api/events');
	events.onmessage = event => {
		const update = JSON.parse(event.data);
		if (update.kind === 'scope' || update.kind === 'view') {
			reconcile(update.state);
			if (!pendingNavigations) { history.replaceState(null, '', urlFor(state.scope.active)); }
			if (reconnecting) {
				reconnecting = false;
				connectionStatus.hidden = true;
				void refreshVisible();
			}
		}
		if (update.kind === 'sources') {
			for (const id of update.topics) { if (panes.has(id) && !panes.get(id).element.hidden) { void panes.get(id).reference.refresh(); } }
		}
		if (update.kind === 'error') { problem(new Error(update.message)); }
	};
	events.onerror = () => {
		reconnecting = true;
		connectionStatus.textContent = 'Live updates disconnected; reconnecting automatically…';
		connectionStatus.hidden = false;
	};
}
window.addEventListener('popstate', () => { void applyURL().catch(problem); }, { signal: lifetime.signal });
window.addEventListener('pageshow', event => {
	if (event.persisted) {
		void request('/api/state', { signal: lifetime.signal }).then(next => { reconcile(next); return refreshVisible(); }).catch(problem);
	}
}, { signal: lifetime.signal });
window.addEventListener('pagehide', event => {
	if (event.persisted) { return; }
	lifetime.abort(); events?.close();
	contents.dispose();
	for (const pane of panes.values()) { pane.reference.dispose(); }
}, { signal: lifetime.signal });
void start().catch(problem);
