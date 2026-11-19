# Agent setup guide

Follow [README.md](README.md) for installation and launch. The [setup reference](docs/setup.md) covers versions, existing checkouts, content validation, troubleshooting, and development checks.

## When asked to install or open the explorer

1. Reuse the requested VS Code checkout. A checkout without `.github/design-system/topics.json` supports basic source browsing; the exploration branch enables the full curated book. Never switch or pull a product branch merely to open the viewer.
2. Follow that checkout's instructions for its Node.js and pnpm versions. Basic source browsing needs no product dependencies or build. For curated readers or live examples, restore dependencies only when required and missing; prepare client output for live examples.
3. Prefer native plugin installation and updates; do not clone/reinstall the viewer per worktree. Follow [Keep one current book](docs/setup.md#keep-one-current-book), reusing `design-book` within the current chat or opening it here when this chat has no panel. Panels are chat-scoped: an old chat's panel or migration blocker must not prevent opening the plugin in another session. Use `select_checkout` or the header picker for another checkout. Keep only one active plugin/workspace provider. The workspace-copy installer remains a legacy development route.
4. Inspect the loaded extension source, not just the installed-plugin list. Native installation must activate `plugin:vscode-design-system:vscode-design-system`, not the legacy `project:vscode-design-system`. In the current chat, invoke a topic action and refresh or reopen the same instance to verify state preservation. If its ID belongs to an old provider, use supported **Close Canvas** before rebinding in that chat, or open in a session without that legacy binding. If reload retains old discovery, use the client's supported customization refresh or a new supported session; report any remaining activation gap and preserve the old copy. Do not create numbered replacements or a canvas for each topic or validation pass.
5. If canvas tools aren't available, use the README's browser route. Verify the printed URL responds and keep the server available for browsing using the host's supported process lifecycle. Give the user its URL and how to stop it.
6. Verify the header's selected checkout and open a source-library document. For a curated checkout, also run the documented content validation command and inspect an article. If live examples were prepared, scroll one into view and verify it renders. Missing curated guidance is expected in basic mode; do not treat it as a failed installation.

Finish with the selected checkout, launch URL or canvas instance, and verification results.

## When changing the viewer

Edit the viewer source clone. Guidance, tokens, styles, book metadata, and product fixtures belong in the selected VS Code checkout. Follow the setup reference's development checks and run focused tests for changed behavior. Coordinate shared source edits and provider reloads with active contributors. Refresh or reopen the current chat's panel against the saved worktree, preserving its topic and view; opening it does not require another chat to act.
