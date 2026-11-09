/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

import { node } from './ui.mjs';
import { appendMotionMarkdown as appendMarkdown, renderMotionExample, renderPropertySpecimen, renderTimingComparison, renderRecipeDiagram, renderResponseSpecimens } from './motion-previews.mjs';
import { motionRecipeExamples, motionSection, motionExample } from './motion-recipes.mjs';

function motionExampleFor(model, id) {
	const result = motionExample(model, id);
	const entry = model.page.examples.find(entry => entry.id === id);
	return { ...result, title: entry.title ?? result.title };
}

function section(id, title, level = 'h2') {
	const element = node('section', undefined, 'motion-doc-section');
	element.id = `motion-${id}`;
	element.append(node(level, title));
	return element;
}

const propertyFrames = {
	fade: () => [{ opacity: 1 }, { opacity: 0 }],
	scale: model => [{ transform: 'scale(1)' }, { transform: `scale(${model.tokens.find(token => token.id === 'motion.press.scale').number})` }],
	position: () => [{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }],
	color: () => [{ backgroundColor: 'var(--vscode-button-secondaryBackground)' }, { backgroundColor: 'var(--vscode-button-background)' }],
};

async function loadStyles(content, signal) {
	if (signal?.aborted) { throw new DOMException('Motion documentation cancelled', 'AbortError'); }
	let link = content.ownerDocument.head.querySelector('link[data-motion-doc-styles]');
	if (!link) {
		link = node('link');
		link.rel = 'stylesheet';
		link.href = '/motion.css';
		link.dataset.motionDocStyles = 'true';
		content.ownerDocument.head.append(link);
	}
	if (link.sheet) { return; }
	await new Promise((resolve, reject) => {
		const cleanup = () => {
			link.removeEventListener('load', loaded);
			link.removeEventListener('error', failed);
			signal?.removeEventListener('abort', abort);
		};
		const abort = () => { cleanup(); reject(new DOMException('Motion documentation cancelled', 'AbortError')); };
		const loaded = () => { cleanup(); resolve(); };
		const failed = () => { cleanup(); link.remove(); reject(new Error('Couldn’t load the motion stylesheet')); };
		link.addEventListener('load', loaded, { once: true });
		link.addEventListener('error', failed, { once: true });
		signal?.addEventListener('abort', abort, { once: true });
		if (signal?.aborted) { abort(); }
	});
}

