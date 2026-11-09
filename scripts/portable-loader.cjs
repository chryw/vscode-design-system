/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Build-time adapter for the no-build canvas. */
module.exports = function (source) {
	const replace = (before, after) => {
		if (!source.includes(before)) { throw new Error(`Portable export adapter needs updating: ${this.resourcePath}: ${before}`); }
		source = source.replace(before, after);
	};
	if (this.resourcePath.endsWith('/reference.mjs')) {
		const { renderers } = this.getOptions();
		if (!Array.isArray(renderers) || !renderers.length || renderers.some(renderer => !/^topics\/[a-z-]+\.mjs$/.test(renderer))) {
			throw new Error('Portable export requires the validated book renderer modules');
		}
		replace('await import(`./${entry.renderer}`)', `await ({${renderers.map(renderer => `${JSON.stringify(renderer)}: () => import(${JSON.stringify(`./${renderer}`)})`).join(',')}})[entry.renderer]()`);
	}
	if (this.resourcePath.endsWith('/ui.mjs')) {
		replace('const response = await fetch(url, options);', `const response = url.startsWith('/api/fixtures')
			? new Response(JSON.stringify({ ...globalThis.designSnapshot.fixtures, explorerUrl: globalThis.portableFixtureURL() }))
			: await fetch(url, options);`);
		replace('`/source?file=${encodeURIComponent(source.file)}#L${source.line ?? 1}`',
			'`https://github.com/microsoft/vscode/blob/${globalThis.designSnapshot.commit}/${source.file}#L${source.line ?? 1}`');
	}
	if (this.resourcePath.endsWith('/view/components.mjs')) {
		replace('const active = () => !document.hidden', 'const active = () => false && !document.hidden');
		replace(`'Connecting to the live Component Explorer...'`, `'Loading the embedded fixture...'`);
		replace(`'Open in Component Explorer'`, `'Open interactive fixture'`);
		replace('`${previewLabel ?? selected.name} · Live preview`', '`${previewLabel ?? selected.name} · Interactive snapshot`');
		replace('new URL(catalog.explorerUrl).origin);', `(location.protocol === 'file:' ? '*' : location.origin));`);
		replace('event.origin !== new URL(catalog.explorerUrl).origin', `(location.protocol !== 'file:' && event.origin !== new URL(catalog.explorerUrl).origin)`);
		replace('}, event.origin);', `}, location.protocol === 'file:' ? '*' : event.origin);`);
		replace(`url.searchParams.delete('mode');`, '');
	}
	if (this.resourcePath.endsWith('/fileIconThemeData.ts')) {
		replace('return resources.joinPath(iconThemeDocumentLocationDirname, path);',
			`return path.startsWith('data:') ? URI.parse(path) : resources.joinPath(iconThemeDocumentLocationDirname, path);`);
	}
	if (this.resourcePath.endsWith('/fixtureResourceLoader.ts')) {
		replace(`request.open('GET', resource.toString(true), true);`,
			`request.open('GET', globalThis.portableFixtureResources[resource.path.slice(1)] ?? (() => { throw new Error('Resource missing from snapshot: ' + resource.path); })(), true);`);
	}
	if (this.resourcePath.endsWith('/view/motion.mjs')) {
		replace('await loadStyles(content, signal);', '');
	}
	if (this.resourcePath.endsWith('/amdX.ts')) {
		replace('module.createRequire(import.meta.url)', `module.createRequire('file:///snapshot/amdX.js')`);
	}
	source = source.replaceAll('Use Refresh to retry.', 'Reload the page to retry.');
	return source;
};
