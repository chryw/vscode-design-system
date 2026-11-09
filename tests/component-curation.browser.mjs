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
