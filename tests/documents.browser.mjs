/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Browser coverage for authored-document contracts. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { chromium, expect } from './playwright.mjs';
import { createExplorer } from '../runtime/server.mjs';
import { readDocument } from '../runtime/headless.mjs';
import { createDocumentCheckout, checkoutRoot } from './document-helpers.mjs';

test('documents share the chapter title, introduction and outline order without losing source structure', { timeout: 60000 }, async t => {
	const fixture = createDocumentCheckout(t);
	const cases = [
		{ name: 'explicit', lead: '<a id="overview"></a>\n## Introduction\n\nLead with **design intent** and [behavior](#behavior).\n\n', introduction: true, headings: ['Behavior', 'Validation'] },
		{ name: 'preamble', lead: 'Lead with **design intent** and [behavior](#behavior).\n\n', introduction: true, headings: ['Behavior', 'Validation'] },
		{ name: 'sections', lead: '', introduction: false, headings: ['Behavior', 'Validation'] },
		{ name: 'nested', lead: '## Introduction\n\n### Scope\n\nKeep this substantive introductory section.\n\n', introduction: false, headings: ['Introduction', 'Behavior', 'Validation'] },
	];
	for (const { name, lead } of cases) {
		fixture.write(`src/vs/feature/${name}.md`, `---\ndescription: Reader hierarchy\n---\n# ${name}\n\n${lead}## Behavior\n\nPreserve meaningful structure.\n\n### Keyboard\n\nKeep focus visible.\n\n## Validation\n\nCheck the result.\n`);
	}
	const panel = await createExplorer(fixture.root, { bookRoot: fixture.bookRoot, scope: { operation: 'all', active: 'documentation' } });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		for (const { name, introduction, headings } of cases) {
			panel.setView({ section: 'documentation', documentId: `src/vs/feature/${name}.md`, anchor: '' });
			await page.goto(panel.url);
			const article = page.locator('[data-topic="documentation"]');
			await expect(article.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
			await expect(article.locator('h1')).toHaveText(name);
			await expect(article.locator('.documentation h2')).toHaveText(headings);
			await expect(article.locator('.article-outline a')).toHaveText(headings);
			await expect(article.getByRole('heading', { name: 'Keyboard', level: 3, exact: true })).toBeVisible();
			assert.equal(await article.locator('.topic-intro').isVisible(), introduction);
			assert.equal(await article.locator('.documentation .document-path, .documentation details').count(), 0);
			if (introduction) {
				await expect(article.locator('.topic-intro strong')).toHaveText('design intent');
				await expect(article.getByText('Lead with', { exact: false })).toHaveCount(1);
				await article.locator('.topic-intro').getByRole('link', { name: 'behavior', exact: true }).click();
				await expect(article.locator('#document-behavior')).toBeFocused();
			}
			for (const width of [390, 1000, 1440]) {
				await page.setViewportSize({ width, height: 900 });
				assert.equal(await article.evaluate(article => {
					const metadata = article.querySelector('.topic-metadata');
					const title = article.querySelector('h1');
					const intro = article.querySelector('.topic-intro');
					const outline = article.querySelector('.article-outline');
					const body = article.querySelector('.topic-content');
					const order = [metadata, title, ...(intro.hidden ? [] : [intro]), outline, body];
					return order.every((element, index) => !index || Boolean(order[index - 1].compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING))
						&& metadata.getBoundingClientRect().left === title.getBoundingClientRect().left
						&& document.documentElement.scrollWidth <= innerWidth;
				}), true, `${name}: shared reading order at ${width}px`);
			}
			if (name === 'explicit') {
				for (const anchor of ['introduction', 'overview']) {
					panel.setView({ section: 'documentation', anchor });
					await expect(article.locator(`#document-${anchor}`)).toBeFocused();
				}
			}
			await article.getByText('Document metadata', { exact: true }).click();
			await expect(article.locator('.topic-metadata pre')).toHaveText('description: Reader hierarchy');
			await article.getByRole('link', { name: 'Back to sources', exact: true }).click();
			await expect(article.locator('h1')).toHaveText('Source library');
			await expect(article.locator('.topic-metadata')).toHaveCount(0);
		}
	} finally { await browser.close(); await panel.close(); }
});

