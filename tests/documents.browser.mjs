/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Browser coverage for authored-document contracts. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { chromium, expect } from './playwright.mjs';
import { createExplorer } from '../runtime/server.mjs';
import { readDocument } from '../runtime/headless.mjs';
import { createDocumentCheckout, checkoutRoot } from './document-helpers.mjs';

test('new authored documents appear live, retain search drafts, render safely, and recover after removal', { timeout: 60000 }, async t => {
	const fixture = createDocumentCheckout(t);
	const panel = await createExplorer(fixture.root, { bookRoot: fixture.bookRoot, scope: { operation: 'all', active: 'documentation' } });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.goto(panel.url);
		await expect(page.getByRole('heading', { name: 'Documentation', level: 1, exact: true })).toBeVisible();
		const topics = page.getByRole('searchbox', { name: 'Find a topic' });
		await topics.fill('specifications');
		await expect(page.getByRole('navigation', { name: 'Topics', exact: true }).getByRole('link', { name: 'Documentation', exact: true })).toBeVisible();
		await topics.fill('');
		const search = page.getByRole('searchbox', { name: 'Search documentation' });
		await search.fill('spec-semaphore');
		await search.press('Enter');
		await expect(page.getByText('No documents match this search. Try another term or source.')).toBeVisible();
		await search.fill('pending draft');
		await search.press('ArrowLeft');
		const selection = await search.evaluate(input => input.selectionStart);
		fixture.write('src/vs/new-feature/diagram.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20"/></svg>');
		const id = 'src/vs/new-feature/DESIGN.md';
		const original = '# New design\n\nspec-semaphore\n\n[Content section](#content)\n\n## Content\n\nBody content.\n\n- Preserve the\n  complete list item.\n- Another item.\n\n## Details\n\n![Shape](diagram.svg)\n\n[Related](../feature/feature-notes.md#behavior)\n\n[Unsafe](javascript:alert)\n\n<script>window.documentScript = true</script>\n';
		fixture.write(id, original);
		await expect(page.getByRole('link', { name: 'New design', exact: true })).toBeVisible({ timeout: 15000 });
		await expect(search).toBeFocused();
		await expect(search).toHaveValue('pending draft');
		assert.equal(await search.evaluate(input => input.selectionStart), selection);
		await page.getByRole('link', { name: 'New design', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'New design', level: 1, exact: true })).toBeVisible();
		await expect(page.getByRole('img', { name: 'Shape', exact: true })).toBeVisible();
		await expect.poll(() => page.getByRole('img', { name: 'Shape', exact: true }).evaluate(image => image.naturalWidth)).toBe(40);
		assert.equal(await page.locator('.prose script').count(), 0);
		assert.equal(await page.evaluate(() => window.documentScript), undefined);
		await expect(page.getByText('Unsafe (invalid reference)', { exact: true })).toBeVisible();
		await expect(page.locator('.documentation .prose li').first()).toHaveText('Preserve the complete list item.');
		await page.getByRole('link', { name: 'Content section', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Content', level: 2, exact: true })).toBeFocused();
		fixture.write(id, original.replace('spec-semaphore', 'Revised canonical guidance.'));
		await expect(page.getByText('Revised canonical guidance.', { exact: true })).toBeVisible({ timeout: 15000 });
		await page.getByRole('link', { name: 'Related', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Feature notes', level: 1, exact: true })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Behavior', exact: true })).toBeFocused();
		await page.goBack();
		await expect(page.getByRole('heading', { name: 'New design', level: 1, exact: true })).toBeVisible();
		rmSync(path.join(fixture.root, id));
		await expect(page.locator('#problem')).toContainText('not available', { timeout: 15000 });
		await page.getByRole('link', { name: 'Back to documentation', exact: true }).first().click();
		await expect(page.getByRole('heading', { name: 'Documentation', level: 1, exact: true })).toBeVisible();
		assert.deepEqual(errors, []);
		assert.equal((await (await page.request.get(new URL('/api/metrics', panel.url).href)).json()).fixtureRequests, 0);
	} finally { await browser.close(); await panel.close(); }
});

test('canonical token guidance is visible in the chapter and opens the same source section as headless reads', { timeout: 60000 }, async () => {
	const panel = await createExplorer(checkoutRoot, { scope: { operation: 'all', active: 'tokens' } });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
		await page.goto(panel.url);
		const guidance = page.locator('#tokens-usage');
		await expect(guidance.getByRole('heading', { name: 'Using tokens', exact: true })).toBeVisible();
		await expect(guidance).toContainText('Structural measurements are not automatically design tokens.');
		await guidance.getByRole('link', { name: 'Read full specification', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Design-token usage in CSS', level: 1, exact: true })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Choose by role', exact: true })).toBeFocused();
		const id = '.github/instructions/design-tokens.instructions.md';
		const read = readDocument(checkoutRoot, id, { anchor: 'choose-by-role' });
		const api = await (await page.request.get(new URL(`/api/document?id=${encodeURIComponent(id)}&anchor=choose-by-role`, panel.url).href)).json();
		assert.deepEqual({ id: api.id, revision: api.revision, markdown: api.markdown }, { id: read.id, revision: read.revision, markdown: read.markdown });
		assert.equal(panel.state.views.documentation.documentId, id);
		assert.equal(panel.state.views.documentation.anchor, 'choose-by-role');
		await page.setViewportSize({ width: 360, height: 800 });
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		assert.equal((await (await page.request.get(new URL('/api/metrics', panel.url).href)).json()).fixtureRequests, 0);
	} finally { await browser.close(); await panel.close(); }
});

test('an unavailable document deep link leaves an actionable route back to the library', { timeout: 30000 }, async t => {
	const fixture = createDocumentCheckout(t);
	const panel = await createExplorer(fixture.root, { bookRoot: fixture.bookRoot });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		const url = new URL('/', panel.url);
		url.search = new URLSearchParams({ section: 'documentation', mode: 'all', documentId: 'src/vs/missing.md' }).toString();
		await page.goto(url.href);
		await expect(page.getByRole('alert')).toContainText('not available');
		await page.getByRole('link', { name: 'Browse documentation', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Documentation', level: 1, exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Feature notes', exact: true })).toBeVisible();
	} finally { await browser.close(); await panel.close(); }
});
