/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { createRequire } from 'node:module';
import path from 'node:path';
import { workspaceRoot } from '../runtime/paths.mjs';

export const { chromium, expect } = createRequire(path.join(workspaceRoot, 'package.json'))('@playwright/test');