test('Illustration has the same opening hierarchy in the chapter and the source reader', { timeout: 30000 }, async () => {
	const panel = await createExplorer(checkoutRoot, { scope: { operation: 'all', active: 'illustration' } });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
		await page.goto(panel.url);
		const chapter = page.locator('[data-topic="illustration"]');
		await expect(chapter.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
		const opening = {
			title: await chapter.locator('h1').innerText(),
			introduction: await chapter.locator('.topic-intro').innerText(),
			sections: await chapter.locator('.article-outline a').allTextContents(),
		};
		panel.setView({ section: 'documentation', documentId: '.github/design-system/guidance/illustration.design.md' });
		const reader = page.locator('[data-topic="documentation"]');
		await expect(reader.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
		assert.deepEqual({
			title: await reader.locator('h1').innerText(),
			introduction: await reader.locator('.topic-intro').innerText(),
			sections: await reader.locator('.article-outline a').allTextContents(),
		}, opening);
		await expect(reader.getByRole('heading', { name: 'Introduction', exact: true })).toHaveCount(0);
		await expect(reader.locator('.documentation > .prose > h2').first()).toHaveText('Principles');
	} finally { await browser.close(); await panel.close(); }
});

test('book tools remain keyboard-accessible outside Foundations and topic filtering', { timeout: 30000 }, async () => {
	const panel = await createExplorer(checkoutRoot, { scope: { operation: 'all', active: 'accessibility' } });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
		await page.goto(panel.url);
		const topics = page.getByRole('navigation', { name: 'Topics', exact: true });
		await expect(topics.locator(':scope > details > summary')).toHaveText(['Foundations', 'Components']);
		const foundations = topics.locator(':scope > details').filter({ has: page.getByText('Foundations', { exact: true }) });
		await expect(foundations.getByRole('link', { name: 'Accessibility', exact: true })).toBeVisible();
		await expect(foundations.getByRole('link', { name: 'Content', exact: true })).toBeVisible();
		const sources = page.getByRole('navigation', { name: 'Book tools', exact: true }).getByRole('link', { name: 'Source library', exact: true });
		await expect(topics.getByRole('link', { name: /Documentation|Source library/ })).toHaveCount(0);
		assert.equal(await sources.evaluate(element => element.getBoundingClientRect().bottom <= innerHeight - 24), true);
		await page.evaluate(() => scrollTo(0, 100));
		await expect.poll(() => sources.evaluate(element => element.getBoundingClientRect().bottom <= innerHeight - 24)).toBe(true);
		const filter = page.getByRole('searchbox', { name: 'Search topics', exact: true });
		for (const width of [1100, 390]) {
			await page.setViewportSize({ width, height: 900 });
			if (width < 760) { await page.getByRole('button', { name: 'Browse topics', exact: true }).click(); }
			await filter.fill('no-topic-match');
			await expect(page.getByText('No matching topics', { exact: true })).toBeVisible();
			await expect(sources).toBeVisible();
			await page.keyboard.press('Tab');
			await expect(sources).toBeFocused();
			await page.keyboard.press('Enter');
			await expect(page.locator('[data-topic="documentation"] h1')).toBeFocused();
			await expect(page.locator('[data-topic="documentation"] h1')).toHaveText('Source library');
			assert.equal(panel.state.scope.active, 'documentation');
			if (width < 760) {
				await expect(topics).not.toBeVisible();
				await expect(page.locator('.book-current')).toHaveText('Source library');
			}
		}
	} finally { await browser.close(); await panel.close(); }
});

