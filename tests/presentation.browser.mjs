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

const root = workspaceRoot;
const widths = [320, 390, 500, 800, 1440];

test('docs-style navigation separates chapters, reading, and a sticky section outline', { timeout: 30000 }, async () => {
	const panel = await createExplorer(root, { scope: { operation: 'all', active: 'typography' } });
	let browser;
	try {
		browser = await chromium.launch({ headless: true });
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		await page.goto(panel.url);
		const article = page.locator('[data-topic="typography"]');
		await expect(article.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
		const outline = article.getByRole('navigation', { name: 'On this page' });
		const geometry = () => article.evaluate(article => {
			const bounds = selector => article.querySelector(selector).getBoundingClientRect();
			const content = bounds('.topic-content');
			const outline = bounds('.article-outline');
			return {
				rail: outline.left > content.right,
				aligned: Math.abs(outline.top - bounds('.topic-heading').top) < 1,
				overflow: document.documentElement.scrollWidth > innerWidth,
			};
		});
		assert.deepEqual(await geometry(), { rail: true, aligned: true, overflow: false });
		const specimen = await article.locator('.typography-style-list').elementHandle();
		await outline.getByRole('link', { name: 'Emphasis', exact: true }).focus();
		await page.keyboard.press('Enter');
		await expect(article.locator('#typography-emphasis')).toBeFocused();
		await expect(outline.getByRole('link', { name: 'Emphasis', exact: true })).toHaveAttribute('aria-current', 'location');
		assert.equal(await outline.evaluate(element => Math.round(element.getBoundingClientRect().top)), 24);
		await article.locator('#typography-styles').evaluate(element => element.scrollIntoView({ block: 'start' }));
		await expect(outline.getByRole('link', { name: 'Type roles', exact: true })).toHaveAttribute('aria-current', 'location');
		assert.equal(await specimen.evaluate(element => element.isConnected), true);
		for (const colorScheme of ['light', 'dark']) {
			await page.emulateMedia({ colorScheme });
			for (const width of [320, 800, 1199, 1200, 1440]) {
				await page.setViewportSize({ width, height: 900 });
				await page.evaluate(() => scrollTo(0, 0));
				const layout = await geometry();
				assert.deepEqual(layout, { rail: width >= 1200, aligned: width >= 1200, overflow: false }, `${colorScheme}, ${width}px`);
			}
		}
		panel.setScope({ operation: 'replace', topics: ['typography', 'layout'], active: 'typography', layout: 'compare' });
		await expect(page.locator('#reference')).toHaveClass('comparison-layout');
		assert.deepEqual(await geometry(), { rail: false, aligned: false, overflow: false });
		panel.setScope({ operation: 'replace', topics: ['typography'], layout: 'single' });
		await expect(page.locator('#book-navigation')).toBeHidden();
		assert.deepEqual(await geometry(), { rail: false, aligned: false, overflow: false });
	} finally {
		await browser?.close();
		await panel.close();
	}
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
						const sections = [title, intro, ...headings].filter(element => element.getClientRects().length);
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
				assert.equal(await article.locator('.source-guidance').first().evaluate(section =>
					section.previousElementSibling.id === 'typography-families'), true);
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
		await page.getByRole('link', { name: 'Next: Colors', exact: true }).focus();
		await page.keyboard.press('Enter');
		await expect(page.locator('[data-topic="colors"] .topic-content')).toHaveAttribute('data-topic-state', 'ready');
		await page.getByRole('link', { name: 'Previous: Typography', exact: true }).focus();
		await page.keyboard.press('Enter');
		await expect(page.locator('[data-topic="typography"] h1')).toBeFocused();
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
			typography: ['Hierarchy and reading rhythm', 'Weight and emphasis', 'UI type roles', 'Font families'],
			shape: ['Round by surface role', 'Corner scale'],
			size: ['Choose a glyph size', 'Size reference'],
			stroke: ['Use strokes to define boundaries', 'Stroke reference'],
			layout: ['Arrange the primary task', 'Adapt to available space'],
			elevation: ['Surface hierarchy', 'High contrast', 'Shadow scale'],
			theming: ['Keep meaning in high contrast', 'Theme comparisons'],
			spacing: ['Make relationships visible', 'Give each interval one owner', 'Choose a spacing pattern', 'Spacing between controls', 'When space gets tight', 'Spacing ramp'],
		};
		for (const id of ['principles', 'typography', 'shape', 'size', 'stroke', 'layout', 'elevation', 'theming', 'accessibility', 'content', 'component-button', 'component-menu', 'motion', 'colors', 'spacing', 'tokens', 'iconography']) {
			panel.setScope({ operation: 'replace', topics: [id], active: id, layout: 'single' });
			await page.goto(panel.url);
			const article = page.locator(`article[data-topic="${panel.state.scope.active}"]`);
			await expect(article.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
			await expect(page).toHaveTitle(`${catalog.find(topic => topic.id === panel.state.scope.active).title} — Visual Studio Code Design System`);
			await expect(page.locator('.book-title')).toHaveText('Visual Studio Code Design System');
			await expect(article.locator('h1')).toHaveCount(1);
			await expect(article.locator('.scope, .system-gap, .slot-placeholder')).toHaveCount(0);
			await expect(article.locator('.topic-content')).not.toContainText(/Why this topic is reserved|Curation notes and audit gaps|Content slot:|To curate:|not a complete migration audit/);
			assert.equal(await article.locator('.topic-content a.source-action').evaluateAll(links => links.filter(link => !link.closest('.source-guidance, .motion-doc-analysis')).length), 0);
			assert.ok(await article.locator('.topic-heading a.source-action').count() <= 1, id);
			const majorHeadings = await article.locator('.topic-content h2').evaluateAll(headings => headings
				.filter(heading => !heading.closest('.control-stage') || heading.closest('[data-topic]').dataset.topic.startsWith('component-'))
				.map(heading => heading.textContent));
			const data = panel.store.topics.get(panel.state.scope.active).envelope.data;
			const sequence = id === 'motion'
				? data.motionDocumentation.page.sections.map(section => section.title ?? data.motionDocumentation.sections[section.heading].title)
				: sequences[id];
			if (sequence) {
				assert.deepEqual(majorHeadings.filter(title => title !== 'Reading metrics'),
					[...sequence, ...(data.sourceSections ?? []).map(section => section.title)], id);
			}
			if (id === 'shape') {
				assert.deepEqual(await article.locator('.radius-scale figure').evaluateAll(items => items.map(item => ({
					id: item.dataset.scaleToken, value: item.querySelector('.radius-example').style.borderRadius,
				}))), data.reference.scales.radii.map(token => ({ id: token.id, value: token.value })));
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
			if (id === 'accessibility' || id === 'content') {
				const priorities = id === 'accessibility'
					? [/Keyboard Navigation/i, /ARIA Labels/i, /Announcement Patterns/i, /Multi-Modal/i, /Keybinding Scoping/i]
					: [/UI labels/i, /Strings/i, /Localization/i];
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
		assert.equal(await page.locator('[data-topic="spacing"] a.source-action').evaluateAll(links => links.filter(link => !link.closest('.source-guidance')).length), 0);
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
			await expect(article.getByRole('link', { name: /^View source:/ })).not.toHaveAttribute('aria-description', /deployed product/);
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
		await expect(page.locator('select')).toHaveCount(0);
		await expect(page.getByRole('button', { name: /Refresh|Reload|Reconnect|Select default/ })).toHaveCount(1);
		await expect(page.getByRole('group', { name: 'Variant', exact: true })).toBeVisible();
		const frame = await page.locator('.component-preview').elementHandle();
		await page.getByRole('radio', { name: 'Light', exact: true }).focus();
		await page.keyboard.press('ArrowRight');
		await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
		await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toBeFocused();
		await expect.poll(() => panel.view.fixtureId).toBe('button/Dark');
		assert.equal(await frame.evaluate(element => element === document.querySelector('.component-preview')), true);
		const reads = panel.store.metrics.reads['src/vs/base/browser/ui/button/button.ts'];
		await page.getByRole('button', { name: 'Refresh', exact: true }).click();
		await expect.poll(() => discoveries).toBe(2);
		await expect(preview).toHaveAttribute('data-preview-state', 'ready');
		await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
		assert.ok(panel.store.metrics.reads['src/vs/base/browser/ui/button/button.ts'] > reads);
		assert.equal(await frame.evaluate(element => element.isConnected), false);
		for (const width of widths) {
			await page.setViewportSize({ width, height: 900 });
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		}
		await page.route('**/api/refresh', route => route.fulfill({ status: 503, body: 'Source temporarily unavailable' }));
		await page.getByRole('button', { name: 'Refresh', exact: true }).click();
		await expect(page.locator('#shell-problem')).toContainText('Source temporarily unavailable');
		await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
		await page.unroute('**/api/refresh');
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
		await page.locator('[data-motion-example="agent-activity"]').getByRole('radio', { name: 'Ring', exact: true }).check();
		const beforeMotion = discoveries;
		await page.getByRole('button', { name: 'Refresh', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
		await allMotionReady();
		await expect(page.locator('[data-motion-example="agent-activity"]').getByRole('radio', { name: 'Ring', exact: true })).toBeChecked();
		await expect.poll(() => discoveries).toBe(beforeMotion + motionCount);
		await page.locator('[data-motion-example="selection"]').getByRole('checkbox', { name: 'Reduced motion', exact: true }).check();
		await page.getByRole('button', { name: 'Refresh', exact: true }).click();
		await allMotionReady();
		await expect.poll(() => discoveries).toBe(beforeMotion + 2 * motionCount);
		await expect(page.locator('[data-motion-example="selection"]').getByRole('checkbox', { name: 'Reduced motion', exact: true })).toBeChecked();
		await expect(page.getByRole('button', { name: /^Load / })).toHaveCount(0);
		await expect(page.getByRole('checkbox', { name: 'Reduced motion', exact: true })).toHaveCount(motionCount - 1);
		await expect(page.getByRole('group', { name: 'Shape', exact: true })).toHaveCount(1);
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		await panel.close();
	}
});

test('the full book browses a flat component inventory without an overview page or composite previews', { timeout: 60000 }, async () => {
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
		assert.deepEqual(await components.getByRole('link').allTextContents(), visibleComponents.map(item => item.title));
		await expect(components.locator('h3, ul ul')).toHaveCount(0);
		await expect(page.locator('.card, iframe, [data-topic="components"]')).toHaveCount(0);
		assert.equal(requests.includes('/api/fixtures'), false);
		for (const width of widths) {
			await page.setViewportSize({ width, height: 900 });
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		}
		await page.setViewportSize({ width: 390, height: 900 });
		await browse.click();
		await page.getByRole('searchbox', { name: 'Find a topic', exact: true }).fill('Menu');
		await page.getByRole('link', { name: 'Menu', exact: true }).focus();
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
		await expect(failed.getByRole('alert')).toContainText('Couldn\'t refresh this topic');
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
			await expect(page.locator('#checkout')).toContainText('Local worktree');
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
			await page.setViewportSize({ width: 800, height: 900 });
			panel.setScope({ operation: 'all', active: 'typography', layout: 'single' });
			const browse = page.getByRole('button', { name: 'Browse topics', exact: true });
			const navigation = page.getByRole('navigation', { name: 'Topics', exact: true });
			const filter = page.getByRole('searchbox', { name: 'Find a topic', exact: true });
			await expect(navigation).toBeVisible();
			await expect(browse).not.toBeVisible();
			await expect(page.locator('#book-navigation nav a')).toHaveCount(catalog.filter(item => !item.hidden).length);
			assert.equal(await page.locator('#book-pagination').evaluate(element =>
				element.getBoundingClientRect().top >= document.querySelector('#reference').getBoundingClientRect().bottom), true);
			await expect(page.locator('#book-navigation .book-neighbor')).toHaveCount(0);
			assert.deepEqual(panel.store.metrics.reads, reads);
			await page.getByRole('link', { name: 'Next: Colors', exact: true }).click();
			await ready('colors');
			await page.getByRole('link', { name: 'Previous: Typography', exact: true }).click();
			await ready('typography');
			await expect(page.locator('[data-topic="typography"] h1')).toBeFocused();
			await expect(page.locator('#book-navigation select, #scope-controls, .breadcrumbs, .page-jumps')).toHaveCount(0);
			for (const width of widths) {
				await page.setViewportSize({ width, height: 900 });
				if (width >= 760) {
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
			await expect(navigation.getByRole('link', { name: 'Button', exact: true })).toBeVisible();
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
			await expect(page.locator('.book-current')).toHaveText('Spacing');
			await expect(navigation).not.toBeVisible();
			assert.equal(await page.evaluate(() => document.activeElement.closest('.topic-pane')?.dataset.topic), 'spacing');
			assert.equal(await link.evaluate(element => element === [...document.querySelectorAll('nav a')].find(item => item.textContent === 'Spacing')), true);
			assert.deepEqual([...panel.store.subscribed], ['spacing']);
			await expect(page.locator('#book-navigation nav')).toHaveCount(1);
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
					contents.update(items, 'one');
					const link = container.querySelector('a');
					const filter = container.querySelector('input');
					filter.value = 'article';
					filter.dispatchEvent(new Event('input'));
					contents.update(items.map(item => ({ ...item, href: `${item.href}-updated` })), 'two');
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
					contents.update([], 'one');
					contents.dispose();
					return { preserved, updatedHref, fits, modifiedIgnored, selected, labels, current, closed, prevented: ordinary.defaultPrevented, empty: !container.children.length };
				} finally { container.remove(); }
			});
			assert.deepEqual(result, {
				preserved: true, updatedHref: '#one-updated', fits: true, modifiedIgnored: true, selected: ['one'],
				labels: ['A different collection', 'Another collection'], current: 'Another article',
				closed: true, prevented: true, empty: true,
			});
		});
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		await panel.close();
	}
});
