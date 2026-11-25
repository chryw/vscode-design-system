# Agent guide

## Open the book

1. Follow the [quick start](README.md#quick-start) from a VS Code session with its normal dependencies installed; the source readers use that session's tooling. Check existing plugin registrations before installing. The reference currently targets the docs-only PR branch `chryw/design-system-docs-pr` in `microsoft/vscode`, unless the user requests another source.
2. Discover `vscode-design-system` and open `design-book` with `version: { kind: "shared", branch: "https://github.com/microsoft/vscode/tree/chryw/design-system-docs-pr" }`. Reuse the existing panel through its owning chat and follow any worktree ownership rule; use `select_content_version` to change its source. Never switch the user's Git branch or create a duplicate to bypass an unavailable owner.
3. Confirm the canvas uses the installed plugin and the intended checkout. Open the requested topic or a foundation. Follow the [API and example prerequisites](docs/setup.md#component-apis-and-live-examples) only when needed. Use the [browser viewer](docs/setup.md#local-browser) when canvas tools are unavailable.

For local authoring or live examples, reuse a matching docs checkout or [prepare one separately](docs/setup.md#prepare-the-docs-only-checkout), then select it with `select_checkout`. Empty input still follows the session worktree by default; it does not implicitly select the docs PR.

## Make changes

Use the `design-system` skill from `microsoft/vscode` to update the owning guidance in the VS Code checkout. Edit viewer code in this repository. For canvas UI changes, follow [Canvas UI consistency](.github/instructions/canvas-ui.instructions.md). See [development commands](docs/setup.md#development) for preview and validation.
