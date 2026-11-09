/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import { readRepository } from '../adapters/vscode/repository.mjs';
import { listDocuments, listTopics, readDocument, readReference, searchReference, validateReference } from '../runtime/headless.mjs';
import { workspaceRoot } from '../runtime/paths.mjs';
import { canonicalRoot } from '../runtime/store.mjs';
import { ViewStateStorage } from '../runtime/state-storage.mjs';

const args = process.argv.slice(2);
const command = args[0] ?? 'list';
const value = key => { const index = args.indexOf(key); return index < 0 ? undefined : args[index + 1]; };
const root = value('--root') ?? workspaceRoot;
const commandOptions = {
	list: ['--root'],
	read: ['--root', '--topic', '--limit'],
	search: ['--root', '--topics', '--topic', '--query', '--limit'],
	documents: ['--root', '--query', '--scope', '--offset', '--limit'],
	'read-document': ['--root', '--document', '--heading', '--anchor', '--limit'],
	validate: ['--root', '--topics', '--active', '--all', '--compare'],
	serve: ['--root', '--topics', '--active', '--all', '--compare'],
};
if (!Object.hasOwn(commandOptions, command)) { throw new Error('Use list, read, search, documents, read-document, validate or serve'); }
const supplied = new Set();
for (let index = 1; index < args.length; index++) {
	const argument = args[index];
	if (!commandOptions[command].includes(argument) || supplied.has(argument)) { throw new Error(`Unknown or repeated argument for ${command}: ${argument}`); }
	supplied.add(argument);
	if (['--all', '--compare'].includes(argument)) { continue; }
	if (!args[++index] || args[index].startsWith('--')) {
		throw new Error(`Incomplete argument: ${argument}`);
	}
}
if (supplied.has('--topic') && supplied.has('--topics')) { throw new Error('Choose --topic or --topics, not both'); }
if (command === 'list') {
	console.log(JSON.stringify(listTopics(root)));
} else if (command === 'documents') {
	console.log(JSON.stringify(listDocuments(root, {
		query: value('--query') ?? '', scope: value('--scope') ?? '',
		offset: Number(value('--offset') ?? 0), limit: Number(value('--limit') ?? 30),
	})));
} else if (command === 'read-document') {
	console.log(JSON.stringify(readDocument(root, value('--document'), {
		heading: value('--heading'), anchor: value('--anchor'), limit: Number(value('--limit') ?? 12000),
	})));
} else if (command === 'read') {
	console.log(JSON.stringify(await readReference(root, value('--topic') ?? readRepository(root).projection.book.defaultTopic,
		value('--limit') ? { limit: Number(value('--limit')) } : {})));
} else if (command === 'search') {
	console.log(JSON.stringify(await searchReference(root, value('--query'), {
		topics: value('--topics')?.split(',') ?? (value('--topic') ? [value('--topic')] : undefined),
		...(value('--limit') ? { limit: Number(value('--limit')) } : {}),
	})));
} else if (command === 'validate' || command === 'serve') {
	const { validateScope, projection: { book } } = readRepository(root);
	const scope = validateScope({
		operation: args.includes('--all') || value('--topics') === undefined ? 'all' : 'replace',
		topics: value('--topics')?.split(',') ?? [],
		active: value('--active') ?? (value('--topics') === undefined ? book.defaultTopic : undefined), layout: args.includes('--compare') ? 'compare' : 'single',
	});
	if (command === 'validate') {
		const result = await validateReference(root, scope.topics);
		console.log(JSON.stringify({ ...result, scope }));
		if (!result.valid) { process.exitCode = 1; }
	}
	else {
		const { createExplorer } = await import('../runtime/server.mjs');
		const panel = await createExplorer(root, { stateStorage: new ViewStateStorage(canonicalRoot(root)), scope: {
			operation: scope.mode === 'all' ? 'all' : 'replace', topics: scope.topics, active: scope.active, layout: scope.layout,
		} });
		console.log(JSON.stringify({ title: book.title, url: new URL('/', panel.url).href, root: panel.root, scope: panel.state.scope, owner: 'this CLI process', pid: process.pid }));
		for (const signal of ['SIGTERM', 'SIGINT']) {
			process.once(signal, () => { void panel.close().catch(error => { console.error(error); process.exitCode = 1; }); });
		}
	}
} else { throw new Error('Use list, read, search, documents, read-document, validate or serve'); }
