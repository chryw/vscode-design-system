/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- The portable reference runs directly in browsers. */
import { mountReference } from './reference.mjs';
import { createBookNavigation } from './book-navigation.mjs';
import { bookTitle, topicId } from './topics/catalog.mjs';
import { documentView, resolveDocumentReference } from '../model/documents.mjs';
import { readViewURL, writeViewURL } from '../model/view-state.mjs';
import { setRepository } from './context.mjs';

const snapshot = globalThis.designSnapshot;
setRepository(snapshot.repository);
const target = document.querySelector('#reference');
const navigation = document.querySelector('#book-navigation');
let reference;
let active;
let view;
const contents = createBookNavigation(navigation, id => show(id, true), document.querySelector('#book-pagination'));
const topicURL = id => {
	const url = new URL(location.href);
	url.search = '';
	url.hash = '';
	url.searchParams.set('topic', id);
	return url;
};
const problem = error => {
	target.replaceChildren();
	const message = document.createElement('p');
	message.setAttribute('role', 'alert');
	message.textContent = `Couldn't open this snapshot topic: ${error.message}`;
	target.append(message);
};
function updateURL() {
	const url = writeViewURL(topicURL(active), view, { topic: false });
	history.replaceState(null, '', url);
}
function show(id, push = false, settings = {}) {
	try {
		const topic = snapshot.topics[id];
		if (!topic) { throw new Error(`Unknown topic: ${id}`); }
		reference?.dispose();
		active = id;
		view = { ...topic.view, ...settings };
		if (push) { history.pushState(null, '', writeViewURL(topicURL(id), view, { topic: false })); }
		contents.update(snapshot.catalog.map(item => ({
			id: item.id, title: item.title, group: item.group, subgroup: item.subgroup, aliases: item.aliases, href: topicURL(item.id).href,
		})), id);
		const article = document.createElement('article');
		article.className = 'design-reference topic-pane';
		article.dataset.topic = id;
		article.setAttribute('aria-label', snapshot.catalog.find(item => item.id === id).title);
		target.replaceChildren(article);
		reference = mountReference(article, view, {
			read: async () => {
				const library = id === 'documentation' ? documentView(snapshot.documents, view) : undefined;
				return { ...topic, view: { ...view }, ...(library ? {
					library, sourceFiles: [...topic.sourceFiles, ...(library.document ? [library.document.id] : [])],
				} : {}) };
			},
			documentResource: (id, target, image) => {
				if (image) {
					const key = JSON.stringify([id, target]);
					return snapshot.documentImages[key] ? { href: snapshot.documentImages[key], image: true }
						: { problem: snapshot.documentImageProblems[key] ?? 'Image is not available in this snapshot' };
				}
				const reference = resolveDocumentReference(id, target);
				return { href: `https://github.com/microsoft/vscode/blob/${snapshot.commit}/${reference.id.split('/').map(encodeURIComponent).join('/')}#${encodeURIComponent(reference.anchor ?? '')}`, external: true };
			},
			onView: patch => {
				Object.assign(view, patch);
				updateURL();
				if (Object.keys(patch).some(key => !['fixtureId', 'anchor'].includes(key))) { show(id, false, view); }
			},
			onQuery: query => { view.query = query; updateURL(); },
			onSnapshot: system => {
				document.title = `${system.library?.document?.title ?? snapshot.catalog.find(item => item.id === id).title} — ${bookTitle}`;
				for (const link of article.querySelectorAll('a[href]')) {
					const url = new URL(link.href);
					if (url.origin === location.origin && url.searchParams.has('section')) {
						const next = topicURL(topicId(Object.fromEntries(url.searchParams)));
						writeViewURL(next, readViewURL(url), { topic: false });
						link.href = next.href;
					}
				}
				if (push) {
					const heading = article.querySelector('h1');
					heading.tabIndex = -1;
					heading.focus({ preventScroll: true });
					heading.scrollIntoView({ block: 'start' });
					push = false;
				}
			},
		});
	} catch (error) { problem(error); }
}
function restore() {
	const url = new URL(location.href);
	const settings = readViewURL(url);
	show(url.searchParams.get('topic') ?? 'principles', false, settings);
}
document.addEventListener('click', event => {
	const link = event.target.closest('a[href]');
	if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target) { return; }
	const url = new URL(link.href);
	if (url.origin !== location.origin || url.pathname !== location.pathname || !url.searchParams.has('topic')) { return; }
	event.preventDefault();
	show(url.searchParams.get('topic'), true, readViewURL(url));
});
document.addEventListener('submit', event => {
	if (!event.target.matches('.document-search')) { return; }
	event.preventDefault();
	const form = new FormData(event.target);
	show('documentation', true, { query: form.get('query'), documentScope: form.get('documentScope'), documentId: '', documentOffset: 0, anchor: '' });
	updateURL();
});
window.addEventListener('popstate', restore);
window.addEventListener('pagehide', event => {
	if (!event.persisted) { reference?.dispose(); contents.dispose(); }
});
document.querySelector('#snapshot-date').textContent = new Date(snapshot.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
restore();
