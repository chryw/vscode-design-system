/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Browser coverage for the no-build canvas. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { chromium, expect } from './playwright.mjs';
import { createDocumentCheckout, checkoutRoot } from './document-helpers.mjs';
import { createExplorer } from '../runtime/server.mjs';
import { createVersionCheckout } from './content-version-helpers.mjs';

test('content versions preserve keyboard access, responsive popup geometry, saved session edits and explicit local compatibility', { timeout: 60000 }, async t => {
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
		const picker = page.getByRole('button', { name: 'Content version', exact: true });
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
			await expect(page.getByRole('combobox', { name: 'Content version', exact: true })).toBeFocused();
			await expect.poll(() => page.locator('#checkout-picker').evaluate(panel => {
				const trigger = document.querySelector('#checkout-toggle').getBoundingClientRect();
				const popup = panel.getBoundingClientRect();
				return popup.left >= 0 && popup.top > trigger.bottom && popup.right <= innerWidth
					&& Math.abs(popup.right - Math.max(trigger.right, popup.width + 8)) <= 1;
			})).toBe(true);
			await page.getByRole('combobox', { name: 'Content version', exact: true }).selectOption('shared');
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
		await page.getByRole('combobox', { name: 'Content version', exact: true }).selectOption('shared');
		const checkoutPath = page.getByLabel('Branch name or GitHub branch URL', { exact: true });
		await expect(checkoutPath).toBeFocused();
		await checkoutPath.fill('../invalid-branch');
		await page.keyboard.press('Tab');
		await expect(page.getByRole('button', { name: 'Browse version', exact: true })).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(page.locator('#checkout-error')).toBeVisible();
		assert.equal(panel.root, fixture.root);
		await page.getByRole('combobox', { name: 'Content version', exact: true }).selectOption('session');
		await page.getByRole('button', { name: 'Browse version', exact: true }).click();
		await expect(picker).toHaveAttribute('aria-expanded', 'false');
		panel.selectCheckout({ root: checkoutRoot });
		await expect(page.locator('#checkout-mode')).toHaveText('');
		await expect(picker).toBeFocused();
		assert.equal(new URL(page.url()).origin, origin);
		await page.locator('#book-navigation summary').filter({ hasText: 'Foundations' }).click();
		await expect(page.getByRole('link', { name: /^Typography(?: Draft)?$/ })).toBeVisible();
		for (const width of [390, 1100]) {
			await page.setViewportSize({ width, height: 900 });
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		}
		assert.deepEqual(errors, []);
	} finally { await browser.close(); await panel.close(); }
});

test('content version split button starts without product dependencies and separates refresh from its popup', { timeout: 30000 }, async t => {
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
			if (pathname === '/api/content-version' && request.method() === 'POST') { checkoutPosts.push(request.postDataJSON()); }
		});
		await page.route('**/page-history.mjs', route => route.fulfill({ status: 404, body: 'Unknown asset' }));
		let releaseChoices;
		const pendingChoices = new Promise(resolve => { releaseChoices = resolve; });
		await page.route('**/api/checkouts', async route => { await pendingChoices; await route.continue(); });
		await page.goto(panel.url, { waitUntil: 'domcontentloaded' });
		const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
		const picker = page.getByRole('button', { name: 'Content version', exact: true });
		await expect(refresh).toBeDisabled();
		await expect(picker).toBeDisabled();
		releaseChoices();
		await expect(page.getByRole('heading', { name: 'Source library', exact: true })).toBeVisible();
		await expect(refresh).toBeEnabled();
		await refresh.focus();
		await page.keyboard.press('Tab');
		await expect(picker).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('combobox', { name: 'Content version', exact: true })).toBeFocused();
		await expect(picker).toHaveAttribute('aria-expanded', 'true');
		assert.deepEqual(checkoutPosts, []);
		await page.keyboard.press('Escape');
		await expect(picker).toBeFocused();
		await page.keyboard.press('ArrowLeft');
		await expect(refresh).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(page.getByRole('dialog', { name: 'Content version', exact: true })).toBeVisible();
		await page.keyboard.press('Escape');
		await picker.focus();
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.press('Enter');
		await expect(page.locator('#checkout-status')).toHaveText('Content version reloaded');
		await expect(page.getByRole('dialog', { name: 'Content version', exact: true })).toBeHidden();
		assert.deepEqual({ checkoutPosts, unavailableAssets, errors }, { checkoutPosts: [{ kind: 'session' }], unavailableAssets: [], errors: [] });
	} finally { await browser.close(); await panel.close(); }
});

