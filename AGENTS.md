# Agent setup guide

Follow [README.md](README.md) for installation and launch. The [setup reference](docs/setup.md) covers versions, existing checkouts, content validation, troubleshooting, and development checks.

## When asked to install or open the explorer

1. Reuse the requested VS Code checkout. A checkout without `.github/design-system/book.json` supports basic source browsing; the exploration branch enables the full curated book. Never switch or pull a product branch merely to open the viewer.
2. Follow that checkout's instructions for its Node.js and pnpm versions. Restore missing dependencies there and prepare client output for live examples.
3. Prefer native plugin installation and updates; do not clone/reinstall the viewer per worktree. Follow [Keep one current book](docs/setup.md#keep-one-current-book), reusing the existing panel in its owning chat. Use `select_checkout` or the header picker for another checkout. Keep only one active plugin/workspace provider. The workspace-copy installer remains a legacy development route.
4. In the owning chat, invoke a topic action and refresh or reopen the existing instance to verify state preservation. Do not create a canvas for each topic or validation pass.
5. If canvas tools aren't available, use the README's browser route. Verify the printed URL responds and keep the server available for browsing using the host's supported process lifecycle. Give the user its URL and how to stop it.
6. Run the documented content validation command. Inspect an article and scroll a live example into view to verify it renders from the selected checkout.

Finish with the selected checkout, launch URL or canvas instance, and verification results.

## When changing the viewer

Edit the viewer source clone. Guidance, tokens, styles, book metadata, and product fixtures belong in the selected VS Code checkout. Follow the setup reference's development checks and run focused tests for changed behavior. Coordinate the combined update with the existing canvas owner so the one canvas reflects the saved worktree and latest validated viewer, preserving its current topic and view.
