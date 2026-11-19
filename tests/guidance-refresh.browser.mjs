/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Browser coverage for saved guidance refresh. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createExplorer } from '../runtime/server.mjs';
import { createDocumentCheckout, checkoutRoot } from './document-helpers.mjs';
import { chromium, expect } from './playwright.mjs';

test('removing and restoring a chapter introduction updates the same open canvas', { timeout: 30000 }, async t => {
	const fixture = createDocumentCheckout(t);
	const file = '.github/design-system/designing-for-ai.design.md';
	const source = readFileSync(path.join(checkoutRoot, file), 'utf8');
	const body = source.slice(source.indexOf('## Choose the guidance'));
	const write = lead => fixture.write(file, `# Designing for AI\n\n${lead}${body}`);
	write('## Introduction\n\nAn optional introduction.\n\n');
	const panel = await createExplorer(fixture.root, { watchCheckout: false, scope: { operation: 'all', active: 'designing-for-ai' } });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.goto(panel.url);
		const chapter = page.locator('[data-topic="designing-for-ai"]');
		await expect(chapter.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
		await expect(chapter.locator('.topic-intro')).toHaveText('An optional introduction.');
		const url = page.url();
		const headings = await chapter.locator('.topic-content h2').allTextContents();
		for (const [lead, intro] of [
			['', ''],
			['A saved unheaded lead.\n\n', 'A saved unheaded lead.'],
			['## Introduction\n\nA restored introduction.\n\n', 'A restored introduction.'],
		]) {
			write(lead);
			await expect(chapter.locator('.topic-intro')).toHaveText(intro);
			if (!intro) { await expect(chapter.locator('.topic-intro')).toBeHidden(); }
			await expect(chapter.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
			await expect(chapter.locator('.topic-content h2')).toHaveText(headings);
			await expect(chapter.getByRole('heading', { name: 'Choose the guidance', exact: true })).toBeVisible();
		}
		await page.getByRole('button', { name: 'Refresh', exact: true }).click();
		await expect(chapter.locator('.topic-intro')).toHaveText('A restored introduction.');
		await expect(chapter.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
		assert.deepEqual({ url: page.url(), errors }, { url, errors: [] });
	} finally { await browser.close(); await panel.close(); }
});
