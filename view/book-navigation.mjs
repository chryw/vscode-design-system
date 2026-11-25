/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

import { disclosureSummary } from './ui.mjs';

let navigationId = 0;
export function createBookNavigation(container, onNavigate, toolbarHost = container) {
	const document = container.ownerDocument;
	const lifetime = new AbortController();
	const wide = document.defaultView.matchMedia('(min-width: 960px)');
	const toolbar = document.createElement('div');
	toolbar.className = 'book-toolbar';
	const toggle = document.createElement('button');
	toggle.type = 'button';
	toggle.className = 'chrome-icon-button';
	toggle.setAttribute('aria-label', 'Browse topics');
	toggle.title = 'Browse topics';
	toggle.setAttribute('aria-expanded', 'false');
	const expand = document.createElement('span');
	expand.className = 'chrome-icon codicon-menu';
	expand.setAttribute('aria-hidden', 'true');
	toggle.append(expand);
	toolbar.append(toggle);
	const panel = document.createElement('aside');
	panel.className = 'book-panel';
	panel.id = `book-panel-${++navigationId}`;
	panel.setAttribute('aria-label', 'Topic navigation');
	toggle.popoverTargetElement = panel;
	toggle.setAttribute('aria-controls', panel.id);
	const header = document.createElement('div');
	header.className = 'book-panel-heading';
	const close = document.createElement('button');
	close.type = 'button';
	close.className = 'chrome-icon-button';
	const closeIcon = document.createElement('span');
	closeIcon.className = 'chrome-icon codicon-close';
	closeIcon.setAttribute('aria-hidden', 'true');
	close.append(closeIcon);
	close.title = 'Close topic navigation';
	close.setAttribute('aria-label', 'Close topic navigation');
	header.append(close);
	const label = document.createElement('label');
	label.className = 'book-search';
	const searchLabel = document.createElement('span');
	searchLabel.className = 'sr-only';
	searchLabel.textContent = 'Search topics';
	label.append(searchLabel);
	const search = document.createElement('input');
	search.className = 'chrome-input';
	search.type = 'search';
	search.placeholder = 'Search topics';
	search.maxLength = 200;
	search.autofocus = true;
	const searchIcon = document.createElement('span');
	searchIcon.className = 'chrome-icon codicon-search';
	searchIcon.setAttribute('aria-hidden', 'true');
	label.append(searchIcon, search);
	const navigation = document.createElement('nav');
	navigation.className = 'book-topics';
	navigation.setAttribute('aria-label', 'Topics');
	const utilities = document.createElement('nav');
	utilities.className = 'book-utilities';
	utilities.setAttribute('aria-label', 'Book tools');
	utilities.hidden = true;
	const empty = document.createElement('p');
	empty.className = 'book-empty';
	empty.hidden = true;
	empty.textContent = 'No matching topics';
	const status = document.createElement('p');
	status.className = 'sr-only';
	status.setAttribute('role', 'status');
	panel.append(header, label, navigation, empty, status, utilities);
	const dismiss = () => {
		if (panel.matches(':popover-open')) { panel.hidePopover(); }
	};
	const presentation = () => {
		const restoreFocus = panel.contains(document.activeElement) || document.activeElement === toggle;
		dismiss();
		if (wide.matches) { panel.removeAttribute('popover'); }
		else { panel.setAttribute('popover', 'auto'); }
		search.autofocus = !wide.matches;
		if (restoreFocus) { (wide.matches ? search : toggle).focus({ preventScroll: true }); }
		if (panel.isConnected) { layout(); revealActive(); }
	};
	presentation();
	const resize = new document.defaultView.ResizeObserver(() => layout());
	resize.observe(document.body);
	document.defaultView.addEventListener('resize', () => layout(), { signal: lifetime.signal });
	document.defaultView.addEventListener('scroll', () => layout(), { passive: true, signal: lifetime.signal });
	wide.addEventListener('change', presentation, { signal: lifetime.signal });
	panel.addEventListener('toggle', event => {
		if (event.target !== panel) { return; }
		toggle.setAttribute('aria-expanded', String(event.newState === 'open'));
		if (event.newState === 'open') { revealActive(); }
	}, { signal: lifetime.signal });
	close.addEventListener('click', () => { dismiss(); toggle.focus({ preventScroll: true }); }, { signal: lifetime.signal });
	panel.addEventListener('keydown', event => {
		if (event.key === 'Escape' && panel.matches(':popover-open')) {
			event.preventDefault();
			dismiss();
			toggle.focus({ preventScroll: true });
		}
	}, { signal: lifetime.signal });
	const choose = id => {
		search.value = '';
		delete search.dataset.filtering;
		filter();
		dismiss();
		onNavigate(id);
	};
	let signature;
	let activeId;
	const links = new Map();
	const utilityLinks = new Map();
	const groups = new Map();
	const createLink = item => {
		const link = document.createElement('a');
		const title = document.createElement('span');
		title.textContent = item.title;
		link.append(title);
		if (item.isDraft) {
			const status = document.createElement('span');
			status.className = 'book-topic-status';
			status.textContent = 'Draft';
			link.append(status);
		}
		link.href = item.href;
		link.addEventListener('click', event => {
			if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) { return; }
			event.preventDefault();
			choose(item.id);
		});
		return link;
	};
	function layout() {
		if (!panel.isConnected) { return; }
		if (wide.matches) {
			panel.style.maxHeight = `${Math.max(0, document.defaultView.innerHeight - panel.getBoundingClientRect().top - 24)}px`;
		} else { panel.style.removeProperty('max-height'); }
	}
	function revealActive() {
		const link = links.get(activeId)?.link;
		if (!link?.getClientRects().length) { return; }
		const bounds = link.getBoundingClientRect();
		const viewport = navigation.getBoundingClientRect();
		const group = [...navigation.children].find(group => group.contains(link));
		const top = viewport.top + (group?.querySelector(':scope > summary')?.getBoundingClientRect().height ?? 0);
		const bottom = Math.min(viewport.bottom, document.defaultView.innerHeight - 24);
		if (bounds.top < top) { navigation.scrollTop += bounds.top - top; }
		else if (bounds.bottom > bottom) { navigation.scrollTop += bounds.bottom - bottom; }
	}
	const filter = () => {
		const query = search.value.trim().toLocaleLowerCase();
		let count = 0;
		for (const { link, item } of links.values()) {
			link.parentElement.hidden = !`${item.title} ${item.group ?? ''} ${item.subgroup ?? ''} ${item.isDraft ? 'draft' : ''} ${(item.aliases ?? []).join(' ')}`.toLocaleLowerCase().includes(query);
			if (!link.parentElement.hidden) { count++; }
		}
		for (const { element, list, open, wrapper } of [...groups.values()].reverse()) {
			element.hidden = ![...list.children].some(child => !child.hidden);
			wrapper.hidden = element.hidden;
			element.open = query ? !element.hidden : open;
		}
		empty.hidden = count > 0 || !links.size;
		status.textContent = query ? `${count} matching topics` : '';
	};
	search.addEventListener('input', () => {
		if (!search.dataset.filtering) {
			for (const group of groups.values()) { group.open = group.element.open; }
		}
		if (search.value) { search.dataset.filtering = 'true'; }
		else { delete search.dataset.filtering; }
		filter();
	}, { signal: lifetime.signal });
	search.addEventListener('keydown', event => {
		if (event.key === 'ArrowDown') {
			const match = [...links.values()].find(({ link }) => link.getClientRects().length);
			if (match) { event.preventDefault(); match.link.focus(); }
		}
	}, { signal: lifetime.signal });
	const group = (key, title, parent) => {
		if (!groups.has(key)) {
			const element = document.createElement('details');
			element.className = 'book-group';
			const summary = disclosureSummary(title);
			const list = document.createElement('ul');
			element.append(summary, list);
			parent.append(element);
			groups.set(key, { element, list, open: false, wrapper: parent.tagName === 'LI' ? parent : element });
		}
		return groups.get(key);
	};
	return {
		update(items, active, tools = []) {
			container.hidden = !items.length && !tools.length;
			if (container.hidden) {
				dismiss();
				toolbar.remove();
				panel.remove();
				return;
			}
			if (!panel.isConnected) { toolbarHost.append(toolbar); container.append(panel); }
			label.hidden = !items.length;
			navigation.hidden = !items.length;
			const identity = ({ id, title, group, subgroup, kind, isDraft, aliases }) => ({ id, title, group, subgroup, kind, isDraft, aliases });
			const nextSignature = JSON.stringify([items.map(identity), tools.map(identity)]);
			if (nextSignature !== signature) {
				signature = nextSignature;
				activeId = undefined;
				navigation.replaceChildren();
				utilities.replaceChildren();
				links.clear();
				utilityLinks.clear();
				groups.clear();
				utilities.hidden = !tools.length;
				for (const item of items) {
					let parent = group(JSON.stringify([item.group ?? '']), item.group || 'Topics', navigation);
					if (item.subgroup) {
						const key = JSON.stringify([item.group ?? '', item.subgroup]);
						let entry = groups.get(key)?.element.parentElement;
						if (!entry) { entry = document.createElement('li'); parent.list.append(entry); }
						parent = group(key, item.subgroup, entry);
					}
					const link = createLink(item);
					const entry = document.createElement('li');
					entry.append(link);
					parent.list.append(entry);
					links.set(item.id, { link, item });
				}
				for (const item of tools) {
					const link = createLink(item);
					utilities.append(link);
					utilityLinks.set(item.id, { link, item });
				}
			}
			for (const item of [...items, ...tools]) {
				const entry = links.get(item.id) ?? utilityLinks.get(item.id);
				entry.link.href = item.href;
				entry.item = item;
			}
			for (const [id, { link }] of [...links, ...utilityLinks]) {
				if (id === active) {
					link.setAttribute('aria-current', 'page');
					if (activeId !== active) {
						for (let ancestor = link.closest('details'); ancestor && panel.contains(ancestor); ancestor = ancestor.parentElement.closest('details')) {
							ancestor.open = true;
						}
					}
				}
				else { link.removeAttribute('aria-current'); }
			}
			if (activeId !== active || !search.value) {
				for (const group of groups.values()) { group.open = group.element.open; }
			}
			const changed = activeId !== active;
			activeId = active;
			filter();
			layout();
			if (changed) { revealActive(); }
		},
		dispose() { dismiss(); lifetime.abort(); resize.disconnect(); toolbar.remove(); panel.remove(); },
	};
}
