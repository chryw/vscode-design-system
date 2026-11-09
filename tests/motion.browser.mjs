/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import assert from 'node:assert/strict';
import { workspaceRoot } from '../runtime/paths.mjs';
import test from 'node:test';
import { motionControls } from './repository-helpers.mjs';
import { chromium, expect } from './playwright.mjs';
import { createBrowserHost } from './explorer-browser-host.mjs';
import { mockFixtureRenderer } from './browser-helpers.mjs';
import { motionRecipeExamples } from '../view/motion-recipes.mjs';
import { motionGuidanceFile, motionPageFile, readMotionDefinitions, readMotionPage } from '../adapters/vscode/groups/motion-source.mjs';
import { readFileSync } from 'node:fs';

const root = workspaceRoot;

test('playback and reduced motion remain directly accessible without restarting the player', { timeout: 30000 }, async () => {
	const panel = await createBrowserHost(root, { scope: { operation: 'all', active: 'motion', layout: 'single' } });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await mockFixtureRenderer(page, root, motionControls.map(control => control.id));
		await page.goto(panel.url);
		await expect(page.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
		const example = page.locator('[data-motion-analysis="selection"]');
		assert.equal(await page.locator('#motion-authoring [data-motion-example]').count(), 0);
		assert.equal(await page.locator('[data-motion-analysis="selection"]').count(), 1);
		assert.equal(await example.getAttribute('data-motion-example'), 'selection');
		await example.evaluate(element => element.scrollIntoView());
		await expect(example.locator('[data-preview-state="ready"]')).toHaveCount(1);
		const handle = await example.locator('iframe').elementHandle();
		const fixture = await handle.contentFrame();
		await expect(example.getByRole('checkbox', { name: 'Reduced motion', exact: true })).toBeVisible();
		await expect(example.locator('details')).toHaveCount(0);
		await example.getByRole('button', { name: 'Play: Selection feedback', exact: true }).click();
		await expect.poll(() => fixture.evaluate(() => window.fixtureInput.motion)).toMatchObject({ action: 'advance', sequence: 1, playbackRate: 1, paused: false });
		await example.getByRole('button', { name: 'Pause: Selection feedback', exact: true }).click();
		await example.getByRole('checkbox', { name: 'Reduced motion', exact: true }).focus();
		await page.keyboard.press('Space');
		await expect.poll(() => fixture.evaluate(() => window.fixtureInput.motion)).toMatchObject({ action: 'advance', sequence: 1, playbackRate: 1, paused: true, reduced: true });
		assert.equal(await handle.evaluate(element => element.isConnected), true);
		assert.equal(await example.getByRole('radio').count(), 0);
		assert.equal(await example.getByRole('link').count(), 0);
	} finally {
		await browser.close();
		await panel.close();
	}
});

test('direct product interaction finishes the player and stale or reset messages cannot restart it', { timeout: 30000 }, async () => {
	const panel = await createBrowserHost(root, { scope: { operation: 'all', active: 'motion', layout: 'single' } });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await mockFixtureRenderer(page, root, motionControls.map(control => control.id));
		await page.goto(panel.url);
		const example = page.locator('[data-motion-example="delayed-content"]');
		await example.scrollIntoViewIfNeeded();
		await expect(example.locator('[data-preview-state="ready"]')).toHaveCount(1);
		const fixture = await (await example.locator('iframe').elementHandle()).contentFrame();
		const post = (type, sequence) => fixture.evaluate(data => parent.postMessage(data, '*'), { type: `vscode-motion-preview:${type}`, sequence });
		await post('ended', 0);
		await expect(example.getByRole('button', { name: 'Play: Waiting for content', exact: true })).toBeVisible();
		await post('started', 0);
		await expect(example.getByRole('button', { name: 'Pause: Waiting for content', exact: true })).toBeVisible();
		await expect.poll(() => fixture.evaluate(() => window.fixtureInput.motion)).toMatchObject({ sequence: 0, paused: false });
		await post('ended', 0);
		await example.getByRole('button', { name: 'Reset: Waiting for content', exact: true }).click();
		await expect.poll(() => fixture.evaluate(() => window.fixtureInput.motion)).toMatchObject({ action: 'reset', sequence: 1 });
		await post('started', 0);
		await post('ended', 0);
		await post('ended', 1);
		await expect(example.getByRole('button', { name: 'Play: Waiting for content', exact: true })).toBeVisible();
		await post('started', 1);
		await post('ended', 1);
		await expect(example.getByRole('button', { name: 'Reset: Waiting for content', exact: true })).toBeVisible();
	} finally {
		await browser.close();
		await panel.close();
	}
});