test('readers browse fresh remote main, a shared branch and session edits without enumerating or changing local branches', { timeout: 60000 }, async t => {
	const fixture = createVersionCheckout(t);
	fixture.publish('design/shared-guidance', '# Shared guidance\n\nA teammate branch.\n');
	const before = { branch: fixture.git(['symbolic-ref', 'HEAD']), status: fixture.git(['status', '--porcelain']), markdown: fixture.read(fixture.root) };
	const panel = await createExplorer(fixture.root, { home: fixture.home, scope: { operation: 'all', active: 'documentation' } });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.goto(panel.url);
		const origin = new URL(page.url()).origin;
		const picker = page.getByRole('button', { name: 'Content version', exact: true });
		const choice = page.getByRole('combobox', { name: 'Content version', exact: true });
		const browse = page.getByRole('button', { name: 'Browse version', exact: true });
		await page.getByRole('link', { name: 'Session edit', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Session edit', exact: true })).toBeVisible();
		await picker.click();
		assert.deepEqual(await choice.locator('option').allTextContents(), ['Latest (main)', 'Shared branch…', 'This session']);
		await choice.selectOption('latest');
		await browse.click();
		await expect(picker).toBeFocused();
		await page.getByRole('link', { name: 'Remote main', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Remote main', exact: true })).toBeVisible();
		fixture.publish('main', '# Updated main\n\nNew remote guidance.\n');
		await page.getByRole('button', { name: 'Refresh', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Updated main', exact: true })).toBeVisible();
		await picker.click();
		await choice.selectOption('shared');
		const branch = page.getByLabel('Branch name or GitHub branch URL', { exact: true });
		await expect(branch).toBeFocused();
		await branch.fill('design/shared-guidance');
		await page.keyboard.press('Tab');
		await page.keyboard.press('Enter');
		await expect(picker).toBeFocused();
		await page.getByRole('link', { name: 'Shared guidance', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Shared guidance', exact: true })).toBeVisible();
		let failFetch;
		const pendingFetch = new Promise(resolve => { failFetch = resolve; });
		await page.route('**/api/content-version', async route => {
			await pendingFetch;
			await route.fulfill({ status: 503, body: 'Remote temporarily unavailable' });
		}, { times: 1 });
		await picker.click();
		await choice.selectOption('latest');
		await browse.click();
		await expect(page.locator('#checkout-form')).toHaveAttribute('aria-busy', 'true');
		await expect(choice).toBeDisabled();
		await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeDisabled();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog', { name: 'Content version', exact: true })).toBeHidden();
		failFetch();
		await expect(page.locator('#shell-problem')).toContainText('Remote temporarily unavailable');
		await expect(page.getByRole('heading', { name: 'Shared guidance', exact: true })).toBeVisible();
		await expect(picker).toBeEnabled();
		await picker.click();
		await expect(page.locator('#checkout-location')).toContainText('design/shared-guidance');
		await choice.selectOption('shared');
		await branch.fill('missing-branch');
		await browse.click();
		await expect(page.locator('#checkout-error')).toContainText("Couldn't load missing-branch");
		await expect(page.getByRole('heading', { name: 'Shared guidance', exact: true })).toBeVisible();
		await choice.selectOption('session');
		await browse.click();
		await page.getByRole('link', { name: 'Session edit', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Session edit', exact: true })).toBeVisible();
		assert.deepEqual({
			branch: fixture.git(['symbolic-ref', 'HEAD']), status: fixture.git(['status', '--porcelain']),
			markdown: fixture.read(fixture.root), origin: new URL(page.url()).origin, errors,
		}, { ...before, origin, errors: [] });
	} finally { await browser.close(); await panel.close(); }
});

test('new authored guidance renders through aliases, tracks saved edits and survives same-checkout catalog refresh', { timeout: 60000 }, async t => {
	const fixture = createDocumentCheckout(t);
	const entry = { id: 'routing-study', title: 'Routing study', aliases: ['previous-study'] };
	const foundations = path.join(fixture.bookRoot, 'foundations');
	rmSync(foundations, { recursive: true, force: true });
	// Each specification owns its guidance; a catalog refresh rediscovers the specifications themselves.
	const writeBook = (topics, guidance) => {
		rmSync(foundations, { recursive: true, force: true });
		mkdirSync(foundations, { recursive: true });
		for (const [index, topic] of topics.entries()) {
			const aliases = topic.aliases?.length ? `aliases:\n${topic.aliases.map(alias => `  - "${alias}"`).join('\n')}\n` : '';
			fixture.write(`.github/skills/design-system/foundations/${topic.id}.design.md`,
				`---\ntitle: "${topic.title}"\nkind: foundation\nstatus: stable\norder: ${index}\n${aliases}---\n# ${topic.title}\n\n`
				+ `## Introduction\n\nLocal authored introduction.\n\n## Usage\n\n${guidance} with a [related document](../../../../src/vs/feature/feature-notes.md).\n`);
		}
	};
	writeBook([entry], 'First saved guidance');
	const panel = await createExplorer(fixture.root, { watchCheckout: false });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.goto(`${new URL('/', panel.url)}?section=previous-study&mode=all#routing-study-usage`);
		const content = page.locator('[data-topic="routing-study"] .topic-content');
		await expect(content).toHaveAttribute('data-topic-state', 'ready');
		await expect(content.locator('h2')).toHaveText('Usage');
		await expect(content).toContainText('First saved guidance');
		await expect(content.getByRole('link', { name: 'related document', exact: true })).toHaveAttribute('href', /documentId=src%2Fvs%2Ffeature%2Ffeature-notes\.md/);
		await expect(content.locator('#routing-study-usage')).toBeFocused();
		const before = panel.state;
		writeBook([entry], 'Updated saved guidance');
		await page.getByRole('button', { name: 'Refresh', exact: true }).click();
		await expect(content).toContainText('Updated saved guidance');
		const second = { id: 'second-study', title: 'Second study', aliases: [] };
		writeBook([entry, second], 'Updated saved guidance');
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
		rmSync(path.join(fixture.root, 'src/vs/feature/feature-notes.md'), { force: true });
		panel.selectCheckout({ root: fixture.root });
		const unavailableDocument = secondContent.getByRole('link', { name: 'related document', exact: true });
		await expect(unavailableDocument).toHaveAttribute('href', /documentId=src%2Fvs%2Ffeature%2Ffeature-notes\.md/);
		await unavailableDocument.click();
		const problem = page.locator('#shell-problem');
		await expect(problem).toBeVisible();
		await problem.locator('summary').click();
		await expect(problem.locator('p')).toContainText('Document is not available in the configured library');
		await expect(secondContent).toHaveAttribute('data-topic-state', 'ready');
		assert.deepEqual(errors, []);
	} finally { await browser.close(); await panel.close(); }
});
