/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

import { node, exampleViewer, request, variantChoices } from './ui.mjs';
import { specificationUrl } from './component-specs.mjs';

export async function renderFixturePreview(content, control, fixtureId, signal, onView, { id = 'component-example', heading = 'h2', compact = false, variantLabel = 'Variant', previewLabel, preferredTheme, showVariants = true, pauseWhenHidden = false, mapVisibilityInput, actionsHost, contentSized = true, fillWidth = false, lazy = false, input = {}, onStatus, onMessage } = {}) {
	const example = node('section', undefined, heading ? 'control-stage article-section reference-example' : 'control-stage');
	example.id = id;
	const status = node('p', 'Connecting to the live Component Explorer...', 'preview-status');
	status.setAttribute('role', 'status');
	if (heading) { example.append(node(heading, compact ? 'Live example' : 'Preview'), node('p', control.docs.preview ?? control.docs.summary, 'muted')); }
	example.append(status);
	content.append(example);
	if (!control.groups.length) {
		status.textContent = control.docs.preview;
		return;
	}
	const controls = node('div');
	const frame = node('iframe', undefined, 'component-preview');
	if (contentSized) {
		frame.style.minHeight = '0';
		frame.style.maxWidth = '100%';
	}
	if (fillWidth) { frame.style.width = '100%'; }
	frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
	frame.hidden = true;
	const actions = node('div', undefined, 'tools');
	const open = node('a', 'Open in Component Explorer');
	open.target = '_blank';
	open.rel = 'noopener noreferrer';
	open.hidden = true;
	actions.append(open);
	if (heading) {
		const stage = node('div', undefined, 'reference-live-stage');
		stage.append(frame);
		const chrome = node('div');
		chrome.append(controls);
		if (!actionsHost) { chrome.append(actions); }
		example.append(exampleViewer(stage, chrome));
	} else {
		// Headingless previews supply their own surrounding viewer and controls.
		example.append(controls, frame);
		if (!actionsHost) { example.append(actions); }
	}
	if (actionsHost) { actionsHost.append(actions); }
	let catalog;
	let selected;
	let timeout;
	let healthTimer;
	let connecting;
	let checking = false;
	let recovered = false;
	let generation = 0;
	let choicesSignature;
	let currentInput = { overrideFocus: false, enableAnimations: true, ...input };
	let intersecting = true;
	let visible = !document.hidden;
	const frameInput = () => pauseWhenHidden ? mapVisibilityInput ? mapVisibilityInput(currentInput, visible) : { ...currentInput, enableAnimations: currentInput.enableAnimations === true && visible } : currentInput;
	const sendInput = () => {
		if (!signal.aborted && catalog && example.dataset.previewState === 'ready') {
			frame.contentWindow.postMessage({ type: 'component-explorer:embedded-input', input: frameInput() }, new URL(catalog.explorerUrl).origin);
		}
	};
	const updateVisibility = () => {
		if (!pauseWhenHidden) { return; }
		const next = intersecting && !document.hidden;
		if (next !== visible) {
			visible = next;
			sendInput();
			if (visible) { scheduleCheck(); } else { clearTimeout(healthTimer); }
		}
	};
	const visibilityObserver = pauseWhenHidden ? new IntersectionObserver(entries => {
		intersecting = !!entries[0]?.isIntersecting;
		updateVisibility();
	}) : undefined;
	signal.addEventListener('abort', () => visibilityObserver?.disconnect(), { once: true });
	visibilityObserver?.observe(frame);
	const active = () => !document.hidden && example.isConnected && !example.closest('[hidden]') && (!pauseWhenHidden || visible);
	const message = (state, text, alert = false) => {
		example.dataset.previewState = state;
		status.textContent = text;
		status.setAttribute('role', alert ? 'alert' : 'status');
		status.classList.toggle('sr-only', Boolean(heading) && state === 'ready');
		onStatus?.(state);
	};
	const unavailable = error => {
		clearTimeout(timeout);
		clearTimeout(healthTimer);
		message('unavailable', `${error.message}. Use Refresh to retry.`, true);
	};
	const recover = async error => {
		if (signal.aborted) { return; }
		if (recovered) { unavailable(error); return; }
		recovered = true;
		clearTimeout(timeout);
		clearTimeout(healthTimer);
		message('connecting', `${error.message}. Reconnecting automatically…`);
		try {
			await connect(true);
		} catch (error) {
			if (!signal.aborted) { unavailable(error); }
		}
	};
	const show = () => {
		clearTimeout(timeout);
		if (!selected) {
			frame.hidden = open.hidden = true;
			message('unavailable', `The live catalog no longer contains ${fixtureId}. Choose an available variant below.`, true);
			return;
		}
		frame.hidden = open.hidden = false;
		message('loading', `Loading ${selected.name}…`);
		const url = new URL(catalog.explorerUrl);
		url.searchParams.set('mode', 'embedded');
		url.searchParams.set('fixture', selected.id);
		frame.title = `${control.name}: ${selected.name}, interactive fixture`;
		frame.src = url.href;
		url.searchParams.delete('mode');
		open.href = url.href;
		timeout = setTimeout(() => { void recover(new Error('The live preview did not become ready')); }, 30000);
	};
	const check = async () => {
		clearTimeout(healthTimer);
		if (signal.aborted || !active() || connecting || checking
			|| example.dataset.previewState !== 'ready') { return; }
		checking = true;
		const version = generation;
		try {
			const current = await request('/api/fixtures?check=true', { signal });
			if (signal.aborted || version !== generation) { return; }
			if (current.explorerUrl !== catalog.explorerUrl) {
				catalog = current;
				show();
			}
		} catch (error) {
			if (version === generation) { await recover(error); }
		} finally {
			checking = false;
			scheduleCheck();
		}
	};
	const scheduleCheck = () => {
		clearTimeout(healthTimer);
		if (!signal.aborted && active() && example.dataset.previewState === 'ready') {
			healthTimer = setTimeout(() => { void check(); }, 15000);
		}
	};
	const connect = refresh => {
		if (connecting) { return connecting; }
		const version = ++generation;
		connecting = (async () => {
			const next = await request(`/api/fixtures${refresh ? '?refresh=true' : ''}`, { signal });
			if (signal.aborted || version !== generation) { return; }
			catalog = next;
			const variants = catalog.controls.find(item => item.id === control.id)?.variants ?? [];
			selected = fixtureId ? variants.find(variant => variant.id === fixtureId) : preferredTheme ? variants.find(variant => variant.variant === preferredTheme) : variants[0];
			if (!variants.length) {
				throw new Error('No fixture variants were found for this control.');
			}
			if (preferredTheme && !fixtureId && !selected) { throw new Error(`No ${preferredTheme} fixture is available for ${control.name}`); }
			const signature = JSON.stringify(variants.map(({ id, name }) => ({ id, name })));
			if (showVariants && signature !== choicesSignature) {
				const restoreFocus = controls.contains(document.activeElement);
				choicesSignature = signature;
				controls.replaceChildren(variantChoices(variantLabel, variants, selected?.id, value => {
					fixtureId = value;
					selected = catalog.controls.find(item => item.id === control.id).variants.find(variant => variant.id === value);
					show();
					onView({ fixtureId: value });
				}));
				if (restoreFocus) { (controls.querySelector('input:checked') ?? controls.querySelector('input'))?.focus({ preventScroll: true }); }
			}
			show();
		})().finally(() => { connecting = undefined; scheduleCheck(); });
		return connecting;
	};
	window.addEventListener('message', event => {
		if (signal.aborted || !catalog || event.source !== frame.contentWindow || event.origin !== new URL(catalog.explorerUrl).origin
			|| !event.data || typeof event.data !== 'object') { return; }
		const data = event.data;
		onMessage?.(data);
		if (data.type === 'component-explorer:embedded-loaded') {
			frame.contentWindow.postMessage({
				type: 'component-explorer:embedded-init',
				host: { kind: 'explorer-ui' },
				input: frameInput(),
			}, event.origin);
		} else if (selected && data.fixtureId === selected.id) {
			if (data.type === 'component-explorer:ready') {
				clearTimeout(timeout);
				recovered = false;
				message('ready', `${previewLabel ?? selected.name} · Live preview`);
				sendInput();
				scheduleCheck();
			} else if (data.type === 'component-explorer:error') {
				void recover(new Error(`Fixture couldn't render: ${data.error?.message ?? 'No details were provided'}`));
			} else if (data.type === 'component-explorer:resize' && Number.isFinite(data.height) && data.height > 0) {
				frame.style.height = `${contentSized ? Math.ceil(data.height) : Math.max(240, Math.min(800, data.height + 40))}px`;
				if (contentSized && !fillWidth && Number.isFinite(data.width) && data.width > 0) {
					frame.style.width = `${Math.ceil(data.width)}px`;
				}
			}
		}
	}, { signal });
	const resume = () => {
		updateVisibility();
		if (document.hidden) { clearTimeout(healthTimer); return; }
		if (example.dataset.previewState === 'unavailable' && recovered) { return; }
		void check();
	};
	document.addEventListener('visibilitychange', resume, { signal });
	window.addEventListener('online', () => {
		if (!document.hidden && example.dataset.previewState === 'unavailable') {
			recovered = false;
			void recover(new Error('The network connection was restored'));
		} else { resume(); }
	}, { signal });
	signal.addEventListener('abort', () => {
		clearTimeout(timeout);
		clearTimeout(healthTimer);
		frame.remove();
	}, { once: true });
	try {
		if (lazy) {
			status.textContent = 'Preview loads when in view';
			await new Promise(resolve => {
				const observer = new IntersectionObserver(entries => {
					if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); resolve(); }
				}, { rootMargin: '200px' });
				observer.observe(example);
				signal.addEventListener('abort', () => { observer.disconnect(); resolve(); }, { once: true });
			});
			if (signal.aborted) { return; }
		}
		await connect(false);
	} catch (error) {
		await recover(error);
	}
	return {
		updateInput(patch) {
			currentInput = { ...currentInput, ...patch };
			sendInput();
		},
	};
}

