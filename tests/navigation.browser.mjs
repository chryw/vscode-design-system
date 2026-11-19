/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Browser coverage for the no-build canvas. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, expect } from './playwright.mjs';
import { createDocumentCheckout } from './document-helpers.mjs';
import { createExplorer } from '../runtime/server.mjs';

function navigationCheckout(t) {
	const fixture = createDocumentCheckout(t);
	const manifest = '.github/design-system/topics.json';
	const book = JSON.parse(readFileSync(path.join(fixture.root, manifest), 'utf8'));
	const topic = id => ({ id, section: id, title: `${id} topic`, group: 'Foundations', renderer: 'guidance',
		aliases: [], page: `content/topics/${id}.json`, fixture: false, compare: true });
	const topics = ['first', 'second', 'third'].map(topic);
	fixture.write('src/vs/feature/shared.md', '# Shared guidance\n\n## Shared\n\nOne document can contribute to multiple topics.\n');
	const saveBook = ids => fixture.write(manifest, JSON.stringify({
		...book, components: undefined, references: {}, defaultTopic: 'first',
		topics: [...topics.filter(topic => ids.includes(topic.id)), book.topics.find(topic => topic.id === 'documentation')],
	}));
	for (const { id } of topics) {
		fixture.write(`src/vs/feature/${id}.md`, `# ${id} topic\n\n## Introduction\n\nA short overview that scrolls away.\n\n## Start\n\n${'Reading content. '.repeat(400)}\n\n## Continue\n\n[Next topic](./second.md#finish)\n\n${'More guidance. '.repeat(100)}\n\n## Finish\n\nEnd of this topic.\n`);
		fixture.write(`.github/design-system/content/topics/${id}.json`, JSON.stringify({
			version: 1, id, renderer: 'guidance', source: `src/vs/feature/${id}.md`, content: {},
			sections: ['Start', 'Continue', 'Finish'].map(title => ({ id: `${id}-${title.toLowerCase()}`, key: title.toLowerCase(), heading: title })),
			guidance: [{ id: `${id}-shared`, file: 'src/vs/feature/shared.md', heading: 'Shared' }],
		}));
	}
	saveBook(['first', 'second']);
	return { ...fixture, saveBook };
}

test('canvas Back and Forward restore cross-topic anchors and reading position without a document reload', { timeout: 30000 }, async t => {
	const fixture = navigationCheckout(t);
	const panel = await createExplorer(fixture.root, { watchCheckout: false });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.goto(panel.url);
		const back = page.getByRole('button', { name: 'Back', exact: true });
		const forward = page.getByRole('button', { name: 'Forward', exact: true });
		await expect(page.locator('[data-topic="first"] .topic-content')).toHaveAttribute('data-topic-state', 'ready');
		await expect(back).toBeDisabled();
		await page.locator('[data-topic="first"] .article-outline').getByRole('link', { name: 'Continue', exact: true }).click();
		const next = page.locator('[data-topic="first"]').getByRole('link', { name: 'Next topic', exact: true });
		await next.scrollIntoViewIfNeeded();
		const y = await page.evaluate(() => scrollY);
		await next.click();
		const second = page.locator('[data-topic="documentation"]');
		await expect(second.locator('#document-finish')).toBeFocused();
		await expect(back).toBeEnabled();
		await back.focus();
		await page.keyboard.press('Enter');
		await expect(page.locator('[data-topic="first"]')).toBeVisible();
		await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(y, 0);
		await expect(forward).toBeEnabled();
		await forward.click();
		await expect(second).toBeVisible();
		await expect(page).toHaveURL(/#finish$/);
		await expect(forward).toBeDisabled();
		await back.click();
		await page.getByRole('navigation', { name: 'Topics', exact: true }).getByRole('link', { name: 'second topic', exact: true }).click();
		await expect(forward).toBeDisabled();
		assert.deepEqual(await page.evaluate(() => ({
			navigations: performance.getEntriesByType('navigation').length,
			library: [...document.querySelectorAll('#book-navigation a')].some(link => link.textContent === 'Source library'),
			misleading: [...document.querySelectorAll('a')].some(link => /Back to sources/.test(link.textContent)),
		})), { navigations: 1, library: false, misleading: false });
		assert.deepEqual(errors, []);
	} finally { await browser.close(); await panel.close(); }
});

test('compact sticky navigation excludes overview, exposes topic files, and reloads the checkout catalog', { timeout: 30000 }, async t => {
	const fixture = navigationCheckout(t);
	const panel = await createExplorer(fixture.root, { watchCheckout: false });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.goto(panel.url);
		const article = page.locator('[data-topic="first"]');
		await expect(article.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
		for (const colorScheme of ['light', 'dark']) {
			await page.emulateMedia({ colorScheme });
			for (const width of [320, 390, 800, 1440]) {
				await page.setViewportSize({ width, height: 900 });
				await article.locator('.article-outline').getByRole('link', { name: 'Continue', exact: true }).click();
				assert.deepEqual(await article.evaluate(article => {
					const bounds = selector => article.querySelector(selector).getBoundingClientRect();
					const header = document.querySelector('.explorer-heading').getBoundingClientRect();
					const context = bounds('.topic-context');
					const search = document.querySelector('.book-search input');
					const searchIcon = document.querySelector('.book-search .chrome-icon');
					return {
						siteStuck: Math.abs(header.top) < 1,
						pageStuck: context.top >= header.bottom - 1 && context.top <= header.bottom + 54,
						introGone: bounds('.topic-intro').bottom < context.bottom,
						oneRow: bounds('.article-outline').height < 48,
						sectionClear: bounds('#first-continue').top >= context.bottom,
						noOverflow: document.documentElement.scrollWidth <= innerWidth,
						compactToolbar: innerWidth !== 390 || document.querySelector('.checkout-details').getBoundingClientRect().height < 36,
						searchClear: innerWidth < 760 || search.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(search).paddingLeft) >= searchIcon.getBoundingClientRect().right + 4,
					};
				}), { siteStuck: true, pageStuck: true, introGone: true, oneRow: true, sectionClear: true, noOverflow: true, compactToolbar: true, searchClear: true }, `${colorScheme} ${width}px`);
				const files = article.locator('.topic-files > summary');
				await files.focus();
				await page.keyboard.press('Enter');
				await page.keyboard.press('Tab');
				await expect(article.locator('.topic-files a').first()).toBeFocused();
				await expect(article.locator('.topic-files a').first()).toHaveAttribute('href', /\/source\?file=src%2Fvs%2Ffeature%2Ffirst.md/);
				assert.deepEqual(await article.locator('.topic-files a').allTextContents(), ['src/vs/feature/first.md', 'src/vs/feature/shared.md']);
				await page.keyboard.press('Escape');
				await expect(files).toBeFocused();
			}
		}
		fixture.saveBook(['first', 'second', 'third']);
		const before = panel.state.views.first;
		await page.getByRole('button', { name: 'Refresh', exact: true }).click();
		await expect(page.locator('#checkout-status')).toHaveText('Checkout reloaded');
		await expect(page.locator('#book-navigation').getByRole('link', { name: 'third topic', exact: true })).toBeVisible();
		assert.deepEqual(panel.state.views.first, before);
		assert.deepEqual(errors, []);
	} finally { await browser.close(); await panel.close(); }
});
