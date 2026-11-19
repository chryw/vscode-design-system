/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import { mountReference } from './reference.mjs';
import { node, request, problemDetails, showProblem, createPageHistory, createAppearancePicker, anchorPopup } from './ui.mjs';
import { bookTitle, topicId, visibleTopicIds } from './topics/catalog.mjs';
import { createBookNavigation } from './book-navigation.mjs';
import { readViewURL, writeViewURL } from '../model/view-state.mjs';
import { setRepository } from './context.mjs';
import { bookNavigation, UnknownTopicError } from '../model/catalog.mjs';

const lifetime = new AbortController();
const panes = new Map();
const target = document.querySelector('#reference');
const navigation = document.querySelector('#book-navigation');
const refresh = document.querySelector('#refresh');
const checkoutChoice = document.querySelector('#checkout-choice');
const checkoutPath = document.querySelector('#checkout-path');
const checkoutForm = document.querySelector('#checkout-form');
const checkoutPicker = document.querySelector('#checkout-picker');
const checkoutToggle = document.querySelector('#checkout-toggle');
createAppearancePicker(document.querySelector('.page-history'), lifetime.signal);
const pageHistory = createPageHistory(() => applyURL().then(() => focusArticle(state.scope.active)).catch(problem), lifetime.signal);
const contents = createBookNavigation(navigation, id => {
	void navigate(id).then(() => focusArticle(id)).catch(error => {
		problem(error);
		target.focus();
	});
}, document.querySelector('.site-navigation'));
let catalog;
let state;
let events;
let pendingNavigations = 0;
let refreshing = false;
let reconnecting = false;
let selectedCheckout;
const connectionStatus = node('p', undefined, 'meta');
connectionStatus.setAttribute('role', 'status');
connectionStatus.hidden = true;
target.before(connectionStatus);
const post = (route, input) => request(route, {
	method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: lifetime.signal,
});
const problem = error => {
	let message = document.querySelector('#shell-problem');
	if (!message) { message = problemDetails('shell-problem'); document.querySelector('.explorer-heading').after(message); }
	showProblem(message, 'Canvas update failed — details', error.message);
};
anchorPopup(checkoutPicker, checkoutToggle, lifetime.signal);
document.querySelector('.checkout-split').addEventListener('keydown', event => {
	if (event.key === 'ArrowDown') {
		event.preventDefault();
		checkoutPicker.showPopover();
	} else if (event.key === 'ArrowRight' && event.target === refresh) {
		event.preventDefault();
		checkoutToggle.focus();
	} else if (event.key === 'ArrowLeft' && event.target === checkoutToggle) {
		event.preventDefault();
		refresh.focus();
	}
}, { signal: lifetime.signal });
function updateRefresh() {
	refresh.disabled = refreshing || !selectedCheckout;
	checkoutToggle.disabled = refresh.disabled;
	document.querySelector('#refresh-label').textContent = refreshing ? 'Refreshing…' : 'Refresh';
	refresh.setAttribute('aria-busy', String(refreshing));
}
async function updateCheckoutChoices(result) {
	result ??= await request('/api/checkouts', { signal: lifetime.signal });
	selectedCheckout = result.checkout;
	checkoutChoice.replaceChildren(...result.checkouts.map(checkout => {
		const option = node('option', `${checkout.branch} — ${checkout.root.split(/[\\/]/).at(-1)}`);
		option.value = checkout.root;
		option.title = checkout.root;
		option.selected = checkout.root === result.checkout;
		return option;
	}));
	const other = node('option', 'Other checkout…');
	other.value = '';
	checkoutChoice.append(other);
	checkoutPath.value = result.checkout;
	checkoutChoice.title = result.checkout;
	checkoutToggle.title = `Checkout details: ${result.checkout}`;
	const checkoutName = document.querySelector('#checkout');
	checkoutName.textContent = result.checkout.split(/[\\/]/).at(-1);
	checkoutName.title = result.checkout;
	document.querySelector('#checkout-location').textContent = result.checkout;
	checkoutPath.hidden = true;
	checkoutPath.required = false;
	checkoutPath.previousElementSibling.hidden = true;
	document.querySelector('#checkout-mode').textContent = result.mode === 'basic'
		? 'Source library: this checkout has no curated design book. Browse local documentation; curated topics and live examples are unavailable.'
		: result.unavailableTopics?.length ? 'Some saved topics are unavailable on this branch. Showing the available content.' : '';
	updateRefresh();
}
checkoutChoice.addEventListener('change', () => {
	const other = !checkoutChoice.value;
	checkoutChoice.title = checkoutChoice.value;
	document.querySelector('#checkout-location').textContent = checkoutChoice.value;
	checkoutPath.hidden = !other;
	checkoutPath.previousElementSibling.hidden = !other;
	checkoutPath.required = other;
	if (other) { checkoutPath.focus(); }
}, { signal: lifetime.signal });
let checkoutRefresh;
function reloadCheckout() {
	checkoutRefresh ??= (async () => {
		const checkouts = await request('/api/checkouts', { signal: lifetime.signal });
		const sameCheckout = selectedCheckout === checkouts.checkout;
		if (!sameCheckout) {
			for (const pane of panes.values()) { pane.reference.dispose(); pane.element.remove(); }
			panes.clear();
		}
		setRepository(await request('/api/repository', { signal: lifetime.signal }));
		catalog = (await request('/api/catalog', { signal: lifetime.signal })).topics;
		reconcile(await request('/api/state', { signal: lifetime.signal }));
		pageHistory.replace(urlFor(state.scope.active));
		await updateCheckoutChoices(checkouts);
		if (sameCheckout) { await refreshVisible(); }
		document.querySelector('#shell-problem')?.remove();
	})().finally(() => { checkoutRefresh = undefined; });
	return checkoutRefresh;
}
checkoutForm.addEventListener('submit', async event => {
	event.preventDefault();
	const button = checkoutForm.querySelector('button');
	const errorMessage = document.querySelector('#checkout-error');
	errorMessage.hidden = true;
	errorMessage.textContent = '';
	button.disabled = true;
	try {
		await post('/api/checkout', { root: checkoutChoice.value || checkoutPath.value });
		await reloadCheckout();
		checkoutPicker.hidePopover();
		checkoutToggle.focus();
	} catch (error) {
		errorMessage.textContent = error.message;
		errorMessage.hidden = false;
	}
	finally { button.disabled = false; }
}, { signal: lifetime.signal });
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
	if (state.views[id]?.anchor && element.contains(document.activeElement)) { return; }
	const heading = element.querySelector('h1');
	const destination = heading?.textContent ? heading : element;
	destination.tabIndex = -1;
	destination.focus({ preventScroll: true });
	if (!state.views[id]?.anchor) { destination.scrollIntoView({ block: 'start' }); }
}
function syncArticleLinks(element) {
	for (const link of element.querySelectorAll('a[href]')) {
		if (link.getAttribute('href').startsWith('#')) { continue; }
		const url = new URL(link.href);
		if (url.origin !== location.origin || url.pathname !== '/' || !url.searchParams.has('section')) { continue; }
		let id;
		try { id = topicId(Object.fromEntries(url.searchParams)); }
		catch (error) {
			if (!(error instanceof UnknownTopicError)) { throw error; }
			const unavailable = node('span', `${link.textContent} (topic unavailable in this checkout)`);
			unavailable.title = error.message;
			link.replaceWith(unavailable);
			continue;
		}
		url.searchParams.set('mode', state.scope.mode);
		url.searchParams.set('topics', state.scope.mode === 'all' ? state.scope.topics.join(',') : id);
		url.searchParams.set('layout', 'single');
		link.href = url.href;
	}
}
async function navigate(id) {
	pageHistory.push(urlFor(id));
	const layout = state.scope.layout === 'compare' && !state.scope.topics.includes(id) ? 'single' : state.scope.layout;
	await changeScope({ operation: state.scope.mode === 'all' ? 'all' : 'add', topics: [id], active: id, layout });
}
async function changeScope(input) {
	pendingNavigations++;
	try {
		const next = await post('/api/scope', input);
		reconcile(next);
		pageHistory.replace(urlFor(next.scope.active));
		await ready();
	} finally { pendingNavigations--; }
}
function reconcile(next) {
	state = next;
	updateRefresh();
	refresh.title = 'Reread saved content, the topic list, and live examples from the selected checkout';
	const all = state.scope.mode === 'all';
	document.body.classList.toggle('book-layout', all);
	const restoreFocus = navigation.contains(document.activeElement) || document.querySelector('.site-navigation').contains(document.activeElement);
	const { topics, utilities } = bookNavigation(all ? catalog : []);
	const link = item => ({ ...item, href: urlFor(item.id).href });
	contents.update(topics.map(link), state.scope.active, utilities.map(link));
	document.querySelector('.skip').hidden = !all;
	const visible = visibleTopicIds(state.scope);
	if (!panes.size) { target.replaceChildren(); }
	for (const [id, pane] of panes) {
		if (!catalog.some(topic => topic.id === id) || !state.scope.topics.includes(id) && !all) { pane.reference.dispose(); pane.element.remove(); panes.delete(id); continue; }
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
					pageHistory.replace(urlFor(state.scope.active));
					void post('/api/view', { topic: id, patch: { query } }).catch(problem);
				},
				onSnapshot: system => {
					syncArticleLinks(element);
					if (document.activeElement === element) { focusArticle(id); }
					document.title = `${system.library?.document?.title ?? catalog.find(item => item.id === state.scope.active).title} — ${bookTitle}`;
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
const ready = () => Promise.all([...panes.values()].filter(pane => !pane.element.hidden).map(pane => pane.reference.ready));
refresh.addEventListener('click', async () => {
	if (refreshing) { return; }
	refreshing = true;
	updateRefresh();
	document.querySelector('#shell-problem')?.remove();
	try {
		await post('/api/checkout', { root: selectedCheckout });
		await reloadCheckout();
		await ready();
		document.querySelector('#checkout-status').textContent = 'Checkout reloaded';
	} catch (error) {
		problem(error);
	} finally {
		refreshing = false;
		updateRefresh();
	}
}, { signal: lifetime.signal });
async function applyURL() {
	pendingNavigations++;
	try {
		const url = new URL(location.href);
		const current = await request('/api/state', { signal: lifetime.signal });
		state = current;
		reconcile(current);
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
		pageHistory.replace(urlFor(state.scope.active));
		await ready();
	} finally { pendingNavigations--; }
}
document.addEventListener('click', event => {
	const link = event.target.closest('a[href]');
	if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target || link.hasAttribute('download')) { return; }
	const url = new URL(link.href);
	if (url.origin !== location.origin || url.pathname !== '/' || !url.searchParams.has('section')) { return; }
	event.preventDefault();
	const patch = readViewURL(url);
	const id = topicId(patch);
	if (url.hash && id === state.scope.active && (patch.documentId ?? '') === (state.views[id].documentId ?? '')) {
		pageHistory.replace(url);
	} else { pageHistory.push(url); }
	void applyURL().then(() => focusArticle(state.scope.active)).catch(problem);
}, { signal: lifetime.signal });
document.addEventListener('submit', event => {
	if (!event.target.matches('.document-search')) { return; }
	event.preventDefault();
	const url = new URL('/', location.href);
	url.search = new URLSearchParams(new FormData(event.target)).toString();
	pageHistory.push(url);
	void applyURL().then(() => focusArticle(state.scope.active)).catch(problem);
}, { signal: lifetime.signal });
async function start() {
	setRepository(await request('/api/repository', { signal: lifetime.signal }));
	catalog = (await request('/api/catalog', { signal: lifetime.signal })).topics;
	await updateCheckoutChoices();
	await applyURL();
	events = new EventSource('/api/events');
	events.onmessage = event => {
		const update = JSON.parse(event.data);
		if (update.kind === 'checkout') { void reloadCheckout().catch(problem); return; }
		if (update.kind === 'scope' || update.kind === 'view') {
			reconcile(update.state);
			if (!pendingNavigations) { pageHistory.replace(urlFor(state.scope.active)); }
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
