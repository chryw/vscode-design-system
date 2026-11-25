/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import assert from 'node:assert/strict';
import { workspaceRoot } from '../runtime/paths.mjs';
import test from 'node:test';
import { catalog, controls } from './repository-helpers.mjs';
import { chromium, expect } from './playwright.mjs';
import { createExplorer } from '../runtime/server.mjs';
import { mockFixtureRenderer } from './browser-helpers.mjs';

const root = workspaceRoot;

test('shared-source component articles retain APIs and explain live-example prerequisites without errors', { timeout: 30000 }, async () => {
	const panel = await createExplorer(root, {
		scope: { topics: ['component-button'] },
		contentVersion: { root, selection: { kind: 'shared', branch: 'design/docs' }, label: 'Shared branch' },
	});
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		const failures = [];
		page.on('pageerror', error => failures.push(error.message));
		page.on('response', response => { if (response.status() >= 400) { failures.push(`${response.status()} ${response.url()}`); } });
		await page.goto(panel.url);
		const article = page.locator('[data-topic="component-button"]');
		await expect(article.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
		await expect(article.locator('.component-api-table')).toContainText('onDidClick');
		await expect(article.locator('.control-stage')).toHaveAttribute('data-preview-state', 'source-only');
		await expect(article.locator('.preview-status')).toContainText('Select a prepared local checkout');
		await expect(article.locator('.preview-status')).toHaveAttribute('role', 'status');
		await expect(article.locator('.reference-viewer')).toBeHidden();
		await expect(article.locator('iframe')).toBeHidden();
		assert.deepEqual(failures, []);
	} finally {
		await browser.close();
		await panel.close();
	}
});

