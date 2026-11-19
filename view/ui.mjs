/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

import { corePaletteThemes } from './token-lookup.mjs';

export const node = (tag, text, className) => {
	const element = document.createElement(tag);
	if (text !== undefined) {
		element.textContent = text;
	}
	if (className) {
		element.className = className;
	}
	return element;
};

export function codicon(id) {
	const icon = node('span', undefined, `chrome-icon codicon-${id}`);
	icon.setAttribute('aria-hidden', 'true');
	return icon;
}

export function disclosureSummary(...content) {
	const summary = node('summary', undefined, 'chrome-disclosure');
	summary.append(codicon('chevron-right'), ...content);
	return summary;
}

export function anchorPopup(popup, trigger, signal) {
	const position = (opening = false) => {
		if (!opening && !popup.matches(':popover-open')) { return; }
		const anchor = trigger.getBoundingClientRect();
		const bounds = opening ? { width: Number.parseFloat(getComputedStyle(popup).width), height: 0 } : popup.getBoundingClientRect();
		const below = innerHeight - anchor.bottom - 8;
		const above = anchor.top - 8;
		const height = Math.min(bounds.height, Math.max(below, above));
		popup.style.maxHeight = `${Math.max(below, above)}px`;
		popup.style.top = `${below >= bounds.height || below >= above ? anchor.bottom + 4 : anchor.top - height - 4}px`;
		popup.style.left = `${Math.max(8, Math.min(anchor.right - bounds.width, innerWidth - bounds.width - 8))}px`;
	};
	const observer = new ResizeObserver(() => position());
	observer.observe(popup);
	signal.addEventListener('abort', () => observer.disconnect(), { once: true });
	window.addEventListener('resize', () => position(), { signal });
	window.addEventListener('scroll', () => position(), { passive: true, signal });
	popup.addEventListener('beforetoggle', event => {
		if (event.target !== popup) { return; }
		trigger.setAttribute('aria-expanded', String(event.newState === 'open'));
		if (event.newState === 'open') { position(true); }
	}, { signal });
	popup.addEventListener('toggle', event => {
		if (event.target === popup && event.newState === 'open') { position(); }
	}, { signal });
	popup.addEventListener('keydown', event => {
		if (event.key === 'Escape' && popup.matches(':popover-open')) {
			event.preventDefault();
			popup.hidePopover();
			trigger.focus();
		}
	}, { signal });
}

