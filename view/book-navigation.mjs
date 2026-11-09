/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

let navigationId = 0;
export function createBookNavigation(container, onNavigate, pagerContainer = container) {
	const document = container.ownerDocument;
	const lifetime = new AbortController();
	const wide = document.defaultView.matchMedia('(min-width: 760px)');
	const toolbar = document.createElement('div');
	toolbar.className = 'book-toolbar';
	const toggle = document.createElement('button');
	toggle.type = 'button';
	toggle.textContent = 'Browse topics';
	toggle.setAttribute('aria-expanded', 'false');
	const current = document.createElement('span');
	current.className = 'book-current';
	toolbar.append(toggle, current);
	const panel = document.createElement('aside');
	panel.className = 'book-panel';
	panel.id = `book-panel-${++navigationId}`;
	panel.setAttribute('aria-label', 'Topic navigation');
	toggle.popoverTargetElement = panel;
	toggle.setAttribute('aria-controls', panel.id);
	const header = document.createElement('div');
	header.className = 'book-panel-heading';
	const title = document.createElement('strong');
	title.textContent = 'Design system';
	const close = document.createElement('button');
	close.type = 'button';
	close.textContent = 'Close';
	close.setAttribute('aria-label', 'Close topic navigation');
	header.append(title, close);
	const label = document.createElement('label');
	label.className = 'book-search';
	label.append('Find a topic');
	const search = document.createElement('input');
	search.type = 'search';
	search.placeholder = 'Filter topics';
	search.maxLength = 200;
	search.autofocus = true;
	label.append(search);
	const navigation = document.createElement('nav');
	navigation.setAttribute('aria-label', 'Topics');
	const empty = document.createElement('p');
	empty.className = 'book-empty';
	empty.hidden = true;
	empty.textContent = 'No matching topics';
	const status = document.createElement('p');
	status.className = 'sr-only';
	status.setAttribute('role', 'status');
	panel.append(header, label, navigation, empty, status);
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
		if (panel.isConnected) { revealActive(); }
	};
	presentation();
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
	const pager = document.createElement('div');
	pager.className = 'book-pagination';
	const neighbors = ['Previous', 'Next'].map(label => {
		const link = document.createElement('a');
		link.className = 'book-neighbor';
		const caption = document.createElement('span');
		caption.textContent = label;
		const title = document.createElement('span');
		link.append(caption, title);
		link.addEventListener('click', event => {
			if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) { return; }
			event.preventDefault();
			choose(link.dataset.topic);
		});
		pager.append(link);
		return { link, title, label };
	});
	let signature;
	let activeId;
	const links = new Map();
	const groups = new Map();
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
			link.parentElement.hidden = !`${item.title} ${item.group ?? ''} ${item.subgroup ?? ''} ${(item.aliases ?? []).join(' ')}`.toLocaleLowerCase().includes(query);
			if (!link.parentElement.hidden) { count++; }
		}
		for (const { element, list, open, wrapper } of [...groups.values()].reverse()) {
			element.hidden = ![...list.children].some(child => !child.hidden);
			wrapper.hidden = element.hidden;
			element.open = query ? !element.hidden : open;
		}
		empty.hidden = count > 0;
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
			const summary = document.createElement('summary');
			summary.textContent = title;
			const list = document.createElement('ul');
			element.append(summary, list);
			parent.append(element);
			groups.set(key, { element, list, open: false, wrapper: parent.tagName === 'LI' ? parent : element });
		}
		return groups.get(key);
	};
	return {
		update(items, active) {
			container.hidden = !items.length;
			pagerContainer.hidden = !items.length;
			if (!items.length) {
				dismiss();
				toolbar.remove();
				panel.remove();
				pager.remove();
				return;
			}
			if (!panel.isConnected) { container.append(toolbar, panel); pagerContainer.append(pager); }
			const nextSignature = JSON.stringify(items.map(({ id, title, group, subgroup, aliases }) => ({ id, title, group, subgroup, aliases })));
			if (nextSignature !== signature) {
				signature = nextSignature;
				navigation.replaceChildren();
				links.clear();
				groups.clear();
				for (const item of items) {
					let parent = group(JSON.stringify([item.group ?? '']), item.group || 'Topics', navigation);
					if (item.subgroup) {
						const key = JSON.stringify([item.group ?? '', item.subgroup]);
						let entry = groups.get(key)?.element.parentElement;
						if (!entry) { entry = document.createElement('li'); parent.list.append(entry); }
						parent = group(key, item.subgroup, entry);
					}
					const link = document.createElement('a');
					link.textContent = item.title;
					link.href = item.href;
					link.addEventListener('click', event => {
						if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) { return; }
						event.preventDefault();
						choose(item.id);
					});
					const entry = document.createElement('li');
					entry.append(link);
					parent.list.append(entry);
					links.set(item.id, { link, item });
				}
			}
			for (const item of items) {
				const entry = links.get(item.id);
				entry.link.href = item.href;
				entry.item = item;
			}
			for (const [id, { link }] of links) {
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
			current.textContent = links.get(active)?.item.title ?? '';
			if (activeId !== active || !search.value) {
				for (const group of groups.values()) { group.open = group.element.open; }
			}
			const changed = activeId !== active;
			activeId = active;
			filter();
			if (changed) { revealActive(); }
			const index = items.findIndex(item => item.id === active);
			neighbors.forEach(({ link, title, label }, offset) => {
				const item = index < 0 ? undefined : items[index + (offset === 0 ? -1 : 1)];
				link.hidden = !item;
				if (item) {
					title.textContent = item.title;
					link.href = item.href;
					link.dataset.topic = item.id;
					link.setAttribute('aria-label', `${label}: ${item.title}`);
				}
			});
		},
		dispose() { dismiss(); lifetime.abort(); toolbar.remove(); panel.remove(); pager.remove(); },
	};
}
