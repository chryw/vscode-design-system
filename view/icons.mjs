/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

import { node, copyText } from './ui.mjs';

const matches = (value, query) => JSON.stringify(value).toLowerCase().includes(query.toLowerCase());
let selectedIconId;

export function iconRowEnd(index, columns, total) {
	return Math.min(total - 1, Math.ceil((index + 1) / columns) * columns - 1);
}

function glyph(icon, compact = false) {
	if (icon.fontAvailable === false) {
		return node('span', 'Not installed', 'meta');
	}
	const preview = node('span', String.fromCodePoint(Number.parseInt(icon.code, 16)), compact ? 'codicon-glyph compact' : 'codicon-glyph');
	preview.setAttribute('aria-hidden', 'true');
	return preview;
}

export async function renderIcons(content, system, onFilter, signal) {
	if (!system.codiconFontAvailable) {
		content.append(node('p', 'The local Codicon font is missing. Restore the repository Codicon dependency to display glyphs.', 'notice'));
		return 0;
	}
	const faces = await content.ownerDocument.fonts.load('16px canvas-codicon');
	signal.throwIfAborted();
	if (!faces.length) {
		throw new Error('The local Codicon font could not load');
	}
	const label = node('label', 'Filter icons', 'icon-filter');
	const input = node('input');
	input.type = 'search';
	input.maxLength = 200;
	input.value = system.view.query;
	label.append(input);
	const scroll = node('div', undefined, 'icon-scroll');
	scroll.tabIndex = 0;
	scroll.setAttribute('role', 'region');
	scroll.setAttribute('aria-label', 'Icon catalog');
	const count = node('span', undefined, 'sr-only');
	count.setAttribute('role', 'status');
	const inspector = node('section', undefined, 'visual-example icon-inspector');
	inspector.id = 'selected-icon-detail';
	const grid = node('div', undefined, 'icon-grid');
	scroll.append(grid);
	content.append(label, count, scroll);
	let buttons = [];
	let icons = [];
	const reveal = () => {
		if (!inspector.isConnected) { return; }
		const item = inspector.getBoundingClientRect();
		const viewport = scroll.getBoundingClientRect();
		const delta = item.bottom > viewport.bottom ? item.bottom - viewport.bottom : item.top < viewport.top ? item.top - viewport.top : 0;
		if (delta) {
			scroll.scrollTo({ top: scroll.scrollTop + delta, behavior: 'instant' });
		}
	};
	const place = () => {
		const index = icons.findIndex(icon => icon.id === selectedIconId);
		if (index < 0 || !buttons.length) {
			inspector.remove();
			return;
		}
		const columns = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length);
		const last = buttons[iconRowEnd(index, columns, buttons.length)];
		if (last.nextElementSibling !== inspector) {
			last.after(inspector);
		}
	};
	function inspect(icon) {
		if (selectedIconId === icon.id && inspector.isConnected) {
			selectedIconId = undefined;
			inspector.remove();
			for (const button of buttons) {
				button.setAttribute('aria-expanded', 'false');
				button.setAttribute('aria-pressed', 'false');
			}
			return;
		}
		selectedIconId = icon.id;
		inspector.replaceChildren(node('h2', icon.id));
		if (icon.fontAvailable === false) {
			inspector.append(node('p', 'This icon is registered in the checkout but missing from its installed Codicon font. Refresh the checkout’s Codicon dependency to preview it.', 'notice'));
		}
		const samples = node('div', undefined, 'tools');
		samples.append(glyph(icon), node('code', `codicon codicon-${icon.id}`), node('span', '16px preview', 'meta'));
		const compact = system.icons.find(item => item.id === `${icon.id}-compact`);
		if (compact) {
			samples.append(glyph(compact, true), node('span', `${compact.id} · 12px`, 'meta'));
		}
		inspector.append(samples, node('code', `U+${icon.code.slice(2).toUpperCase()} · content: "\\${icon.code.slice(2)}"`));
		const actions = node('div', undefined, 'tools');
		const copyClass = node('button', 'Copy icon class');
		copyClass.type = 'button';
		copyClass.addEventListener('click', () => copyText(`codicon codicon-${icon.id}`, copyClass));
		const copyCode = node('button', 'Copy CSS code point');
		copyCode.type = 'button';
		copyCode.addEventListener('click', () => copyText(`\\${icon.code.slice(2)}`, copyCode));
		actions.append(copyClass, copyCode);
		inspector.append(actions);
		for (const button of buttons) {
			button.setAttribute('aria-pressed', String(button.dataset.icon === icon.id));
			button.setAttribute('aria-expanded', String(button.dataset.icon === icon.id));
		}
		place();
		reveal();
	}
	const update = () => {
		icons = system.icons.filter(icon => matches(icon, input.value));
		count.textContent = `${icons.length} icons`;
		grid.replaceChildren();
		buttons = [];
		for (const icon of icons) {
		const button = node('button', undefined, 'icon-tile');
		button.type = 'button';
		button.dataset.icon = icon.id;
		button.setAttribute('aria-label', `Inspect ${icon.id}`);
		button.setAttribute('aria-expanded', 'false');
		button.setAttribute('aria-controls', inspector.id);
		button.append(glyph(icon), node('span', icon.id));
		button.addEventListener('click', () => inspect(icon));
		grid.append(button);
		buttons.push(button);
		}
		if (!icons.length) {
			grid.append(node('p', 'No matching icons', 'meta'));
		}
		if (icons.some(icon => icon.id === selectedIconId)) {
			const selected = selectedIconId;
			selectedIconId = undefined;
			inspect(icons.find(icon => icon.id === selected));
		}
	};
	input.addEventListener('input', () => { onFilter(input.value); update(); }, { signal });
	const observer = new ResizeObserver(() => {
		place();
		if (selectedIconId && inspector.isConnected) {
			reveal();
		}
	});
	observer.observe(grid);
	signal.addEventListener('abort', () => observer.disconnect(), { once: true });
	update();
	return icons.length;
}
