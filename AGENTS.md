# Agent guide

## Open the book

1. Follow the [quick start](README.md#quick-start). Check existing plugin registrations before installing. Use the session's VS Code worktree by default. If it lacks the requested content, reuse a matching worktree or [prepare a separate checkout](docs/setup.md#prepare-the-exploration-checkout).
2. Discover `vscode-design-system` and open `design-book` with empty input when the session is in the intended worktree. If the session is outside that worktree, pass the checkout as `root`. Reuse the existing panel and follow any worktree rule that assigns an owning chat. Use `select_checkout` to change the checkout of an open panel.
3. Confirm the canvas uses the installed plugin and the intended checkout. Open the requested topic or a foundation. Follow the [API and example prerequisites](docs/setup.md#component-apis-and-live-examples) only when needed. Use the [browser viewer](docs/setup.md#local-browser) when canvas tools are unavailable.

## Make changes

Use the `design-system` skill from `microsoft/vscode` to update the owning guidance in the VS Code checkout. Edit viewer code in this repository. For canvas UI changes, follow [Canvas UI consistency](.github/instructions/canvas-ui.instructions.md). See [development commands](docs/setup.md#development) for preview and validation.