test('Motion renders source guidance and composition without implementation clutter', { timeout: 30000 }, async () => {
	const read = file => readFileSync(`${root}/${file}`, 'utf8');
	const spec = read(motionGuidanceFile)
		.replace('Motion helps people acknowledge a change', 'Motion explains a meaningful change')
		.replace('Make changes easier to understand.', 'Clarify meaningful change.')
		.replace('.surface {', '.surface.updated-reference {');
	const composition = JSON.parse(read(motionPageFile));
	composition.sections[0].blocks.reverse();
	const context = {
		root, source: file => ({ file, line: 1 }),
		read: file => file === motionGuidanceFile ? spec : file === motionPageFile ? JSON.stringify(composition) : read(file),
	};
	const authored = readMotionPage(context, readMotionDefinitions(context));
	const panel = await createBrowserHost(root, { scope: { operation: 'replace', topics: ['motion'], active: 'motion', layout: 'single' } });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await mockFixtureRenderer(page, root, motionControls.map(control => control.id));
		await page.route(url => url.pathname === '/api/topic' && url.searchParams.get('id') === 'motion', async route => {
			const response = await route.fetch();
			const envelope = await response.json();
			Object.assign(envelope.data.motionDocumentation, authored);
			await route.fulfill({ response, json: envelope });
		});
		await page.goto(panel.url);
		await expect(page.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
		await expect(page.locator('.topic-intro')).toContainText('Motion explains a meaningful change');
		assert.deepEqual(await page.locator('#motion-principles > h3').allTextContents(), ['Accessible', 'Consistent', 'Responsive', 'Natural', 'Purposeful']);
		await expect(page.locator('#motion-principles')).toContainText('Clarify meaningful change.');
		await expect(page.locator('#motion-principles')).not.toContainText('Keep attention on the task, not on the transition.');
		assert.match(motionRecipeExamples(authored).find(recipe => recipe.id === 'surface').code, /^\.surface\.updated-reference \{/);
		assert.equal(await page.locator('.motion-doc pre, .motion-doc-code').count(), 0);
	} finally {
		await browser.close();
		await panel.close();
	}
});

test('Motion players use a consistent viewport without width or speed controls', { timeout: 30000 }, async () => {
	const panel = await createBrowserHost(root, { scope: { operation: 'all', active: 'motion', layout: 'single' } });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await mockFixtureRenderer(page, root, motionControls.map(control => control.id));
		await page.goto(panel.url);
		const example = page.locator('[data-motion-analysis="selection"]');
		await example.evaluate(element => element.scrollIntoView());
		await expect(example.locator('[data-preview-state="ready"]')).toHaveCount(1);
		const handle = await example.locator('iframe').elementHandle();
		const fixture = await handle.contentFrame();
		const reducedMotion = example.getByRole('checkbox', { name: 'Reduced motion', exact: true });
		await reducedMotion.check();
		await expect.poll(() => fixture.evaluate(() => window.fixtureInput.motion)).toMatchObject({ reduced: true, action: 'reset', sequence: 0 });
		await reducedMotion.uncheck();
		await expect.poll(() => fixture.evaluate(() => window.fixtureInput.motion)).toMatchObject({ reduced: false, action: 'reset', sequence: 0 });
		const geometry = page.locator('#motion-example-anchored-menu');
		await geometry.evaluate(element => element.scrollIntoView());
		await expect(geometry.locator('[data-preview-state="ready"]')).toHaveCount(1);
		const geometryFrame = await geometry.locator('iframe').elementHandle();
		const geometryFixture = await geometryFrame.contentFrame();
		await expect(geometry.getByRole('checkbox', { name: 'Reduced motion', exact: true })).toBeVisible();
		await geometry.getByRole('button', { name: 'Play: Menu transition', exact: true }).click();
		await expect.poll(() => geometryFixture.evaluate(() => window.fixtureInput.motion)).toMatchObject({
			action: 'enter', sequence: 1, playbackRate: 1,
		});
		assert.equal(await geometryFrame.evaluate(element => element.style.width), '100%');
		assert.equal(await page.getByRole('radio', { name: /^(Default|Narrow|Wide|Actual speed|0.25x)$/ }).count(), 0);
		assert.equal(await handle.evaluate(element => element.isConnected), true);
	} finally {
		await browser.close();
		await panel.close();
	}
});

