# Share a snapshot release

A snapshot is a frozen, self-contained book with interactive examples. Readers need only a modern browser, not VS Code, Node.js, or a repository checkout. GitHub Releases provides the download; GitHub Pages provides the browsable link.

The prepared product checkout builds the snapshot locally using the existing exporter. GitHub Actions only verifies and deploys the finished release assets, so deployment needs no product build, npm credentials, or extra repository secrets.

For the complete software-and-snapshot workflow, use the repository's [release skill](../.github/skills/release/SKILL.md). Use `snapshot-v<software-version>` for a release companion. After successful deployment, the Action adds its browser link to the matching software release without replacing existing notes; the snapshot's viewer commit must match that release exactly.

## Set up Pages once

1. Commit and push this release tooling and workflow to the viewer repository before publishing a snapshot.
2. In the viewer repository's **Settings → Pages**, select **GitHub Actions** as the build source.
3. Keep the **github-pages** environment's deployment protection rules enabled as appropriate for the team. Permit snapshot tags to deploy if the environment restricts branches and tags.
4. Sign in with `gh auth login` using an account allowed to create releases in that repository.

**Public repositories produce public Pages sites.** A snapshot embeds the discovered source-document library as well as curated chapters. Review the generated HTML before publishing; do not include confidential documents or working changes. Public publication requires `--allow-public`. For access-controlled enterprise hosting, use the separate [private review publisher](private-review.md).

## Build and inspect without publishing

Use the Node.js version and prepared dependencies from the selected VS Code checkout. Releases require the full exploration book at `.github/design-system/book.json`; the viewer's basic source-browsing mode is not a portable book. The viewer can be newer than that checkout; incompatible content fails explicitly rather than falling back to another branch.

From the viewer clone:

```sh
node scripts/release-snapshot.mjs \
  --root /absolute/path/to/vscode-checkout \
  --tag snapshot-2026-11-17 \
  --output /tmp/design-system-snapshot
```

The output directory must be new. This validates every source binding, exports the portable book, and opens every chapter in headless Chromium. Started examples, browser errors, and rendering failures must pass. Sources changing during the build fail the snapshot. It does not test every theme, lazy example, variant, or interaction, and it is not visual approval.

Open `design-system.html` to inspect the result. `snapshot.json` records viewer and content commits, saved working-change flags, the chapter count, and the HTML checksum. Local builds require no GitHub access. Select another branch by passing its local checkout or worktree as `--root`; no branch is fetched or switched automatically.

## Publish a release

Commit and push the validated viewer tooling first. The snapshot must be built from a clean viewer checkout whose base commit exists in the destination repository. Content may include saved, uncommitted exploration changes; these are identified in the snapshot metadata. Source links point to the base content commit and may differ from those changes.

Build and inspect the snapshot with the command above, then publish that exact output:

```sh
node scripts/release-snapshot.mjs \
  --output /tmp/design-system-snapshot \
  --publish --repository chryw/vscode-design-system --allow-public
```

The publisher creates a draft prerelease with `design-system.html` and `snapshot.json`, downloads and verifies both, then publishes it. Snapshot tags are immutable: use a new `snapshot-...` tag for each release. An upload or verification failure leaves the release as a draft; inspect it rather than overwriting its assets.

Publication triggers **Actions → Deploy snapshot releases**. The command reports a pending Pages URL, not a successful deployment. Wait for the workflow and any environment approval, then open the URL before sharing it.

- **Stable release link:** `<Pages URL>/snapshots/<snapshot-tag>/`
- **Newest published snapshot:** the Pages root URL
- **Offline download:** the GitHub Release's `design-system.html` asset

Each deployment rebuilds the site from all published snapshot releases, preserving older versioned URLs. Do not remove or alter their tags or assets while their links are in use. Snapshot prereleases do not replace the viewer's latest software release.

If deployment fails, the previous Pages deployment remains available. Fix the cause and run **Deploy snapshot releases → Run workflow** to retry without creating another release. A missing or checksum-mismatched asset stops deployment rather than silently dropping an older snapshot.

## Test the release tooling

```sh
node --test tests/snapshot-release.test.mjs
```

These tests need only Node.js. The real local build additionally exercises the selected checkout's exporter and Playwright Chromium.
