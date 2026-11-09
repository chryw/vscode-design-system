/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- No-build canvas runtime. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { validateBook as validateCatalogBook } from '../model/catalog.mjs';
import { contained, workspaceRoot } from './paths.mjs';

export const bookTitle = 'Visual Studio Code Design System';
export const bookId = 'vscode-design-system';
export function validateBook(book) {
	if (!book || book.version !== 1 || book.id !== bookId || book.title !== bookTitle
		|| !Array.isArray(book.topics) || !book.topics.length || book.topics.length > 200) {
		throw new Error('Invalid Visual Studio Code Design System manifest or unsupported version');
	}
	for (const topic of validateCatalogBook(book)) {
		if (topic.id.length > 100 || topic.title.length > 200 || topic.aliases.length > 100
			|| topic.aliases.some(alias => alias.length > 200)
			|| new Set(topic.aliases).size !== topic.aliases.length
			|| !/^[a-z][a-z0-9-]*$/.test(topic.section)) {
			throw new Error(`Invalid book topic: ${topic.id}`);
		}
	}
	return book;
}

export function readBook(root = path.join(workspaceRoot, '.github/design-system')) {
	const file = contained(root, 'book.json');
	if (statSync(file).size > 1024 * 1024) { throw new Error('Book manifest is too large'); }
	try { return validateBook(JSON.parse(readFileSync(file, 'utf8'))); }
	catch (error) { throw new Error(`Couldn't read book.json: ${error.message}`); }
}

export function contentAssets(root = path.join(workspaceRoot, '.github/design-system')) {
	const files = new Set();
	const collect = relative => {
		let entries;
		try { entries = readdirSync(contained(root, relative), { withFileTypes: true }); }
		catch (error) { if (error.code === 'ENOENT') { return; } throw error; }
		for (const entry of entries) {
			const file = `${relative}/${entry.name}`;
			if (entry.isDirectory()) { collect(file); }
			else if (entry.isFile() && /\.(?:json|md)$/.test(entry.name)) {
				contained(root, file);
				files.add(file);
				if (files.size > 1000) { throw new Error('Too many book content files'); }
			}
		}
	};
	collect('content');
	collect('pages');
	return files;
}
