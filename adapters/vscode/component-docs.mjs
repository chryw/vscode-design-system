/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import { createRequire } from 'node:module';
import path from 'node:path';
import { documentSection, parseDocument } from '../../model/documents.mjs';

export function validateControlDocumentation(input, id) {
	if (input?.version !== 1 || input.id !== id || typeof input.className !== 'string'
		|| typeof input.summary !== 'string' || typeof input.preview !== 'string'
		|| ![input.usage, input.accessibility].every(items => Array.isArray(items) && items.length && items.every(item => typeof item === 'string'))
		|| !Array.isArray(input.api) || !input.api.length || input.api.some(member =>
			!Array.isArray(member) || member.length < 4 || member.length > 5 || member.some(value => typeof value !== 'string' || !value))
		|| input.apiStart !== undefined && typeof input.apiStart !== 'string') {
		throw new Error(`Invalid component documentation: ${id}`);
	}
	const { version, id: identity, ...documentation } = input;
	return documentation;
}

export function describeControl(control, input) {
	if (control.content === 'tbd') {
		return { ...control, docs: { summary: control.reason } };
	}
	const documentation = validateControlDocumentation(input, control.id);
	return { ...control, docs: documentation };
}

function sourceApi(control, read, root) {
	if (typeof root !== 'string' || !root) { throw new Error('Component API extraction requires the selected checkout root'); }
	const ts = createRequire(path.join(root, 'package.json'))('typescript');
	const files = [control.owner, ...(control.relatedOwners ?? [])].map(file => {
		const text = read(file);
		const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
		if (ast.parseDiagnostics.length) { throw new Error(`Cannot parse component API source: ${file}`); }
		return { file, text, ast };
	});
	return control.api.map(selector => {
		const [symbol, name] = selector.split('.');
		const matches = [];
		for (const source of files) {
			for (const declaration of source.ast.statements) {
				if (!(ts.isClassDeclaration(declaration) || ts.isInterfaceDeclaration(declaration))
					|| declaration.name?.text !== symbol
					|| !declaration.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) { continue; }
				for (const member of declaration.members) {
					if (member.name && ts.isIdentifier(member.name) && member.name.text === name) {
						matches.push({ ...source, declaration, member });
					}
				}
			}
		}
		if (matches.length !== 1) { throw new Error(`Expected one public component API member ${selector}; found ${matches.length}`); }
		const { file, text, ast, declaration, member } = matches[0];
		if (member.modifiers?.some(modifier => [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword].includes(modifier.kind))
			|| !(ts.isPropertySignature(member) || ts.isMethodSignature(member) || ts.isMethodDeclaration(member)
				|| ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member))) {
			throw new Error(`Unsupported public component API declaration: ${selector}`);
		}
		const type = ts.isSetAccessorDeclaration(member) ? member.parameters[0]?.type : member.type;
		if (!type) { throw new Error(`Component API ${selector} needs an explicit declared type`); }
		const start = member.getStart(ast);
		const parameters = ts.isMethodDeclaration(member) ? `(${member.parameters.map(parameter => parameter.name.getText(ast)).join(', ')})` : '';
		const description = (member.jsDoc ?? []).map(doc => ts.getTextOfJSDocComment(doc.comment)).filter(Boolean).join('\n');
		return {
			name: ts.isClassDeclaration(declaration) ? `${selector}${parameters}` : name,
			type: type.getText(ast),
			optional: Boolean(member.questionToken),
			declaration: `${text.slice(start, member.body?.getStart(ast) ?? member.end).trim().replace(/;$/, '')};`,
			...(description ? { description } : {}),
			symbol: selector,
			source: { file, line: ast.getLineAndCharacterOfPosition(start).line + 1 },
		};
	});
}

function designControl(control, read, root) {
	const design = parseDocument(read(control.design), { id: control.design, origin: 'product' });
	const section = heading => {
		const result = documentSection(design, { heading });
		if (!result.markdown) { throw new Error(`Empty component design section ${heading}: ${control.design}`); }
		return result.markdown;
	};
	const notes = heading => section(heading).split(/^- /m).map(text => text.trim()).filter(Boolean);
	return {
		...control,
		docs: {
			className: design.title,
			summary: section('Overview'),
			usage: notes('Usage'),
			accessibility: notes('Accessibility'),
			preview: section('Preview'),
			design,
			apiSource: 'typescript',
			api: sourceApi(control, read, root),
		},
	};
}

export function documentControl(control, read, input, root) {
	if (control.content === 'ready' && control.design) { return designControl(control, read, root); }
	const { docs: documentation } = describeControl(control, input);
	for (const file of control.relatedOwners ?? []) { read(file); }
	if (control.content === 'tbd') {
		if (control.owner) { read(control.owner); }
		if (control.evidence) { read(control.evidence); }
		return { ...control, docs: documentation };
	}
	const lines = read(control.owner).split('\n');
	const start = documentation.apiStart ? lines.findIndex(line => line.includes(documentation.apiStart)) : 0;
	if (start < 0) {
		throw new Error(`Component documentation source changed: ${control.name}`);
	}
	return {
		...control,
		docs: {
			...documentation,
			api: documentation.api.map(([name, type, description, anchor, file = control.owner]) => {
				if (![control.owner, ...(control.relatedOwners ?? [])].includes(file)) {
					throw new Error(`Component API source is not an owner: ${control.name}, ${file}`);
				}
				const sourceLines = file === control.owner ? lines : read(file).split('\n');
				const index = sourceLines.findIndex((line, index) => index >= (file === control.owner ? start : 0) && line.includes(anchor));
				if (index < 0) {
					throw new Error(`Component documentation source changed: ${control.name}, ${name}`);
				}
				return { name, type, description, source: { file, line: index + 1 } };
			}),
		},
	};
}
