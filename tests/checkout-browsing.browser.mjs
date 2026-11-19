/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Browser coverage for the no-build canvas. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { chromium, expect } from './playwright.mjs';
import { createDocumentCheckout, checkoutRoot } from './document-helpers.mjs';
import { createExplorer } from '../runtime/server.mjs';

test('the same canvas browses a basic checkout, saved edits and a curated book through keyboard-accessible checkout controls', { timeout: 60000 }, async t => {
	const fixture = createDocumentCheckout(t);
	rmSync(fixture.bookRoot, { recursive: true });
	execFileSync('git', ['init', '-q', '-b', 'ordinary'], { cwd: fixture.root });
	const panel = await createExplorer(fixture.root);
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.goto(panel.url);
		const origin = new URL(page.url()).origin;
		await expect(page.getByRole('heading', { name: 'Source library', exact: true })).toBeVisible();
		await expect(page.locator('#checkout-mode')).toContainText('no curated design book');
		await page.getByRole('link', { name: 'Feature notes', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Feature notes', exact: true })).toBeVisible();
		fixture.write('src/vs/feature/feature-notes.md', '# Saved edit\n\nRead the current checkout.\n');
		await expect(page.getByRole('heading', { name: 'Saved edit', exact: true })).toBeVisible();
		await expect(page.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
		await page.evaluate(() => document.fonts.ready);
		const picker = page.getByRole('button', { name: 'Checkout details', exact: true });
		await expect(picker).toBeEnabled();
		await expect(page.locator('.checkout-details > #checkout')).toHaveCount(0);
		await expect(page.locator('#checkout-picker #checkout')).toHaveCount(1);
		const geometry = () => page.evaluate(() => {
			const bounds = selector => {
				const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
				return { x, y, width, height };
			};
			return ['.explorer-heading', '.explorer-layout', '#refresh', '#checkout-toggle'].map(bounds);
		});
		for (const width of [320, 800, 1440]) {
			await page.setViewportSize({ width, height: 900 });
			await expect.poll(() => page.locator('.book-panel').evaluate(panel => panel.hasAttribute('popover'))).toBe(width < 960);
			const before = await geometry();
			await picker.focus();
			await page.keyboard.press('Enter');
			await expect(page.locator('#checkout-form')).toBeVisible();
			assert.deepEqual(await geometry(), before, `Opening the checkout switcher at ${width}px`);
			await expect(page.getByLabel('Local worktree')).toBeFocused();
			await expect.poll(() => page.locator('#checkout-picker').evaluate(panel => {
				const trigger = document.querySelector('#checkout-toggle').getBoundingClientRect();
				const popup = panel.getBoundingClientRect();
				return popup.left >= 0 && popup.top > trigger.bottom && popup.right <= innerWidth
					&& Math.abs(popup.right - Math.max(trigger.right, popup.width + 8)) <= 1;
			})).toBe(true);
			await page.getByLabel('Local worktree').selectOption('');
			assert.deepEqual(await geometry(), before, `Showing a checkout path at ${width}px`);
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
			await page.keyboard.press('Escape');
			await expect(page.locator('#checkout-form')).toBeHidden();
			await expect(picker).toBeFocused();
			assert.deepEqual(await geometry(), before, `Closing the checkout switcher at ${width}px`);
		}
		await picker.click();
		await page.locator('.book-title').click();
		await expect(page.locator('#checkout-form')).toBeHidden();
		await page.setViewportSize({ width: 1100, height: 900 });
		await picker.focus();
		await page.keyboard.press('Enter');
		await page.getByLabel('Local worktree').selectOption('');
		const checkoutPath = page.getByLabel('Checkout path', { exact: true });
		await expect(checkoutPath).toBeFocused();
		await checkoutPath.fill('/definitely/not/a/checkout');
		await page.keyboard.press('Tab');
		await expect(page.getByRole('button', { name: 'Browse checkout', exact: true })).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(page.locator('#checkout-error')).toBeVisible();
		assert.equal(panel.root, fixture.root);
		await checkoutPath.fill(checkoutRoot);
		await page.getByRole('button', { name: 'Browse checkout', exact: true }).click();
		await expect(picker).toHaveAttribute('aria-expanded', 'false');
		await expect(page.locator('#checkout-mode')).toHaveText('');
		await expect(picker).toBeFocused();
		assert.equal(new URL(page.url()).origin, origin);
		await page.locator('#book-navigation summary').filter({ hasText: 'Foundations' }).click();
		await expect(page.getByRole('link', { name: 'Typography', exact: true })).toBeVisible();
		for (const width of [390, 1100]) {
			await page.setViewportSize({ width, height: 900 });
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		}
		assert.deepEqual(errors, []);
	} finally { await browser.close(); await panel.close(); }
});

test('checkout split button starts without new runtime assets or product dependencies and separates refresh from its popup', { timeout: 30000 }, async t => {
	const fixture = createDocumentCheckout(t);
	rmSync(fixture.bookRoot, { recursive: true });
	const panel = await createExplorer(fixture.root, { watchCheckout: false });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
		const errors = [];
		const unavailableAssets = [];
		const checkoutPosts = [];
		page.on('pageerror', error => errors.push(error.message));
		page.on('request', request => {
			const pathname = new URL(request.url()).pathname;
			if (pathname === '/page-history.mjs' || pathname === '/codicon.ttf') { unavailableAssets.push(pathname); }
			if (pathname === '/api/checkout' && request.method() === 'POST') { checkoutPosts.push(request.postDataJSON()); }
		});
		await page.route('**/page-history.mjs', route => route.fulfill({ status: 404, body: 'Unknown asset' }));
		let releaseChoices;
		const pendingChoices = new Promise(resolve => { releaseChoices = resolve; });
		await page.route('**/api/checkouts', async route => { await pendingChoices; await route.continue(); });
		await page.goto(panel.url, { waitUntil: 'domcontentloaded' });
		const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
		const picker = page.getByRole('button', { name: 'Checkout details', exact: true });
		await expect(refresh).toBeDisabled();
		await expect(picker).toBeDisabled();
		releaseChoices();
		await expect(page.getByRole('heading', { name: 'Source library', exact: true })).toBeVisible();
		await expect(refresh).toBeEnabled();
		await refresh.focus();
		await page.keyboard.press('Tab');
		await expect(picker).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('combobox', { name: 'Local worktree', exact: true })).toBeFocused();
		await expect(picker).toHaveAttribute('aria-expanded', 'true');
		assert.deepEqual(checkoutPosts, []);
		await page.keyboard.press('Escape');
		await expect(picker).toBeFocused();
		await page.keyboard.press('ArrowLeft');
		await expect(refresh).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(page.getByRole('dialog', { name: 'Checkout', exact: true })).toBeVisible();
		await page.keyboard.press('Escape');
		await picker.focus();
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.press('Enter');
		await expect(page.locator('#checkout-status')).toHaveText('Checkout reloaded');
		await expect(page.getByRole('dialog', { name: 'Checkout', exact: true })).toBeHidden();
		assert.deepEqual({ checkoutPosts, unavailableAssets, errors }, { checkoutPosts: [{ root: fixture.root }], unavailableAssets: [], errors: [] });
	} finally { await browser.close(); await panel.close(); }
});

