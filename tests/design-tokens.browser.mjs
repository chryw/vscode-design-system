/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import assert from 'node:assert/strict';
import { workspaceRoot } from '../runtime/paths.mjs';
import test from 'node:test';
import { chromium, expect } from './playwright.mjs';
import { createBrowserHost } from './explorer-browser-host.mjs';

const root = workspaceRoot;

test('token guidance leads into a page-scrolling reference with working domain deep links', { timeout: 60000 }, async () => {
	const panel = await createBrowserHost(root, { scope: { operation: 'all', active: 'tokens' } });
	let browser;
	try {
		browser = await chromium.launch({ headless: true });
		const page = await browser.newPage({ viewport: { width: 1440, height: 500 } });
		await page.goto(panel.url);
		const article = page.locator('[data-topic="tokens"]');
		await expect(article.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
		const outline = article.getByRole('navigation', { name: 'On this page', exact: true });
		await expect(outline.getByRole('link').first()).toHaveText('Using tokens');
		await outline.getByRole('link', { name: 'Spacing', exact: true }).focus();
		await page.keyboard.press('Enter');
		await expect(article.locator('#tokens-spacing')).toBeFocused();
		await expect(article.locator('#tokens-spacing')).toHaveAttribute('open', '');
		await expect(article.locator('#tokens-spacing .token-reference-row')).toHaveCount(14);
		await article.locator('.token-source-group').evaluateAll(groups => groups.forEach(group => { group.open = true; }));
		await expect(article.locator('.token-source-group:not([open])')).toHaveCount(0);
		await expect(article.locator('#tokens-legacy .token-reference-row').last()).toBeAttached();
		for (const colorScheme of ['light', 'dark']) {
			await page.emulateMedia({ colorScheme });
			for (const width of [320, 800, 1440]) {
				await page.setViewportSize({ width, height: 500 });
				assert.equal(await article.evaluate(root => {
					const guidance = root.querySelector('#tokens-usage').getBoundingClientRect();
					const search = root.querySelector('input[type="search"]').getBoundingClientRect();
					const containers = root.querySelectorAll('.topic-content, .article-body, #tokens-reference, .token-list');
					return guidance.bottom <= search.top && [...containers].every(element =>
						element.scrollHeight <= element.clientHeight + 1 && getComputedStyle(element).overflowY !== 'hidden')
						&& document.documentElement.scrollWidth <= innerWidth;
				}), true, `${colorScheme} ${width}px: guidance precedes an unclipped reference`);
				const last = article.locator('.token-reference-row').last();
				await last.scrollIntoViewIfNeeded();
				await expect(last).toBeInViewport();
			}
		}
		const url = new URL(page.url());
		url.hash = 'tokens-motion';
		await page.goto(url.href);
		await expect(article.locator('#tokens-motion')).toBeFocused();
		await expect(article.locator('#tokens-motion')).toHaveAttribute('open', '');
		await expect(article.locator('#tokens-motion .token-reference-row').last()).toBeAttached();
		const search = article.getByRole('searchbox', { name: 'Search tokens', exact: true });
		await search.fill('spacing.size80');
		await expect(search).toBeFocused();
		await expect(article.locator('.token-reference-row')).toHaveCount(1);
		await search.fill('');
		await expect(article.locator('#tokens-motion')).toHaveAttribute('open', '');
	} finally {
		await browser?.close();
		await panel.close();
	}
});

test('the curated token reference explains choices and keeps implementation inventories out', { timeout: 60000 }, async () => {
	const panel = await createBrowserHost(root, { scope: { operation: 'all', active: 'tokens' } });
	let browser;
	try {
		browser = await chromium.launch({ headless: true });
		const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
		const errors = [];
		const requests = [];
		page.on('pageerror', error => errors.push(error.message));
		page.on('request', request => requests.push(new URL(request.url()).pathname));
		await page.goto(panel.url);
		const article = page.locator('[data-topic="tokens"]');
		await expect(article.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready', { timeout: 30000 });
		await expect(article.locator('.token-reference-table')).toHaveCount(0);
		await expect(article.locator('#tokens-legacy')).not.toHaveAttribute('open');
		assert.deepEqual(await article.locator('.token-source-group > summary').allTextContents(), [
			'Spacing', 'Typography', 'Corner radius', 'Icon size', 'Stroke', 'Color roles', 'Elevation', 'Motion', 'Scoped layout tokens', 'Deprecated aliases',
		]);
		await article.locator('#tokens-spacing > summary').focus();
		await page.keyboard.press('Enter');
		await expect(article.locator('.token-reference-table caption')).toHaveText('Spacing');
		assert.deepEqual(await article.locator('.token-reference-row td:first-of-type code').allTextContents(), [
			'0px', '2px', '4px', '6px', '8px', '10px', '12px', '16px', '20px', '24px', '28px', '32px', '36px', '40px',
		]);
		await expect(article.getByRole('columnheader', { name: 'Purpose', exact: true })).toHaveCount(1);
		await expect(article.getByRole('columnheader', { name: 'Source', exact: true })).toHaveCount(0);
		assert.equal(await article.locator('.token-reference-table').evaluate(element => element.scrollWidth <= element.parentElement.clientWidth), true);
		const search = page.getByRole('searchbox', { name: 'Search tokens', exact: true });
		for (const query of ['EDITOR_FONT_DEFAULTS', 'ZIndex.ModalDialog', 'languageIds.typescript', 'Codicon.add', 'Widget style mapping', 'Figma documented color']) {
			await search.fill(query);
			await expect(article.locator('.token-reference-row')).toHaveCount(0);
			await expect(article.getByText('No matching foundation tokens', { exact: true })).toBeVisible();
		}
		await search.fill('spacing.size80');
		await expect(article.locator('.token-reference-row')).toHaveCount(1);
		await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
		const copy = article.getByRole('button', { name: 'Copy spacing.size80 CSS variable --vscode-spacing-size80', exact: true });
		await copy.focus();
		await page.keyboard.press('Enter');
		assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'var(--vscode-spacing-size80)');
		await expect(copy.locator('.copy-feedback')).toHaveText('Copied');
		await search.fill('color.background.accent');
		await expect(article.locator('.token-reference-row')).toContainText('Strong emphasis for a leading action');
		await expect(article.locator('.token-reference-row')).toContainText('#0E639C');
		await search.fill('motion.control.duration');
		await expect(article.locator('#tokens-motion h3')).toHaveText('Feedback');
		const tokenRow = id => article.locator('.token-reference-row').filter({
			has: page.getByRole('button', { name: `Copy ${id} CSS variable --vscode-${id.replaceAll('.', '-')}`, exact: true }),
		});
		const controlDuration = panel.store.topics.get('tokens').envelope.data.designTokens.find(token => token.id === 'motion.control.duration');
		await expect(tokenRow('motion.control.duration')).toHaveCount(1);
		await expect(tokenRow('motion.control.duration').locator('td').first()).toHaveText(controlDuration.value);
		await expect(tokenRow('motion.border.duration')).toContainText('Alias of motion.control.duration');
		await search.fill('motion.progress.duration');
		await expect(article.locator('#tokens-motion h3')).toHaveText('Activity');
		await expect(tokenRow('motion.progress.duration')).toContainText('4000ms');
		await search.fill('agents.fontSize.heading1');
		await expect(article.locator('.token-reference-row')).toContainText('Use fontSize.heading1');
		for (const width of [320, 390, 800, 1440]) {
			await page.setViewportSize({ width, height: 900 });
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px`);
		}
		await expect(article.locator('.token-list a')).toHaveCount(0);
		await expect(article.getByRole('link', { name: 'Read full specification', exact: true })).toHaveCount(1);
		await page.getByRole('searchbox', { name: 'Find a topic', exact: true }).fill('Iconography');
		await page.getByRole('navigation', { name: 'Topics', exact: true }).getByRole('link', { name: 'Iconography', exact: true }).click();
		await expect(page.locator('[data-topic="iconography"] .topic-content')).toHaveAttribute('data-topic-state', 'ready');
		assert.equal(panel.state.scope.mode, 'all');
		assert.equal(requests.includes('/api/fixtures'), false);
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		await panel.close();
	}
});
