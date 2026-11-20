/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Browser coverage for no-build hosted snapshot navigation. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { chromium, expect } from './playwright.mjs';
import { createExplorer } from '../runtime/server.mjs';
import { createDocumentCheckout } from './document-helpers.mjs';

async function setup(t) {
	const fixture = createDocumentCheckout(t);
	const panel = await createExplorer(fixture.root, { watchCheckout: false });
	const browser = await chromium.launch({ headless: true });
	t.after(async () => { await browser.close(); await panel.close(); });
	const page = await browser.newPage();
	const versions = [
		{ tag: 'snapshot-v0.5.0', label: 'v0.5.0', topics: ['principles', 'component-button', 'designing-for-ai'] },
		{ tag: 'snapshot-v0.4.2', label: 'v0.4.2', topics: ['principles', 'component-button'] },
	];
	await page.route('**/snapshot-versions.mjs', route => route.fulfill({
		contentType: 'text/javascript', body: readFileSync(new URL('../view/snapshot-versions.mjs', import.meta.url), 'utf8'),
	}));
	await page.route(url => url.pathname === '/' || url.pathname.startsWith('/snapshots/'), route => {
		const url = new URL(route.request().url());
		const current = url.pathname.includes('snapshot-v0.4.2') ? 'snapshot-v0.4.2' : versions[0].tag;
		const base = url.pathname.startsWith('/snapshots/') ? '../../' : './';
		const host = current === 'snapshot-v0.4.2'
			? '<details class="snapshot-info"><summary>Review snapshot</summary><p>Metadata retained</p></details>'
			: '<button type="button" popovertarget="snapshot-details">Snapshot details</button><section id="snapshot-details" class="chrome-popup checkout-popup" popover="auto"><h2>Snapshot</h2><p>Metadata retained</p></section>';
		const index = { current: url.searchParams.has('invalid') ? 'missing' : current, latest: versions[0].tag, versions };
		return route.fulfill({ contentType: 'text/html', body: `<!doctype html>
			<html><head><link rel="stylesheet" href="/canvas.css"><link rel="stylesheet" href="/shell.css"></head>
			<body class="design-reference explorer">
			${host}
			<script id="snapshot-release-index" type="application/json" data-base="${base}">${JSON.stringify(index)}</script>
			<script type="module" src="/snapshot-versions.mjs"></script></body></html>` });
	});
	return { page, url: panel.url };
}

test('hosted snapshot versions preserve the chapter and remain keyboard reachable after switching to an older release', async t => {
	const { page, url } = await setup(t);
	await page.goto(new URL('/?topic=component-button', url).href);
	await page.getByRole('button', { name: 'Snapshot details' }).focus();
	await page.keyboard.press('Enter');
	const select = page.getByRole('combobox', { name: 'Version', exact: true });
	await expect(select).toBeVisible();
	await expect(select).toBeFocused();
	await expect(select).toHaveValue('snapshot-v0.5.0');
	assert.deepEqual(await select.locator('option').allTextContents(), ['v0.5.0 (Latest)', 'v0.4.2']);
	await select.selectOption('snapshot-v0.4.2');
	await page.waitForURL('**/snapshots/snapshot-v0.4.2/?topic=component-button');
	await page.getByText('Review snapshot', { exact: true }).click();
	await expect(select).toHaveValue('snapshot-v0.4.2');
	await select.selectOption('snapshot-v0.5.0');
	await page.waitForURL('**/snapshots/snapshot-v0.5.0/?topic=component-button');
});

test('version switching from a versioned URL falls back to the first available chapter when the current chapter is absent', async t => {
	const { page, url } = await setup(t);
	await page.goto(new URL('/snapshots/snapshot-v0.5.0/?topic=designing-for-ai#old-anchor', url).href);
	await page.getByRole('button', { name: 'Snapshot details' }).click();
	await page.getByRole('combobox', { name: 'Version', exact: true }).selectOption('snapshot-v0.4.2');
	await page.waitForURL('**/snapshots/snapshot-v0.4.2/?topic=principles');
	assert.equal(new URL(page.url()).hash, '');
});

test('embedded product fixtures do not mount hosted version controls or report missing metadata', async t => {
	const { page, url } = await setup(t);
	const errors = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.goto(new URL('/?mode=embedded', url).href);
	await expect(page.getByRole('combobox', { name: 'Version' })).toHaveCount(0);
	await expect(page.getByRole('alert')).toHaveCount(0);
	assert.deepEqual(errors, []);
});

test('invalid hosted version metadata is explicitly reported instead of enabling an invalid destination', async t => {
	const { page, url } = await setup(t);
	await page.goto(new URL('/?invalid', url).href);
	await page.getByRole('button', { name: 'Snapshot details' }).click();
	await expect(page.getByRole('alert')).toHaveText('Published snapshot versions are unavailable. Reload this page to retry.');
	await expect(page.getByRole('combobox', { name: 'Version' })).toHaveCount(0);
});