test('portable navigation retains Source library, source search and document links without live APIs', { timeout: 30000 }, async () => {
	const panel = await createExplorer(checkoutRoot, { scope: { operation: 'all', active: 'documentation' } });
	const browser = await chromium.launch({ headless: true });
	try {
		const ids = ['accessibility', 'documentation'];
		const snapshot = {
			createdAt: new Date().toISOString(),
			repository: panel.store.repository.projection,
			catalog: panel.store.repository.catalog.filter(item => ids.includes(item.id)),
			topics: Object.fromEntries(await Promise.all(ids.map(async id => [id, (await panel.store.read(id, panel.state.views[id])).data]))),
			documents: panel.store.documents.snapshot(), documentImages: {}, documentImageProblems: {},
		};
		const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
		const errors = [];
		const apiRequests = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.addInitScript(snapshot => { globalThis.designSnapshot = snapshot; }, snapshot);
		await page.route('**/api/**', route => { apiRequests.push(route.request().url()); return route.abort(); });
		await page.route('**/portable.mjs', route => route.fulfill({
			contentType: 'text/javascript', body: readFileSync(new URL('../view/portable.mjs', import.meta.url), 'utf8'),
		}));
		await page.route('**/snapshot.html*', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
			<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
			<link rel="stylesheet" href="/canvas.css"><link rel="stylesheet" href="/shell.css"><link rel="stylesheet" href="/book-navigation.css">
			<script type="module" src="/portable.mjs"></script></head><body class="design-reference explorer book-layout">
			<header class="explorer-heading"><time id="snapshot-date"></time></header>
			<div class="explorer-layout"><div id="book-navigation"></div><main id="reference" tabindex="-1"></main></div>
			</body></html>` }));
		await page.goto(new URL('/snapshot.html?topic=documentation', panel.url).href);
		await expect(page.locator('h1')).toHaveText('Source library');
		const topics = page.getByRole('navigation', { name: 'Topics', exact: true });
		const tools = page.getByRole('navigation', { name: 'Book tools', exact: true });
		await expect(topics.getByRole('link', { name: 'Source library', exact: true })).toHaveCount(0);
		await expect(tools.getByRole('link', { name: 'Source library', exact: true })).toHaveAttribute('aria-current', 'page');
		const search = page.getByRole('searchbox', { name: 'Search sources', exact: true });
		await search.fill('Design-token usage in CSS');
		await search.press('Enter');
		await page.getByRole('link', { name: 'Design-token usage in CSS', exact: true }).click();
		await expect(page.locator('h1')).toHaveText('Design-token usage in CSS');
		await page.getByRole('link', { name: 'Back to sources', exact: true }).click();
		await expect(page.locator('h1')).toHaveText('Source library');
		await topics.locator('summary').click();
		await topics.getByRole('link', { name: 'Accessibility', exact: true }).click();
		await expect(page.locator('h1')).toHaveText('Accessibility');
		await tools.getByRole('link', { name: 'Source library', exact: true }).click();
		await expect(page.locator('h1')).toHaveText('Source library');
		assert.deepEqual({ errors, apiRequests }, { errors: [], apiRequests: [] });
	} finally { await browser.close(); await panel.close(); }
});

test('new authored documents appear live, retain search drafts, render safely, and recover after removal', { timeout: 60000 }, async t => {
	const fixture = createDocumentCheckout(t);
	const panel = await createExplorer(fixture.root, { bookRoot: fixture.bookRoot, scope: { operation: 'all', active: 'documentation' } });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.goto(panel.url);
		await expect(page.getByRole('heading', { name: 'Source library', level: 1, exact: true })).toBeVisible();
		const topics = page.getByRole('searchbox', { name: 'Search topics' });
		await topics.fill('specifications');
		await expect(page.getByRole('navigation', { name: 'Topics', exact: true }).getByRole('link', { name: 'Source library', exact: true })).toHaveCount(0);
		await expect(page.getByRole('navigation', { name: 'Book tools', exact: true }).getByRole('link', { name: 'Source library', exact: true })).toBeVisible();
		await expect(page.getByText('No matching topics', { exact: true })).toBeVisible();
		await topics.fill('');
		const search = page.getByRole('searchbox', { name: 'Search sources' });
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
		await page.getByRole('link', { name: 'Back to sources', exact: true }).first().click();
		await expect(page.getByRole('heading', { name: 'Source library', level: 1, exact: true })).toBeVisible();
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
		await page.locator('#shell-problem > summary').click();
		await expect(page.locator('#shell-problem')).toContainText('not available');
		await page.getByRole('link', { name: 'Browse sources', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Source library', level: 1, exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Feature notes', exact: true })).toBeVisible();
	} finally { await browser.close(); await panel.close(); }
});

test('renamed design guidance renders from canonical sources and restores an old document bookmark', { timeout: 60000 }, async () => {
	const old = 'src/vs/platform/theme/common/sizes/typography.md';
	const canonical = 'src/vs/platform/theme/common/sizes/typography.design.md';
	const panel = await createExplorer(checkoutRoot, { scope: { operation: 'all', active: 'documentation' } });
	const browser = await chromium.launch({ headless: true });
	try {
		panel.setView({ section: 'documentation', documentId: old, anchor: 'weight-and-emphasis' });
		const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.goto(panel.url);
		await expect(page.getByRole('heading', { name: 'Typography', level: 1, exact: true })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Weight and emphasis', exact: true })).toBeFocused();
		const guidance = readDocument(checkoutRoot, canonical, { anchor: 'weight-and-emphasis' });
		await expect(page.locator('.documentation')).toContainText(guidance.markdown.split(/\n\s*\n/)[0]);
		await page.reload();
		await expect(page.getByRole('heading', { name: 'Typography', level: 1, exact: true })).toBeVisible();
		const document = await (await page.request.get(new URL(`/api/document?id=${encodeURIComponent(old)}&anchor=weight-and-emphasis`, panel.url).href)).json();
		const listing = await (await page.request.get(new URL('/api/documents?query=typography.design.md', panel.url).href)).json();
		assert.deepEqual({
			id: document.id, source: document.source.file,
			canonicalListed: listing.results.some(item => item.id === canonical),
			oldListed: listing.results.some(item => item.id === old),
			fixtures: (await (await page.request.get(new URL('/api/metrics', panel.url).href)).json()).fixtureRequests,
			errors,
		}, { id: canonical, source: canonical, canonicalListed: true, oldListed: false, fixtures: 0, errors: [] });
		panel.setView({ section: 'documentation', documentId: 'src/vs/platform/theme/common/motion/motion.design.md', anchor: 'accessibility' });
		await expect(page.getByRole('heading', { name: 'Motion', level: 1, exact: true })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Accessibility', exact: true })).toBeFocused();
		await expect(page.locator('.documentation')).toContainText('workbench.reduceMotion');
	} finally { await browser.close(); await panel.close(); }
});
