---
name: release
description: Release the design-system plugin and its matching browser snapshot, validate both, publish signed revisions, and verify GitHub Pages delivery.
---

# Release the viewer and browser snapshot

Use the existing native plugin and snapshot tooling as one release workflow. An authorized "release" includes the plugin and its browser snapshot unless the user explicitly excludes one. Preserve the configured native marketplace source, including local live development; do not replace it or reopen unrelated panels.

## Freeze and validate

1. Read the source owners' released checkpoints and both repositories' instructions. Resolve the actual content checkout, viewer repository, branch/upstream, native plugin source, and current dirty files. Preserve unrelated work and serialize shared Git and delivery operations.
2. Select an unused semantic version. Update `package.json`, `.plugin/plugin.json`, `.plugin/marketplace.json`, and the existing package-version test together. Do not overwrite an existing version or snapshot tag.
3. Use the content checkout's pinned Node version and dependencies. From that checkout, run `node <viewer>/scripts/test.mjs --root "$PWD"` and `node --test --test-concurrency=1 <viewer>/tests/*.browser.mjs`. Run its documented source validation command. Fix concrete integration failures without discarding accepted content changes.
4. Inspect the complete intended diff, including new assets and source documents that enter the portable library. Ensure no private host state, credentials, or confidential material enters either repository or the public snapshot.
5. Commit and push coherent signed changes to the approved repositories, respecting hooks and configured signing. Reconcile remote updates without unapproved force-push. Pin both final heads and verify remote readback and GitHub signatures. Create a signed `v<version>` tag and a normal software release.

## Build and publish the matching snapshot

From the prepared content checkout, using a new output directory outside both repositories:

```sh
node <viewer>/scripts/release-snapshot.mjs \
  --root "$PWD" --tag snapshot-v<version> --output <new-output-directory>
```

The viewer must be clean. Prefer the released content revision; if explicitly including saved content changes, disclose the working-change flag and keep sources frozen during export. The command renders every chapter and verifies source stability. Inspect the resulting HTML and its embedded document corpus before public publication.

```sh
node <viewer>/scripts/release-snapshot.mjs \
  --output <reviewed-output-directory> \
  --publish --repository chryw/vscode-design-system --allow-public
```

Use `--allow-public` only with authority to publish that content publicly. Preserve repository visibility and Pages protection rules. If upload or verification fails, inspect the existing draft and assets before retrying; never overwrite immutable snapshot assets. Do not create another snapshot merely to retry deployment.

## Verify the Action and native delivery

The **Deploy snapshot releases** GitHub Action verifies the assets, deploys all versioned snapshots, preserves old URLs, and adds the deployed link to the matching software release. The link step requires an exact viewer commit match and preserves the rest of the release notes.

Wait for the actual workflow result, then fetch the versioned URL and verify a rendered chapter plus an interactive example. If the event did not start a run, dispatch `snapshots-pages.yml` on the approved default branch. Respect environment approvals; a queued deployment is not success.

Use the native plugin manager to update the existing enabled plugin when needed. A configured live marketplace already reads the source: preserve that setup. Use supported session customization refresh when membership is stale, and distinguish installation, source adoption, and actual panel verification. Reuse an existing panel rather than creating duplicate IDs.

Return the software release, versioned Pages URL, verified revisions and test results. Report delivery blockers explicitly. No snapshot or software release is complete merely because upload succeeded.