let appearanceId = 0;
export function createAppearancePicker(history, signal, storage = () => localStorage) {
	const control = node('div', undefined, 'appearance-control');
	const button = node('button', undefined, 'chrome-icon-button');
	button.type = 'button';
	button.setAttribute('aria-haspopup', 'menu');
	button.setAttribute('aria-expanded', 'false');
	button.append(codicon('color-mode'));
	const popup = node('div', undefined, 'chrome-popup appearance-popup');
	popup.id = `appearance-${++appearanceId}`;
	popup.setAttribute('popover', 'auto');
	button.setAttribute('aria-controls', popup.id);
	button.popoverTargetElement = popup;
	const group = node('div', undefined, 'appearance-choices');
	group.setAttribute('role', 'menu');
	group.setAttribute('aria-label', 'Appearance');
	const options = new Map();
	for (const [value, label] of [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]) {
		const choice = node('button');
		choice.type = 'button';
		choice.value = value;
		choice.setAttribute('role', 'menuitemradio');
		choice.append(codicon('check'), node('span', label));
		group.append(choice);
		options.set(value, { choice, label });
	}
	const message = node('p', undefined, 'appearance-message');
	message.setAttribute('role', 'status');
	message.hidden = true;
	popup.append(group, message);
	control.append(button, popup);
	history.after(control);
	anchorPopup(popup, button, signal);
	signal.addEventListener('abort', () => control.remove(), { once: true });
	const report = text => {
		message.textContent = text;
		message.hidden = false;
		console.warn(text);
	};
	const apply = value => {
		document.documentElement.style.colorScheme = value === 'system' ? 'light dark' : value;
		for (const [id, { choice }] of options) {
			choice.setAttribute('aria-checked', String(id === value));
			choice.autofocus = id === value;
			choice.tabIndex = id === value ? 0 : -1;
		}
		button.title = `Appearance: ${options.get(value).label}`;
		button.setAttribute('aria-label', button.title);
	};
	const key = 'vscode-design-system.appearance';
	let saved;
	try { saved = storage().getItem(key); }
	catch (error) {
		if (!(error instanceof DOMException) || error.name !== 'SecurityError') { throw error; }
		report('This browser blocks appearance storage. Your choice can be changed here but will not be remembered after reload.');
	}
	if (saved !== null && saved !== undefined && !options.has(saved)) {
		report('The saved appearance is invalid. Choose System, Light, or Dark to replace it.');
	}
	apply(options.has(saved) ? saved : 'system');
	group.addEventListener('click', event => {
		const value = event.target.closest('button')?.value;
		if (!options.has(value)) { return; }
		apply(value);
		try {
			if (value === 'system') { storage().removeItem(key); }
			else { storage().setItem(key, value); }
			message.hidden = true;
			popup.hidePopover();
			button.focus();
		} catch (error) {
			if (!(error instanceof DOMException) || !['SecurityError', 'QuotaExceededError'].includes(error.name)) { throw error; }
			report('Appearance changed for this page, but this browser could not save it. It will not be remembered after reload.');
		}
	}, { signal });
	const choices = [...options.values()].map(({ choice }) => choice);
	const focusChoice = choice => {
		for (const item of choices) { item.tabIndex = item === choice ? 0 : -1; }
		choice.focus();
	};
	popup.addEventListener('beforetoggle', event => {
		if (event.newState === 'open') {
			for (const choice of choices) { choice.tabIndex = choice.getAttribute('aria-checked') === 'true' ? 0 : -1; }
		}
	}, { signal });
	button.addEventListener('keydown', event => {
		if (!['ArrowDown', 'ArrowUp'].includes(event.key)) { return; }
		event.preventDefault();
		popup.showPopover();
		focusChoice(event.key === 'ArrowDown' ? choices[0] : choices.at(-1));
	}, { signal });
	group.addEventListener('keydown', event => {
		if (event.key === 'Tab') {
			popup.hidePopover();
			button.focus();
			return;
		}
		const index = choices.indexOf(document.activeElement);
		let next;
		if (event.key === 'ArrowDown') { next = choices[(index + 1) % choices.length]; }
		else if (event.key === 'ArrowUp') { next = choices[(index + choices.length - 1) % choices.length]; }
		else if (event.key === 'Home') { next = choices[0]; }
		else if (event.key === 'End') { next = choices.at(-1); }
		else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
			next = choices.find(choice => choice.textContent.toLowerCase().startsWith(event.key.toLowerCase()));
		}
		if (next) {
			event.preventDefault();
			focusChoice(next);
		}
	}, { signal });
}

export function createPageHistory(onRestore, signal) {
	const back = document.querySelector('#history-back');
	const forward = document.querySelector('#history-forward');
	for (const [button, id] of [[back, 'arrow-left'], [forward, 'arrow-right']]) {
		const label = button.textContent;
		button.setAttribute('aria-label', label);
		button.title = label;
		button.classList.add('chrome-icon-button');
		button.replaceChildren(codicon(id));
	}
	let index = 0;
	let end = 0;
	let restoring = false;
	const heading = document.querySelector('.explorer-heading');
	const resize = new ResizeObserver(() => {
		document.body.style.setProperty('--site-header-height', `${heading.getBoundingClientRect().height}px`);
	});
	resize.observe(heading);
	signal.addEventListener('abort', () => resize.disconnect(), { once: true });
	const update = () => {
		back.disabled = restoring || index === 0;
		forward.disabled = restoring || index === end;
	};
	const replace = url => history.replaceState({ ...history.state, bookPage: { index, x: scrollX, y: scrollY } }, '', url);
	replace(location.href);
	history.scrollRestoration = 'manual';
	back.addEventListener('click', () => history.back(), { signal });
	forward.addEventListener('click', () => history.forward(), { signal });
	window.addEventListener('scroll', () => {
		if (!restoring) { replace(location.href); }
	}, { passive: true, signal });
	window.addEventListener('popstate', async event => {
		const destination = event.state?.bookPage;
		if (destination) { index = destination.index; }
		restoring = true;
		update();
		try {
			await onRestore();
			if (destination) { window.scrollTo(destination.x, destination.y); }
			else { replace(location.href); }
		} finally {
			restoring = false;
			update();
		}
	}, { signal });
	update();
	return {
		replace,
		push(url) {
			replace(location.href);
			history.pushState({ bookPage: { index: ++index, x: 0, y: 0 } }, '', url);
			end = index;
			update();
		},
	};
}

