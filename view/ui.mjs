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
	link.setAttribute('aria-label', `${label}: ${source.file}, line ${source.line ?? 1} (opens in a new tab)`);
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
export function problem(error, context = document.activeElement) {
	const target = context?.closest?.('.topic-pane')?.querySelector('#problem') ?? document.querySelector('#problem');
	target.hidden = false;
	target.textContent = `${error.message}. Use Refresh to retry.`;
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
