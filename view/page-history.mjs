/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
export function createPageHistory(onRestore, signal) {
	const back = document.querySelector('#history-back');
	const forward = document.querySelector('#history-forward');
	for (const [button, path] of [[back, 'm7 3-5 5 5 5M2 8h12'], [forward, 'm9 3 5 5-5 5M14 8H2']]) {
		const label = document.createElement('span');
		label.textContent = button.textContent;
		button.setAttribute('aria-label', label.textContent);
		button.title = label.textContent;
		const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		icon.setAttribute('viewBox', '0 0 16 16');
		icon.setAttribute('aria-hidden', 'true');
		const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		shape.setAttribute('d', path);
		icon.append(shape);
		button.replaceChildren(icon, label);
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
