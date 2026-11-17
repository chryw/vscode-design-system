/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { chromium, expect } from './playwright.mjs';
import { createDocumentCheckout, checkoutRoot } from './document-helpers.mjs';
import { createExplorer } from '../runtime/server.mjs';

test('the same canvas browses a basic checkout, saved edits and a curated book through keyboard-accessible checkout controls', { timeout: 60000 }, async t => {
	const fixture = createDocumentCheckout(t);
	rmSync(fixture.bookRoot, { recursive: true });
	execFileSync('git', ['init', '-q', '-b', 'ordinary'], { cwd: fixture.root });
	const panel = await createExplorer(fixture.root);
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.goto(panel.url);
		const origin = new URL(page.url()).origin;
		await expect(page.getByRole('heading', { name: 'Source library', exact: true })).toBeVisible();
		await expect(page.locator('#checkout-mode')).toContainText('no curated design book');
		await page.getByRole('link', { name: 'Feature notes', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Feature notes', exact: true })).toBeVisible();
		fixture.write('src/vs/feature/feature-notes.md', '# Saved edit\n\nRead the current checkout.\n');
		await expect(page.getByRole('heading', { name: 'Saved edit', exact: true })).toBeVisible();
		const picker = page.locator('#checkout-picker summary');
		await picker.focus();
		await page.keyboard.press('Enter');
		await page.getByLabel('Local worktree').selectOption('');
		const checkoutPath = page.getByLabel('Checkout path', { exact: true });
		await expect(checkoutPath).toBeFocused();
		await checkoutPath.fill('/definitely/not/a/checkout');
		await page.keyboard.press('Tab');
		await expect(page.getByRole('button', { name: 'Browse checkout', exact: true })).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(page.locator('#shell-problem')).toBeVisible();
		assert.equal(panel.root, fixture.root);
		await checkoutPath.fill(checkoutRoot);
		await page.getByRole('button', { name: 'Browse checkout', exact: true }).click();
		await expect(page.locator('#checkout-picker')).not.toHaveAttribute('open', '');
		await expect(page.locator('#checkout-mode')).toHaveText('');
		await expect(page.locator('#checkout-picker summary')).toBeFocused();
		assert.equal(new URL(page.url()).origin, origin);
		await page.locator('#book-navigation summary').filter({ hasText: 'Foundations' }).click();
		await expect(page.getByRole('link', { name: 'Typography', exact: true })).toBeVisible();
		for (const width of [390, 1100]) {
			await page.setViewportSize({ width, height: 900 });
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		}
		assert.deepEqual(errors, []);
	} finally { await browser.close(); await panel.close(); }
});
