/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- No-build foundation renderer. */
import { node, tokenButton, variantChoices } from './ui.mjs';
import { chapterContent, sectionContent } from './page-content.mjs';
import { documentMarkup } from './documents.mjs';

export function renderElevation(content, system, host) {
	const authored = chapterContent(system);
	const guide = node('div', undefined, 'article-flow elevation-guide');
	const markup = text => {
		const result = documentMarkup({ id: authored.markdownSource, markdown: text }, {
			level: 3, resolveResource: host.documentResource,
		});
		for (const table of result.querySelectorAll('.table-scroll')) {
			table.tabIndex = 0;
			table.setAttribute('role', 'region');
			table.setAttribute('aria-label', 'Elevation reference table; scroll horizontally for more columns');
		}
		return result;
	};
	const section = (id, illustrate) => {
		const text = sectionContent(authored, id);
		const result = node('section', undefined, 'article-section');
		result.id = `elevation-${id}`;
		result.append(node('h2', text.title), markup(text.description));
		illustrate?.(result);
		result.append(...text.paragraphs.map(markup));
		return result;
	};
	for (const token of [...system.sizes, ...system.elevation.cssShadows]) {
		guide.style.setProperty(token.css, token.value);
	}
	const palettes = system.elevation.palettes;
	const selected = host.previewState.get('elevation-theme')
		?? (palettes.some(palette => palette.id === system.view.theme) ? system.view.theme : palettes[0].id);
	let partShadowsOff = host.previewState.get('elevation-part-shadows-off') ?? false;
	const applyTheme = id => {
		const palette = palettes.find(palette => palette.id === id);
		if (!palette) { throw new Error(`Unknown elevation diagram theme: ${id}`); }
		for (const token of palette.tokens) { guide.style.setProperty(token.css, token.value); }
		guide.dataset.contrast = String(palette.highContrast);
		guide.dataset.partShadowsOff = String(partShadowsOff);
		guide.dataset.previewTheme = id;
		host.previewState.set('elevation-theme', id);
	};
	const controls = node('div', undefined, 'elevation-preview-controls');
	const themes = variantChoices('Specimen theme', palettes.map(palette => ({ id: palette.id, name: palette.label })), selected, applyTheme);
	controls.append(themes);
	const tiers = section('tiers');
	const anatomy = section('anatomy', result => {
		result.append(controls);
		const figure = node('figure', undefined, 'elevation-construction');
		const stage = node('div', undefined, 'elevation-construction-stage');
		stage.setAttribute('aria-hidden', 'true');
		const surface = node('div', undefined, 'elevation-construction-surface');
		surface.append(node('strong', authored.construction.labels[1]), node('div', authored.construction.labels[2], 'elevation-contained-group'));
		for (let index = 0; index < authored.construction.parts.length; index++) {
			surface.append(node('span', String(index + 1), `elevation-marker elevation-marker-${index + 1}`));
		}
		stage.append(surface, node('span', authored.construction.labels[0], 'elevation-receiver-label'));
		figure.append(stage, node('figcaption', authored.construction.caption));
		const parts = node('ol', undefined, 'elevation-construction-parts');
		const tokens = [...system.sizes, ...system.elevation.cssShadows, ...palettes[0].tokens];
		for (const part of authored.construction.parts) {
			const item = node('li');
			const references = node('div', undefined, 'elevation-part-tokens');
			for (const id of part.tokens) {
				const token = tokens.find(token => token.id === id || token.css === id);
				if (!token) { throw new Error(`Unknown elevation construction token: ${id}`); }
				references.append(tokenButton({ ...token, id }, id));
			}
			item.append(node('strong', part.title), markup(part.description), references);
			parts.append(item);
		}
		result.append(figure, parts);
	});
	const scenarios = section('scenarios');
	for (const scenario of authored.scenarios) {
		const item = node('section', undefined, 'elevation-scenario');
		item.id = `elevation-${scenario.id}`;
		item.append(node('h3', scenario.title), node('p', scenario.caption, 'elevation-scenario-summary'), markup(scenario.description));
		scenarios.append(item);
	}
	const preference = node('label', undefined, 'elevation-shadow-preference');
	const checkbox = node('input');
	checkbox.type = 'checkbox';
	checkbox.checked = partShadowsOff;
	checkbox.addEventListener('change', () => {
		partShadowsOff = checkbox.checked;
		host.previewState.set('elevation-part-shadows-off', partShadowsOff);
		applyTheme(guide.dataset.previewTheme);
	});
	preference.append(checkbox, document.createTextNode('Turn off part shadows'));
	const shadows = section('shadows', result => {
		const scale = node('div', undefined, 'elevation-shadow-scale');
		for (const role of authored.shadowRoles) {
			const token = system.elevation.cssShadows.find(token => token.css === `--vscode-shadow-${role.id}`);
			if (!token) { throw new Error(`Unknown elevation shadow: ${role.id}`); }
			const figure = node('figure', undefined, 'elevation-shadow-reference');
			figure.dataset.scaleToken = token.css;
			const stage = node('div', undefined, 'elevation-shadow-stage');
			stage.setAttribute('aria-hidden', 'true');
			const sample = node('div', undefined, 'elevation-shadow-sample');
			sample.style.setProperty('--elevation-sample-shadow', `var(${token.css})`);
			stage.append(sample);
			const caption = node('figcaption');
			caption.append(tokenButton({ ...token, id: token.css }), node('code', token.value), markup(role.description));
			figure.append(stage, caption);
			scale.append(figure);
		}
		result.append(preference, scale);
	});
	const role = section('role', result => {
		const figure = node('figure', undefined, 'elevation-hosting');
		const pair = node('div', undefined, 'elevation-hosting-pair');
		for (const hosted of [false, true]) {
			const example = node('div');
			example.append(node('strong', authored.hosting.labels[hosted ? 1 : 0]));
			const stage = node('div', undefined, 'elevation-hosting-stage');
			stage.dataset.hosted = String(hosted);
			stage.setAttribute('aria-hidden', 'true');
			const clip = node('div', undefined, 'elevation-clipping-container');
			clip.append(node('span', authored.hosting.labels[2]), node('code', 'overflow: hidden'));
			const overlay = node('div', authored.hosting.labels[3], 'elevation-hosted-overlay');
			if (hosted) {
				stage.append(clip, overlay);
			} else {
				clip.append(overlay);
				stage.append(clip);
			}
			example.append(stage);
			pair.append(example);
		}
		figure.append(pair, node('figcaption', authored.hosting.caption));
		result.append(figure);
	});
	guide.append(tiers, anatomy, shadows, scenarios, role, section('guidance'));
	applyTheme(selected);
	content.append(guide);
	return guide.children.length;
}
