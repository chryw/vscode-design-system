/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Source packaging for the no-build canvas. */
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { packageRoot, workspaceRoot } from '../runtime/paths.mjs';
import { TopicStore } from '../runtime/store.mjs';
import { defaultView } from '../runtime/view-state.mjs';

export async function copyReviewSources(destination, root = workspaceRoot) {
	await cp(packageRoot, path.join(destination, 'book'), {
		recursive: true,
		filter: source => {
			const relative = path.relative(packageRoot, source);
			if (!relative) { return true; }
			const parts = relative.split(path.sep);
			if (parts.some(part => ['node_modules', '.git', '.DS_Store'].includes(part))) { return false; }
			return ['adapters', 'docs', 'model', 'runtime', 'scripts', 'tests', 'view'].includes(parts[0])
				|| ['.gitignore', 'README.md', 'extension.mjs', 'package.json'].includes(relative);
		},
	});
	const repositoryRoot = path.join(destination, 'repository');
	await cp(path.join(root, '.github/design-system'), path.join(repositoryRoot, '.github/design-system'), { recursive: true });
	const store = new TopicStore(root);
	try {
		const documents = new Set();
		for (const topic of store.repository.catalog.filter(topic => !topic.hidden)) {
			const result = await store.read(topic.id, defaultView(topic.id, store.repository));
			for (const file of result.sources.filter(file => file.endsWith('.md') && !file.startsWith('.github/design-system/'))) { documents.add(file); }
		}
		for (const file of documents) {
			const target = path.join(repositoryRoot, file);
			await mkdir(path.dirname(target), { recursive: true });
			await cp(store.sourcePath(file), target);
		}
	} finally { store.close(); }
}
