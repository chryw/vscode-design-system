/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- The portable reference runs directly in browsers. */
import { mountReference } from './reference.mjs';
import { createBookNavigation } from './book-navigation.mjs';
import { bookTitle, topicId } from './topics/catalog.mjs';
import { documentView, findDocument, resolveDocumentReference } from '../model/documents.mjs';
import { readViewURL, writeViewURL } from '../model/view-state.mjs';
import { setRepository } from './context.mjs';
import { bookNavigation } from '../model/catalog.mjs';
import { node, codicon, anchorPopup, createPageHistory, createAppearancePicker } from './ui.mjs';

const snapshot = globalThis.designSnapshot;
setRepository(snapshot.repository);
const target = document.querySelector('#reference');
const navigation = document.querySelector('#book-navigation');
let reference;
let active;
let view;
const lifetime = new AbortController();
createAppearancePicker(document.querySelector('.page-history'), lifetime.signal);
const pageHistory = createPageHistory(restore, lifetime.signal);
const contents = createBookNavigation(navigation, id => show(id, true), document.querySelector('.site-navigation') ?? navigation);
const topicURL = id => {
	const url = new URL(location.href);
	url.search = '';
	url.hash = '';
	url.searchParams.set('topic', id);
	return url;
};
const sourceURL = (id, anchor = '') => `https://github.com/microsoft/vscode/blob/${snapshot.commit}/${id.split('/').map(encodeURIComponent).join('/')}#${encodeURIComponent(anchor)}`;
function createSnapshotDetails() {
	const button = node('button', undefined, 'chrome-button secondary');
	button.id = 'snapshot-toggle';
	button.type = 'button';
	button.title = `Snapshot details: viewer v${snapshot.viewerVersion}`;
	button.setAttribute('aria-label', 'Snapshot details');
	button.setAttribute('aria-haspopup', 'dialog');
	button.setAttribute('aria-expanded', 'false');
	button.setAttribute('aria-controls', 'snapshot-details');
	button.append(node('span', `Snapshot v${snapshot.viewerVersion}`, 'snapshot-label'), codicon('chevron-down'));
	const popup = node('section', undefined, 'chrome-popup checkout-popup');
	popup.id = 'snapshot-details';
	popup.setAttribute('popover', 'auto');
	popup.setAttribute('role', 'dialog');
	popup.setAttribute('aria-labelledby', 'snapshot-title');
	button.popoverTargetElement = popup;
	const heading = node('h2', 'Snapshot');
	heading.id = 'snapshot-title';
	const date = node('time', new Date(snapshot.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }));
	date.dateTime = snapshot.createdAt;
	const revision = node('a', snapshot.commit.slice(0, 8));
	revision.href = `https://github.com/microsoft/vscode/tree/${snapshot.commit}`;
	revision.target = '_blank';
	revision.rel = 'noopener noreferrer';
	revision.autofocus = true;
	revision.setAttribute('aria-label', `Base revision ${snapshot.commit.slice(0, 8)} on GitHub (opens in a new tab)`);
	const metadata = node('dl', undefined, 'snapshot-metadata');
	for (const [label, value] of [
		['Viewer', `v${snapshot.viewerVersion}`], ['Captured', date], ['Repository', 'microsoft/vscode'],
		['Checkout', snapshot.branch], ['Base revision', revision], ['Saved changes', snapshot.modified ? 'Included' : 'None'],
	]) {
		const description = node('dd');
		description.append(value);
		metadata.append(node('dt', label), description);
	}
	popup.append(heading, metadata);
	document.querySelector('.checkout-details').append(button);
	document.querySelector('.explorer-heading').after(popup);
	anchorPopup(popup, button, lifetime.signal);
	button.addEventListener('keydown', event => {
		if (event.key === 'ArrowDown') { event.preventDefault(); popup.showPopover(); }
	}, { signal: lifetime.signal });
}
const problem = error => {
	target.replaceChildren();
	const message = document.createElement('p');
	message.setAttribute('role', 'alert');
	message.textContent = `Couldn't open this snapshot topic: ${error.message}`;
	target.append(message);
};
function updateURL() {
	const url = writeViewURL(topicURL(active), view, { topic: false });
	pageHistory.replace(url);
}
function show(id, push = false, settings = {}) {
	try {
		const topic = snapshot.topics[id];
		if (!topic) { throw new Error(`Unknown topic: ${id}`); }
		if (push) { pageHistory.push(writeViewURL(topicURL(id), { ...topic.view, ...settings }, { topic: false })); }
		reference?.dispose();
		active = id;
		view = { ...topic.view, ...settings };
		const { topics, utilities } = bookNavigation(snapshot.catalog);
		const link = item => ({ ...item, href: topicURL(item.id).href });
		contents.update(topics.map(link), id, utilities.map(link));
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
				return { href: sourceURL(reference.id, reference.anchor), external: true };
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
						const documentId = url.searchParams.get('documentId');
						if (url.searchParams.get('section') === 'documentation' && documentId && !findDocument(snapshot.documents, documentId)) {
							link.href = sourceURL(documentId, decodeURIComponent(url.hash.slice(1)));
							link.target = '_blank';
							link.rel = 'noopener noreferrer';
							link.setAttribute('aria-label', `${link.textContent} (opens in a new tab)`);
							continue;
						}
						const next = topicURL(topicId(Object.fromEntries(url.searchParams)));
						writeViewURL(next, readViewURL(url), { topic: false });
						link.href = next.href;
					}
				}
				if (push) {
					const heading = article.querySelector('h1');
					heading.tabIndex = -1;
					heading.focus({ preventScroll: true });
					if (!view.anchor) { heading.scrollIntoView({ block: 'start' }); }
					push = false;
				}
			},
		});
		return reference.ready;
	} catch (error) { problem(error); }
}
function restore() {
	const url = new URL(location.href);
	const settings = readViewURL(url);
	return show(url.searchParams.get('topic') ?? 'principles', false, settings);
}
document.addEventListener('click', event => {
	const link = event.target.closest('a[href]');
	if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target) { return; }
	const url = new URL(link.href);
	if (url.origin !== location.origin || url.pathname !== location.pathname || !url.searchParams.has('topic')) { return; }
	event.preventDefault();
	const id = url.searchParams.get('topic');
	const settings = readViewURL(url);
	const samePageAnchor = url.hash && id === active && (settings.documentId ?? '') === (view.documentId ?? '');
	if (samePageAnchor) { pageHistory.replace(url); }
	show(id, !samePageAnchor, settings);
});
document.addEventListener('submit', event => {
	if (!event.target.matches('.document-search')) { return; }
	event.preventDefault();
	const form = new FormData(event.target);
	show('documentation', true, { query: form.get('query'), documentScope: form.get('documentScope'), documentId: '', documentOffset: 0, anchor: '' });
	updateURL();
});
window.addEventListener('pagehide', event => {
	if (!event.persisted) { lifetime.abort(); reference?.dispose(); contents.dispose(); }
});
createSnapshotDetails();
restore();
