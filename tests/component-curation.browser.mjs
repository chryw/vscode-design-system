/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import assert from 'node:assert/strict';
import { workspaceRoot } from '../runtime/paths.mjs';
import test from 'node:test';
import { controls } from './repository-helpers.mjs';
import { chromium, expect } from './playwright.mjs';
import { createExplorer } from '../runtime/server.mjs';
import { mockFixtureRenderer } from './browser-helpers.mjs';

const root = workspaceRoot;

test('the full canvas browses canonical component families and preserves grouped and archived URLs', { timeout: 60000 }, async () => {
	const panel = await createExplorer(root, { scope: { operation: 'all', active: 'component-pill' } });
	let browser;
	try {
		browser = await chromium.launch({ headless: true });
		const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await mockFixtureRenderer(page, root, ['button', 'label']);
		await page.goto(panel.url);
		await expect(page.locator('[data-topic="component-pill"] .topic-content')).toHaveAttribute('data-topic-state', 'ready');
		const navigation = page.getByRole('navigation', { name: 'Topics', exact: true });
		const names = await navigation.locator('a[href]').evaluateAll(links => links
			.filter(link => new URL(link.href).searchParams.get('section') === 'components').map(link => link.textContent));
		assert.deepEqual(names, controls.filter(control => !control.hidden).map(control => control.name));
		const button = navigation.getByRole('link', { name: 'Button', exact: true });
		if (!await button.isVisible()) { await navigation.getByText('Components', { exact: true }).click(); }
		await button.focus();
		await page.keyboard.press('Enter');
		await expect(page.locator('[data-topic="component-button"] .topic-content')).toHaveAttribute('data-topic-state', 'ready');
		await expect(page.locator('[data-topic="component-button"] .component-api-table')).toContainText('ButtonBar.addButton');
		await expect(page.locator('[data-topic="component-button"] .control-stage')).toHaveAttribute('data-preview-state', 'ready');
		await page.goto(new URL('/?section=components&controlId=icon-label&mode=all', panel.url).href);
		await expect(page.locator('[data-topic="component-label"] .topic-content')).toHaveAttribute('data-topic-state', 'ready');
		await expect(page.locator('[data-topic="component-label"] .component-api-table')).toContainText('IconLabel.setLabel');
		assert.equal(panel.state.scope.active, 'component-label');
		await page.goto(new URL('/?section=components&controlId=chat-attachment&mode=all', panel.url).href);
		await expect(page.getByRole('heading', { name: 'Resource pill', exact: true })).toBeVisible();
		await expect(page.locator('[data-topic="component-pill"] iframe, [data-topic="component-pill"] .component-api-table')).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'View Figma specification', exact: true })).toHaveAttribute('href', /node-id=20676-43729$/);
		await page.goto(new URL('/?section=components&controlId=notebook&mode=all', panel.url).href);
		await expect(page.getByRole('heading', { name: 'Notebook', exact: true })).toBeVisible();
		await expect(navigation.getByRole('link', { name: 'Notebook', exact: true })).toHaveCount(0);
		assert.equal(panel.state.scope.mode, 'all');
		for (const width of [390, 1280]) {
			await page.setViewportSize({ width, height: 900 });
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		}
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		await panel.close();
	}
});

test('component articles render source Markdown and derived APIs while retaining older-book support', { timeout: 60000 }, async () => {
	const panel = await createExplorer(root, { scope: { operation: 'all', active: 'component-button' } });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await mockFixtureRenderer(page, root, ['button', 'checkbox']);
		await page.goto(panel.url);
		const article = page.locator('[data-topic="component-button"]');
		await expect(article.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
		await expect(article.locator('#component-usage code').getByText('onDidClick', { exact: true })).toBeVisible();
		const example = article.getByRole('link', { name: 'Button and ButtonBar fixtures', exact: true });
		const sourceUrl = new URL(await example.getAttribute('href'), panel.url);
		assert.equal(sourceUrl.searchParams.get('id'), 'src/vs/base/browser/ui/button/button.design.md');
		const source = await page.request.get(sourceUrl.href);
		assert.equal(source.status(), 200);
		assert.match(await source.text(), /function renderButtons/);
		assert.deepEqual(await article.locator('.component-api-table thead th').allTextContents(), ['Member', 'Type', 'Declaration']);
		const label = article.locator('.component-api-table tbody tr').filter({
			has: page.getByRole('rowheader', { name: 'label', exact: true }),
		});
		await expect(label).toContainText('set label(value: string | IMarkdownString);');
		const declarations = article.getByRole('region', { name: 'Button API declarations', exact: true });
		await declarations.focus();
		await expect(declarations).toBeFocused();
		await page.setViewportSize({ width: 390, height: 900 });
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		panel.setScope({ operation: 'replace', topics: ['component-checkbox'], active: 'component-checkbox' });
		const checkbox = page.locator('[data-topic="component-checkbox"]');
		await expect(checkbox.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
		assert.deepEqual(await checkbox.locator('.component-api-table thead th').allTextContents(),
			['Member', 'Type', controls.find(control => control.id === 'checkbox').design ? 'Declaration' : 'Purpose']);
		assert.deepEqual(errors, []);
	} finally { await browser.close(); await panel.close(); }
});
