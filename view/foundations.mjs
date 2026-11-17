/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

import { node, example, exampleViewer, tokenButton } from './ui.mjs';
import { renderLayout } from './layout.mjs';
import { visualTokens } from './token-lookup.mjs';
import { chapterContent, sectionContent, contentText } from './page-content.mjs';
import { renderElevation } from './elevation.mjs';

function tokenNote(token) {
	const note = node('div', undefined, 'foundation-token-note');
	note.append(tokenButton(token), node('code', token.value));
	return note;
}

export async function renderFoundations(content, system, onView, host, signal) {
	const page = system.view.section;
	const authored = chapterContent(system);
	const specimen = (id, values = {}) => {
		const { title, description } = sectionContent(authored, id);
		return example(title, contentText(description, values));
	};
	if (page === 'elevation') {
		return renderElevation(content, system, host);
	}
	if (page === 'spacing') {
		return renderLayout(content, system, host, signal);
	}
	const grid = node('div', undefined, 'article-flow');
	if (page === 'shape') {
		const scale = specimen('scale');
		const samples = node('div', undefined, 'radius-scale');
		for (const token of visualTokens(system, 'shape')) {
			const item = node('figure');
			item.dataset.scaleToken = token.id;
			const sample = node('div', undefined, 'radius-example blue-square');
			sample.style.borderRadius = token.value;
			sample.setAttribute('aria-hidden', 'true');
			item.append(sample, node('figcaption', `${token.id.split('.').at(-1)} · ${token.value}`));
			samples.append(item);
		}
		scale.append(samples);
		const contexts = specimen('roles');
		const scene = node('div', undefined, 'shape-contexts');
		for (const { label, token: id, kind } of authored.contexts) {
			const token = system.sizes.find(token => token.id === id);
			if (!token) { throw new Error(`Unknown shape specimen token: ${id}`); }
			const frame = node('figure', undefined, `shape-context shape-context-${kind}`);
			const surface = node('div', label);
			surface.style.borderRadius = token.value;
			frame.append(surface, node('figcaption', `${label} · ${token.value}`));
			scene.append(frame);
		}
		contexts.append(exampleViewer(scene));
		grid.append(contexts, scale);
	} else if (page === 'size') {
		const sizes = visualTokens(system, 'size');
		const glyphs = specimen('glyphs');
		const samples = node('div', undefined, 'grid reference-specimen');
		for (const token of sizes) {
			const item = node('section');
			item.append(node('h3', token.id.endsWith('compact') ? 'Compact glyph' : 'Base glyph'));
			const sample = node('span', undefined, 'size-glyph-example codicon-glyph');
			const icon = system.icons.find(icon => icon.id === (token.id.endsWith('compact') ? 'add-compact' : 'add'));
			sample.textContent = String.fromCodePoint(Number.parseInt(icon.code, 16));
			sample.style.fontSize = token.value;
			sample.setAttribute('aria-hidden', 'true');
			const context = node('div', undefined, 'glyph-context');
			const marker = node('span', undefined, 'blue-square sizing-mark');
			marker.style.width = token.value;
			marker.style.height = token.value;
			context.append(marker, sample, node('code', token.value));
			item.append(context);
			samples.append(item);
		}
		glyphs.append(exampleViewer(samples));
		const reference = specimen('reference');
		for (const token of sizes) { reference.append(tokenNote(token)); }
		if (system.reference.scales.componentSizes.length) {
			for (const token of system.reference.scales.componentSizes) {
				reference.append(node('p', `${token.description} · ${token.value}`));
			}
		}
		grid.append(glyphs, reference);
	} else if (page === 'stroke') {
		const token = system.sizes.find(token => token.id === 'strokeThickness');
		const usage = specimen('usage', { value: token.value });
		const samples = node('div', undefined, 'grid');
		for (const label of ['Divider', 'Control boundary']) {
			const item = node('section');
			item.append(node('h3', label));
			const sample = node('div', label === 'Divider' ? '' : 'Control boundary', label === 'Divider' ? 'stroke-divider' : 'stroke-control');
			sample.style.borderWidth = token.value;
			item.append(sample);
			samples.append(item);
		}
		samples.classList.add('reference-specimen');
		usage.append(exampleViewer(samples));
		const reference = specimen('reference');
		reference.append(tokenNote(token));
		grid.append(usage, reference);
	} else if (page === 'colors') {
		return (await import('./color-reference.mjs')).renderColors(content, system, host, signal);
	}
	if (grid.children.length) {
		content.append(grid);
	}
	if (page === 'layout') {
		const composition = specimen('hierarchy');
		composition.id = 'layout-hierarchy';
		const scene = node('div', undefined, 'layout-structure');
		scene.append(node('div', 'Navigation'), node('div', 'Primary task'), node('div', 'Supporting detail'));
		composition.append(scene);
		const responsive = specimen('responsive');
		responsive.id = 'layout-responsive';
		const reflow = node('div', undefined, 'reflow-example');
		reflow.append(node('div', 'Navigation'), node('div', 'Content reflows'), node('div', 'Supporting content moves'));
		responsive.append(reflow);
		content.append(composition, responsive);
	}
	return content.children.length;
}