test('new authored guidance renders through aliases, tracks saved edits and survives same-checkout catalog refresh', { timeout: 60000 }, async t => {
	const fixture = createDocumentCheckout(t);
	const manifest = '.github/design-system/topics.json';
	const book = JSON.parse(readFileSync(path.join(fixture.root, manifest), 'utf8'));
	const entry = { id: 'routing-study', section: 'routing-study', group: 'Guidance', title: 'Routing study',
		renderer: 'guidance', aliases: ['previous-study'], page: 'content/topics/routing-study.json', fixture: false, compare: true };
	const writeBook = (topics, includeLibrary = true) => fixture.write(manifest, JSON.stringify({
		...book, components: undefined, references: {}, defaultTopic: entry.id,
		topics: [...topics, ...(includeLibrary ? [book.topics.find(topic => topic.id === 'documentation')] : [])],
	}));
	const source = 'src/vs/feature/routing.md';
	fixture.write(source, '# Routing study\n\n## Introduction\n\nLocal authored introduction.\n\n## Usage\n\nFirst saved guidance with a [related document](./feature-notes.md).\n');
	fixture.write('.github/design-system/content/topics/routing-study.json', JSON.stringify({
		version: 1, id: entry.id, renderer: 'guidance', source, content: {},
		sections: [{ id: 'routing-usage', key: 'usage', heading: 'Usage' }],
	}));
	writeBook([entry]);
	const panel = await createExplorer(fixture.root, { watchCheckout: false });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.goto(`${new URL('/', panel.url)}?section=previous-study&mode=all#routing-usage`);
		const content = page.locator('[data-topic="routing-study"] .topic-content');
		await expect(content).toHaveAttribute('data-topic-state', 'ready');
		await expect(content.locator('h2')).toHaveText('Usage');
		await expect(content).toContainText('First saved guidance');
		await expect(content.getByRole('link', { name: 'related document', exact: true })).toHaveAttribute('href', /documentId=src%2Fvs%2Ffeature%2Ffeature-notes\.md/);
		await expect(content.locator('#routing-usage')).toBeFocused();
		const before = panel.state;
		fixture.write(source, readFileSync(path.join(fixture.root, source), 'utf8').replace('First saved guidance', 'Updated saved guidance'));
		await page.getByRole('button', { name: 'Refresh', exact: true }).click();
		await expect(content).toContainText('Updated saved guidance');
		const second = { ...entry, id: 'second-study', section: 'second-study', title: 'Second study', aliases: [], page: 'content/topics/second-study.json' };
		fixture.write('.github/design-system/content/topics/second-study.json', JSON.stringify({
			version: 1, id: second.id, renderer: 'guidance', source, content: {},
			guidance: [{ id: 'second-usage', heading: 'Usage' }],
		}));
		writeBook([entry, second]);
		panel.selectCheckout({ root: fixture.root });
		await expect(content).toHaveAttribute('data-topic-state', 'ready');
		await expect(content).toContainText('Updated saved guidance');
		await page.getByRole('searchbox', { name: 'Search topics', exact: true }).fill('Second study');
		await expect(page.getByRole('link', { name: 'Second study', exact: true })).toBeVisible();
		assert.deepEqual(panel.state.views[entry.id], before.views[entry.id]);
		await page.getByRole('link', { name: 'Second study', exact: true }).click();
		const secondContent = page.locator('[data-topic="second-study"] .topic-content');
		await expect(secondContent).toHaveAttribute('data-topic-state', 'ready');
		await expect(secondContent).toContainText('Updated saved guidance');
		writeBook([entry, second], false);
		panel.selectCheckout({ root: fixture.root });
		await expect(secondContent.getByText('related document (topic unavailable in this checkout)', { exact: true })).toBeVisible();
		await expect(secondContent).toHaveAttribute('data-topic-state', 'ready');
		await expect(secondContent.getByRole('link', { name: 'related document', exact: true })).toHaveCount(0);
		assert.deepEqual(errors, []);
	} finally { await browser.close(); await panel.close(); }
});
