/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Hosted navigation works across immutable no-build snapshot versions. */

function mount(index, base) {
	const host = document.getElementById('snapshot-details') ?? document.querySelector('.snapshot-info');
	if (!host) { return false; }
	const label = document.createElement('label');
	label.textContent = 'Version';
	const wrapper = document.createElement('div');
	wrapper.className = 'chrome-select';
	const select = document.createElement('select');
	select.autofocus = host.id === 'snapshot-details';
	for (const version of index.versions) {
		const option = document.createElement('option');
		option.value = version.tag;
		option.textContent = `${version.label}${version.tag === index.latest ? ' (Latest)' : ''}`;
		option.selected = version.tag === index.current;
		select.append(option);
	}
	const chevron = document.createElement('span');
	chevron.className = 'chrome-icon codicon-chevron-down';
	chevron.setAttribute('aria-hidden', 'true');
	wrapper.append(select, chevron);
	label.append(wrapper);
	const heading = host.querySelector('h2, summary');
	if (heading) { heading.after(label); }
	else { host.prepend(label); }
	select.addEventListener('change', () => {
		const version = index.versions.find(version => version.tag === select.value);
		if (version.tag === index.current) { return; }
		const current = new URL(location.href);
		const topic = current.searchParams.get('topic') ?? current.searchParams.get('section');
		const destination = new URL(`snapshots/${version.tag}/`, base);
		destination.searchParams.set('topic', version.topics.includes(topic) ? topic : version.topics[0]);
		location.assign(destination.href);
	});
	return true;
}

function initialize() {
	const metadata = document.getElementById('snapshot-release-index');
	if (!metadata || !['./', '../../'].includes(metadata.dataset.base)) {
		throw new Error('Missing hosted snapshot version metadata');
	}
	const index = JSON.parse(metadata.textContent);
	if (!index || !Array.isArray(index.versions) || !index.versions.length
		|| new Set(index.versions.map(version => version.tag)).size !== index.versions.length
		|| !index.versions.some(version => version.tag === index.current)
		|| !index.versions.some(version => version.tag === index.latest)
		|| index.versions.some(version => typeof version.tag !== 'string' || !/^snapshot-[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(version.tag)
			|| version.tag.includes('..') || typeof version.label !== 'string' || !version.label
			|| !Array.isArray(version.topics) || !version.topics.length
			|| version.topics.some(topic => typeof topic !== 'string' || !/^[a-z][a-z0-9-]*$/.test(topic)))) {
		throw new Error('Invalid hosted snapshot version metadata');
	}
	const base = new URL(metadata.dataset.base, location.href);
	if (!mount(index, base)) {
		const observer = new MutationObserver(() => {
			if (mount(index, base)) { observer.disconnect(); }
		});
		observer.observe(document.body, { childList: true, subtree: true });
		addEventListener('pagehide', () => observer.disconnect(), { once: true });
	}
}

if (!['embedded', 'headless'].includes(new URL(location.href).searchParams.get('mode'))) {
	try {
		initialize();
	} catch (error) {
		const message = document.createElement('p');
		message.setAttribute('role', 'alert');
		message.textContent = 'Published snapshot versions are unavailable. Reload this page to retry.';
		(document.getElementById('snapshot-details') ?? document.querySelector('.snapshot-info') ?? document.body).append(message);
		console.error(error);
	}
}