test('duration studies isolate source timing, compare together, and keep product patterns separate', { timeout: 30000 }, async () => {
	const panel = await createBrowserHost(root, { scope: { operation: 'all', active: 'motion', layout: 'single' } });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await mockFixtureRenderer(page, root, motionControls.map(control => control.id));
		await page.goto(panel.url);
		await expect(page.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
		const { data } = await (await page.request.get(new URL('/api/topic?id=motion', panel.url).href)).json();
		const study = page.locator('#motion-duration');
		assert.equal(await page.locator('.motion-doc table').count(), 0);
		assert.equal(await page.locator('#motion-timing iframe, #motion-timing [data-motion-example]').count(), 0);
		assert.deepEqual(await study.locator('[data-duration-example] > span').allTextContents(),
			data.motionDocumentation.page.durations.map(entry => `${entry.title} · ${data.motionDocumentation.tokens.find(token => token.id === entry.tokens[0]).value}`));
		await study.getByRole('button', { name: 'Play: Compare durations', exact: true }).focus();
		await page.keyboard.press('Enter');
		await study.getByRole('button', { name: 'Pause: Compare durations', exact: true }).click();
		assert.deepEqual(await study.locator('.motion-doc-duration-fill').evaluateAll(elements => elements.map(element => {
			const animation = element.getAnimations()[0];
			const timing = animation.effect.getTiming();
			animation.currentTime = timing.duration / 2;
			return {
				token: element.dataset.motionDuration,
				duration: timing.duration, easing: timing.easing,
				progress: new DOMMatrix(getComputedStyle(element).transform).a,
				frames: animation.effect.getKeyframes().map(frame => frame.transform),
			};
		})), data.motionDocumentation.page.durations.map(entry => ({
			token: entry.tokens[0],
			duration: data.motionDocumentation.tokens.find(token => token.id === entry.tokens[0]).number,
			easing: 'linear', progress: 0.5, frames: ['scaleX(0)', 'scaleX(1)'],
		})));
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await expect(study.locator('.motion-doc-duration-viewer')).toHaveAttribute('data-playback-state', 'finished');
		assert.equal(await study.locator('.motion-doc-duration-fill').evaluateAll(elements => elements.every(element =>
			element.getAnimations()[0].effect.getTiming().duration === 0 && new DOMMatrix(getComputedStyle(element).transform).a === 1)), true);
		await study.getByRole('button', { name: 'Reset: Compare durations', exact: true }).click();
		assert.equal(await study.locator('.motion-doc-duration-fill').evaluateAll(elements => elements.every(element =>
			!element.getAnimations().length && new DOMMatrix(getComputedStyle(element).transform).a === 0)), true);
		for (const width of [320, 720, 1440]) {
			await page.setViewportSize({ width, height: 900 });
			assert.equal(await study.evaluate(element => element.scrollWidth <= element.clientWidth), true, `Timing study fits ${width}px`);
		}
		assert.equal(await page.locator('.motion-doc-curve > header > p').count(), data.motionDocumentation.page.easings.length);
		assert.equal(await page.locator('.motion-doc-curve > .motion-doc-caption').count(), 0);
		assert.equal(await page.locator('.motion-doc a[href^="#motion-"]').evaluateAll(links => links.every(link => document.getElementById(link.hash.slice(1)))), true);
		const menuLink = page.getByRole('link', { name: 'menu example', exact: true }).first();
		await menuLink.focus();
		await page.keyboard.press('Enter');
		await expect(page.locator('#motion-example-anchored-menu')).toBeFocused();
		assert.equal(await page.locator('[data-motion-curve] input[type="checkbox"]').count(), 0);
		assert.equal(await page.locator('[data-motion-property="scale"] .motion-doc-specimen-target').count(), 1);
		assert.equal(await page.locator('.motion-doc [data-motion-preset], #motion-authoring, #motion-presets').count(), 0);
		assert.doesNotMatch(await page.locator('.motion-doc').textContent(), /Component binding|Preset contract|Default tokens|interpolation-error|Source ownership|Analytic peak speed|travel\/s|Analysis unavailable/);
		await page.locator('.source-documents > summary').click();
		assert.equal(new URL(await page.locator('.source-documents').getByRole('link', { name: 'Motion', exact: true }).getAttribute('href')).searchParams.get('documentId'), motionGuidanceFile);
		await study.getByRole('link', { name: 'Design tokens', exact: true }).click();
		const reference = page.locator('[data-topic="tokens"] #tokens-motion');
		await expect(reference).toBeFocused();
		await expect(reference).toHaveAttribute('open', '');
		for (const id of ['motion.duration.none', 'motion.duration.faster', 'motion.duration.fast', 'motion.duration.normal', 'motion.duration.gentle', 'motion.duration.slow', 'motion.duration.ultraSlow']) {
			await expect(reference.locator('th').getByText(id, { exact: true })).toHaveCount(1);
		}
	} finally {
		await browser.close();
		await panel.close();
	}
});

test('ongoing activity exposes its shape and reduced-motion controls directly', { timeout: 30000 }, async () => {
	const panel = await createBrowserHost(root, { scope: { operation: 'all', active: 'motion', layout: 'single' } });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await mockFixtureRenderer(page, root, motionControls.map(control => control.id));
		await page.goto(panel.url);
		const example = page.locator('[data-motion-example="agent-activity"]');
		await example.evaluate(element => element.scrollIntoView());
		await expect(example.locator('[data-preview-state="ready"]')).toHaveCount(1);
		const handle = await example.locator('iframe').elementHandle();
		const fixture = await handle.contentFrame();
		assert.equal(await example.locator('details, dl').count(), 0);
		await example.getByRole('checkbox', { name: 'Reduced motion', exact: true }).check();
		await example.getByRole('radio', { name: 'Ring', exact: true }).check();
		await example.getByRole('button', { name: 'Play: Agent working status', exact: true }).click();
		await expect.poll(() => fixture.evaluate(() => window.fixtureInput.motion)).toMatchObject({
			action: 'working', sequence: 2, paused: false, reduced: true, playbackRate: 1, variant: 'ring',
		});
		assert.equal(await handle.evaluate(element => element.isConnected), true);
	} finally {
		await browser.close();
		await panel.close();
	}
});

