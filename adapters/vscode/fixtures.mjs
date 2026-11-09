/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { curateFixtures } from '../../model/components.mjs';

const runFile = promisify(execFile);

function readResult(result) {
	const text = result.content?.filter(item => item.type === 'text').map(item => item.text) ?? [];
	if (result.isError) {
		throw new Error(text.join('\n') || 'Component Explorer could not load its catalog');
	}
	if (text.length !== 1) {
		throw new Error(`Component Explorer reported an incomplete catalog: ${text.join('\n')}`);
	}
	return JSON.parse(text[0]);
}

export function selectFixtureSession(sessions, explorerUrl) {
	if (!Array.isArray(sessions)) {
		throw new Error('Component Explorer returned invalid session metadata');
	}
	const available = sessions.filter(item => typeof item.name === 'string' && typeof item.serverUrl === 'string');
	const session = explorerUrl
		? available.find(item => new URL(item.serverUrl).origin === new URL(explorerUrl).origin)
		: available.find(item => item.name === 'current') ?? (available.length === 1 ? available[0] : undefined);
	if (!session) {
		throw new Error(explorerUrl
			? 'This URL does not match a running Component Explorer session for this checkout'
			: 'No unambiguous current Component Explorer session is available. Check this checkout’s Component Explorer configuration, then reconnect.');
	}
	const url = new URL('/___explorer', session.serverUrl);
	if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.username || url.password) {
		throw new Error('The fixture renderer must use a loopback HTTP address without credentials.');
	}
	return { session, explorerUrl: url.href };
}

export async function loadFixtureCatalog(root, explorerUrl, signal, afterSourceTreeId, repository) {
	const { controls, motionControls } = repository;
	if (!existsSync(path.join(root, 'node_modules/@vscode/component-explorer-cli/dist/index.js'))) {
		throw new Error('This checkout has no Component Explorer CLI dependency. Restore its independent repository dependencies, then reconnect. The renderer starts automatically.');
	}
	const require = createRequire(path.join(root, 'package.json'));
	let Client;
	let StdioClientTransport;
	try {
		({ Client } = require('@modelcontextprotocol/sdk/client/index.js'));
		({ StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js'));
	} catch (error) {
		throw new Error(`Fixture discovery needs the repository's MCP SDK dependency: ${error.message}`);
	}
	const command = process.versions.electron ? 'node' : process.execPath;
	const cli = path.join(root, 'node_modules/@vscode/component-explorer-cli/dist/index.js');
	const project = path.join(root, 'test/componentFixtures/component-explorer.json');
	const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined));
	// Background startup is idempotent; disabling the shared redirect port lets other checkouts coexist.
	await runFile(command, [cli, 'serve', '--project', project, '--background', '--redirectionPort', '0'], {
		cwd: root, env, timeout: 45000, signal, windowsHide: true,
	});
	const transport = new StdioClientTransport({
		command,
		args: [cli, 'mcp', '--project', project, '--use-daemon', '--no-daemon-autostart', '--call-timeout', '60'],
		cwd: root,
		env,
		stderr: 'pipe',
	});
	const client = new Client({ name: 'vscode-design-system', version: '1.0.0' });
	transport.stderr?.resume();
	try {
		await client.connect(transport, { timeout: 15000, signal });
		let sessions = readResult(await client.callTool({ name: 'sessions', arguments: {} }, undefined, { timeout: 90000, signal }));
		let selected = selectFixtureSession(sessions, explorerUrl);
		const updateDeadline = Date.now() + 30000;
		let waits = 0;
		while (afterSourceTreeId && selected.session.sourceTreeId === afterSourceTreeId) {
			const update = await client.callTool({ name: 'wait_for_update', arguments: {
				sessionName: selected.session.name, sourceTreeId: afterSourceTreeId,
			} }, undefined, { timeout: Math.max(1, updateDeadline - Date.now()), signal });
			if (update.isError) {
				throw new Error(update.content?.filter(item => item.type === 'text').map(item => item.text).join('\n') || 'Component Explorer could not publish the saved update');
			}
			sessions = readResult(await client.callTool({ name: 'sessions', arguments: {} }, undefined, { timeout: Math.max(1, updateDeadline - Date.now()), signal }));
			selected = selectFixtureSession(sessions, explorerUrl);
			if (selected.session.sourceTreeId === afterSourceTreeId) {
				const text = update.content?.find(item => item.type === 'text')?.text.trimStart();
				const timedOut = text?.startsWith('{') && readResult(update).timeout === true;
				if (!timedOut || ++waits >= 6 || Date.now() >= updateDeadline) {
					throw new Error('Component Explorer did not publish the saved fixture change');
				}
			}
		}
		const { session } = selected;
		if (session.name !== 'current') {
			throw new Error('Only this checkout’s current Component Explorer session can be embedded. Other worktree sessions are not used.');
		}
		const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const inventory = [...controls, ...motionControls];
		const groups = inventory.flatMap(control => control.groups);
		const fixtures = readResult(await client.callTool({
			name: 'list_fixtures',
			arguments: { sessionName: session.name, fixtureIdRegex: `^(?:${groups.map(escape).join('|')})/` },
		}, undefined, { timeout: 90000, signal }));
		return { controls: curateFixtures(fixtures, inventory), session: session.name, explorerUrl: selected.explorerUrl, sourceTreeId: session.sourceTreeId, checkoutPath: root };
	} finally {
		try {
			await client.close();
		} finally {
			await transport.close();
		}
	}
}