test('the full canvas browses specification-owned components, resolves aliases, and reports removed families', { timeout: 60000 }, async () => {
	const panel = await createExplorer(root, { scope: { operation: 'all', active: 'component-button' } });
	let browser;
	try {
		browser = await chromium.launch({ headless: true });
		const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await mockFixtureRenderer(page, root, ['button', 'button-bar', 'label']);
		await page.goto(panel.url);
		await expect(page.locator('[data-topic="component-button"] .topic-content')).toHaveAttribute('data-topic-state', 'ready');
		const navigation = page.getByRole('navigation', { name: 'Topics', exact: true });
		const names = await navigation.locator('a[href]').evaluateAll(links => links
			.filter(link => new URL(link.href).searchParams.get('section') === 'components')
			.map(link => link.firstElementChild.textContent));
		assert.deepEqual([...names].sort((a, b) => a.localeCompare(b, 'en')),
			controls.filter(control => !control.hidden).map(control => control.name).sort((a, b) => a.localeCompare(b, 'en')));
		const group = navigation.locator(':scope > details').filter({ has: page.getByText('Components', { exact: true }) });
		const componentNames = await group.locator('a[href]').evaluateAll(links => links.map(link => link.firstElementChild.textContent));
		assert.deepEqual([...componentNames].sort((a, b) => a.localeCompare(b, 'en')),
			controls.filter(control => !control.hidden).map(control => control.name).sort((a, b) => a.localeCompare(b, 'en')));
		await expect(group.locator('details')).toHaveCount(0);
		await expect(group.locator(':scope > ul > li > a')).toHaveCount(componentNames.length);
		await group.getByRole('link', { name: /^Menu/ }).focus();
		await page.keyboard.press('Tab');
		await expect(group.getByRole('link', { name: /^Multi-select/ })).toBeFocused();
		const patterns = navigation.locator(':scope > details').filter({ has: page.getByText('Patterns', { exact: true }) });
		await patterns.locator('summary').click();
		assert.deepEqual(await patterns.locator('a[href]').evaluateAll(links => links.map(link => link.firstElementChild.textContent)),
			catalog.filter(topic => topic.group === 'Patterns' && !topic.hidden).map(topic => topic.title));
		await patterns.getByRole('link', { name: /^Modal(?: Draft)?$/ }).focus();
		await page.keyboard.press('Enter');
		await expect(page.locator('[data-topic="modal"] .topic-content')).toHaveAttribute('data-topic-state', 'ready');
		await expect(page.locator('[data-topic="modal"] h1')).toBeFocused();
		await page.goto(new URL('/?section=modal&anchor=modal-composition&mode=all', panel.url).href);
		await expect(page.locator('[data-topic="modal"] #modal-composition')).toBeVisible();
		await expect(page.locator('[data-topic="modal"] #modal-scenarios')).toContainText('Remote environments');
		const components = navigation.locator(':scope > details').filter({ has: page.getByText('Components', { exact: true }) });
		if (!await components.evaluate(element => element.open)) { await components.locator(':scope > summary').click(); }
		const search = page.getByRole('searchbox', { name: 'Search topics' });
		await search.fill('draft');
		assert.deepEqual((await navigation.locator('li:not([hidden]) > a[href]').evaluateAll(links => links
			.filter(link => link.checkVisibility()).map(link => link.firstElementChild.textContent))).sort(),
		catalog.filter(topic => topic.isDraft && !topic.hidden && topic.navigation !== 'utility').map(topic => topic.title).sort());
		await search.fill('Components');
		assert.deepEqual((await navigation.locator('li:not([hidden]) > a[href]').evaluateAll(links => links
			.filter(link => link.checkVisibility()).map(link => new URL(link.href).searchParams.get('controlId')))).sort(),
		controls.filter(control => !control.hidden).map(control => control.id).sort());
		await search.fill('');
		const button = navigation.getByRole('link', { name: /^Button(?: Draft)?$/ });
		await button.focus();
		await page.keyboard.press('Enter');
		await expect(page.locator('[data-topic="component-button"] .topic-content')).toHaveAttribute('data-topic-state', 'ready');
		await expect(page.locator('[data-topic="component-button"] .topic-status')).toHaveText('Draft guidance');
		await expect(page.locator('[data-topic="component-button"] .component-api-table')).toContainText('onDidClick');
		await expect(page.locator('[data-topic="component-button"] .component-api-table')).not.toContainText('ButtonBar.');
		await expect(page.locator('[data-topic="component-button"] .control-stage')).toHaveAttribute('data-preview-state', 'ready');
		await page.goto(new URL('/?section=components&controlId=button-bar&mode=all', panel.url).href);
		await expect(page.locator('[data-topic="component-button-bar"] .topic-content')).toHaveAttribute('data-topic-state', 'ready');
		await expect(page.locator('[data-topic="component-button-bar"] .component-api-table')).toContainText('ButtonBar.addButton');
		await page.goto(new URL('/?section=components&controlId=icon-label&mode=all', panel.url).href);
		await expect(page.locator('[data-topic="component-icon-label"] .topic-content')).toHaveAttribute('data-topic-state', 'ready');
		await expect(page.locator('[data-topic="component-icon-label"] .component-api-table')).toContainText('IconLabel.setLabel');
		assert.equal(panel.state.scope.active, 'component-icon-label');
		await page.goto(new URL('/?section=components&controlId=split-button&mode=all', panel.url).href);
		await expect(page.locator('[data-topic="component-button"] .topic-content')).toHaveAttribute('data-topic-state', 'ready');
		assert.equal(panel.state.scope.active, 'component-button');
		const designReference = controls.find(control => control.id === 'button').designReference;
		const designLink = page.locator('[data-topic="component-button"]').getByRole('link', { name: 'View Figma specification', exact: true });
		if (designReference) { await expect(designLink).toHaveAttribute('href', designReference); }
		else { await expect(designLink).toHaveCount(0); }
		// Families without a specification are not topics; a saved URL reports the problem and keeps the book usable.
		await page.goto(new URL('/?section=components&controlId=notebook&mode=all', panel.url).href);
		await expect(page.getByRole('alert').filter({ hasText: 'Canvas update failed' })).toBeVisible();
		await expect(page.locator('#shell-problem')).toContainText('component-notebook');
		await expect(navigation.getByRole('link', { name: /^Button/ }).first()).toBeVisible();
		assert.equal(panel.state.scope.active, 'component-button');
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
		const example = article.getByRole('link', { name: 'Button fixtures', exact: true });
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
