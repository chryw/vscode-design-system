/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import { createCanvas, CanvasError, joinSession } from '@github/copilot-sdk/extension';
import { createBookRuntime } from './runtime/lifecycle.mjs';
import { listDocuments, listTopics, readDocument, readReference, searchReference } from './runtime/headless.mjs';
import { bookTitle } from './runtime/book.mjs';
import { workspaceRoot } from './runtime/paths.mjs';
import { viewProperties } from './model/view-state.mjs';

const runtime = createBookRuntime(workspaceRoot);
const inputSchema = {
	type: 'object', additionalProperties: false,
	properties: {
		root: { type: 'string', description: 'VS Code checkout path. An instance remains bound to its first canonical checkout.' },
		topics: { type: 'array', items: { type: 'string' }, uniqueItems: true },
		active: { type: 'string' }, layout: { type: 'string', enum: ['single', 'compare'] },
	},
};
const scopeSchema = {
	...inputSchema, properties: {
		topics: inputSchema.properties.topics, active: inputSchema.properties.active, layout: inputSchema.properties.layout,
		operation: { type: 'string', enum: ['replace', 'add', 'all'] },
	},
};
const topicSchema = { type: 'object', additionalProperties: false, properties: { topic: { type: 'string' }, details: { type: 'boolean', default: false } } };
const guarded = handler => async context => {
	try { return await handler(context); }
	catch (error) { if (error instanceof CanvasError) { throw error; } throw new CanvasError(error.code ?? 'DESIGN_SYSTEM_FAILED', error.message); }
};
await joinSession({
	canvases: [createCanvas({
		id: 'vscode-design-system', displayName: bookTitle,
		description: 'Browse source-backed design references, authored specifications and live product examples.',
		inputSchema,
		actions: [
			{ name: 'list_topics', description: 'List compact topic metadata without reading product sources or starting fixtures.', handler: guarded(({ instanceId }) => listTopics(runtime.rootFor(instanceId))) },
			{ name: 'set_scope', description: 'Replace/add selected topics or expose all; comparison takes exactly two topics.', inputSchema: scopeSchema,
				handler: guarded(({ instanceId, input }) => {
					const panel = runtime.required(instanceId);
					panel.setScope(input);
					return { url: panel.url, scope: panel.state.scope };
				}) },
			{ name: 'set_view', description: 'Compatibility navigation: section, control, theme, fixture, filter or anchor.',
				inputSchema: { type: 'object', additionalProperties: false, properties: viewProperties },
				handler: guarded(({ instanceId, input }) => runtime.required(instanceId).setView(input)) },
			{ name: 'inspect_topic', description: 'Return a bounded summary; full topic data only when details is explicitly true.', inputSchema: topicSchema,
				handler: guarded(({ instanceId, input }) => runtime.required(instanceId).inspectTopic(input.topic, input.details)) },
			{ name: 'read_topic', description: 'Read bounded source-backed guidance without rendering a topic or starting fixtures.',
				inputSchema: { type: 'object', additionalProperties: false, required: ['topic'], properties: {
					topic: { type: 'string' }, limit: { type: 'integer', minimum: 100, maximum: 24000, description: 'Character budget for summary, guidance, and serialized definitions; source metadata is additional.' },
				} }, handler: guarded(({ instanceId, input }) => readReference(runtime.rootFor(instanceId), input.topic, input)) },
			{ name: 'list_documents', description: 'Discover or search authored specifications, instructions, workflows and book guidance without rendering fixtures.',
				inputSchema: { type: 'object', additionalProperties: false, properties: {
					query: { type: 'string', maxLength: 200 }, scope: { type: 'string', maxLength: 100 },
					offset: { type: 'integer', minimum: 0, maximum: 1000 }, limit: { type: 'integer', minimum: 1, maximum: 100 },
				} }, handler: guarded(({ instanceId, input }) => listDocuments(runtime.rootFor(instanceId), input)) },
			{ name: 'read_document', description: 'Read a discovered document or named source section with provenance, stable headings and an explicit truncation flag.',
				inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: {
					id: { type: 'string', maxLength: 2048 }, heading: { type: 'string', maxLength: 200 }, anchor: { type: 'string', maxLength: 200 },
					limit: { type: 'integer', minimum: 100, maximum: 24000 },
				} }, handler: guarded(({ instanceId, input }) => readDocument(runtime.rootFor(instanceId), input.id, input)) },
			{ name: 'open_document', description: 'Open a discovered source document in the book while retaining the instance and its navigation.',
				inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: {
					id: { type: 'string', maxLength: 2048 }, anchor: { type: 'string', maxLength: 200 },
				} }, handler: guarded(({ instanceId, input }) => {
					const panel = runtime.required(instanceId);
					panel.setView({ section: 'documentation', documentId: input.id, anchor: input.anchor ?? '' });
					const document = panel.store.documents.read(input.id);
					return { url: panel.url, document: { id: document.id, title: document.title, source: document.source, anchor: input.anchor ?? '' } };
				}) },
			{ name: 'search', description: 'Search bounded source excerpts from selected topics without opening a browser or fixture renderer.',
				inputSchema: { type: 'object', additionalProperties: false, required: ['query'], properties: {
					query: { type: 'string', minLength: 2, maxLength: 200 }, topics: inputSchema.properties.topics,
					limit: { type: 'integer', minimum: 1, maximum: 50 },
				} }, handler: guarded(({ instanceId, input }) => searchReference(runtime.rootFor(instanceId), input.query, input)) },
			{ name: 'inspect_system', description: 'Compatibility receipt: current scope, URL and topic count, not the full source inventory.',
				handler: guarded(({ instanceId }) => {
					const panel = runtime.required(instanceId); return { title: bookTitle, checkout: panel.root, scope: panel.state.scope, url: panel.url, topicCount: panel.store.repository.catalog.filter(item => !item.hidden).length, catalogPath: '/api/catalog' };
				}) },
			{ name: 'refresh_topic', description: 'Reread the selected topic, preserving scope and view state.', inputSchema: topicSchema,
				handler: guarded(({ instanceId, input }) => runtime.required(instanceId).refreshTopic(input.topic)) },
			{ name: 'stop_explorer', description: 'Dispose only this instance runtime, requests and source watches.',
				handler: guarded(({ instanceId }) => runtime.stop(instanceId)) },
		],
		open: guarded(({ instanceId, input }) => runtime.open(instanceId, input)),
		onClose: guarded(({ instanceId }) => runtime.close(instanceId)),
	})],
});
