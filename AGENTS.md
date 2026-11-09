# Agent setup guide

Read [README.md](README.md) first. It is the shared installation, browser, canvas, and troubleshooting guide for people and agents. Don't build another launcher, install a Copilot plugin, or create a VSIX to use this repository.

## When asked to install or open the explorer

1. Establish the user's intended workspace and host capabilities. Preserve existing work. Reuse a suitable checkout with `.github/design-system/book.json`, or clone the README's exploration branch into a separate directory. Don't switch a dirty checkout or assume the viewer clone is the content checkout. Use ordinary HTTPS Git; GitHub CLI and sign-in aren't required for cloning these public repositories.
2. Read the selected checkout's own instructions. Use its `.nvmrc` and pinned pnpm version. Check prerequisites before restoring missing dependencies. Don't run a package install in this viewer clone, install `@github/copilot-sdk`, share `node_modules` between checkouts, bypass install scripts, or change credentials/global registry settings. Prepare client output only for live examples when needed.
3. Follow the README's launch route. For SDK canvas support, the chat's workspace must be the prepared VS Code checkout, not this viewer clone. Use the host's supported workspace selection, or explain how to open a session in that checkout. Install into that actual workspace/worktree. Keep the content root explicit; selecting `root` doesn't install the viewer or change discovery. Use `--update` only for an unchanged managed installation that needs updating. Never bypass overwrite protection.
4. Discover available tool schemas rather than guessing arguments. After installing or updating a canvas, reload extension providers, discover `vscode-design-system`, open it with an explicit checkout root and stable instance ID, invoke a topic action, and reopen that same instance to verify state preservation. Report missing host support rather than claiming the canvas opened.
5. If canvas tools aren't available, use the README's ordinary browser route when the user requested launch. Use the host's supported process lifecycle, verify the printed URL responds, and keep the server available for the requested browsing session. Record its owner and how to stop it; stop temporary verification helpers. Don't start duplicate servers or kill unrelated processes. If persistent execution isn't supported, give the terminal command instead of claiming a lasting launch.
6. Validate selected-checkout content with the documented CLI. Inspect an article and, when live examples were requested, scroll a real example into view and verify it renders from that checkout. A topic listing, HTTP 200, build success, or placeholder alone doesn't prove a live example works.

Use the same README commands and troubleshooting for both routes. Missing sources must produce a clear error, not bundled content or a silent fallback. Ask only for a material workspace decision, missing credentials/permissions, or a destructive/shared action; ordinary setup and verification are part of an authorized installation request.

Finish with the selected checkout and revision, launch route, accessible URL or canvas instance, checks performed, and any remaining limitation. Don't claim full OS-profile isolation, visual inspection, or live-fixture success without observing it. A bare repository URL isn't authorization to install code or start processes; clarify the intended action if none was supplied.

## When changing the viewer

Keep viewer/runtime changes here and guidance, tokens, styles, book metadata, and product fixtures in the selected VS Code checkout. Never edit a generated installed copy. Follow the README's development checks, run the smallest tests covering changed behavior, and don't run full suites or product builds for documentation-only changes. Don't commit, push, publish snapshots, or change repository access without authorization.
