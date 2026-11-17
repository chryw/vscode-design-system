/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
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
		const picker = page.locator('#checkout-picker summary');
		const geometry = () => page.evaluate(() => {
			const bounds = selector => {
				const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
				return { x, y, width, height };
			};
			return ['.explorer-heading', '.explorer-layout', '#refresh', '#checkout-picker summary'].map(bounds);
		});
		for (const width of [320, 800, 1440]) {
			await page.setViewportSize({ width, height: 900 });
			await expect.poll(() => page.locator('.book-panel').evaluate(panel => panel.hasAttribute('popover'))).toBe(width < 760);
			const before = await geometry();
			await picker.focus();
			await page.keyboard.press('Enter');
			await expect(page.locator('#checkout-form')).toBeVisible();
			assert.deepEqual(await geometry(), before, `Opening the checkout switcher at ${width}px`);
			await page.getByLabel('Local worktree').selectOption('');
			assert.deepEqual(await geometry(), before, `Showing a checkout path at ${width}px`);
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
			await picker.focus();
			await page.keyboard.press('Enter');
			await expect(page.locator('#checkout-form')).toBeHidden();
			assert.deepEqual(await geometry(), before, `Closing the checkout switcher at ${width}px`);
		}
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
		await expect(page.locator('#shell-problem')).toBeVisible();
		assert.equal(panel.root, fixture.root);
		await checkoutPath.fill(checkoutRoot);
		await page.getByRole('button', { name: 'Browse checkout', exact: true }).click();
		await expect(page.locator('#checkout-picker')).not.toHaveAttribute('open', '');
		await expect(page.locator('#checkout-mode')).toHaveText('');
		await expect(page.locator('#checkout-picker summary')).toBeFocused();
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

test('new authored guidance renders through aliases, tracks saved edits and survives same-checkout catalog refresh', { timeout: 60000 }, async t => {
	const fixture = createDocumentCheckout(t);
	const manifest = '.github/design-system/book.json';
	const book = JSON.parse(readFileSync(path.join(fixture.root, manifest), 'utf8'));
	const entry = { id: 'routing-study', section: 'routing-study', group: 'Guidance', title: 'Routing study',
		renderer: 'guidance', aliases: ['previous-study'], page: 'pages/routing-study.json', fixture: false, compare: true };
	const writeBook = (topics, includeLibrary = true) => fixture.write(manifest, JSON.stringify({
		...book, components: undefined, references: {}, defaultTopic: entry.id,
		topics: [...topics, ...(includeLibrary ? [book.topics.find(topic => topic.id === 'documentation')] : [])],
	}));
	const source = 'src/vs/feature/routing.md';
	fixture.write(source, '# Routing study\n\n## Introduction\n\nLocal authored introduction.\n\n## Usage\n\nFirst saved guidance with a [related document](./feature-notes.md).\n');
	fixture.write('.github/design-system/pages/routing-study.json', JSON.stringify({
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
		await page.getByRole('button', { name: 'Refresh topic', exact: true }).click();
		await expect(content).toContainText('Updated saved guidance');
		const second = { ...entry, id: 'second-study', section: 'second-study', title: 'Second study', aliases: [], page: 'pages/second-study.json' };
		fixture.write('.github/design-system/pages/second-study.json', JSON.stringify({
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
