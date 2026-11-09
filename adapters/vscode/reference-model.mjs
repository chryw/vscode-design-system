/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
export function createReferenceModel(system, selected) {
	const { structures: pageStructures, capabilities: expectedCapabilities } = system.referenceExpectations;
	const documents = Object.values(system.documents).flat();
	const document = file => {
		const result = documents.find(item => item.file === file);
		if (!result || typeof result.text !== 'string') {
			throw new Error(`Reference assessment needs the covered source ${file}`);
		}
		return result;
	};
	const lazyDocument = file => ({ get file() { return document(file).file; }, get text() { return document(file).text; } });
	const philosophy = lazyDocument('.github/skills/design-philosophy/SKILL.md');
	const sizing = lazyDocument('.github/instructions/design-tokens.instructions.md');
	const layout = lazyDocument('.github/skills/ux-css-layout/SKILL.md');
	const theming = lazyDocument('.github/skills/ux-theming/SKILL.md');
	const base = 'src/vs/platform/theme/common/sizes/baseSizes.ts';
	const style = 'src/vs/workbench/browser/media/style.css';
	const geometrySources = [...new Set((system.geometry?.recipes ?? []).flatMap(recipe => [
		...recipe.rules.map(rule => rule.source.file), ...(recipe.sources ?? []).map(source => source.file),
	]))];
	const coveredSizes = system.sizes.filter(token => token.source.file === base && !token.deprecated);
	const hasSize = pattern => coveredSizes.some(token => pattern.test(token.id));
	const topics = {
		principles: ({ documented, unassessed }) => [
			documented('Design principles', philosophy.file),
			unassessed('Application across the product', [philosophy.file]),
		],
		typography: ({ registered, assessment, gap }) => [
			registered('UI role scale'),
			assessment('Font families', 'implementation-only', [style]),
			hasSize(/lineHeight|letterSpacing/) ? registered('Role-specific line height and tracking')
				: gap('Role-specific line height and tracking', base),
		],
		spacing: ({ registered, assessment, gap }) => [
			registered('Spacing scale'),
			assessment('Product spacing patterns', 'implementation-only',
				[...new Set((system.spacing?.patterns ?? []).flatMap(pattern => pattern.rules.map(rule => rule.source.file)))]),
			hasSize(/^spacing\.(?!size)/) ? registered('Named semantic spacing roles')
				: gap('Named semantic spacing roles', base),
		],
		shape: ({ registered, documented }) => [
			registered('Radius scale'),
			documented('Surface-role guidance', philosophy.file, sizing.file),
		],
		size: ({ registered, gap, assessment, unassessed }) => [
			registered('Icon dimensions'),
			hasSize(/controlHeight|hitTarget|hitArea|density/) ? registered('Control height, density and hit-area scales')
				: gap('Control height, density and hit-area scales', base),
			geometrySources.length ? assessment('Product control geometry', 'implementation-only', geometrySources)
				: unassessed('Product control geometry', [base]),
		],
		stroke: ({ registered, assessment, unassessed }) => [
			registered('Registered stroke'),
			geometrySources.length || system.geometry?.scrollbar
				? assessment('Boundary and scrollbar recipes', 'implementation-only',
					[...geometrySources, ...(system.geometry?.scrollbar ? [
						system.geometry.scrollbar.track.source.file, system.geometry.scrollbar.thumb.source.file,
						...system.geometry.scrollbar.rules.map(rule => rule.source.file),
					] : [])])
				: unassessed('Boundary and scrollbar recipes', [base]),
		],
		colors: ({ documented, unassessed }) => [
			documented('Semantic color roles', theming.file),
			unassessed('Runtime color-default coverage', system.chain, system.colorRegistryCoverage ? 'present' : 'absent'),
		],
		theming: ({ documented }) => [
			documented('Theme mappings', ...system.themes.map(theme => theme.file)),
			documented('High-contrast guidance', theming.file),
		],
		iconography: ({ assessment, documented }) => [
			assessment('Glyph catalog', 'source-defined', ['src/vs/base/common/codiconsLibrary.ts']),
			documented('Glyph sizing and naming guidance', philosophy.file, sizing.file),
		],
		motion: ({ documented, gap, assessment }) => [
			documented('Motion intent', philosophy.file),
			system.motionDocumentation?.status === 'defined'
				? documented('Named timing and easing system', ...system.motionDocumentation.scope)
				: gap('Named timing and easing system', ...(system.motionDocumentation?.scope ?? [base])),
			assessment('Current implementation examples', 'implementation-only', system.motion.map(item => item.file)),
		],
		layout: ({ documented, gap }) => [
			documented('Constraint-based layout guidance', layout.file),
			gap('Named composition recipes', layout.file),
		],
		elevation: ({ assessment, gap }) => [
			assessment('Shadow definitions', 'source-defined', [style]),
			gap('Shadow-tier usage guidance', theming.file),
			assessment('Product usage', system.elevation.shadowUsage.length ? 'implementation-only' : 'not-assessed',
				['src/vs/workbench/browser/parts/notifications/media/notificationsToasts.css'], system.elevation.shadowUsage.length ? 'present' : 'absent'),
		],
	};
	const assessments = (selected ?? Object.keys(topics)).map(id => {
		const assessment = (expected, status, scope, variant = status) => {
			const summary = system.referenceNotes?.[id]?.[expected]?.[variant];
			if (typeof summary !== 'string' || !summary) { throw new Error(`Missing source coverage note: ${id}, ${expected}, ${variant}`); }
			if (!scope.length || ['source-defined', 'implementation-only'].includes(status) && scope.some(file => !system.sourceFiles.includes(file))) {
				throw new Error(`Reference assessment needs the covered source ${scope.find(file => !system.sourceFiles.includes(file)) ?? expected}`);
			}
			return { expected, status, summary, scope };
		};
		return [id, topics[id]({
			assessment,
			registered: expected => assessment(expected, 'source-defined', [base]),
			documented: (expected, ...files) => assessment(expected, 'source-defined', files),
			gap: (expected, ...files) => assessment(expected, 'not-defined-in-covered-sources', files),
			unassessed: (expected, files, variant) => assessment(expected, 'not-assessed', files, variant),
		})];
	});
	return {
		expected: expectedCapabilities,
		structure: pageStructures,
		topics: Object.fromEntries(assessments),
		scales: {
			typeRoles: system.typography.tokens.filter(token => !token.deprecated && token.id.startsWith('fontSize.')),
			weights: system.typography.tokens.filter(token => !token.deprecated && token.id.startsWith('fontWeight.')),
			readingMetrics: coveredSizes.filter(token => /lineHeight|letterSpacing/.test(token.id)),
			componentSizes: coveredSizes.filter(token => /controlHeight|hitTarget|hitArea|density/.test(token.id)),
			spacing: coveredSizes.filter(token => token.category === 'spacing'),
			radii: coveredSizes.filter(token => token.id.startsWith('cornerRadius.')).sort((a, b) => Number.parseInt(a.value) - Number.parseInt(b.value)),
			shadows: system.elevation.cssShadows,
		},
	};
}