export async function renderMotion(content, system, signal, presentation) {
	await loadStyles(content, signal);
	if (signal?.aborted) { throw new DOMException('Motion documentation cancelled', 'AbortError'); }
	if (!system.motionDocumentation) { throw new Error('Motion source definitions are missing'); }
	const model = { ...system.motionDocumentation, icons: system.icons };
	const page = node('div', undefined, 'motion-doc');
	page.dataset.motionDocumentation = model.status;
	if (model.status !== 'defined') {
		const principles = model.page.sections.find(section => section.id === 'principles');
		if (principles) {
			const group = section(principles.id, motionSection(model, principles.heading).title);
			for (const block of principles.blocks.filter(block => block.type === 'guidance')) {
				const authored = motionSection(model, block.heading);
				group.append(node('h3', authored.title));
				appendMarkdown(group, authored.markdown);
			}
			page.append(group);
		}
		page.append(node('p', 'Motion definitions aren’t available in this checkout.'));
		content.append(page);
		return model.tokens.length;
	}
	if (!system.motionAppearance || model.icons.some(icon => !icon.fontAvailable)) { throw new Error('Product styles or playback icons are unavailable'); }
	const font = await document.fonts.load('16px canvas-codicon', model.icons.map(icon => String.fromCodePoint(Number.parseInt(icon.code, 16))).join(''));
	if (!font.length || font.some(face => face.status !== 'loaded')) { throw new Error('Couldn’t load the product icon font'); }
	if (signal.aborted) { return; }
	for (const token of system.sizes) { page.style.setProperty(token.css, token.value); }
	for (const dark of system.motionAppearance.dark) {
		const light = system.motionAppearance.light.find(token => token.id === dark.id);
		if (!light) { throw new Error(`Missing light product token: ${dark.id}`); }
		page.style.setProperty(dark.css, `light-dark(${light.value}, ${dark.value})`);
	}
	const platform = /Mac/.test(navigator.platform) ? 'mac' : /Win/.test(navigator.platform) ? 'windows' : 'linux';
	const family = system.typography.families.find(family => family.platform === platform && family.locale === 'Default' && family.property === 'font-family');
	if (!family) { throw new Error(`Missing workbench typography: ${platform}`); }
	page.style.fontFamily = family.value;
	const styles = node('style');
	styles.textContent = `@scope (.motion-doc) { ${system.motionAppearance.buttonCss} }`;
	page.prepend(styles);
	const reducedPreference = matchMedia('(prefers-reduced-motion: reduce)');
	const reducedNotice = node('p', 'Reduced motion is enabled. Spatial examples show their final state without animation.', 'motion-doc-preference-notice');
	reducedNotice.setAttribute('role', 'status');
	const updatePreferenceNotice = () => { reducedNotice.hidden = !reducedPreference.matches; };
	reducedPreference.addEventListener('change', updatePreferenceNotice, { signal });
	updatePreferenceNotice();
	page.append(reducedNotice);
	const scheme = getComputedStyle(document.body).colorScheme;
	model.previewTheme = scheme === 'dark' || scheme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches ? 'Dark' : 'Light';
	const examples = (parent, ids) => {
		const grid = node('div', undefined, 'motion-doc-grid');
		for (const id of ids) { renderMotionExample(grid, model, { ...motionExampleFor(model, id), heading: 'h4' }, signal, presentation); }
		parent.append(grid);
	};
	const recipes = motionRecipeExamples(model);
	const renderRecipe = (parent, id, level = 4) => {
		const recipe = recipes.find(recipe => recipe.id === id);
		const item = recipe.id === 'feedback' ? section('feedback', recipe.title, `h${level}`) : node('section', undefined, 'motion-doc-recipe');
		item.dataset.motionRecipe = recipe.id;
		if (recipe.id !== 'feedback') { item.id = `motion-pattern-${recipe.id}`; }
		if (recipe.id !== 'feedback') { item.append(node(`h${level}`, recipe.title)); }
		appendMarkdown(item, recipe.markdown);
		const composition = node('div', undefined, 'motion-doc-grid motion-doc-recipe-examples');
		for (const diagram of recipe.diagrams ?? []) {
			const pattern = node('article', undefined, 'motion-doc-example motion-doc-pattern');
			const heading = node('header');
			heading.append(node(`h${level + 1}`, diagram.title));
			pattern.append(heading);
			renderRecipeDiagram(pattern, model, { id, ...diagram }, signal);
			composition.append(pattern);
		}
		for (const exampleId of recipe.examples ?? []) {
			renderMotionExample(composition, model, { ...motionExampleFor(model, exampleId), heading: `h${level + 1}`, bare: false }, signal, presentation);
		}
		if (composition.childElementCount) { item.append(composition); }
		parent.append(item);
	};
	const guidance = (parent, heading, level = 3, description, title) => {
		const authored = motionSection(model, heading);
		parent.append(node(`h${level}`, title ?? authored.title));
		appendMarkdown(parent, description ?? authored.markdown);
	};
	const renderBlock = (parent, block) => {
		switch (block.type) {
			case 'guidance':
				guidance(parent, block.heading, block.level, block.description, block.title);
				break;
			case 'group': {
				const group = section(block.id, motionSection(model, block.heading).title, 'h3');
				appendMarkdown(group, block.description ?? motionSection(model, block.heading).markdown);
				for (const child of block.blocks) { renderBlock(group, child); }
				parent.append(group);
				break;
			}
			case 'duration': {
				guidance(parent, block.heading, block.level, block.description);
				renderTimingComparison(parent, model, 'duration', signal, presentation, block.level);
				break;
			}
			case 'easing':
				guidance(parent, block.heading, block.level, block.description);
				renderTimingComparison(parent, model, 'easing', signal, presentation, block.level);
				break;
			case 'responses':
				guidance(parent, block.heading, block.level, block.description);
				renderResponseSpecimens(parent, model, signal);
				break;
			case 'reference': {
				const authored = motionSection(model, block.heading);
				const reference = node('details', undefined, 'motion-doc-reference');
				reference.append(node('summary', authored.title));
				appendMarkdown(reference, authored.markdown);
				for (const child of block.blocks ?? []) { renderBlock(reference, child); }
				parent.append(reference);
				break;
			}
			case 'properties': {
				guidance(parent, block.heading, block.level, block.description);
				const specimens = node('div', undefined, 'motion-doc-specimens');
				for (const specimen of model.page.properties) {
					const item = node('div', undefined, 'motion-doc-specimen-item');
					const description = node('header');
					const authored = motionSection(model, specimen.heading);
					guidance(description, specimen.heading, 4, specimen.description);
					item.append(description);
					item.dataset.motionProperty = specimen.id;
					item.id = `motion-property-${specimen.id}`;
					item.tabIndex = -1;
					if (specimen.example) {
						renderMotionExample(item, model, { ...motionExampleFor(model, specimen.example), heading: false }, signal, presentation);
					} else {
						renderPropertySpecimen(item, model, { ...specimen, title: authored.title, frames: propertyFrames[specimen.id] }, signal);
					}
					specimens.append(item);
				}
				parent.append(specimens);
				break;
			}
			case 'transitions': {
				const group = section(block.id, motionSection(model, block.heading).title, 'h3');
				appendMarkdown(group, block.description ?? motionSection(model, block.heading).markdown);
				for (const id of block.recipes) { renderRecipe(group, id); }
				if (block.after) { renderBlock(group, block.after); }
				parent.append(group);
				break;
			}
			case 'recipe':
				renderRecipe(parent, block.id, 3);
				break;
			case 'examples': {
				const group = section(block.id, motionSection(model, block.heading).title, 'h3');
				appendMarkdown(group, block.description ?? motionSection(model, block.heading).markdown);
				examples(group, block.examples);
				parent.append(group);
				break;
			}
			case 'example': {
				const example = motionExample(model, block.id);
				renderMotionExample(parent, model, { ...example, heading: example.showHeading === false ? false : 'h4' }, signal, presentation);
				break;
			}
			default:
				throw new Error(`Unsupported Motion block: ${block.type}`);
		}
	};
	for (const composition of model.page.sections) {
		const authored = motionSection(model, composition.heading);
		const group = section(composition.id, composition.title ?? authored.title);
		appendMarkdown(group, composition.description ?? authored.markdown);
		for (const block of composition.blocks) { renderBlock(group, block); }
		page.append(group);
	}
	page.addEventListener('click', event => {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) { return; }
		const link = event.target instanceof Element ? event.target.closest('a[href^="#motion-"]') : undefined;
		if (!link) { return; }
		const anchor = link.getAttribute('href').slice(1);
		const target = page.querySelector(`#${CSS.escape(anchor)}`);
		if (!target) { throw new Error(`Missing Motion example destination: ${anchor}`); }
		event.preventDefault();
		target.tabIndex = -1;
		target.focus({ preventScroll: true });
		target.scrollIntoView({ block: 'start' });
		presentation.onView({ anchor });
	}, { signal });
	content.append(page);
	return model.tokens.length;
}
