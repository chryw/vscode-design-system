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
		const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
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

test('compact reading headers exclude overview and repository controls while retaining contributor resources', { timeout: 30000 }, async t => {
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
						pageStuck: Math.abs(context.top - header.bottom) < 1,
						introGone: bounds('.topic-intro').bottom < context.bottom,
						oneRow: bounds('.article-outline').height < 48,
						sectionClear: bounds('#first-continue').top >= context.bottom,
						noOverflow: document.documentElement.scrollWidth <= innerWidth,
						compactToolbar: innerWidth !== 390 || document.querySelector('.checkout-details').getBoundingClientRect().height < 36,
						searchClear: innerWidth < 960 || search.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(search).paddingLeft) >= searchIcon.getBoundingClientRect().right + 4,
					};
				}), { siteStuck: true, pageStuck: true, introGone: true, oneRow: true, sectionClear: true, noOverflow: true, compactToolbar: true, searchClear: true }, `${colorScheme} ${width}px`);
				const files = article.locator('.contributor-resources > summary');
				await files.focus();
				await page.keyboard.press('Enter');
				await page.keyboard.press('Tab');
				await expect(article.locator('.contributor-resources a').first()).toBeFocused();
				await expect(article.locator('.contributor-resources a').first()).toHaveAttribute('href', /\/source\?file=src%2Fvs%2Ffeature%2Ffirst.md/);
				assert.deepEqual(await article.locator('.contributor-resources .repository-path').allTextContents(), ['src/vs/feature/first.md', 'src/vs/feature/shared.md']);
				await files.focus();
				await page.keyboard.press('Space');
				await expect(files).toBeFocused();
			}
		}
		fixture.saveBook(['first', 'second', 'third']);
		const sourceFile = 'src/vs/feature/first.md';
		fixture.write(sourceFile, readFileSync(path.join(fixture.root, sourceFile), 'utf8')
			.replace('## Introduction\n\nA short overview that scrolls away.\n\n', ''));
		const before = panel.state.views.first;
		await page.getByRole('button', { name: 'Refresh', exact: true }).click();
		await expect(page.locator('#checkout-status')).toHaveText('Checkout reloaded');
		await expect(article.locator('.topic-intro')).toBeHidden();
		await expect(page.locator('#book-navigation').getByRole('link', { name: 'third topic', exact: true })).toBeVisible();
		assert.deepEqual(panel.state.views.first, before);
		assert.deepEqual(errors, []);
	} finally { await browser.close(); await panel.close(); }
});

test('compact global navigation and a single local heading remain distinct and gap-free', { timeout: 60000 }, async t => {
	const fixture = navigationCheckout(t);
	const manifest = '.github/design-system/topics.json';
	const book = JSON.parse(readFileSync(path.join(fixture.root, manifest), 'utf8'));
	fixture.write(manifest, JSON.stringify({ ...book, topics: book.topics.map(topic => topic.id === 'first' ? { ...topic, title: 'Designing for AI' } : topic) }));
	const panel = await createExplorer(fixture.root, { watchCheckout: false });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.goto(panel.url);
		const article = page.locator('[data-topic="first"]');
		await expect(article.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
		const browse = page.getByRole('button', { name: 'Browse topics', exact: true });
		const filter = page.getByRole('searchbox', { name: 'Search topics', exact: true });
		await page.keyboard.press('Tab');
		const skip = page.getByRole('link', { name: 'Skip to content', exact: true });
		await expect(skip).toBeFocused();
		assert.equal(await skip.evaluate(element => {
			const bounds = element.getBoundingClientRect();
			return document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2) === element;
		}), true);
		for (const colorScheme of ['light', 'dark']) {
			for (const forcedColors of ['none', 'active']) {
				await page.emulateMedia({ colorScheme, forcedColors });
				for (const width of [320, 390, 800, 959, 960, 1440, 390]) {
					await page.setViewportSize({ width, height: 800 });
					await expect.poll(() => page.locator('.book-panel').evaluate(panel => panel.hasAttribute('popover'))).toBe(width < 960);
					if (width < 960) {
						await expect(browse).toBeVisible();
						await browse.focus();
						await page.keyboard.press('Enter');
						await expect(filter).toBeFocused();
						await page.keyboard.press('Escape');
						await expect(browse).toBeFocused();
					} else {
						await expect(browse).toBeHidden();
						await expect(filter).toBeVisible();
					}
					for (const y of [300, 650]) {
						await page.evaluate(y => scrollTo(0, y), y);
						await expect.poll(() => article.evaluate(article => {
							const siteHeader = document.querySelector('.explorer-heading');
							const site = siteHeader.getBoundingClientRect();
							const context = article.querySelector('.topic-context');
							const bounds = context.getBoundingClientRect();
							const heading = article.querySelector('.topic-heading');
							const button = document.querySelector('.site-navigation button').getBoundingClientRect();
							const brand = document.querySelector('.book-title').getBoundingClientRect();
							const controls = document.querySelector('.checkout-details').getBoundingClientRect();
							const seam = document.elementFromPoint(bounds.left + bounds.width / 2, site.bottom + 1);
							return {
								joined: Math.abs(bounds.top - site.bottom) < 1,
								opaque: getComputedStyle(context).backgroundColor === getComputedStyle(document.querySelector('.explorer-heading')).backgroundColor,
								seamOwned: context.contains(seam),
								singleTitle: heading.textContent.split('Designing for AI').length === 2 && !document.querySelector('.book-current'),
								noSeparateRow: !document.querySelector('#book-navigation .book-toolbar'),
								compact: bounds.height < (innerWidth < 960 ? 96 : 104),
								globalCompact: site.height <= 45,
								globalUtilities: Math.abs((brand.top + brand.bottom) / 2 - (controls.top + controls.bottom) / 2) < 1,
								leftTrigger: innerWidth >= 960 || Math.abs(button.left - site.left) < 1 && button.right < brand.left,
								localOnly: !heading.querySelector('button'),
								noCheckoutRow: !siteHeader.querySelector('#checkout'),
								noOverflow: document.documentElement.scrollWidth <= innerWidth,
							};
						}), { message: `${colorScheme}, ${forcedColors}, ${width}px, scroll ${y}` }).toEqual({ joined: true, opaque: true, seamOwned: true, singleTitle: true, noSeparateRow: true, compact: true, globalCompact: true, globalUtilities: true, leftTrigger: true, localOnly: true, noCheckoutRow: true, noOverflow: true });
					}
				}
			}
		}
		await browse.focus();
		await page.keyboard.press('Enter');
		await expect(filter).toBeFocused();
		await page.setViewportSize({ width: 1100, height: 800 });
		await expect(filter).toBeFocused();
		await page.setViewportSize({ width: 390, height: 800 });
		await expect(browse).toBeFocused();
		await page.keyboard.press('Enter');
		await filter.fill('second');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Enter');
		await expect(page.locator('[data-topic="second"] h1')).toBeFocused();
		await expect(page.locator('.site-navigation').getByRole('button', { name: 'Browse topics', exact: true })).toBeVisible();
		assert.deepEqual(errors, []);
	} finally { await browser.close(); await panel.close(); }
});
