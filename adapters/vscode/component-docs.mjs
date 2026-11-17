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
		const ast = ts.createSourceFile(path.resolve(root, file), text, ts.ScriptTarget.Latest, true);
		if (ast.parseDiagnostics.length) { throw new Error(`Cannot parse component API source: ${file}`); }
		return { file, text, ast };
	});
	const declarations = files.flatMap(source => source.ast.statements
		.filter(node => (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name)
		.map(declaration => ({ ...source, declaration })));
	const exported = declaration => declaration.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
	const named = (name, publicOnly) => declarations.filter(({ declaration }) =>
		declaration.name.text === name && (!publicOnly || exported(declaration)));
	const members = (source, name, visited = new Set()) => {
		if (visited.has(source.declaration)) { throw new Error(`Cyclic component API inheritance: ${control.id}`); }
		const own = source.declaration.members.filter(member => name === 'constructor' ? ts.isConstructorDeclaration(member)
			: member.name && ts.isIdentifier(member.name) && member.name.text === name);
		if (own.length) { return own.map(member => ({ ...source, member })); }
		const bases = source.declaration.heritageClauses?.flatMap(clause => clause.types) ?? [];
		return bases.flatMap(base => {
			const targets = named(base.expression.getText(source.ast), false);
			if (targets.length !== 1) {
				throw new Error(`Expected one public component API member ${source.declaration.name.text}.${name}; list inherited ${base.expression.getText(source.ast)} in relatedOwners`);
			}
			return members(targets[0], name, new Set([...visited, source.declaration]));
		});
	};
	let checker;
	const inferredType = (member, ast) => {
		if (!checker) {
			const options = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext,
				moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, noEmit: true, skipLibCheck: true };
			const host = ts.createCompilerHost(options);
			const compilerRead = host.readFile;
			host.readFile = file => {
				const relative = path.relative(root, file).split(path.sep).join('/');
				return relative.startsWith('src/') && file.endsWith('.ts') ? read(relative) : compilerRead(file);
			};
			host.getSourceFile = (file, languageVersion) => {
				const existing = files.find(source => source.ast.fileName === file);
				if (existing) { return existing.ast; }
				const text = host.readFile(file);
				return text === undefined ? undefined : ts.createSourceFile(file, text, languageVersion, true);
			};
			checker = ts.createProgram(files.map(source => source.ast.fileName), options, host).getTypeChecker();
		}
		const signature = ts.isFunctionDeclaration(member) || ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member)
			? checker.getSignatureFromDeclaration(member) : undefined;
		const type = signature ? checker.getReturnTypeOfSignature(signature) : checker.getTypeAtLocation(member);
		if (type.flags & ts.TypeFlags.Any) { throw new Error(`Component API ${member.name?.getText(ast)} needs an explicit declared type or resolvable source type`); }
		return checker.typeToString(type, member, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope);
	};
	return control.api.map(selector => {
		const [symbol, name] = selector.split('.');
		const targets = named(symbol, true);
		if (targets.length !== 1) { throw new Error(`Expected one public component API member ${selector}; found ${targets.length}`); }
		const target = targets[0];
		const matches = name && !ts.isFunctionDeclaration(target.declaration) ? members(target, name) : !name && ts.isFunctionDeclaration(target.declaration)
			? [{ ...target, member: target.declaration }] : [];
		const accessors = matches.length === 2
			&& matches.filter(({ member }) => ts.isGetAccessorDeclaration(member)).length === 1
			&& matches.filter(({ member }) => ts.isSetAccessorDeclaration(member)).length === 1;
		if (!matches.length || matches.length > 1 && !accessors) {
			throw new Error(`Expected one public component API member ${selector}; found ${matches.length}`);
		}
		if (matches.some(({ member }) => member.modifiers?.some(modifier => [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword].includes(modifier.kind))
			|| !(ts.isPropertySignature(member) || ts.isPropertyDeclaration(member) || ts.isMethodSignature(member)
				|| ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member) || ts.isFunctionDeclaration(member)
				|| ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)))) {
			throw new Error(`Unsupported public component API declaration: ${selector}`);
		}
		const selected = matches;
		const { file, ast, declaration, member } = selected.find(({ member }) => ts.isGetAccessorDeclaration(member)) ?? selected[0];
		const type = ts.isSetAccessorDeclaration(member) ? member.parameters[0]?.type : member.type;
		const start = member.getStart(ast);
		const parameters = ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member) || ts.isFunctionDeclaration(member)
			? `(${member.parameters.map(parameter => parameter.name.getText(ast)).join(', ')})` : '';
		const description = (member.jsDoc ?? []).map(doc => ts.getTextOfJSDocComment(doc.comment)).filter(Boolean).join('\n');
		return {
			name: ts.isClassDeclaration(declaration) || ts.isFunctionDeclaration(declaration) ? `${selector}${parameters}` : name,
			type: ts.isConstructorDeclaration(member) ? target.declaration.name.text : type?.getText(ast) ?? inferredType(member, ast),
			optional: Boolean(member.questionToken),
			declaration: selected.map(({ text, ast, member }) =>
				`${text.slice(member.getStart(ast), member.body?.getStart(ast) ?? member.end).trim().replace(/;$/, '')};`).join('\n'),
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
