/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import assert from 'node:assert/strict';
import { workspaceRoot } from '../runtime/paths.mjs';
import test from 'node:test';
import { catalog, controls, motionControls } from './repository-helpers.mjs';
import { chromium, expect } from './playwright.mjs';
import { createExplorer } from '../runtime/server.mjs';
import { corePaletteThemes } from '../view/token-lookup.mjs';
import { mockFixtureControl, mockFixtureRenderer } from './browser-helpers.mjs';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readPage } from '../adapters/vscode/groups/authored.mjs';
import { vscodeAdapter } from '../adapters/vscode/readers.mjs';
import { createDocumentCheckout } from './document-helpers.mjs';

const root = workspaceRoot;
const widths = [320, 390, 500, 800, 1440];

test('repository references are collapsed contributor resources after the article and further reading', { timeout: 60000 }, async t => {
	const fixture = createDocumentCheckout(t);
	const references = [
		{ title: 'Text spacing', url: 'https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html', description: 'Check the required user text-spacing overrides.' },
		{ title: `Variable font axes: ${'LongUnbrokenReferenceTitle'.repeat(4)}`, url: 'https://learn.microsoft.com/en-us/typography/opentype/spec/otvaroverview', description: 'Understand font-axis interpolation and how it relates to the weight specimen.' },
	];
	const specFile = '.github/skills/design-system/patterns/designing-for-ai.design.md';
	const spec = readFileSync(path.join(fixture.bookRoot, 'patterns/designing-for-ai.design.md'), 'utf8');
	const referenceYaml = references.map(reference => `  - title: ${JSON.stringify(reference.title)}\n    url: ${JSON.stringify(reference.url)}\n    description: ${JSON.stringify(reference.description)}`).join('\n');
	const updatedSpec = spec.replace(/^references:\r?\n(?:[ \t]+.*\r?\n)*/m, `references:\n${referenceYaml}\n`);
	assert.notEqual(updatedSpec, spec);
	fixture.write(specFile, updatedSpec);
	const panel = await createExplorer(fixture.root, { scope: { operation: 'all', active: 'designing-for-ai' } });
	let browser;
	try {
		browser = await chromium.launch({ headless: true });
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await mockFixtureRenderer(page, root, ['icon-label', 'button', 'input', 'radio']);
		await page.goto(panel.url);
		const article = page.locator('[data-topic="designing-for-ai"]');
		await expect(article.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
		const footer = article.locator('.topic-actions');
		const sources = article.locator('.contributor-resources');
		const reading = footer.locator('.topic-references');
		const summaries = footer.locator(':scope > details > summary');
		await expect(article.locator('.topic-context details')).toHaveCount(0);
		await expect(sources).not.toHaveAttribute('open', '');
		await expect(sources.locator('summary')).toHaveText('Contributor resources');
		await expect(sources.locator('p')).toContainText('updating this topic');
		assert.equal(await sources.evaluate(sources => sources.parentElement.classList.contains('topic-actions')
			&& Boolean(sources.previousElementSibling.compareDocumentPosition(sources) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
		await sources.locator('summary').focus();
		await page.keyboard.press('Enter');
		await page.keyboard.press('Tab');
		await expect(sources.locator('a').first()).toBeFocused();
		await sources.locator('summary').focus();
		await page.keyboard.press('Space');
		await reading.locator('summary').focus();
		await page.keyboard.press('Enter');
		await page.keyboard.press('Tab');
		await expect(reading.getByRole('link', { name: /^Text spacing/ })).toBeFocused();
		assert.ok((await sources.locator('.repository-path').allTextContents()).includes(specFile));
		assert.deepEqual(await reading.locator('li').evaluateAll(items => items.map(item => ({
			title: item.querySelector('a').textContent, url: item.querySelector('a').href, description: item.querySelector('p').textContent,
			target: item.querySelector('a').target, rel: item.querySelector('a').rel,
		}))), references.map(reference => ({ ...reference, target: '_blank', rel: 'noopener noreferrer' })));
		for (const colorScheme of ['light', 'dark']) {
			for (const forcedColors of ['none', 'active']) {
				await page.emulateMedia({ colorScheme, forcedColors });
				for (const width of [320, 800, 1440]) {
					await page.setViewportSize({ width, height: 900 });
					await page.mouse.move(0, 0);
					const styles = await summaries.evaluateAll(summaries => summaries.map(summary => {
						const bounds = summary.getBoundingClientRect();
						const icon = summary.querySelector('.chrome-icon').getBoundingClientRect();
						const style = getComputedStyle(summary);
						return {
							left: bounds.left, width: bounds.width, height: bounds.height,
							iconOffset: icon.left - bounds.left, iconWidth: icon.width, iconHeight: icon.height,
							padding: style.padding, font: style.font, color: style.color,
						};
					}));
					assert.deepEqual(styles[0], styles[1], `Equivalent disclosure geometry: ${colorScheme}, ${forcedColors}, ${width}px`);
					for (const summary of await summaries.all()) {
						await summary.focus();
						await summary.hover();
						assert.deepEqual(await summary.evaluate(summary => {
							const style = getComputedStyle(summary);
							return { focused: summary.matches(':focus-visible'), outline: style.outlineStyle, width: style.outlineWidth, offset: style.outlineOffset };
						}), { focused: true, outline: 'solid', width: '1px', offset: '-1px' });
					}
					await reading.locator('a').first().focus();
					assert.deepEqual(await footer.evaluate(footer => {
						const bounds = element => element.getBoundingClientRect();
						const items = [...footer.querySelectorAll('li')].filter(item => item.getClientRects().length);
						const focused = document.activeElement;
						return {
							disclosuresAligned: [...footer.children].every(child => Math.abs(bounds(child).left - bounds(footer).left) < 1),
							linksAligned: items.every(item => Math.abs(bounds(item).left - bounds(items[0]).left) < 1),
							noOverflow: document.documentElement.scrollWidth <= innerWidth,
							focusVisible: focused.matches(':focus-visible') && getComputedStyle(focused).outlineStyle !== 'none',
						};
					}), { disclosuresAligned: true, linksAligned: true, noOverflow: true, focusVisible: true },
					`${colorScheme}, ${forcedColors}, ${width}px`);
				}
			}
		}
		await sources.locator('summary').focus();
		await page.keyboard.press('Enter');
		await expect(sources).toHaveAttribute('open', '');
		const sourceLink = sources.locator('a').first();
		await page.keyboard.press('Tab');
		await expect(sourceLink).toBeFocused();
		const beforeSourceClick = await sources.locator('summary .chrome-icon').evaluate(icon => getComputedStyle(icon).transform);
		assert.equal(beforeSourceClick, await reading.locator('summary .chrome-icon').evaluate(icon => getComputedStyle(icon).transform));
		await page.getByRole('button', { name: 'Refresh', exact: true }).click();
		await expect(article.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
		await expect(article.locator('.contributor-resources')).toBeVisible();
		panel.setScope({ operation: 'all', active: 'illustration' });
		await expect(page.locator('[data-topic="illustration"] .topic-content')).toHaveAttribute('data-topic-state', 'ready');
		await expect(page.locator('[data-topic="illustration"] .topic-references')).toBeHidden();
		await page.locator('[data-topic="illustration"] .contributor-resources > summary').click();
		await expect(page.locator('[data-topic="illustration"] .contributor-resources a')).toHaveCount(1);
		const contentPanel = await createExplorer(root, { scope: { operation: 'all', active: 'colors' } });
		try {
			await page.goto(contentPanel.url);
			const colors = page.locator('[data-topic="colors"]');
			await expect(colors.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
			const contributors = colors.locator('.contributor-resources');
			const colorScroll = colors.getByRole('region', { name: 'Color tokens across four themes; scroll for more rows and columns', exact: true });
			await colorScroll.evaluate(element => { element.scrollTop = 100; });
			await expect(contributors).not.toHaveAttribute('open', '');
			await contributors.locator('summary').focus();
			await page.keyboard.press('Enter');
			for (const width of [320, 800, 1440]) {
				await page.setViewportSize({ width, height: 900 });
				await contributors.locator('a').last().focus();
				assert.deepEqual(await colors.evaluate(article => {
					const resources = article.querySelector('.contributor-resources');
					const content = article.querySelector('.topic-content');
					const header = article.querySelector('.color-matrix thead');
					const link = resources.querySelector('li:last-child a');
					const bounds = link.getBoundingClientRect();
					const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
					return {
						afterContent: resources.getBoundingClientRect().top >= content.getBoundingClientRect().bottom,
						linksInFlow: bounds.top >= content.getBoundingClientRect().bottom && bounds.bottom <= resources.getBoundingClientRect().bottom,
						clearOfTable: resources.getBoundingClientRect().top >= header.getBoundingClientRect().bottom,
						clickable: hit === link || link.contains(hit),
						noHeaderControl: !article.querySelector('.topic-context details'),
						noOverflow: document.documentElement.scrollWidth <= innerWidth,
					};
				}), { afterContent: true, linksInFlow: true, clearOfTable: true, clickable: true, noHeaderControl: true, noOverflow: true }, `Colors ${width}px`);
			}
			contentPanel.setScope({ operation: 'all', active: 'documentation' });
			await expect(page.locator('[data-topic="documentation"] .topic-content')).toHaveAttribute('data-topic-state', 'ready');
			await expect(page.locator('[data-topic="documentation"] .topic-actions')).toBeHidden();
		} finally { await contentPanel.close(); }
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		await panel.close();
	}
});

test('viewer search fields and command controls share dimensions and honor semantic theme overrides', { timeout: 60000 }, async () => {
	const panel = await createExplorer(root, { scope: { operation: 'all', active: 'tokens' } });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await mockFixtureRenderer(page, root, ['icon-label', 'button', 'input', 'radio']);
		await page.goto(panel.url);
		await page.evaluate(() => {
			document.body.style.setProperty('--vscode-input-background', 'rgb(24, 36, 48)');
			document.body.style.setProperty('--vscode-input-foreground', 'rgb(240, 240, 240)');
			document.body.style.setProperty('--vscode-input-placeholderForeground', 'rgb(210, 220, 230)');
		});
		const sidebar = page.getByRole('searchbox', { name: 'Search topics', exact: true });
		const fieldStyle = input => input.evaluate(input => {
			const style = getComputedStyle(input);
			return {
				height: input.getBoundingClientRect().height, font: style.font,
				border: style.border, radius: style.borderRadius, paddingBlock: style.paddingBlock,
				background: style.backgroundColor, foreground: style.color,
			};
		});
		for (const id of ['tokens', 'colors', 'iconography', 'documentation']) {
			panel.setScope({ operation: 'all', active: id });
			const article = page.locator(`[data-topic="${id}"]`);
			await expect(article.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
			const input = article.getByRole('searchbox');
			assert.deepEqual(await fieldStyle(input), await fieldStyle(sidebar), `${id}: shared search field`);
			if (await input.getAttribute('placeholder')) {
				assert.equal(await input.evaluate(input => getComputedStyle(input, '::placeholder').color),
					await sidebar.evaluate(input => getComputedStyle(input, '::placeholder').color));
			}
			await input.focus();
			await page.keyboard.press('Tab');
			await page.keyboard.press('Shift+Tab');
			assert.equal(await input.evaluate(input => input.matches(':focus-visible') && getComputedStyle(input).outlineStyle === 'solid'), true);
		}
		const documentSearch = page.locator('[data-topic="documentation"]').getByRole('button', { name: 'Search', exact: true });
		const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
		const buttonStyle = button => button.evaluate(button => {
			const style = getComputedStyle(button);
			return { height: button.getBoundingClientRect().height, font: style.font, paddingBlock: style.paddingBlock };
		});
		assert.deepEqual(await buttonStyle(documentSearch), await buttonStyle(refresh));
		const filter = page.locator('[data-topic="documentation"]').getByRole('combobox', { name: 'Source', exact: true });
		await page.getByRole('button', { name: 'Content version', exact: true }).click();
		const version = page.getByRole('combobox', { name: 'Content version', exact: true });
		assert.deepEqual(await fieldStyle(filter), await fieldStyle(version));
		await page.keyboard.press('Escape');
		await page.setViewportSize({ width: 320, height: 900 });
		await expect(documentSearch).toBeVisible();
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		assert.deepEqual(errors, []);
	} finally { await browser.close(); await panel.close(); }
});

test('Markdown tables retain shared alignment and spacing outside the prose wrapper', { timeout: 60000 }, async () => {
	const panel = await createExplorer(root, { scope: { operation: 'all', active: 'motion' } });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await mockFixtureRenderer(page, root, motionControls.map(control => control.id));
		await page.goto(panel.url);
		const style = table => table.evaluate(table => {
			const text = table.rows[1].cells[0].firstChild;
			const word = text.textContent.trim().split(/\s+/).reduce((first, second) => first.length >= second.length ? first : second);
			const offset = text.textContent.indexOf(word);
			const range = document.createRange();
			range.setStart(text, offset);
			range.setEnd(text, offset + word.length);
			return {
				cells: [...table.querySelectorAll('th, td')].every(cell => {
					const style = getComputedStyle(cell);
					return style.textAlign === 'left' && style.verticalAlign === 'top'
						&& style.padding === '8px 12px' && style.borderBottomStyle === 'solid' && style.borderBottomWidth === '1px';
				}),
				columns: [...table.rows[0].cells].every((header, index) =>
					Math.abs(header.getBoundingClientRect().left - table.rows[1].cells[index].getBoundingClientRect().left) < 1),
				borderCollapse: getComputedStyle(table).borderCollapse,
				fontSize: getComputedStyle(table).fontSize,
				lineHeight: getComputedStyle(table).lineHeight,
				padding: getComputedStyle(table.rows[1].cells[0]).padding,
				wordsIntact: range.getClientRects().length === 1,
			};
		});
		for (const colorScheme of ['light', 'dark']) {
			for (const forcedColors of ['none', 'active']) {
				await page.emulateMedia({ colorScheme, forcedColors });
				for (const width of [320, 800, 1440]) {
					await page.setViewportSize({ width, height: 900 });
					const styles = [];
					for (const id of ['motion', 'elevation']) {
						panel.setScope({ operation: 'all', active: id });
						const article = page.locator(`[data-topic="${id}"]`);
						await expect(article).toBeVisible();
						await expect(article).toHaveAttribute('aria-busy', 'false');
						await expect(article.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
						const table = article.locator('.table-scroll table').first();
						await expect(table.locator('th').first()).toHaveText(id === 'motion' ? 'Intent' : 'Relationship');
						styles.push(await style(table));
						assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${id}, ${width}px`);
						assert.equal(await table.evaluate(table => {
							const scroll = table.parentElement;
							scroll.scrollLeft = scroll.scrollWidth;
							return table.getBoundingClientRect().right <= scroll.getBoundingClientRect().right + 1;
						}), true, `${id}: last column is reachable at ${width}px`);
					}
					assert.deepEqual(styles[0], styles[1], `${colorScheme}, ${forcedColors}, ${width}px`);
					assert.deepEqual({ cells: styles[0].cells, columns: styles[0].columns, collapse: styles[0].borderCollapse, wordsIntact: styles[0].wordsIntact },
						{ cells: true, columns: true, collapse: 'collapse', wordsIntact: true });
				}
			}
		}
		assert.deepEqual(errors, []);
	} finally { await browser.close(); await panel.close(); }
});

test('source chapter composition controls order, renders complete Markdown, and preserves earlier anchors', { timeout: 60000 }, async () => {
	const read = file => readFileSync(path.join(root, file), 'utf8');
	const authored = readPage(read, 'typography').authored;
	const source = '.github/skills/design-system/foundations/typography.design.md';
	const pageFile = '.github/skills/design-system/content/topics/typography.json';
	mkdirSync(path.join(root, '.build'), { recursive: true });
	const scratch = mkdtempSync(path.join(root, '.build/chapter-composition-'));
	const sourceFile = path.join(scratch, 'source.md');
	const descriptor = path.join(scratch, 'page.json');
	const sections = Object.entries(authored.sections).map(([key, section]) => ({
		id: `typography-${key}`, key, heading: section.title, ...(key === 'emphasis' ? { aliases: ['typography-weight-guidance'] } : {}),
	})).reverse();
	const candidate = { version: 1, id: 'typography', renderer: 'typography', source, sources: [],
		content: { sampleText: authored.sampleText, baseline: authored.baseline, composition: authored.composition }, sections };
	writeFileSync(descriptor, JSON.stringify(candidate));
	writeFileSync(sourceFile, read(source).replace('## Weight and emphasis',
		'## Weight and emphasis\n\nAdditional **authored emphasis** with [owned typography](./typography.design.md).'));
	const panel = await createExplorer(root, { scope: { operation: 'replace', topics: ['typography'], active: 'typography' },
		adapter: { ...vscodeAdapter, sourcePath: (root, file, bookRoot) =>
			file === source ? sourceFile : file === pageFile ? descriptor : vscodeAdapter.sourcePath(root, file, bookRoot) } });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
		await page.goto(`${panel.url}#typography-weight-guidance`);
		const article = page.locator('[data-topic="typography"]');
		await expect(article.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
		assert.deepEqual(await article.locator('.topic-content h2').allTextContents(), sections.map(section => section.heading));
		await expect(article.locator('#typography-emphasis')).toBeFocused();
		await expect(article.locator('#typography-emphasis strong')).toHaveText('authored emphasis');
		await expect(article.getByRole('link', { name: 'owned typography', exact: true })).toHaveAttribute('href', /documentId=.*typography\.design\.md/);
		for (const width of [390, 1100]) {
			await page.setViewportSize({ width, height: 900 });
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		}
		writeFileSync(descriptor, JSON.stringify({ ...candidate, sections: [
			...sections, { id: 'unrendered', key: 'unrendered', heading: 'Introduction' },
		] }));
		await panel.refreshTopic('typography');
		await expect(article.locator('#problem')).toContainText('Expected one rendered chapter section: unrendered');
		await expect(article.locator('#typography-emphasis strong')).toHaveText('authored emphasis');
	} finally {
		await browser.close();
		await panel.close();
		rmSync(scratch, { recursive: true, force: true });
	}
});

test('Illustration uses the shared book frame, source sections, and keyboard outline', { timeout: 30000 }, async () => {
	const panel = await createExplorer(root, { scope: { operation: 'all', active: 'illustration' } });
	let browser;
	try {
		browser = await chromium.launch({ headless: true });
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.goto(panel.url);
		const article = page.locator('[data-topic="illustration"]');
		await expect(article.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
		await expect(article.locator('h1')).toHaveText('Illustration');
		await expect(article.locator('.reference-empty, .guide-doc')).toHaveCount(0);
		await expect(article.locator('.source-guidance > h2')).toHaveText(['Usage', 'Explain one idea', 'Visual style', 'Accessibility', 'Build and review']);
		const outline = article.getByRole('navigation', { name: 'On this page' });
		await outline.getByRole('link', { name: 'Visual style', exact: true }).focus();
		await page.keyboard.press('Enter');
		await expect(article.locator('#illustration-style')).toBeFocused();
		await expect(article.getByRole('link', { name: 'Motion', exact: true })).toHaveAttribute('href', /documentId=\.github%2Fskills%2Fdesign-system%2Ffoundations%2Fmotion\.design\.md/);
		for (const theme of ['Dark 2026', 'Light 2026', 'High Contrast Dark', 'High Contrast Light']) {
			panel.setView({ theme });
			for (const width of [390, 1440]) {
				await page.setViewportSize({ width, height: 900 });
				await expect(article.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
				assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${theme}, ${width}px`);
			}
		}
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		await panel.close();
	}
});

test('section navigation stays compact beneath the sticky page title at every width', { timeout: 30000 }, async () => {
	const panel = await createExplorer(root, { scope: { operation: 'all', active: 'typography' } });
	let browser;
	try {
		browser = await chromium.launch({ headless: true });
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		await page.goto(panel.url);
		const article = page.locator('[data-topic="typography"]');
		await expect(article.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
		const outline = article.getByRole('navigation', { name: 'On this page' });
		assert.equal(await article.evaluate(article =>
			Boolean(article.querySelector('.article-outline').compareDocumentPosition(article.querySelector('.topic-intro'))
				& Node.DOCUMENT_POSITION_FOLLOWING)), true);
		const geometry = () => article.evaluate(article => {
			const bounds = selector => article.querySelector(selector).getBoundingClientRect();
			const content = bounds('.topic-content');
			const outline = bounds('.article-outline');
			return {
				aligned: Math.abs(outline.left - content.left) < 1,
				oneRow: outline.height < 48 && outline.top >= bounds('.topic-heading').bottom,
				overflow: document.documentElement.scrollWidth > innerWidth,
			};
		});
		assert.deepEqual(await geometry(), { aligned: true, oneRow: true, overflow: false });
		const specimen = await article.locator('.typography-style-list').elementHandle();
		await outline.getByRole('link', { name: 'Emphasis', exact: true }).focus();
		await page.keyboard.press('Enter');
		await expect(article.locator('#typography-emphasis')).toBeFocused();
		await expect(outline.getByRole('link', { name: 'Emphasis', exact: true })).toHaveAttribute('aria-current', 'location');
		assert.equal(await outline.evaluate(element => element.getBoundingClientRect().top >= document.querySelector('.explorer-heading').getBoundingClientRect().bottom), true);
		await article.locator('#typography-styles').evaluate(element => element.scrollIntoView({ block: 'start' }));
		await expect(outline.getByRole('link', { name: 'Type roles', exact: true })).toHaveAttribute('aria-current', 'location');
		assert.equal(await specimen.evaluate(element => element.isConnected), true);
		for (const colorScheme of ['light', 'dark']) {
			await page.emulateMedia({ colorScheme });
			for (const width of [320, 800, 1199, 1200, 1440]) {
				await page.setViewportSize({ width, height: 900 });
				await page.evaluate(() => scrollTo(0, 0));
				const layout = await geometry();
				assert.deepEqual(layout, { aligned: true, oneRow: true, overflow: false }, `${colorScheme}, ${width}px`);
			}
		}
		panel.setScope({ operation: 'replace', topics: ['typography', 'layout'], active: 'typography', layout: 'compare' });
		await expect(page.locator('#reference')).toHaveClass('comparison-layout');
		assert.deepEqual(await geometry(), { aligned: true, oneRow: true, overflow: false });
		panel.setScope({ operation: 'replace', topics: ['typography'], layout: 'single' });
		await expect(page.locator('#book-navigation')).toBeHidden();
		assert.deepEqual(await geometry(), { aligned: true, oneRow: true, overflow: false });
	} finally {
		await browser?.close();
		await panel.close();
	}
});

test('compact topic context stays visible and recoverable errors do not displace readable content', { timeout: 30000 }, async () => {
	const panel = await createExplorer(root, { scope: { operation: 'all', active: 'typography' } });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
		await page.goto(panel.url);
		const article = page.locator('[data-topic="typography"]');
		const content = article.locator('.topic-content');
		await expect(content).toHaveAttribute('data-topic-state', 'ready');
		await expect(page.locator('.checkout-details')).not.toHaveJSProperty('tagName', 'DETAILS');
		await expect(page.locator('#checkout')).toBeHidden();
		await expect(page.locator('.checkout-details').getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
		for (const width of [390, 800, 1199]) {
			await page.setViewportSize({ width, height: 900 });
			await page.evaluate(() => scrollTo(0, 0));
			const link = article.getByRole('navigation', { name: 'On this page' }).getByRole('link', { name: 'Emphasis', exact: true });
			await link.focus();
			await page.keyboard.press('Enter');
			await expect(article.locator('#typography-emphasis')).toBeFocused();
			const geometry = await article.evaluate(article => {
				const context = article.querySelector('.topic-context').getBoundingClientRect();
				const section = article.querySelector('#typography-emphasis').getBoundingClientRect();
				return {
					contextVisible: context.top >= 0 && context.bottom < innerHeight,
					sectionVisible: section.top >= context.bottom && section.top < innerHeight,
					overflow: document.documentElement.scrollWidth > innerWidth,
				};
			});
			assert.deepEqual(geometry, { contextVisible: true, sectionVisible: true, overflow: false }, `${width}px`);
			await expect(article.locator('h1')).toBeVisible();
			await expect(article.locator('.topic-intro')).toBeVisible();
		}
		const original = await content.locator('.typography-style-list').elementHandle();
		await page.route('**/api/topic?*', route => route.fulfill({ status: 503, body: 'Source unavailable. Keep reading the last loaded topic.' }));
		await page.getByRole('button', { name: 'Refresh', exact: true }).click();
		const problem = article.locator('#problem');
		await expect(problem).toBeVisible();
		await expect(problem.locator('summary')).toContainText('showing last loaded content');
		assert.equal(await problem.evaluate(element => element.open), false);
		assert.ok(await problem.evaluate(element => element.getBoundingClientRect().height) < 70);
		await problem.locator('summary').focus();
		await page.keyboard.press('Enter');
		await expect(problem.locator('p')).toBeVisible();
		await expect(problem).toContainText('Source unavailable');
		assert.equal(await original.evaluate(element => element.isConnected), true);
		await page.unroute('**/api/topic?*');
		await page.getByRole('button', { name: 'Refresh', exact: true }).click();
		await expect(problem).toBeHidden();
		await expect(content).toHaveAttribute('data-topic-state', 'ready');
		await page.route('**/api/checkouts', route => route.fulfill({ status: 503, body: 'Checkout read failed' }));
		await page.getByRole('button', { name: 'Refresh', exact: true }).click();
		await expect(page.locator('#shell-problem > summary')).toBeVisible();
		assert.equal(await page.locator('#shell-problem').evaluate(element => element.open), false);
		await expect(content).toHaveAttribute('data-topic-state', 'ready');
	} finally { await browser.close(); await panel.close(); }
});

test('chapters keep a readable hierarchy and a stable left edge at every article width', { timeout: 60000 }, async () => {
	const panel = await createExplorer(root, { scope: { operation: 'all', active: 'typography' } });
	let browser;
	try {
		browser = await chromium.launch({ headless: true });
		const page = await browser.newPage();
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await mockFixtureRenderer(page, root, [...controls, ...motionControls].map(control => control.id));
		for (const { id } of catalog.filter(topic => !topic.hidden)) {
			panel.setScope({ operation: 'all', active: id });
			await page.goto(new URL('/', panel.url).href);
			const article = page.locator(`article[data-topic="${id}"]`);
			await expect(article.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
			assert.equal(await article.locator('.topic-actions').evaluate(footer =>
				footer.previousElementSibling.classList.contains('topic-content')), true, `${id}: references follow the chapter`);
			for (const colorScheme of ['light', 'dark']) {
				await page.emulateMedia({ colorScheme });
				for (const width of widths) {
					await page.setViewportSize({ width, height: 900 });
					const reading = await article.evaluate(article => {
						const bounds = article.getBoundingClientRect();
						const content = article.querySelector('.topic-content');
						const headings = [...content.querySelectorAll('h2')].filter(heading => !heading.closest('.control-stage, summary'));
						const title = article.querySelector('h1');
						const intro = article.querySelector('.topic-intro');
						const sections = [title.parentElement, intro, ...headings].filter(element => element.getClientRects().length);
						return {
							aligned: sections.every(element => Math.abs(element.getBoundingClientRect().left - bounds.left) < 1),
							hierarchy: headings.every(heading => Number.parseFloat(getComputedStyle(title).fontSize) > Number.parseFloat(getComputedStyle(heading).fontSize)
								&& Number.parseFloat(getComputedStyle(heading).fontSize) > Number.parseFloat(getComputedStyle(intro).fontSize)),
							readable: Number.parseFloat(getComputedStyle(intro).fontSize) >= 15,
							unclipped: content.scrollHeight <= content.clientHeight + 1,
							overflow: document.documentElement.scrollWidth > innerWidth,
						};
					});
					assert.deepEqual(reading, { aligned: true, hierarchy: true, readable: true, unclipped: true, overflow: false }, `${id}, ${colorScheme}, ${width}px`);
					for (const selector of ['.color-role-map', '.spacing-relationships', '.motion-doc-recipe-examples', '#motion-progress > .motion-doc-grid']) {
						assert.equal(await article.locator(selector).evaluateAll(groups => groups.every(group => {
							const children = [...group.children];
							return children.every((child, index) => !index || child.getBoundingClientRect().top >= children[index - 1].getBoundingClientRect().bottom);
						})), true, `${id}: linear reading order at ${width}px`);
					}
				}
			}
			if (id === 'typography') {
				assert.equal(await article.locator('.typography-style-row').evaluateAll(rows => rows.every(row =>
					row.firstElementChild.classList.contains('typography-style-meta'))), true);
				assert.equal(await article.evaluate(article => [
					['#typography-role-guidance', '#typography-styles .typography-style-list'],
					['#typography-weight-guidance', '#typography-emphasis .typography-emphasis'],
					['#typography-reading-guidance', '#typography-families'],
				].every(([source, target]) => Boolean(article.querySelector(source)
					.compareDocumentPosition(article.querySelector(target)) & Node.DOCUMENT_POSITION_FOLLOWING))), true);
			}
			const links = article.locator('.article-outline a');
			assert.equal(await links.evaluateAll(links => links.every((link, index) => {
				const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
				if (!target) { return false; }
				if (!index) { return true; }
				const previous = document.getElementById(decodeURIComponent(links[index - 1].hash.slice(1)));
				return Boolean(previous.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING);
			})), true, `${id}: section links follow reading order`);
			if (await links.count()) {
				const last = links.last();
				const anchor = new URL(await last.getAttribute('href'), page.url()).hash.slice(1);
				await last.focus();
				await page.keyboard.press('Enter');
				await expect(article.locator(`[id="${anchor}"]`)).toBeFocused();
			}
			if (id.startsWith('component-') && await article.locator('#component-usage').count()) {
				await expect(article.locator('.article-outline a')).toHaveText(['Usage', 'Preview', 'Accessibility', 'API']);
			}
		}
		panel.setScope({ operation: 'all', active: 'typography' });
		await page.goto(new URL('/', panel.url).href);
		await expect(page.locator('[data-topic="typography"] .topic-content')).toHaveAttribute('data-topic-state', 'ready');
		const jump = page.getByRole('navigation', { name: 'On this page' }).getByRole('link', { name: 'Hierarchy', exact: true });
		await jump.focus();
		await page.keyboard.press('Enter');
		await expect(page.locator('#typography-composition')).toBeFocused();
		await page.setViewportSize({ width: 1440, height: 900 });
		const topics = page.getByRole('navigation', { name: 'Topics', exact: true });
		await topics.getByRole('link', { name: 'Colors', exact: true }).focus();
		await page.keyboard.press('Enter');
		await expect(page.locator('[data-topic="colors"] .topic-content')).toHaveAttribute('data-topic-state', 'ready');
		await topics.getByRole('link', { name: 'Typography', exact: true }).focus();
		await page.keyboard.press('Enter');
		await expect(page.locator('[data-topic="typography"] h1')).toBeFocused();
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		await panel.close();
	}
});

test('accessibility renders composed decisions, keyboard outline links and source references', { timeout: 60000 }, async () => {
	const panel = await createExplorer(root, { scope: { operation: 'all', active: 'accessibility' } });
	let browser;
	try {
		browser = await chromium.launch({ headless: true });
		const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.goto(panel.url);
		const article = page.locator('[data-topic="accessibility"]');
		await expect(article.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
		assert.deepEqual(await article.locator('.topic-content h2').allTextContents(), [
			'Keyboard and focus', 'Names and states', 'Help and readable content',
			'Feedback and announcements', 'Visual alternatives', 'Build and review',
		]);
		await expect(article.getByRole('table')).toHaveCount(3);
		await expect(article.locator('#accessibility-help')).toContainText('a separate Accessible View is not needed');
		await expect(article.locator('#announcement-patterns')).toContainText('no duplicate speech');
		await expect(article.locator('#accessibility-review')).toContainText('With a screen reader');
		const outline = article.getByRole('navigation', { name: 'On this page', exact: true });
		const help = outline.getByRole('link', { name: 'Help and readable content', exact: true });
		await help.focus();
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/#accessibility-help$/);
		await page.reload();
		await expect(article.locator('#accessibility-help')).toBeInViewport();
		const workflow = article.getByRole('link', { name: 'implementation workflow', exact: true });
		await expect(workflow).toHaveAttribute('href', /documentId=.*accessibility.*SKILL.md/);
		for (const theme of ['Light 2026', 'Dark 2026', 'High Contrast Dark', 'High Contrast Light']) {
			panel.setView({ theme });
			for (const width of [390, 1100]) {
				await page.setViewportSize({ width, height: 900 });
				await expect(article.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
				assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${theme} at ${width}px`);
			}
		}
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		await panel.close();
	}
});

test('reader-facing articles share useful navigation and omit audit scaffolding', { timeout: 120000 }, async () => {
	const panel = await createExplorer(root, { scope: { topics: ['typography'] } });
	let browser;
	try {
		browser = await chromium.launch({ headless: true });
		const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await mockFixtureRenderer(page, root, ['button', 'icon-label', 'input', 'radio', ...motionControls.map(control => control.id)]);
		const checkedSources = new Set();
		const sequences = {
			typography: ['Hierarchy and reading rhythm', 'UI type roles', 'Weight and emphasis', 'Font families'],
			shape: ['Round by surface role', 'Corner scale'],
			size: ['Choose a glyph size', 'Size reference'],
			stroke: ['Use strokes to define boundaries', 'Stroke reference'],
			layout: ['Arrange the primary task', 'Adapt to available space'],
			elevation: ['Choose the surface relationship', 'Apply elevation to real tasks', 'What makes elevation',
				'Use the existing shadow scale', 'Compose a reusable surface', 'Keep surfaces accessible and responsive'],
			theming: ['Keep meaning in high contrast', 'Theme comparisons'],
			spacing: ['Make relationships visible', 'Give each interval one owner', 'Choose a spacing pattern', 'Spacing between controls', 'When space gets tight', 'Spacing ramp'],
		};
		for (const id of ['principles', 'illustration', 'typography', 'shape', 'size', 'stroke', 'layout', 'elevation', 'theming', 'accessibility', 'content', 'component-button', 'component-menu', 'motion', 'colors', 'spacing', 'tokens', 'iconography']) {
			panel.setScope({ operation: 'replace', topics: [id], active: id, layout: 'single' });
			await page.goto(panel.url);
			const article = page.locator(`article[data-topic="${panel.state.scope.active}"]`);
			await expect(article.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
			await expect(page).toHaveTitle(`${catalog.find(topic => topic.id === panel.state.scope.active).title} — Visual Studio Code Design System`);
			await expect(page.locator('.book-title')).toHaveText('VS Code Design System');
			await expect(article.locator('h1')).toHaveCount(1);
			await expect(article.locator('.scope, .system-gap, .slot-placeholder')).toHaveCount(0);
			await expect(article.locator('.topic-content')).not.toContainText(/Why this topic is reserved|Curation notes and audit gaps|Content slot:|To curate:|not a complete migration audit/);
			await expect(article.locator('.topic-content a.source-action')).toHaveCount(0);
			await expect(article.locator('.topic-heading a.source-action:visible')).toHaveCount(0);
			const headingEntries = await article.locator('.topic-content h2').evaluateAll(headings => headings
				.filter(heading => !heading.closest('.control-stage') || heading.closest('[data-topic]').dataset.topic.startsWith('component-'))
				.map(heading => ({ title: heading.textContent, sourceGuidance: Boolean(heading.closest('.source-guidance')) })));
			const majorHeadings = headingEntries.map(heading => heading.title);
			const data = panel.store.topics.get(panel.state.scope.active).envelope.data;
			const sequence = id === 'motion'
				? data.motionDocumentation.page.sections.map(section => section.title ?? data.motionDocumentation.sections[section.heading].title)
				: sequences[id];
			if (sequence) {
				assert.deepEqual(headingEntries.filter(heading => !heading.sourceGuidance && heading.title !== 'Reading metrics')
					.map(heading => heading.title), sequence, id);
			}
			for (const section of data.sourceSections ?? []) {
				await expect(article.locator(`#${section.sectionId} > h2`)).toHaveText(section.title);
				assert.equal(await article.evaluate((article, section) => {
					const guide = article.querySelector(`#${CSS.escape(section.sectionId)}`);
					let next = guide.nextElementSibling;
					while (next?.classList.contains('source-guidance')) { next = next.nextElementSibling; }
					return section.before ? next?.id === section.before : next === null;
				}, { sectionId: section.sectionId, before: section.before }), true, `${id}: ${section.sectionId} placement`);
			}
			if (id === 'shape') {
				assert.deepEqual(await article.locator('.radius-scale figure').evaluateAll(items => items.map(item => ({
					id: item.dataset.scaleToken, value: item.querySelector('.radius-example').style.borderRadius,
				}))), data.reference.scales.radii.map(token => ({ id: token.id, value: token.value })));
			}
			if (id === 'elevation') {
				await expect(article.locator('.topic-content')).not.toContainText(/Lessons from other systems|\bAtlassian\b|\bFluent (?:2|UI)\b/i);
				const sourceLink = await article.getByRole('link', { name: 'workbench styles' }).getAttribute('href');
				assert.equal(new URL(sourceLink, page.url()).searchParams.get('id'), data.authored.markdownSource);
				assert.equal((await page.request.get(new URL(sourceLink, page.url()).href)).status(), 200);
				const relocated = 'src/vs/platform/theme/common/elevation-guide.md';
				const relocatedLink = await page.evaluate(async ({ data, relocated }) => {
					const { renderElevation } = await import('/elevation.mjs');
					const target = document.createElement('div');
					renderElevation(target, { ...data, authored: { ...data.authored, markdownSource: relocated } }, { previewState: new Map() });
					return [...target.querySelectorAll('.elevation-guide a')].find(link => link.textContent === 'workbench styles').getAttribute('href');
				}, { data: { view: data.view, authored: data.authored, sizes: data.sizes, elevation: data.elevation }, relocated });
				assert.equal(new URL(relocatedLink, page.url()).searchParams.get('id'), relocated);
			}
			if (id === 'size') {
				assert.deepEqual(await article.locator('.glyph-context .codicon-glyph').evaluateAll(items => items.map(item => item.style.fontSize)),
					['codiconFontSize', 'codiconFontSize.compact'].map(id => data.sizes.find(token => token.id === id).value));
			}
			if (id === 'stroke') {
				const value = data.sizes.find(token => token.id === 'strokeThickness').value;
				assert.deepEqual(await article.locator('.stroke-divider, .stroke-control').evaluateAll(items => items.map(item => item.style.borderWidth)), [value, value]);
			}
			assert.ok(await article.getByRole('navigation', { name: 'On this page', exact: true }).count() <= 1, id);
			assert.equal(await article.getByRole('navigation', { name: 'On this page', exact: true }).count(), majorHeadings.length >= 2 ? 1 : 0, id);
			assert.equal(await article.locator('.topic-content a').evaluateAll(links => links.filter(link => !link.closest('.source-guidance, .motion-doc-analysis')).every(link => {
				if (['Open in Component Explorer', 'View Figma specification'].includes(link.textContent.trim())) { return true; }
				if (link.closest('.prose, .elevation-guide, .component-doc-section')) {
					const url = new URL(link.href);
					return url.protocol === 'https:' || url.origin === location.origin
						&& (url.pathname === '/api/document-resource'
							|| url.pathname === '/' && url.searchParams.get('section') === 'documentation' && Boolean(url.searchParams.get('documentId')));
				}
				if (!link.closest('.motion-doc')) { return false; }
				if (/^#motion-[a-z0-9-]+$/.test(link.getAttribute('href'))) { return Boolean(document.getElementById(link.hash.slice(1))); }
				const url = new URL(link.href);
				return url.origin === location.origin && url.searchParams.get('section') === 'tokens' && url.hash === '#tokens-motion';
			})), true, id);
			assert.equal(await article.locator('.article-outline a').evaluateAll(links => links.every(link =>
				document.getElementById(decodeURIComponent(link.hash.slice(1))))), true, id);
			for (const url of await article.locator('a.source-action').evaluateAll(links => links.map(link => link.href))) {
				if (checkedSources.has(url)) { continue; }
				checkedSources.add(url);
				assert.equal((await fetch(url)).status, 200, url);
			}
			if (id === 'typography') {
				await expect(article.getByRole('button', { name: /Copy --vscode-font/ })).toHaveCount(0);
				await expect(article.getByRole('heading', { name: 'Regular', exact: true })).toBeVisible();
				const specimen = await article.locator('.typography-style-list').elementHandle();
				await article.getByRole('navigation', { name: 'On this page' }).getByRole('link', { name: 'Emphasis', exact: true }).click();
				await expect(article.locator('#typography-emphasis')).toBeFocused();
				await expect.poll(() => panel.view.anchor).toBe('typography-emphasis');
				assert.equal(await specimen.evaluate(element => element.isConnected), true);
			}
			if (id === 'theming') {
				await expect(article.getByRole('button', { name: /^Use / })).toHaveCount(0);
				assert.deepEqual(await article.locator('.theme-comparison').evaluateAll(items => items.slice(0, 4).map(item => item.dataset.theme)),
					corePaletteThemes.map(theme => theme.id));
			}
			if (id === 'component-menu') {
				await expect(article.getByText('Documentation and examples are not available yet.', { exact: true })).toBeVisible();
				await expect(article.getByRole('link', { name: 'View Figma specification', exact: true })).toBeVisible();
			}
			if (id === 'component-button') {
				await expect(article.locator('.control-stage')).toHaveAttribute('data-preview-state', 'ready');
				const frame = await article.locator('iframe').elementHandle();
				await article.getByRole('navigation', { name: 'On this page' }).getByRole('link', { name: 'API', exact: true }).click();
				await expect(article.locator('#component-api')).toBeFocused();
				await expect.poll(() => panel.view.anchor).toBe('component-api');
				assert.equal(await frame.evaluate(element => element.isConnected), true);
			}
			if (id === 'tokens') {
				await article.locator('#tokens-spacing > summary').click();
				await expect(article.locator('.token-reference-row')).toHaveCount(14);
				await expect(article.locator('.token-list a')).toHaveCount(0);
			}
			if (id === 'motion') {
				assert.deepEqual(await article.locator('.motion-doc > section').evaluateAll(sections => sections.map(section => section.id)),
					data.motionDocumentation.page.sections.map(section => `motion-${section.id}`));
			}
			if (id === 'content') {
				const priorities = [/UI labels/i, /Strings/i, /Localization/i];
				const ranks = majorHeadings.map(title => priorities.findIndex(pattern => pattern.test(title)));
				assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), id);
			}
			if (id === 'iconography') {
				await article.getByRole('button', { name: 'Inspect add', exact: true }).click();
				await expect(article.locator('#selected-icon-detail')).toBeVisible();
				await expect(article.locator('.topic-content a')).toHaveCount(0);
			}
			for (const width of [390, 1440]) {
				await page.setViewportSize({ width, height: 900 });
				assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${id} at ${width}px`);
			}
		}
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		await panel.close();
	}
});

test('elevation studies preserve overlay separation, keyboard choices, and source tokens across themes', { timeout: 60000 }, async () => {
	const panel = await createExplorer(root, { scope: { operation: 'replace', topics: ['elevation'], active: 'elevation' } });
	let browser;
	try {
		browser = await chromium.launch({ headless: true });
		const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.goto(panel.url);
		const article = page.locator('[data-topic="elevation"]');
		await expect(article.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
		await expect(article.locator('.elevation-scenario')).toHaveCount(4);
		await expect(article.locator('.elevation-scenario figure, .elevation-study, .depth-illustration')).toHaveCount(0);
		await expect(article.locator('.elevation-construction-parts > li')).toHaveCount(3);
		await expect(article.locator('.elevation-construction figcaption')).toContainText('The numbered cues pair fill and text');
		await expect(article.locator('.elevation-hosting figcaption')).toContainText('The supported overlay host keeps content visible');
		const partShadows = article.getByRole('checkbox', { name: 'Turn off part shadows' });
		const samples = () => article.evaluate(article => {
			const style = selector => getComputedStyle(article.querySelector(selector));
			return {
				part: style('[data-scale-token="--vscode-shadow-sm"] .elevation-shadow-sample').boxShadow,
				overlay: style('.elevation-construction-surface').boxShadow,
				boundary: style('.elevation-construction-surface').borderTopColor,
				contained: style('.elevation-contained-group').boxShadow,
				reference: style('[data-scale-token="--vscode-shadow-lg"] .elevation-shadow-sample').boxShadow,
			};
		});
		const normal = await samples();
		await partShadows.focus();
		await page.keyboard.press('Space');
		const disabled = await samples();
		assert.deepEqual({
			partSuppressed: disabled.part !== normal.part,
			overlayPreserved: disabled.overlay === normal.overlay && disabled.overlay !== 'none',
			containedFlat: disabled.contained === 'none',
			sourceShadow: disabled.overlay === disabled.reference,
		}, { partSuppressed: true, overlayPreserved: true, containedFlat: true, sourceShadow: true });
		for (const { id, label } of corePaletteThemes) {
			const choice = article.getByRole('radio', { name: label, exact: true });
			await choice.focus();
			await page.keyboard.press('Space');
			await expect(choice).toBeChecked();
			await expect(choice).toBeFocused();
			const highContrast = id.startsWith('Default High Contrast');
			const values = await samples();
			assert.equal(values.overlay === 'none', highContrast);
			if (highContrast) { assert.notEqual(values.boundary, 'rgba(0, 0, 0, 0)'); }
			for (const width of [320, 500, 1000, 1440]) {
				await page.setViewportSize({ width, height: 900 });
				assert.equal(await article.evaluate(article => {
					const studies = article.querySelectorAll('.elevation-construction-stage, .elevation-shadow-stage, .elevation-hosting-stage');
					const samples = [...article.querySelectorAll('.elevation-shadow-sample')].map(sample => {
						const style = getComputedStyle(sample);
						return [style.width, style.height, style.backgroundColor, style.borderRadius].join();
					});
					return document.documentElement.scrollWidth <= innerWidth && [...studies].every(study =>
						study.scrollWidth <= study.clientWidth + 1 && study.scrollHeight <= study.clientHeight + 1)
						&& new Set(samples).size === 1;
				}), true, `${label}, ${width}px`);
				for (const hosted of [false, true]) {
					const stage = article.locator(`.elevation-hosting-stage[data-hosted="${hosted}"]`);
					await stage.scrollIntoViewIfNeeded();
					assert.deepEqual(await stage.evaluate(stage => {
						const overlay = stage.querySelector('.elevation-hosted-overlay');
						const bounds = overlay.getBoundingClientRect();
						const clip = stage.querySelector('.elevation-clipping-container').getBoundingClientRect();
						return {
							extendsPastContainer: bounds.bottom > clip.bottom,
							visibleOutsideContainer: overlay.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.bottom - 8)),
						};
					}), { extendsPastContainer: true, visibleOutsideContainer: hosted }, `${label}, ${width}px, hosted=${hosted}`);
				}
			}
		}
		await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
		const copy = article.locator('[data-scale-token="--vscode-shadow-lg"]').getByRole('button', { name: 'Copy --vscode-shadow-lg CSS variable --vscode-shadow-lg', exact: true });
		await copy.focus();
		await page.keyboard.press('Enter');
		assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'var(--vscode-shadow-lg)');
		await page.getByRole('button', { name: 'Refresh', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
		await expect(partShadows).toBeChecked();
		await expect(article.getByRole('radio', { name: 'High contrast light', exact: true })).toBeChecked();
		const outline = article.getByRole('navigation', { name: 'On this page', exact: true });
		await outline.getByRole('link', { name: 'Implementation', exact: true }).focus();
		await page.keyboard.press('Enter');
		await expect(article.locator('#elevation-role')).toBeFocused();
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		await panel.close();
	}
});

test('live stream reconnection rereads visible data and clears only its connection notice', { timeout: 30000 }, async () => {
	const panel = await createExplorer(root, { scope: { topics: ['typography'] } });
	let browser;
	try {
		browser = await chromium.launch({ headless: true });
		const page = await browser.newPage();
		let streams = 0;
		let reads = 0;
		await page.route('**/api/topic?*', async route => {
			if (++reads === 1) { await route.fulfill({ status: 503, body: 'Temporarily unavailable' }); }
			else { await route.continue(); }
		});
		await page.route('**/api/events', async route => {
			if (++streams === 1) {
				await route.fulfill({
					contentType: 'text/event-stream',
					body: `retry: 100\n\ndata: ${JSON.stringify({ kind: 'scope', state: panel.state })}\n\n`,
				});
			} else { await route.continue(); }
		});
		await page.goto(panel.url);
		await expect(page.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
		assert.ok(streams >= 2 && reads >= 2);
		await expect(page.getByText('Live updates disconnected; reconnecting automatically…', { exact: true })).not.toBeVisible();
		await expect(page.locator('#shell-problem')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toHaveCount(1);
	} finally {
		await browser?.close();
		await panel.close();
	}
});

test('Spacing keeps concise guidance, one token ramp, and an automatic product preview', { timeout: 60000 }, async () => {
	const panel = await createExplorer(root, { scope: { topics: ['spacing'] } });
	let browser;
	try {
		browser = await chromium.launch({ headless: true });
		const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
		const errors = [];
		const requests = [];
		page.on('pageerror', error => errors.push(error.message));
		page.on('request', request => requests.push(new URL(request.url()).pathname));
		await mockFixtureRenderer(page, root, ['button']);
		await page.goto(panel.url);
		await expect(page.locator('[data-topic="spacing"] .topic-content')).toHaveAttribute('data-topic-state', 'ready');
		await expect(page.locator('.spacing-guide h2')).toHaveText([
			'Make relationships visible', 'Give each interval one owner', 'Choose a spacing pattern',
			'Spacing between controls', 'When space gets tight', 'Spacing ramp',
		]);
		await expect(page.getByRole('slider')).toHaveCount(0);
		await expect(page.locator('.spacing-pattern')).toHaveCount(5);
		await expect(page.locator('.spacing-rationale')).toHaveCount(0);
		await expect(page.locator('.spacing-guide')).not.toContainText(/Why this works|real Button|universal component-spacing recipe/);
		await expect(page.locator('[data-topic="spacing"] .topic-content details, .spacing-sample, .spacing-grouping-scene')).toHaveCount(0);
		await expect(page.locator('[data-topic="spacing"] .topic-content a.source-action')).toHaveCount(0);
		const navigation = page.getByRole('navigation', { name: 'On this page' });
		await navigation.getByRole('link', { name: 'Spacing tokens', exact: true }).focus();
		await page.keyboard.press('Enter');
		await expect(page.locator('#layout-spacing')).toBeFocused();
		const tokens = panel.store.topics.get('spacing').envelope.data.reference.scales.spacing;
		assert.deepEqual(await page.locator('.spacing-token-table tbody tr').evaluateAll(rows => rows.map(row => ({
			id: row.dataset.scaleToken, css: row.querySelector('button code').textContent,
			value: row.cells[1].textContent, width: row.querySelector('.spacing-bar').getBoundingClientRect().width,
		}))), tokens.map(token => ({ id: token.id, css: token.css, value: token.value, width: Number.parseFloat(token.value) })));
		await expect(page.locator('#spacing-example')).toHaveAttribute('data-preview-state', 'ready');
		await expect(page.getByRole('button', { name: /^Load / })).toHaveCount(0);
		assert.equal(requests.includes('/api/fixtures'), true);
		await expect(page.locator('.spacing-guide details, .spacing-guide .source-action')).toHaveCount(0);
		const frame = await page.locator('.component-preview').elementHandle();
		await page.getByRole('radio', { name: 'Light', exact: true }).focus();
		await page.keyboard.press('ArrowRight');
		await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
		await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toBeFocused();
		assert.equal(await frame.evaluate(element => element.isConnected), true);
		await expect(page.locator('#spacing-example')).toHaveAttribute('data-preview-state', 'ready');
		await (await frame.contentFrame()).evaluate(() => {
			parent.postMessage({
				type: 'component-explorer:resize', fixtureId: new URL(location.href).searchParams.get('fixture'),
				width: 280, height: 180,
			}, '*');
		});
		await expect.poll(() => frame.evaluate(element => {
			const { width, height } = element.getBoundingClientRect();
			return { width, height };
		})).toEqual({ width: 280, height: 180 });
		await page.keyboard.press('Tab');
		await expect(page.getByRole('link', { name: 'Open in Component Explorer', exact: true })).toBeFocused();
		const copy = page.getByRole('button', { name: 'Copy spacing.size160 CSS variable --vscode-spacing-size160', exact: true });
		await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
		await copy.focus();
		await page.keyboard.press('Enter');
		await expect(page.locator('[data-topic="spacing"] #status')).toHaveText('Copied var(--vscode-spacing-size160)');
		await expect(copy.locator('.copy-feedback')).toHaveText('Copied');
		assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'var(--vscode-spacing-size160)');
		for (const colorScheme of ['light', 'dark']) {
			await page.emulateMedia({ colorScheme });
			for (const width of widths) {
				await page.setViewportSize({ width, height: 900 });
				assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${colorScheme} ${width}px`);
				assert.equal(await page.locator('#spacing-example .reference-viewer').evaluate(viewer => {
					const bounds = viewer.getBoundingClientRect();
					return [...viewer.querySelectorAll('iframe, label, a')].every(element => {
						const rect = element.getBoundingClientRect();
						return rect.left >= bounds.left && rect.right <= bounds.right;
					});
				}), true, `Preview and controls remain inside the viewer at ${width}px`);
			}
		}
		await page.emulateMedia({ forcedColors: 'active' });
		await copy.focus();
		assert.equal(await copy.evaluate(element => getComputedStyle(element).outlineStyle), 'solid');
		assert.notEqual(await page.locator('.spacing-bar').last().evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
		await page.getByRole('button', { name: 'Refresh', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
		await expect(page.locator('.spacing-token-table tbody tr')).toHaveCount(tokens.length);
		await expect(page.locator('#spacing-example')).toHaveAttribute('data-preview-state', 'ready');
		await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		await panel.close();
	}
});

test('component articles keep behavior and APIs without authoring commentary', { timeout: 60000 }, async () => {
	const panel = await createExplorer(root, { scope: { topics: ['component-radio'] } });
	let browser;
	try {
		browser = await chromium.launch({ headless: true });
		const page = await browser.newPage();
		await mockFixtureRenderer(page, root, ['radio', 'label', 'spinner', 'progress']);
		for (const id of ['radio', 'label', 'spinner', 'progress']) {
			panel.setScope({ operation: 'replace', topics: [`component-${id}`] });
			await page.goto(panel.url);
			const article = page.locator(`[data-topic="${panel.state.scope.active}"]`);
			await expect(article.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
			await expect(article.locator('.control-stage')).toHaveAttribute('data-preview-state', 'ready');
			await expect(article.locator('.component-doc-section h2')).toHaveText(['Usage', 'Accessibility', 'API']);
			assert.ok(await article.locator('.component-api-table tbody tr').count() > 0);
			await expect(article).not.toContainText(/not React props|new React|newly invented|This documents|primitive tag|proposed motion standard|existing fixture/);
			await article.locator('.contributor-resources > summary').click();
			await expect(article.locator('.contributor-resources a').first()).toBeVisible();
			await expect(article.locator('.contributor-resources a').first()).not.toHaveAttribute('aria-description', /deployed product/);
		}
	} finally {
		await browser?.close();
		await panel.close();
	}
});

test('one Refresh reloads data and fixtures, preserving visible variants and recovering failures', { timeout: 60000 }, async () => {
	const panel = await createExplorer(root, { scope: { topics: ['component-button'] } });
	let browser;
	try {
		browser = await chromium.launch({ headless: true });
		const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		let discoveries = 0;
		let unavailable = false;
		await page.route('**/api/fixtures*', route => {
			discoveries++;
			return route.fulfill(unavailable ? { status: 503, body: 'Renderer unavailable' } : {
				json: {
					checkoutPath: root, session: 'test', sourceTreeId: `tree-${discoveries}`,
					explorerUrl: 'http://127.0.0.1:43111/___explorer',
					controls: ['button', ...motionControls.map(control => control.id)].map(mockFixtureControl),
				},
			});
		});
		await page.route('http://127.0.0.1:43111/___explorer?*', route => route.fulfill({
			contentType: 'text/html',
			body: `<!doctype html><button>Interactive example</button><script>
				addEventListener('message', event => {
					if (event.data.type === 'component-explorer:embedded-init') {
						parent.postMessage({ type: 'component-explorer:ready', fixtureId: new URL(location.href).searchParams.get('fixture') }, '*');
					}
				});
				parent.postMessage({ type: 'component-explorer:embedded-loaded' }, '*');
			</script>`,
		}));
		await page.goto(panel.url);
		const preview = page.locator('.control-stage');
		await expect(preview).toHaveAttribute('data-preview-state', 'ready');
		await expect(page.locator('.topic-content select')).toHaveCount(0);
		await expect(page.getByRole('button', { name: /Refresh|Reload|Reconnect|Select default/ })).toHaveCount(1);
		await expect(page.getByRole('group', { name: 'Variant', exact: true })).toBeVisible();
		const frame = await page.locator('.component-preview').elementHandle();
		await page.getByRole('radio', { name: 'Light', exact: true }).focus();
		await page.keyboard.press('ArrowRight');
		await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
		await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toBeFocused();
		await expect.poll(() => panel.view.fixtureId).toBe('button/Dark');
		assert.equal(await frame.evaluate(element => element === document.querySelector('.component-preview')), true);
		const store = panel.store;
		await page.getByRole('button', { name: 'Refresh', exact: true }).click();
		await expect.poll(() => discoveries).toBe(2);
		await expect(preview).toHaveAttribute('data-preview-state', 'ready');
		await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
		assert.notEqual(panel.store, store);
		assert.ok(panel.store.metrics.reads['src/vs/base/browser/ui/button/button.ts'] > 0);
		assert.equal(await frame.evaluate(element => element.isConnected), false);
		for (const width of widths) {
			await page.setViewportSize({ width, height: 900 });
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		}
		await page.route('**/api/content-version', route => route.fulfill({ status: 503, body: 'Source temporarily unavailable' }));
		await page.getByRole('button', { name: 'Refresh', exact: true }).click();
		await expect(page.locator('#shell-problem')).toContainText('Source temporarily unavailable');
		await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
		await page.unroute('**/api/content-version');
		await page.getByRole('button', { name: 'Refresh', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
		await expect(page.locator('#shell-problem')).toHaveCount(0);
		await expect(preview).toHaveAttribute('data-preview-state', 'ready');
		unavailable = true;
		await page.getByRole('button', { name: 'Refresh', exact: true }).click();
		await expect(page.locator('.preview-status')).toContainText('Use Refresh to retry');
		await expect(page.getByRole('button', { name: /Refresh|Reload|Reconnect|Select default/ })).toHaveCount(1);
		unavailable = false;
		await page.getByRole('button', { name: 'Refresh', exact: true }).click();
		await expect(preview).toHaveAttribute('data-preview-state', 'ready');
		await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
		panel.setView({ fixtureId: 'removed-variant' });
		await expect(page.locator('.preview-status')).toContainText('Choose an available variant');
		await page.getByRole('radio', { name: 'Light', exact: true }).check();
		await expect(preview).toHaveAttribute('data-preview-state', 'ready');
		await expect.poll(() => panel.view.fixtureId).toBe('button/Light');

		panel.setScope({ operation: 'replace', topics: ['motion'] });
		await expect(page.locator('[data-topic="motion"] .topic-content')).toHaveAttribute('data-topic-state', 'ready');
		const motionCount = await page.locator('[data-motion-example]').count();
		const allMotionReady = async () => {
			await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
			for (const summary of await page.locator('.motion-doc-reference:not([open]) > summary').all()) {
				await summary.click();
			}
			for (const example of await page.locator('[data-motion-example]').all()) {
				await example.evaluate(element => element.scrollIntoView());
				await expect(example.locator('.control-stage')).toHaveAttribute('data-preview-state', 'ready');
			}
		};
		await allMotionReady();
		const reducedCount = await page.getByRole('checkbox', { name: 'Reduced motion', exact: true }).count();
		await page.locator('[data-motion-example="delayed-content"]').getByRole('radio', { name: 'Fast', exact: true }).check();
		const beforeMotion = discoveries;
		await page.getByRole('button', { name: 'Refresh', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
		await allMotionReady();
		await expect(page.locator('[data-motion-example="delayed-content"]').getByRole('radio', { name: 'Fast', exact: true })).toBeChecked();
		await expect.poll(() => discoveries).toBe(beforeMotion + motionCount);
		await page.locator('[data-motion-example="selection"]').getByRole('checkbox', { name: 'Reduced motion', exact: true }).check();
		await page.getByRole('button', { name: 'Refresh', exact: true }).click();
		await allMotionReady();
		await expect.poll(() => discoveries).toBe(beforeMotion + 2 * motionCount);
		await expect(page.locator('[data-motion-example="selection"]').getByRole('checkbox', { name: 'Reduced motion', exact: true })).toBeChecked();
		await expect(page.getByRole('button', { name: /^Load / })).toHaveCount(0);
		await expect(page.getByRole('checkbox', { name: 'Reduced motion', exact: true })).toHaveCount(reducedCount);
		await expect(page.getByRole('group', { name: 'Shape', exact: true })).toHaveCount(0);
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		await panel.close();
	}
});

test('the full book browses a curated component inventory without an overview page or composite previews', { timeout: 60000 }, async () => {
	const visibleComponents = catalog.filter(item => item.section === 'components' && !item.hidden);
	const availableIds = new Set(visibleComponents.map(item => item.controlId));
	const undocumented = controls.filter(control => availableIds.has(control.id) && control.content === 'tbd');
	const initial = undocumented.find(control => control.id !== 'menu');
	assert.ok(initial, 'The availability scenario needs a visible undocumented component');
	const initialId = `component-${initial.id}`;
	const panel = await createExplorer(root, { scope: { operation: 'all', active: initialId } });
	let browser;
	try {
		browser = await chromium.launch({ headless: true });
		const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
		const errors = [];
		const requests = [];
		page.on('pageerror', error => errors.push(error.message));
		page.on('request', request => requests.push(new URL(request.url()).pathname));
		await mockFixtureRenderer(page, root, ['button']);
		await page.goto(panel.url);
		await expect(page.locator(`[data-topic="${initialId}"] .topic-content`)).toHaveAttribute('data-topic-state', 'ready');
		const browse = page.getByRole('button', { name: 'Browse topics', exact: true });
		await browse.focus();
		await page.keyboard.press('Enter');
		const components = page.locator('.book-panel nav > .book-group').filter({ has: page.getByText('Components', { exact: true }) });
		for (const subgroup of await components.locator('details').all()) {
			if (!await subgroup.evaluate(element => element.open)) { await subgroup.locator(':scope > summary').click(); }
		}
		assert.deepEqual(
			(await components.getByRole('link').evaluateAll(links => links.map(link => link.firstElementChild.textContent))).sort((a, b) => a.localeCompare(b, 'en')),
			catalog.filter(item => item.group === 'Components' && !item.hidden).map(item => item.title).sort((a, b) => a.localeCompare(b, 'en')));
		await expect(components.locator('h3')).toHaveCount(0);
		await expect(page.locator('.card, iframe, [data-topic="components"]')).toHaveCount(0);
		assert.equal(requests.includes('/api/fixtures'), false);
		for (const width of widths) {
			await page.setViewportSize({ width, height: 900 });
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		}
		await page.setViewportSize({ width: 390, height: 900 });
		await browse.click();
		await page.getByRole('searchbox', { name: 'Search topics', exact: true }).fill('Menu');
		await page.getByRole('link', { name: /^Menu/ }).focus();
		await page.keyboard.press('Enter');
		await expect(page.locator('[data-topic="component-menu"] .topic-content')).toHaveAttribute('data-topic-state', 'ready');
		await expect(page.getByRole('heading', { name: 'Menu', exact: true })).toBeVisible();
		await expect(page.locator('.topic-pane:visible').getByText('Documentation and examples are not available yet.', { exact: true })).toBeVisible();
		await expect(page.locator('.topic-pane:visible .topic-content h2')).toHaveCount(0);
		await expect(page.getByRole('navigation', { name: 'On this page' })).toHaveCount(0);
		await page.goBack();
		await expect(page.locator(`[data-topic="${initialId}"] .topic-content`)).toHaveAttribute('data-topic-state', 'ready');
		assert.equal(requests.includes('/api/fixtures'), false);
		for (const control of undocumented) {
			await page.goto(new URL(`/?section=components&controlId=${control.id}`, panel.url).href);
			await expect(page.locator(`article[data-topic="component-${control.id}"] .topic-content`)).toHaveAttribute('data-topic-state', 'ready');
			await expect(page.getByRole('heading', { name: control.name, exact: true })).toBeVisible();
			await expect(page.locator('.topic-pane:visible').getByText('Documentation and examples are not available yet.', { exact: true })).toBeVisible();
			await expect(page.locator('iframe, .component-api-table, .preview-status')).toHaveCount(0);
			await expect(page.getByRole('link', { name: 'All components', exact: true })).toHaveCount(0);
			if (control.nodeId) {
				await expect(page.getByRole('link', { name: 'View Figma specification', exact: true })).toHaveAttribute('href', new RegExp(control.nodeId.replace(':', '-')));
			}
			await expect(page.getByText('Why this topic is reserved', { exact: true })).toHaveCount(0);
			await expect(page.locator('.topic-content details')).toHaveCount(0);
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, control.id);
		}
		assert.equal(requests.includes('/api/fixtures'), false);
		await page.goto(new URL('/?section=components', panel.url).href);
		await expect(page.locator('[data-topic="component-button"] .topic-content')).toHaveAttribute('data-topic-state', 'ready');
		await expect(browse).toBeVisible();
		await expect(page.locator('[data-topic="components"], .card')).toHaveCount(0);
		assert.equal(panel.state.scope.mode, 'all');
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		await panel.close();
	}
});

test('iconography loads real font faces before committing glyphs and reports font failures', { timeout: 30000 }, async () => {
	const panel = await createExplorer(root, { scope: { topics: ['iconography'] } });
	let browser;
	try {
		browser = await chromium.launch({ headless: true });
		const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
		await page.route('**/api/topic?*', async route => {
			const response = await route.fetch();
			const envelope = await response.json();
			envelope.data.icons.find(icon => icon.id === 'trophy').fontAvailable = false;
			await route.fulfill({ response, json: envelope });
		});
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.goto(panel.url);
		await expect(page.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
		assert.equal(await page.evaluate(() => [...document.fonts].some(face => face.family === 'canvas-codicon' && face.status === 'loaded')), true);
		const tile = page.getByRole('button', { name: 'Inspect add', exact: true });
		assert.deepEqual(await tile.locator('.codicon-glyph').evaluate(element => ({
			code: element.textContent.codePointAt(0), family: getComputedStyle(element).fontFamily,
		})), { code: 0xea60, family: 'canvas-codicon' });
		await tile.click();
		await expect(page.locator('#selected-icon-detail')).toContainText('U+EA60');
		await page.getByRole('searchbox', { name: 'Filter icons', exact: true }).fill('arrow-right');
		await expect(page.getByRole('button', { name: 'Inspect arrow-right', exact: true })).toBeVisible();
		await page.getByRole('searchbox', { name: 'Filter icons', exact: true }).fill('trophy');
		const unavailable = page.getByRole('button', { name: 'Inspect trophy', exact: true });
		await expect(unavailable).toContainText('Not installed');
		await unavailable.click();
		await expect(page.locator('#selected-icon-detail')).toContainText('missing from its installed Codicon font');
		await expect(unavailable.locator('.codicon-glyph')).toHaveCount(0);
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		assert.deepEqual(errors, []);

		const failed = await browser.newPage();
		await failed.route('**/codicon.ttf', route => route.fulfill({ status: 404, body: 'Missing font' }));
		await failed.goto(panel.url);
		await expect(failed.locator('.topic-content')).toHaveAttribute('data-topic-state', 'error');
		await expect(failed.getByRole('alert')).toContainText('Couldn\'t load this topic');
		await expect(failed.locator('.codicon-glyph')).toHaveCount(0);
	} finally {
		await browser?.close();
		await panel.close();
	}
});

test('article-first presentation and reusable book contents', { timeout: 120000 }, async t => {
	const panel = await createExplorer(root, { scope: { topics: ['motion'] } });
	let browser;
	try {
		browser = await chromium.launch({ headless: true });
		const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
		await mockFixtureRenderer(page, root, ['button', ...motionControls.map(control => control.id)]);
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		page.on('response', response => { if (response.status() >= 400) { errors.push(`${response.status()} ${response.url()}`); } });
		const ready = id => expect(page.locator(`[data-topic="${id}"] .topic-content`)).toHaveAttribute('data-topic-state', 'ready');
		const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Overflow at ${page.viewportSize().width}px`);
		await page.goto(panel.url);
		await ready('motion');

		await t.test('focused motion has no navigation and retains working, reduced-motion-safe examples', async () => {
			await expect(page.locator('#book-navigation nav, #scope-controls, #topic, .breadcrumbs, .page-jumps')).toHaveCount(0);
			await expect(page.getByRole('navigation', { name: 'On this page', exact: true })).toBeVisible();
			await expect(page.getByRole('heading', { name: 'Motion', exact: true })).toBeVisible();
			await expect(page.locator('#checkout')).toHaveText('Reading: This session');
			await expect(page.locator('#checkout')).toHaveAttribute('title', root);
			assert.deepEqual(Object.keys(panel.store.metrics.parses).sort(), ['guidance', 'icons', 'motion', 'motionAppearance', 'sizes', 'sourceDocuments', 'themes', 'typography']);
			assert.equal(Object.keys(panel.store.metrics.reads).includes('extensions/theme-abyss/themes/abyss-color-theme.json'), false);
			for (const width of widths) {
				await page.setViewportSize({ width, height: 900 });
				await noOverflow();
			}
			const reducedExample = page.locator('[data-motion-example="selection"]');
			await reducedExample.evaluate(element => element.scrollIntoView());
			await expect(reducedExample.locator('.control-stage')).toHaveAttribute('data-preview-state', 'ready');
			await reducedExample.getByRole('checkbox', { name: 'Reduced motion', exact: true }).check();
			await expect(reducedExample.getByRole('checkbox', { name: 'Reduced motion', exact: true })).toHaveCount(1);
			await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
			await expect(page.getByRole('checkbox', { name: 'Preview reduced motion' })).toHaveCount(0);
			await expect(reducedExample.getByRole('checkbox', { name: 'Reduced motion', exact: true })).toBeChecked();
			assert.equal(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length), 0);
			await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
		});

		await t.test('adding topics renders ordered articles, preserves DOM, and subscribes every visible article', async () => {
			panel.setScope({ operation: 'replace', topics: ['typography'], layout: 'single' });
			await ready('typography');
			const first = await page.locator('[data-topic="typography"]').elementHandle();
			panel.setScope({ operation: 'add', topics: ['spacing'] });
			await ready('spacing');
			await expect(page.locator('.topic-pane:visible')).toHaveCount(2);
			assert.deepEqual(await page.locator('.topic-pane:visible').evaluateAll(elements => elements.map(element => element.dataset.topic)), ['typography', 'spacing']);
			assert.equal(await first.evaluate(element => element === document.querySelector('[data-topic="typography"]')), true);
			assert.deepEqual([...panel.store.subscribed], ['typography', 'spacing']);
			await expect(page.getByRole('navigation', { name: 'Topics' })).toHaveCount(0);
			await expect(page.getByRole('navigation', { name: 'On this page' })).toHaveCount(2);
			panel.setScope({ operation: 'replace', topics: ['spacing', 'typography'], active: 'spacing', layout: 'compare' });
			await expect(page.locator('#reference')).toHaveClass('comparison-layout');
			await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toHaveCount(1);
			await page.getByRole('button', { name: 'Refresh', exact: true }).click();
			await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
			await ready('spacing');
			await ready('typography');
			await expect(page.locator('#shell-problem')).toHaveCount(0);
			await expect(page.getByRole('slider')).toHaveCount(0);
			await expect(page.locator('.spacing-token-table tbody tr')).toHaveCount(14);
			for (const width of widths) {
				await page.setViewportSize({ width, height: 900 });
				const boxes = await page.locator('.topic-pane:visible').evaluateAll(elements => elements.map(element => ({ x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y })));
				assert.equal(boxes[0].x === boxes[1].x, width < 1100);
				if (width < 1100) { assert.ok(boxes[1].y > boxes[0].y); }
				await noOverflow();
			}
			assert.deepEqual(await page.locator('.topic-pane:visible').evaluateAll(elements => elements.map(element => element.dataset.topic)), ['spacing', 'typography']);
		});

		await t.test('full book has a searchable sidebar and a compact mobile drawer without moving the article', async () => {
			const reads = { ...panel.store.metrics.reads };
			await page.setViewportSize({ width: 1100, height: 900 });
			panel.setScope({ operation: 'all', active: 'typography', layout: 'single' });
			const browse = page.getByRole('button', { name: 'Browse topics', exact: true });
			const navigation = page.getByRole('navigation', { name: 'Topics', exact: true });
			const filter = page.getByRole('searchbox', { name: 'Search topics', exact: true });
			await expect(navigation).toBeVisible();
			await expect(browse).not.toBeVisible();
			await expect(page.locator('#book-navigation nav a')).toHaveCount(catalog.filter(item => !item.hidden && item.id !== 'documentation').length);
			await expect(page.locator('#book-pagination, .book-neighbor')).toHaveCount(0);
			await expect(page.locator('.book-panel-heading strong')).toHaveCount(0);
			assert.deepEqual(panel.store.metrics.reads, reads);
			await navigation.getByRole('link', { name: 'Colors', exact: true }).click();
			await ready('colors');
			await navigation.getByRole('link', { name: 'Typography', exact: true }).click();
			await ready('typography');
			await expect(page.locator('[data-topic="typography"] h1')).toBeFocused();
			await expect(page.locator('#book-navigation select, #scope-controls, .breadcrumbs, .page-jumps')).toHaveCount(0);
			for (const width of widths) {
				await page.setViewportSize({ width, height: 900 });
				if (width >= 960) {
					await expect(navigation).toBeVisible();
					await expect(browse).not.toBeVisible();
					const boxes = await page.evaluate(() => ({
						nav: document.querySelector('.book-panel').getBoundingClientRect().right,
						article: document.querySelector('#reference').getBoundingClientRect().left,
					}));
					assert.ok(boxes.nav < boxes.article);
				} else {
					await expect(browse).toBeVisible();
					await expect(navigation).not.toBeVisible();
					const top = await page.locator('#reference').evaluate(element => element.getBoundingClientRect().top);
					await browse.focus();
					await page.keyboard.press('Enter');
					await expect(filter).toBeFocused();
					await expect(navigation).toBeVisible();
					assert.equal(await page.locator('#reference').evaluate(element => element.getBoundingClientRect().top), top);
					await page.keyboard.press('Escape');
					await expect(browse).toBeFocused();
					await expect(navigation).not.toBeVisible();
				}
				await noOverflow();
			}
			const beforeFiltering = { ...panel.store.metrics.reads };
			await filter.fill('does-not-exist');
			await expect(page.getByText('No matching topics', { exact: true })).toBeVisible();
			await expect(navigation.locator('a:visible')).toHaveCount(0);
			await filter.fill('button');
			await expect(navigation.getByRole('link', { name: /^Button/ })).toBeVisible();
			assert.deepEqual(panel.store.metrics.reads, beforeFiltering);
			await filter.fill('');
			await expect(page.getByText('No matching topics', { exact: true })).not.toBeVisible();
			await page.setViewportSize({ width: 390, height: 900 });
			await browse.click();
			await filter.fill('Spacing');
			await page.keyboard.press('ArrowDown');
			await expect(navigation.getByRole('link', { name: 'Spacing', exact: true })).toBeFocused();
			await page.keyboard.press('Escape');
			await expect(browse).toBeFocused();
			await expect(navigation).not.toBeVisible();
			await browse.click();
			const spacing = navigation.getByRole('link', { name: 'Spacing', exact: true });
			const link = await spacing.elementHandle();
			await spacing.focus();
			await page.keyboard.press('Enter');
			await ready('spacing');
			await expect(page.locator('.book-panel a[aria-current="page"]')).toHaveText('Spacing');
			await expect(page.locator('.book-current')).toHaveCount(0);
			await expect(page.locator('.site-navigation').getByRole('button', { name: 'Browse topics', exact: true })).toBeVisible();
			await expect(navigation).not.toBeVisible();
			assert.equal(await page.evaluate(() => document.activeElement.closest('.topic-pane')?.dataset.topic), 'spacing');
			assert.equal(await link.evaluate(element => element === [...document.querySelectorAll('nav a')].find(item => item.textContent === 'Spacing')), true);
			assert.deepEqual([...panel.store.subscribed], ['spacing']);
			await expect(page.locator('#book-navigation .book-topics')).toHaveCount(1);
			assert.equal((await (await fetch(new URL('/api/metrics', panel.url))).json()).fixtureRequests, 0);
			await browse.click();
			await expect(filter).toHaveValue('');
			await navigation.getByRole('link', { name: 'Design tokens', exact: true }).click();
			await ready('tokens');
			assert.equal(panel.state.scope.mode, 'all');
			await expect(browse).toBeVisible();
			const search = page.getByRole('searchbox', { name: 'Search tokens' });
			await search.fill('spacing.size160');
			await expect(search).toBeFocused();
			await expect(page.locator('[data-topic="tokens"] #status')).toContainText('matching entries');
			await page.getByRole('button', { name: 'Refresh', exact: true }).click();
			await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
			await expect(search).toHaveValue('spacing.size160');
			await ready('tokens');
			await expect(page.locator('.book-panel a[aria-current="page"]')).toHaveText('Design tokens');
			await noOverflow();
			await page.emulateMedia({ forcedColors: 'active' });
			await browse.focus();
			await page.keyboard.press('Tab');
			await page.keyboard.press('Shift+Tab');
			assert.equal(await browse.evaluate(element => getComputedStyle(element).outlineStyle), 'solid');
			await page.emulateMedia({ forcedColors: 'none' });
		});

		await t.test('book-to-focused transition removes navigation without stranding keyboard focus', async () => {
			await page.getByRole('button', { name: 'Browse topics', exact: true }).focus();
			panel.setScope({ operation: 'replace', topics: ['motion'], active: 'motion', layout: 'single' });
			await ready('motion');
			await expect(page.locator('#book-navigation nav, .book-panel, .book-toolbar')).toHaveCount(0);
			assert.equal(await page.evaluate(() => document.activeElement.closest('.topic-pane')?.dataset.topic), 'motion');
			for (const width of widths) {
				await page.setViewportSize({ width, height: 900 });
				await noOverflow();
			}
		});

		await t.test('the contents template accepts unrelated groups and labels without topic knowledge', async () => {
			await page.setViewportSize({ width: 320, height: 900 });
			const result = await page.evaluate(async () => {
				const { createBookNavigation } = await import('/book-navigation.mjs');
				const container = document.createElement('div');
				document.body.append(container);
				try {
					const selected = [];
					const contents = createBookNavigation(container, id => selected.push(id));
					const items = [
						{ id: 'one', title: 'A very long ordinary article title about an unrelated subject', group: 'A different collection', href: '#one' },
						{ id: 'two', title: 'Another article', group: 'Another collection', href: '#two' },
					];
					const tools = [{ id: 'library', title: 'Browse sources', href: '#library' }];
					contents.update(items, 'one', tools);
					const link = container.querySelector('a');
					const filter = container.querySelector('input');
					filter.value = 'article';
					filter.dispatchEvent(new Event('input'));
					contents.update(items.map(item => ({ ...item, href: `${item.href}-updated` })), 'two', tools);
					const preserved = container.querySelector('a') === link && container.querySelector('input') === filter && filter.value === 'article';
					const updatedHref = link.getAttribute('href');
					const fits = document.documentElement.scrollWidth <= innerWidth;
					link.dispatchEvent(new MouseEvent('click', { button: 0, ctrlKey: true, cancelable: true }));
					const modifiedIgnored = selected.length === 0;
					const ordinary = new MouseEvent('click', { button: 0, cancelable: true });
					link.dispatchEvent(ordinary);
					const labels = [...container.querySelectorAll('.book-group > summary')].map(element => element.textContent);
					const current = container.querySelector('[aria-current="page"]').textContent;
					const closed = !container.querySelector('.book-panel').matches(':popover-open');
					contents.update(items, 'library', tools);
					const utility = container.querySelector('.book-utilities a');
					filter.value = 'no-topic-match';
					filter.dispatchEvent(new Event('input'));
					const utilityIndependent = utility.getAttribute('aria-current') === 'page'
						&& !container.querySelector('.book-topics').contains(utility)
						&& !utility.hidden && !utility.parentElement.hidden;
					utility.click();
					contents.update(items, 'one');
					const optionalTools = container.querySelector('.book-utilities').hidden;
					contents.update([], 'library', tools);
					const toolsOnly = !container.hidden && container.querySelector('.book-topics').hidden
						&& container.querySelector('[aria-current="page"]').textContent === 'Browse sources';
					contents.update([], 'one');
					contents.dispose();
					return { preserved, updatedHref, fits, modifiedIgnored, selected, labels, current, closed, utilityIndependent, optionalTools, toolsOnly, prevented: ordinary.defaultPrevented, empty: !container.children.length };
				} finally { container.remove(); }
			});
			assert.deepEqual(result, {
				preserved: true, updatedHref: '#one-updated', fits: true, modifiedIgnored: true, selected: ['one', 'library'],
				labels: ['A different collection', 'Another collection'], current: 'Another article',
				closed: true, utilityIndependent: true, optionalTools: true, toolsOnly: true, prevented: true, empty: true,
			});
		});
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		await panel.close();
	}
});
