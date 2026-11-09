/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import { readMotionDefinitions, readMotionPage } from './motion-source.mjs';
import { analyzeMotionTiming } from './motion-analysis.mjs';
import { readMotionPresetBindings } from './motion-preset-bindings.mjs';
const motionFiles = [
	'src/vs/base/browser/ui/toggle/switch.css',
	'src/vs/base/browser/ui/radio/radio.css',
	'src/vs/base/browser/ui/pixelSpinner/pixelSpinner.css',
	'src/vs/base/browser/ui/hover/hoverWidget.css',
	'src/vs/base/browser/ui/progressbar/progressbar.css',
	'src/vs/base/browser/ui/findinput/findInput.css',
	'src/vs/platform/actionWidget/browser/actionWidget.css',
	'src/vs/workbench/contrib/chat/browser/widget/chatContentParts/media/chatCollapsibleContentPart.css',
	'src/vs/workbench/contrib/chat/browser/widget/chatContentParts/media/chatConfirmationWidget.css',
	'src/vs/workbench/contrib/chat/browser/widget/media/chatWorkingLogo.css',
	'src/vs/platform/quickinput/browser/media/quickInput.css',
	'src/vs/base/browser/ui/scrollbar/media/scrollbars.css',
	'src/vs/workbench/browser/parts/notifications/media/notificationsToasts.css',
];

export function load(context){
	const { read, source } = context;
	read('src/vs/workbench/test/browser/componentFixtures/motion.fixture.ts');
	read('src/vs/workbench/contrib/chat/browser/widget/chatWorkingLogo.ts');
	read('src/vs/base/browser/ui/animations/animations.ts');
	const motion = motionFiles.map(file => {
		const text = read(file);
		return {
			file,
			declarations: [...text.matchAll(/^[ \t]*(?<property>transition(?:-[\w-]+)?|animation(?:-[\w-]+)?):[ \t]*(?<value>[^;]+);/gm)]
				.map(match => ({ ...match.groups, source: source(file, match.index) })),
			reducedMotion: text.includes('prefers-reduced-motion') ? 'Media query' : text.includes('monaco-reduce-motion') ? 'Workbench class' : 'No local opt-out found; inspect the caller',
		};
	});
	const definitions = readMotionDefinitions(context);
	const presetBindings = readMotionPresetBindings(context, definitions);
	const bindingIds = presetBindings.status === 'defined' ? presetBindings.bindings.map(binding => binding.id) : undefined;
	const motionDocumentation = {
		...definitions, ...readMotionPage(context, definitions, bindingIds), ...presetBindings, status: definitions.status,
	};
	motionDocumentation.analyses = definitions.status !== 'defined' ? [] : (motionDocumentation.page.analyses ?? []).map(binding => {
		const recipe = definitions.recipes.find(recipe => recipe.id === binding.recipeId);
		if (!recipe) { throw new Error(`Missing analyzed recipe: ${binding.recipeId}`); }
		const tracks = recipe.tracks.length ? recipe.tracks.filter(track => track.property !== 'visibility') : ['opacity', 'transform']
			.filter(property => recipe.frames.some(frame => property === 'opacity' ? frame.opacity !== undefined
				: frame.scale !== undefined || frame.distance !== undefined || frame.angle !== undefined))
			.map(property => ({
				property, duration: recipe.duration, easing: recipe.easing, durationToken: recipe.durationToken, easingToken: recipe.easingToken,
			}));
		if (!tracks.length) { throw new Error(`No continuous tracks to analyze: ${recipe.id}`); }
		const groups = Map.groupBy(tracks, track => JSON.stringify([track.durationToken, track.easingToken, track.delay ?? 0]));
		return {
			id: recipe.id, entryId: binding.id, source: recipe.source,
			tracks: [...groups.values()].map(group => ({
				properties: group.map(track => track.property), durationToken: group[0].durationToken, easingToken: group[0].easingToken,
				delay: group[0].delay ?? 0,
				analysis: analyzeMotionTiming(group[0].duration, group[0].easing),
			})),
		};
	});
	return {
		motion,
		motionDocumentation,
		page: {
			id: 'motion',
			sections: motionDocumentation.page.sections.map(({ id, heading, title }) => ({
				id: `motion-${id}`,
				title: title ?? motionDocumentation.sections[heading].title,
			})),
		},
	};
}
