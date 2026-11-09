/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Source-backed examples are shared by the book and its validation. */

export function motionSection(model, heading) {
	const section = model.sections?.[heading];
	if (!section) { throw new Error(`Missing motion guidance: ${heading}`); }
	return section;
}

export function motionExample(model, id) {
	const example = model.page.examples.find(example => example.id === id);
	if (!example) { throw new Error(`Missing motion example binding: ${id}`); }
	const section = motionSection(model, example.heading);
	return { ...example, title: example.title ?? section.title, usageMarkdown: example.description ?? (example.caption ? undefined : section.markdown) };
}

export function motionRecipeExamples(model) {
	return model.page.recipes.map(recipe => {
		const section = motionSection(model, recipe.heading);
		const reference = motionSection(model, recipe.reference);
		return {
			...recipe, title: recipe.title ?? section.title, markdown: recipe.description ?? section.markdown,
			lifecycle: reference.markdown.replace(/```css\n[\s\S]*?\n```/, '').trim(),
			code: reference.markdown.match(/```css\n(?<code>[\s\S]*?)\n```/)?.groups.code,
			source: reference.source,
		};
	});
}