test('motion explains intent with canvas-owned independent playback and one token reference', { timeout: 60000 }, async () => {
	const panel = await createBrowserHost(root, { scope: { operation: 'all', active: 'motion', layout: 'single' } });
	let browser;
	try {
		browser = await chromium.launch({ headless: true });
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await mockFixtureRenderer(page, root, motionControls.map(control => control.id));
		await page.goto(panel.url);
		const article = page.locator('[data-topic="motion"]');
		await expect(article.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
		await expect(page.getByRole('navigation', { name: 'Topics', exact: true })).toBeVisible();
		assert.deepEqual(await article.locator('.motion-doc > section > h2').allTextContents(), ['Principles', 'Foundations', 'Best practices', 'Accessibility']);
		assert.deepEqual(await article.locator('.motion-doc > section').evaluateAll(sections => sections.map(section => section.id)),
			['motion-principles', 'motion-foundations', 'motion-practices', 'motion-accessibility']);
		assert.equal(await article.locator('#motion-practices [data-motion-example]').count(), 0);
		await expect(article.locator('#motion-practices')).toContainText('Name the benefit.');
		assert.deepEqual(await article.locator('#motion-timing > h4').allTextContents(), ['Duration', 'Easing']);
		assert.equal(await article.locator('.article-outline a').evaluateAll(links => links.every(link => document.getElementById(decodeURIComponent(link.hash.slice(1))))), true);
		const exampleIds = ['fade', 'selection', 'listening-color', 'input-focus', 'control', 'anchored-menu', 'disclosure', 'delayed-content', 'compact-activity', 'agent-activity', 'progress', 'unknown-progress', 'notification', 'working-logo', 'image-generation', 'blobby', 'completion'];
		for (const id of exampleIds) {
			const example = article.locator(`[data-motion-example="${id}"]`);
			await example.evaluate(element => element.scrollIntoView());
			await expect(example.locator('[data-preview-state="ready"]')).toHaveCount(1);
		}
		assert.deepEqual(await article.locator('[data-motion-example]').evaluateAll(examples => examples.map(example => example.dataset.motionExample)),
			exampleIds);
		assert.equal(await article.locator('[data-motion-example] > .motion-doc-caption').count(), exampleIds.length);
		assert.equal(await article.locator('#motion-progress [data-motion-example], #motion-attention [data-motion-example], #motion-expression [data-motion-example]').evaluateAll(examples => examples.every(example => {
			const header = example.querySelector('header');
			return header?.querySelector('p') && !!(header.compareDocumentPosition(example.querySelector('.motion-doc-viewer')) & Node.DOCUMENT_POSITION_FOLLOWING);
		})), true);
		assert.equal(await article.locator('[data-motion-property]:not([data-motion-property="scale"])').evaluateAll(properties => properties.every(property => {
			const header = property.querySelector('header');
			const caption = property.querySelector('.motion-doc-caption');
			const viewer = property.querySelector('.motion-doc-viewer');
			return header && caption && viewer && !header.contains(caption)
				&& !!(viewer.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING);
		})), true);
		assert.equal(await article.locator('[data-motion-example] .motion-doc-viewer > .motion-doc-stage + .motion-doc-preview-tools').count(), 16);
		assert.deepEqual(await article.locator('#motion-foundations .motion-doc-specimen-item h4').allTextContents(), ['Fade', 'Scale', 'Position', 'Color']);
		assert.deepEqual(await article.locator('[data-motion-property]').evaluateAll(items => items.map(item => item.dataset.motionProperty)), ['fade', 'scale', 'position', 'color']);
		assert.equal(await article.locator('.motion-doc-property-list').count(), 0);
		assert.equal(await article.locator('[data-motion-property] iframe').count(), 3);
		assert.equal(await article.locator('[data-motion-property="scale"] .motion-doc-specimen-target').count(), 1);
		assert.equal(await article.locator('.motion-doc-property').count(), 0);
		assert.deepEqual(await article.locator('#motion-principles > h3').allTextContents(), ['Purposeful', 'Natural', 'Responsive', 'Consistent', 'Accessible']);
		assert.equal(await article.locator('#motion-principles dl').count(), 0);
		assert.deepEqual(await article.locator('#motion-transitions > [data-motion-recipe] > h4').allTextContents(), ['Appear and dismiss', 'Changes in layout', 'Replace content without losing context']);
		assert.deepEqual(await article.locator('#motion-foundations > h3').allTextContents(), ['Visual changes']);
		assert.equal(await article.locator('#motion-timing > h3').textContent(), 'Timing');
		assert.equal(await article.locator('[data-motion-curve]').count(), 4);
		assert.equal(await article.locator('[data-motion-diagram]').count(), 0);
		assert.equal(await article.getByRole('heading', { name: 'State without movement' }).count(), 0);
		assert.equal(await article.locator('.motion-doc-viewer .motion-doc-parameters, .motion-doc-viewer .motion-doc-endpoints, .motion-doc-viewer .motion-doc-caption, .motion-doc-viewer output').count(), 0);
		assert.doesNotMatch(await article.innerText(), /Illustrative example/);
		assert.doesNotMatch(await article.innerText(), /From parameters to components|ICodeEditor|Edge entrance/);
		await expect(article.locator('#motion-accessibility')).toContainText('same content, state, and available actions');
		await expect(article.locator('#motion-accessibility')).toContainText('Screen-reader announcements and motion preferences are separate');
		assert.equal(await article.locator('.motion-doc .token-copy, .motion-doc input[type="range"], .motion-doc-playback-state').count(), 0);
		assert.equal(await article.locator('#motion-practices table, #motion-accessibility table').count(), 0);
		assert.equal(await article.getByRole('combobox', { name: /^Playback speed:/ }).count(), 0);
		assert.equal(await article.locator('.motion-doc pre, .motion-doc select').count(), 0);
		assert.equal(await article.getByRole('link', { name: 'Open in Component Explorer', exact: true }).count(), 0);
		assert.equal(await article.getByRole('checkbox', { name: 'Reduced motion', exact: true }).count(), 16);
		assert.equal(await article.locator('.motion-doc-viewer > .motion-doc-preview-tools .motion-doc-reduced').count(), 16);
		assert.equal(await article.getByRole('radio', { name: /^(Preset|Current|No motion|Proposed motion|Existing motion)$/ }).count(), 0);
		assert.deepEqual(await article.locator('#motion-foundations [data-motion-example]').evaluateAll(examples => examples.map(example => example.dataset.motionExample)), exampleIds);
		assert.equal(await article.locator('.motion-doc details').count(), 0);
		assert.doesNotMatch(await article.innerText(), /Phase\s?2|Phase\s?1|Further guidance|Motion in components/i);
		assert.equal(await article.getByRole('radio', { name: /Dark|Light|Contrast/ }).count(), 0);
		const before = await article.locator('iframe').evaluateAll(frames => {
			window.motionFrames = frames;
			return frames.map(frame => frame.src);
		});
		const fade = article.locator('[data-motion-example="anchored-menu"]');
		assert.equal(await fade.getByRole('button').count(), 1);
		assert.equal(await article.getByRole('button', { name: /Replay:|Dismiss:|Select Next:|Toggle:|Highlight Options:|Stop:/ }).count(), 0);
		assert.equal(await article.getByRole('button', { name: /^Expand:/ }).count(), 0);
		await fade.getByRole('button', { name: 'Play: Menu transition', exact: true }).click();
		const frame = await fade.locator('iframe').elementHandle();
		const fixture = await frame.contentFrame();
		await expect.poll(() => fixture.evaluate(() => window.fixtureInput.motion)).toMatchObject({ action: 'enter', sequence: 1, paused: false, reduced: false });
		await fade.getByRole('button', { name: 'Pause: Menu transition', exact: true }).click();
		await expect.poll(() => fixture.evaluate(() => window.fixtureInput.motion)).toMatchObject({ sequence: 1, paused: true, reduced: false });
		await fade.getByRole('button', { name: 'Play: Menu transition', exact: true }).click();
		await expect.poll(() => fixture.evaluate(() => window.fixtureInput.motion)).toMatchObject({ sequence: 1, paused: false });
		await fixture.evaluate(() => parent.postMessage({ type: 'vscode-motion-preview:ended', sequence: 0 }, '*'));
		await expect(fade.getByRole('button', { name: 'Pause: Menu transition', exact: true })).toBeVisible();
		await fixture.evaluate(() => parent.postMessage({ type: 'vscode-motion-preview:ended', sequence: 1 }, '*'));
		await expect(fade.getByRole('button', { name: 'Reset: Menu transition', exact: true })).toBeVisible();
		await fade.getByRole('button', { name: 'Reset: Menu transition', exact: true }).click();
		await expect.poll(() => fixture.evaluate(() => window.fixtureInput.motion)).toMatchObject({ action: 'reset', sequence: 2, paused: false });
		await fixture.evaluate(() => parent.postMessage({ type: 'vscode-motion-preview:ended', sequence: 1 }, '*'));
		await expect(fade.getByRole('button', { name: 'Play: Menu transition', exact: true })).toBeVisible();
		const control = article.locator('[data-motion-example="control"]');
		await control.getByRole('button', { name: 'Play: Toggle feedback', exact: true }).click();
		const controlFixture = await (await control.locator('iframe').elementHandle()).contentFrame();
		await expect.poll(() => controlFixture.evaluate(() => window.fixtureInput.motion)).toMatchObject({ action: 'toggle', sequence: 1, paused: false });
		await control.getByRole('button', { name: 'Pause: Toggle feedback', exact: true }).click();
		await control.getByRole('button', { name: 'Play: Toggle feedback', exact: true }).click();
		await expect.poll(() => controlFixture.evaluate(() => window.fixtureInput.motion)).toMatchObject({ action: 'toggle', sequence: 1, paused: false });
		assert.deepEqual(await article.locator('iframe').evaluateAll(frames => frames.map(frame => frame.src)), before);
		assert.equal(await article.locator('iframe').evaluateAll(frames => frames.every((frame, index) => frame === window.motionFrames[index])), true);
		await expect(article.locator('[data-motion-example="notification"]')).toContainText('without taking focus');
		await expect(article.locator('[data-motion-example="anchored-menu"] .preview-status')).toHaveText('Menu transition · Live preview');
		await expect(article.locator('[data-motion-example="anchored-menu"] .preview-status')).not.toBeVisible();
		await expect(article.locator('#motion-practices')).toContainText('Respond before waiting.');
		await expect(article.locator('#motion-transitions')).toContainText('reading anchor');
		assert.doesNotMatch(await article.locator('#motion-progress').innerText(), /[0-9]+ms/);
		await expect(article.locator('[data-motion-example="agent-activity"]').getByRole('radio', { name: 'Matrix', exact: true })).toBeChecked();
		await article.locator('[data-motion-example="agent-activity"]').getByRole('radio', { name: 'Ring', exact: true }).check();
		await expect(article.locator('[data-motion-example="agent-activity"]').getByRole('radio', { name: 'Ring', exact: true })).toBeChecked();
		for (const width of [320, 390, 720, 800, 1000, 1440]) {
			await page.setViewportSize({ width, height: 900 });
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px`);
			if ((await article.boundingBox()).width < 780) {
				assert.equal(await article.evaluate(element => {
					const left = element.querySelector('.motion-doc').getBoundingClientRect().left;
					return [...element.querySelectorAll('.motion-doc-viewer')].every(viewer => Math.abs(viewer.getBoundingClientRect().left - left) < 1);
				}), true, `Left alignment at ${width}px`);
			}
		}
		assert.ok((await article.locator('.topic-content').boundingBox()).width <= 860);
		assert.equal(await article.locator('.motion-doc-specimen, [data-motion-curve], [data-motion-diagram]').evaluateAll(viewers =>
			viewers.every(viewer => viewer.getBoundingClientRect().width <= 400)), true);
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		await panel.close();
	}
});

test('single-button players retain their final state until an explicit non-playing reset', { timeout: 60000 }, async () => {
	const panel = await createBrowserHost(root, { scope: { operation: 'replace', topics: ['motion'], active: 'motion', layout: 'single' } });
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
		await mockFixtureRenderer(page, root, motionControls.map(control => control.id));
		await page.goto(panel.url);
		const response = page.locator('[data-motion-curve="motion.easing.linear"]');
		await expect(response).toBeVisible();
		const target = response.locator('circle');
		await response.getByRole('button', { name: 'Play: Interpolate reported progress', exact: true }).focus();
		await page.keyboard.press('Enter');
		await expect(response).toHaveAttribute('data-playback-state', 'finished');
		await expect(target).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 16)');
		await expect(response.getByRole('button', { name: 'Reset: Interpolate reported progress', exact: true })).toBeFocused();
		await page.waitForTimeout(3000);
		await expect(target).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 16)');
		await page.keyboard.press('Enter');
		assert.deepEqual(await target.evaluate(async element => {
			const transforms = [];
			for (let index = 0; index < 12; index++) {
				await new Promise(requestAnimationFrame);
				transforms.push(getComputedStyle(element).transform);
			}
			return [...new Set(transforms)];
		}), ['matrix(1, 0, 0, 1, 0, 144)']);
		assert.equal(await target.evaluate(element => element.getAnimations().length), 0);
		const easing = page.locator('[data-motion-curve]');
		for (const curve of await easing.all()) {
			await curve.getByRole('button', { name: /^Play:/ }).evaluate(button => { button.click(); button.click(); });
			assert.equal(await curve.evaluate(element => {
				for (const animation of element.getAnimations({ subtree: true })) { animation.currentTime = animation.effect.getTiming().duration / 2; }
				const svg = element.querySelector('svg');
				const marker = element.querySelector('circle');
				const position = new DOMPoint(0, 0).matrixTransform(svg.getCTM().inverse().multiply(marker.getCTM()));
				return element.querySelector('.motion-doc-curve-path').isPointInStroke(position);
			}), true);
		}
		assert.equal(await easing.getByRole('radio').count(), 0);
		const easeOut = page.locator('[data-motion-curve="motion.surface.easing"]');
		await easeOut.scrollIntoViewIfNeeded();
		assert.equal(await easing.evaluateAll(elements => elements.every(element =>
			element.getAnimations({ subtree: true }).every(animation => animation.playState === 'paused'))), true);
		const { data } = await (await page.request.get(new URL('/api/topic?id=motion', panel.url).href)).json();
		assert.deepEqual(await easing.evaluateAll(elements => elements.map(element => ({
			curve: element.dataset.motionCurve,
			durationToken: element.dataset.motionDuration,
			durations: element.getAnimations({ subtree: true }).map(animation => animation.effect.getTiming().duration),
		}))), data.motionDocumentation.page.easings.map(binding => ({
			curve: binding.variants[0][0],
			durationToken: binding.tokens[0],
			durations: Array(2).fill(data.motionDocumentation.tokens.find(token => token.id === binding.tokens[0]).number),
		})));
		await easeOut.getByRole('button', { name: 'Play: Arrive and settle', exact: true }).click();
		await page.getByRole('heading', { name: 'Motion', level: 1, exact: true }).scrollIntoViewIfNeeded();
		await expect(easeOut).toHaveAttribute('data-playback-state', 'paused');
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await expect.poll(() => target.evaluate(element => element.getAnimations()[0].effect.getTiming().duration)).toBe(0);
		await expect(target).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 16)');
		await response.getByRole('button', { name: 'Reset: Interpolate reported progress', exact: true }).click();
		await expect(target).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 144)');
		await response.getByRole('button', { name: 'Play: Interpolate reported progress', exact: true }).click();
		assert.deepEqual(await target.evaluate(element => ({
			transform: getComputedStyle(element).transform,
			delay: element.getAnimations()[0].effect.getTiming().delay,
		})), { transform: 'matrix(1, 0, 0, 1, 0, 16)', delay: 0 });
	} finally {
		await browser.close();
		await panel.close();
	}
});

test('published CSS recipes resolve real parameters and run their documented state changes', { timeout: 60000 }, async () => {
	const context = { root, read: file => readFileSync(`${root}/${file}`, 'utf8'), source: file => ({ file, line: 1 }) };
	const definitions = readMotionDefinitions(context);
	const model = { ...definitions, ...readMotionPage(context, definitions) };
	const duration = id => model.tokens.find(token => token.id === id).number;
	const cssName = id => `--vscode-${id.replaceAll('.', '-')}`;
	const variables = Object.fromEntries(model.tokens.map(token => [token.css, token.value]));
	for (const recipe of model.recipes.filter(recipe => recipe.tracks.length)) {
		variables[`${cssName(recipe.id)}-transition`] = recipe.tracks.map(track =>
			`${track.property} var(${cssName(track.durationToken)}) var(${cssName(track.easingToken)})${track.delayToken ? ` var(${cssName(track.delayToken)})` : ''}`).join(', ');
	}
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		const results = await page.evaluate(({ recipes, variables }) => {
			return recipes.map(recipe => {
				const references = [...recipe.code.matchAll(/var\((?<name>--[\w-]+)/g)].map(match => match.groups.name);
				const missing = references.filter(name => !(name in variables));
				const host = document.createElement('div');
				for (const [name, value] of Object.entries(variables)) { host.style.setProperty(name, value); }
				const shadow = host.attachShadow({ mode: 'open' });
				const style = document.createElement('style');
				style.textContent = recipe.code;
				const owner = document.createElement('div');
				const element = document.createElement('div');
				element.className = { surface: 'surface is-entering', layout: 'details', content: 'incoming-content', feedback: 'state-control', notification: 'notification' }[recipe.id];
				element.style.width = '200px';
				const child = document.createElement('div');
				child.className = 'thumb';
				child.style.height = '60px';
				element.append(child);
				owner.append(element);
				shadow.append(style, owner);
				document.body.append(host);
				if (recipe.id === 'feedback') { element.style.backgroundColor = 'rgb(20, 20, 20)'; }
				getComputedStyle(element).opacity;
				element.classList.remove('is-entering');
				element.classList.add({ content: 'is-ready', notification: 'is-arriving' }[recipe.id] ?? 'is-open');
				if (recipe.id === 'feedback') { element.style.backgroundColor = 'rgb(80, 80, 80)'; }
				const animations = element.getAnimations({ subtree: true });
				const durations = animations.map(animation => animation.effect.getTiming().duration).sort((a, b) => a - b);
				for (const animation of animations) { animation.finish(); }
				const styleAfter = getComputedStyle(element);
				const visible = styleAfter.opacity === '1' && styleAfter.visibility === 'visible';
				element.classList.remove('is-open', 'is-ready', 'is-arriving');
				getComputedStyle(element).opacity;
				owner.className = 'monaco-reduce-motion';
				const reduced = getComputedStyle(element).transitionDuration;
				let disclosure;
				if (recipe.id === 'layout') {
					owner.className = '';
					owner.style.display = 'flex';
					owner.style.flexDirection = 'column';
					owner.style.height = '240px';
					owner.style.width = '240px';
					const sibling = document.createElement('div');
					sibling.style.flex = '1';
					owner.prepend(sibling);
					element.className = 'details';
					element.style.width = '';
					element.style.flex = 'none';
					child.style.height = '';
					const content = document.createElement('div');
					content.style.height = '96px';
					child.replaceChildren(content);
					const collapsed = element.getBoundingClientRect().height;
					const before = sibling.getBoundingClientRect();
					element.classList.add('is-open');
					for (const animation of element.getAnimations()) { animation.finish(); }
					const expanded = element.getBoundingClientRect().height;
					const after = sibling.getBoundingClientRect();
					element.classList.remove('is-open');
					for (const animation of element.getAnimations()) { animation.finish(); }
					disclosure = { collapsed, expanded, anchorShift: after.y - before.y, reflow: before.height - after.height, closedAgain: element.getBoundingClientRect().height };
				}
				host.remove();
				return { id: recipe.id, missing, durations, visible, reduced, ...(disclosure ? { disclosure } : {}) };
			});
		}, { recipes: motionRecipeExamples(model), variables });
		assert.deepEqual(results, [
			{ id: 'surface', missing: [], durations: [duration('motion.surface.enter.duration'), duration('motion.surface.enter.duration')], visible: true, reduced: '0s' },
			{ id: 'layout', missing: [], durations: [duration('motion.disclosure.opacity.duration'), duration('motion.disclosure.duration')].sort((a, b) => a - b), visible: true, reduced: '0s', disclosure: { collapsed: 0, expanded: 96, anchorShift: 0, reflow: 96, closedAgain: 0 } },
			{ id: 'content', missing: [], durations: [duration('motion.content.duration')], visible: true, reduced: '0s' },
			{ id: 'feedback', missing: [], durations: [duration('motion.control.duration')], visible: true, reduced: '0s' },
			{ id: 'notification', missing: [], durations: [duration('motion.toast.duration'), duration('motion.toast.duration')], visible: true, reduced: '0s' },
		]);
	} finally { await browser.close(); }
});

test('motion diagrams and controls use product tokens, Codicons, and matching fixture themes', { timeout: 60000 }, async () => {
	const panel = await createBrowserHost(root, { scope: { operation: 'replace', topics: ['motion'], active: 'motion', layout: 'single' } });
	const browser = await chromium.launch({ headless: true });
	try {
		for (const scheme of ['light', 'dark']) {
			const page = await browser.newPage({ colorScheme: scheme, viewport: { width: 1100, height: 900 } });
			await mockFixtureRenderer(page, root, motionControls.map(control => control.id));
			await page.goto(new URL('/', panel.url).href);
			await expect(page.locator('.topic-content')).toHaveAttribute('data-topic-state', 'ready');
			const { data } = await (await page.request.get(new URL('/api/topic?id=motion', panel.url).href)).json();
			assert.deepEqual(data.motionAppearance.themes, { dark: 'Dark 2026', light: 'Light Modern' });
			const headingSizes = await page.locator('.topic-heading h1, #motion-foundations > h2, #motion-timing > h3, #motion-timing > h4:first-of-type').evaluateAll(elements => elements.map(element => getComputedStyle(element).fontSize));
			assert.equal(headingSizes.every((size, index) => !index || Number.parseFloat(size) < Number.parseFloat(headingSizes[index - 1])), true);
			assert.equal(await page.locator('.motion-doc :is(h2,h3,h4,h5,h6)').evaluateAll(elements => {
				let previous = 1;
				return elements.every(element => {
					const level = Number(element.tagName.slice(1));
					const sequential = level <= previous + 1;
					previous = level;
					return sequential;
				});
			}), true);
			const measurements = await page.evaluate(({ colors }) => {
				const reference = document.createElement('span');
				document.body.append(reference);
				const expectedColors = colors.map(color => {
					reference.style.backgroundColor = color;
					return getComputedStyle(reference).backgroundColor;
				});
				reference.remove();
				const targets = [...document.querySelectorAll('[data-motion-curve] .motion-doc-stage')]
					.map(target => getComputedStyle(target).backgroundColor);
				return { targets, expected: expectedColors };
			}, {
				colors: Array(4).fill(data.motionAppearance[scheme].find(token => token.id === 'editor.background').value),
			});
			assert.deepEqual(measurements.targets, measurements.expected);
			const button = page.getByRole('button', { name: 'Play: Interpolate reported progress', exact: true });
			await expect(button).toHaveClass(/monaco-button monaco-text-button default-colors secondary/);
			await expect(button.locator('.codicon-play')).toHaveText(String.fromCodePoint(Number.parseInt(data.icons.find(icon => icon.id === 'play').code, 16)));
			assert.ok((await page.locator('.motion-doc > style').textContent()).includes(data.motionAppearance.buttonCss));
			const control = page.locator('[data-motion-example="control"]');
			await control.scrollIntoViewIfNeeded();
			await expect(control.locator('[data-preview-state="ready"]')).toHaveCount(1);
			assert.equal(new URL(await control.locator('iframe').getAttribute('src')).searchParams.get('fixture'), `motion/Control/${scheme === 'dark' ? 'Dark' : 'Light'}`);
			for (const width of [320, 720]) {
				await page.setViewportSize({ width, height: 900 });
				assert.equal(await page.locator('[data-topic="motion"]').evaluate(root => {
					const viewer = root.querySelector('[data-motion-example="control"] .motion-doc-viewer').getBoundingClientRect();
					const elements = root.querySelectorAll('.topic-intro, .topic-heading, #motion-foundations > p:first-of-type, [data-motion-example="control"] header');
					return [...elements].every(element => {
						const bounds = element.getBoundingClientRect();
						return Math.abs(bounds.left - viewer.left) < 1 && bounds.right >= viewer.right - 1;
					});
				}), true, `Aligned reading column at ${width}px`);
			}
			await page.close();
		}
	} finally {
		await browser.close();
		await panel.close();
	}
});
