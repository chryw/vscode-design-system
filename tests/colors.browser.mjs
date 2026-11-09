/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

import assert from 'node:assert/strict';
import { workspaceRoot } from '../runtime/paths.mjs';
import test from 'node:test';
import { chromium, expect } from './playwright.mjs';
import { createExplorer } from '../runtime/server.mjs';
import { mockFixtureRenderer } from './browser-helpers.mjs';

const root = workspaceRoot;

test('Colors keeps guidance visible and compares usage colors in one simple table', { timeout: 60000 }, async () => {
	const panel = await createExplorer(root, { scope: { topics: ['colors'] } });
	let browser;
	try {
		browser = await chromium.launch({ headless: true });
		const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
		const errors = [];
		const requests = [];
		page.on('pageerror', error => errors.push(error.message));
		page.on('request', request => requests.push(new URL(request.url()).pathname));
		await mockFixtureRenderer(page, root, ['icon-label', 'button', 'input', 'radio']);
		await page.goto(panel.url);
		await expect(page.locator('[data-topic="colors"] .topic-content')).toHaveAttribute('data-topic-state', 'ready');
		await expect(page.locator('.control-stage[data-preview-state="ready"]')).toHaveCount(4);
		await expect(page.getByRole('button', { name: /^Load / })).toHaveCount(0);
		await expect(page.locator('.color-guide h2')).toHaveText([
			'Choose color by purpose', 'Let neutrals establish hierarchy', 'Reserve accent for the leading action',
			'Use semantic color only when it has meaning', 'Keep selection separate from focus', 'Color reference',
		]);
		await expect(page.getByRole('heading', { name: 'Why this pattern', exact: true })).toHaveCount(0);
		await expect(page.locator('.color-rationale')).toHaveCount(0);
		await expect(page.locator('.color-guide')).not.toContainText(/Real (IconLabel|Buttons|InputBox|Radio)|reproducing those styles by hand/);
		await expect(page.locator('.color-guide details, .color-scene')).toHaveCount(0);
		await expect(page.getByText('Definition coverage', { exact: true })).toHaveCount(0);
		await expect(page.getByText('Sources and design judgment', { exact: true })).toHaveCount(0);
		await expect(page.getByRole('combobox', { name: 'Token family' })).toHaveCount(0);
		await expect(page.locator('.color-matrix thead th')).toHaveText(['Token', 'Light', 'Dark', 'High contrast dark', 'High contrast light']);
		const data = panel.store.topics.get('colors').envelope.data;
		const foundations = data.colorCatalog.filter(token => token.definitionSource.file.endsWith('/semanticColors.ts'));
		assert.equal(foundations.length, 23);
		assert.deepEqual(await page.locator('.color-matrix tbody tr').evaluateAll(rows => rows.map(row => ({
			id: row.dataset.color, values: [...row.querySelectorAll('.color-value-chip code')].map(code => code.textContent),
		}))), foundations.map(token => ({ id: token.id, values: data.colorPalettes.map(palette => token.values[palette.id].value) })));
		for (const link of await page.getByRole('navigation', { name: 'On this page' }).getByRole('link').all()) {
			assert.equal(await page.locator(await link.getAttribute('href')).count(), 1);
		}
		const article = await page.locator('.color-guide').elementHandle();
		const table = await page.locator('.color-matrix').elementHandle();
		const search = page.getByRole('searchbox', { name: 'Search colors' });
		const reads = requests.filter(path => path === '/api/topic').length;
		await search.fill('button.background');
		await expect(page.locator('.color-matrix tbody tr')).toHaveCount(0);
		await page.getByRole('checkbox', { name: 'Include component aliases' }).check();
		await expect(page.locator('.color-matrix tbody tr').first()).toHaveAttribute('data-color', 'button.background');
		await search.fill('var(--vscode-color-background-accent)');
		await expect(search).toBeFocused();
		await expect(page.locator('.color-matrix tbody tr')).toHaveCount(1);
		const copy = page.getByRole('button', { name: 'Copy color.background.accent CSS variable --vscode-color-background-accent', exact: true });
		await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
		await copy.focus();
		await page.keyboard.press('Enter');
		await expect(page.locator('[data-topic="colors"] #status')).toHaveText('Copied var(--vscode-color-background-accent)');
		await expect(copy.locator('.copy-feedback')).toHaveText('Copied');
		assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'var(--vscode-color-background-accent)');
		assert.equal(await article.evaluate(element => element.isConnected), true);
		assert.equal(await table.evaluate(element => element.isConnected), true);
		assert.equal(requests.filter(path => path === '/api/topic').length, reads);
		await page.getByRole('navigation', { name: 'On this page' }).getByRole('link', { name: 'Semantic feedback' }).click();
		await expect(page.locator('#colors-feedback')).toBeFocused();
		assert.equal(await article.evaluate(element => element.isConnected), true);
		assert.equal(requests.filter(path => path === '/api/topic').length, reads);
		for (const colorScheme of ['light', 'dark']) {
			await page.emulateMedia({ colorScheme });
			for (const width of [320, 390, 500, 800, 1440]) {
				await page.setViewportSize({ width, height: 900 });
				assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${colorScheme} ${width}px`);
			}
		}
		await page.emulateMedia({ forcedColors: 'active' });
		await search.focus();
		assert.equal(await search.evaluate(element => getComputedStyle(element).outlineStyle), 'solid');
		await page.emulateMedia({ forcedColors: 'none' });
		await page.getByRole('button', { name: 'Refresh', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
		await expect(page.getByRole('searchbox', { name: 'Search colors' })).toHaveValue('var(--vscode-color-background-accent)');
		await expect(page.getByRole('checkbox', { name: 'Include component aliases' })).toBeChecked();
		await expect(page.locator('.color-matrix tbody tr')).toHaveCount(1);
		await page.getByRole('navigation', { name: 'On this page' }).getByRole('link', { name: 'Semantic feedback' }).click();
		await expect(page.locator('#colors-feedback')).toBeFocused();
		assert.equal(requests.includes('/api/fixtures'), true);
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		await panel.close();
	}
});
