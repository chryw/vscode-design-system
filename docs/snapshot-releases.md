# Snapshot releases

A snapshot is a frozen book that opens in a browser without VS Code. For a software release and its matching snapshot, follow the [release workflow](../.github/skills/release/SKILL.md). For access-controlled sharing, use [private review snapshots](private-review.md).

## Build and inspect without publishing

From the viewer clone, build against a [prepared VS Code checkout](setup.md#component-apis-and-live-examples). Use a new output directory:

```sh
node scripts/release-snapshot.mjs \
  --root /path/to/vscode-checkout \
  --tag snapshot-vX.Y.Z \
  --output /tmp/design-system-snapshot
```

The build validates the book, exports it, and opens every chapter in Chromium. Inspect `design-system.html` and its embedded content before sharing. Release builds include only documents referenced as chapter guidance; review that selection for unpublished or confidential material.

The toolbar's **Snapshot details** popup shows the viewer version, capture date, source checkout branch and base revision, and whether saved working changes are included. It replaces the introductory snapshot notice. Narrow layouts keep a compact chevron button; snapshots have no checkout-switching or Refresh action.

On GitHub Pages, **Version** in that popup selects any published snapshot. Older snapshots expose the same selector in their existing snapshot-information disclosure. Switching keeps the current chapter when it exists in the selected version; otherwise it opens that version's first chapter. Each deployment derives the choices from verified release assets, so the list updates when another snapshot is published.

This navigation is added only to hosted pages, using deployment tooling from the viewer's default branch rather than each snapshot's pinned revision. Offline downloads and release assets remain unchanged and self-contained. The checksum in `snapshot.json` identifies the original snapshot HTML; deployment verification removes only the marked hosted-navigation block before checking that checksum.

## Publish a release

Use a clean viewer checkout whose source commit exists in the destination repository. Configure Pages to deploy with **GitHub Actions**. When public publication is approved, publish the reviewed output:

```sh
node scripts/release-snapshot.mjs \
  --output /tmp/design-system-snapshot \
  --publish --repository chryw/vscode-design-system --allow-public
```

Wait for **Deploy snapshot releases** to succeed before sharing `snapshots/<snapshot-tag>/` under the Pages URL. The Pages root shows the latest snapshot; GitHub Releases provides the HTML download. Preserve existing snapshot tags and assets so those links keep working.