export async function renderComponents(content, system, fixtureId, signal, onView) {
	const control = system.controls.find(control => control.id === system.view.controlId);
	let specification;
	if (control.nodeId) {
		specification = node('a', 'View Figma specification');
		specification.href = specificationUrl(control.nodeId);
		specification.target = '_blank';
		specification.rel = 'noopener noreferrer';
	}
	if (control.content === 'tbd') {
		const unavailable = node('section', undefined, 'reference-empty');
		unavailable.append(node('p', 'Documentation and examples are not available yet.'));
		if (specification) { unavailable.append(specification); }
		content.append(unavailable);
		return;
	}
	const appendNotes = (id, title, notes) => {
		const section = node('section', undefined, 'article-section component-doc-section');
		section.id = id;
		const list = node('ul');
		list.append(...notes.map(text => node('li', text)));
		section.append(node('h2', title), list);
		content.append(section);
	};
	appendNotes('component-usage', 'Usage', control.docs.usage);
	const preview = renderFixturePreview(content, control, fixtureId, signal, onView);
	appendNotes('component-accessibility', 'Accessibility', control.docs.accessibility);
	const api = node('section', undefined, 'article-section component-doc-section');
	api.id = 'component-api';
	api.append(node('h2', 'API'));
	const scroll = node('div', undefined, 'table-scroll');
	const table = node('table', undefined, 'component-api-table');
	table.append(node('caption', `${control.docs.className} API`));
	const head = node('thead');
	const header = node('tr');
	for (const name of ['Member', 'Type', 'Purpose']) {
		const cell = node('th', name);
		cell.scope = 'col';
		header.append(cell);
	}
	head.append(header);
	const body = node('tbody');
	for (const prop of control.docs.api) {
		const row = node('tr');
		const name = node('th');
		name.scope = 'row';
		name.append(node('code', prop.name));
		const type = node('td');
		type.append(node('code', prop.type));
		row.append(name, type, node('td', prop.description));
		body.append(row);
	}
	table.append(head, body);
	scroll.append(table);
	api.append(scroll);
	if (specification) { api.append(specification); }
	content.append(api);
	void preview.catch(error => {
		if (!signal.aborted) {
			const status = content.querySelector('.preview-status');
			status.textContent = `Couldn't render preview: ${error.message}`;
			status.setAttribute('role', 'alert');
		}
	});
}