export function tokenButton(token, label = token.id) {
	const button = node('button', undefined, 'token-copy');
	button.type = 'button';
	button.setAttribute('aria-label', `Copy ${token.id} CSS variable ${token.css}`);
	button.append(node('code', label), node('span', 'Copy', 'copy-label'));
	button.addEventListener('click', () => copyText(`var(${token.css})`, button));
	return button;
}

let choiceGroupId = 0;
export function variantChoices(label, options, selected, onChange) {
	const group = node('fieldset', undefined, 'variant-choices');
	const groupName = `variant-${++choiceGroupId}`;
	group.append(node('legend', label));
	for (const { id, name } of options) {
		const choice = node('label');
		const input = node('input');
		input.type = 'radio';
		input.name = groupName;
		input.value = id;
		input.checked = id === selected;
		input.addEventListener('change', () => { if (input.checked) { onChange(id); } });
		choice.append(input, node('span', name));
		group.append(choice);
	}
	return group;
}

export function sourceLink(source, label = 'View source') {
	const link = node('a', label, 'source-action');
	link.href = `/source?file=${encodeURIComponent(source.file)}#L${source.line ?? 1}`;
	link.target = '_blank';
	link.rel = 'noopener noreferrer';
	link.setAttribute('aria-label', `${label === source.file ? 'Open' : label}: ${source.file}, line ${source.line ?? 1} (opens in a new tab)`);
	return link;
}

export function card(title, text) {
	const item = node('article', undefined, 'card');
	item.append(node('h3', title), node('p', text, 'muted'));
	return item;
}

export function example(title, text) {
	const item = node('section', undefined, 'article-section');
	item.append(node('h2', title), node('p', text, 'muted'));
	return item;
}

export function exampleViewer(stage, controls) {
	const viewer = node('div', undefined, 'reference-viewer');
	viewer.append(stage);
	if (controls) {
		controls.classList.add('reference-viewer-tools');
		viewer.append(controls);
	}
	return viewer;
}

export function paletteSwitcher(system, onChange) {
	const group = node('div', undefined, 'palette-switcher');
	group.setAttribute('role', 'group');
	group.setAttribute('aria-label', 'Palette theme');
	for (const { id, label } of corePaletteThemes) {
		const button = node('button', label);
		button.type = 'button';
		button.setAttribute('aria-pressed', String(system.view.theme === id));
		button.addEventListener('click', () => onChange({ theme: id }));
		group.append(button);
	}
	return group;
}
export function problemDetails(id) {
	const details = node('details', undefined, 'canvas-problem');
	details.id = id;
	details.hidden = true;
	const message = node('span');
	message.setAttribute('role', 'alert');
	const summary = disclosureSummary(message);
	details.append(summary, node('p'));
	return details;
}

export function showProblem(target, title, message) {
	target.hidden = false;
	target.querySelector('summary [role="alert"]').textContent = title;
	target.querySelector('p').textContent = message;
}

export function problem(error, context = document.activeElement) {
	const target = context?.closest?.('.topic-pane')?.querySelector('#problem') ?? document.querySelector('#problem');
	showProblem(target, 'Action failed — details', `${error.message}. Use Refresh to retry.`);
}

export async function request(url, options) {
	const response = await fetch(url, options);
	if (!response.ok) {
		throw new Error(await response.text());
	}
	return response.json();
}

export async function copyText(text, context = document.activeElement) {
	const status = context?.closest?.('.topic-pane')?.querySelector('#status') ?? document.querySelector('#status');
	const button = context?.closest?.('button');
	const feedback = (message, state) => {
		if (!button?.isConnected) { return; }
		let label = button.querySelector('.copy-feedback');
		if (!label) {
			label = node('span', undefined, 'copy-feedback');
			label.setAttribute('aria-hidden', 'true');
			button.append(label);
		}
		label.textContent = message;
		button.dataset.copyState = state;
	};
	try {
		await navigator.clipboard.writeText(text);
		feedback('Copied', 'copied');
		if (status?.isConnected) {
			status.hidden = false;
			status.textContent = `Copied ${text}`;
		}
	} catch (error) {
		feedback('Copy failed', 'error');
		problem(new Error(`Couldn't copy: ${error.message}. Select the visible text to copy it`), context);
	}
}
